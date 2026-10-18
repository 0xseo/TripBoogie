import type { CurrentUser, ItemKind, ItemRecord, Member, Role, Trip, Workspace } from "../types";
import {
  ApiError,
  inviteRole,
  itemData,
  itemKind,
  object,
  tripData,
  uuid,
  version,
} from "./validation";

type Row = Record<string, unknown>;
const WRITE_ROLES = "('owner','editor')";
const accessSql = (roles = "('owner','editor','viewer')") =>
  `EXISTS (SELECT 1 FROM trip_members auth WHERE auth.trip_id = ? AND auth.user_id = ? AND auth.role IN ${roles})`;
// Full-workspace polling stays bounded: 2 MiB of user JSON, up to 5000 record
// envelopes, and 100 members. Tombstones have their own retained-row budget.
const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024;
const MAX_LIVE_RECORDS = 5000;
const MAX_STORED_RECORDS = 20000;

function tripFromRow(row: Row): Trip {
  return {
    id: String(row.id),
    title: String(row.title),
    destination: String(row.destination),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    currency: String(row.currency),
    timezone: String(row.timezone),
    version: Number(row.version),
    revision: Number(row.revision),
    role: row.role as Role,
    memberCount: Number(row.member_count),
    updatedAt: String(row.updated_at),
    createdAt: String(row.created_at),
  };
}

export class TripRepository {
  constructor(private db: D1Database) {}

  private statement(sql: string, ...values: (string | number | null)[]) {
    return this.db.prepare(sql).bind(...values);
  }

  private userStatement(user: CurrentUser, now: string) {
    return this.statement(
      "INSERT INTO users (id,name,email,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
      user.id,
      user.name,
      user.email,
      now,
    );
  }

  async list(user: CurrentUser): Promise<Trip[]> {
    const rows = await this.statement(
      `SELECT t.*,m.role,(SELECT COUNT(*) FROM trip_members n WHERE n.trip_id=t.id) member_count FROM trips t JOIN trip_members m ON m.trip_id=t.id AND m.user_id=? ORDER BY t.updated_at DESC`,
      user.id,
    ).all<Row>();
    return rows.results.map(tripFromRow);
  }

  async workspace(id: string, user: CurrentUser): Promise<Workspace> {
    uuid(id);
    // D1 batch gives the trip, records, and membership one transaction snapshot.
    const results = await this.db.batch<Row>([
      this.statement(
        "SELECT t.*,m.role,(SELECT COUNT(*) FROM trip_members n WHERE n.trip_id=t.id) member_count FROM trips t JOIN trip_members m ON m.trip_id=t.id AND m.user_id=? WHERE t.id=?",
        user.id,
        id,
      ),
      this.statement(
        `SELECT id,kind,data_json,version,updated_at,updated_by FROM trip_records WHERE trip_id=? AND deleted=0 AND ${accessSql()} ORDER BY updated_at,id`,
        id,
        id,
        user.id,
      ),
      this.statement(
        `SELECT u.id,u.name,u.email,m.role FROM trip_members m JOIN users u ON u.id=m.user_id WHERE m.trip_id=? AND ${accessSql()} ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,m.created_at`,
        id,
        id,
        user.id,
      ),
    ]);
    const row = results[0].results[0];
    if (!row) throw new ApiError(404, "여행을 찾을 수 없거나 접근 권한이 없습니다.", "NOT_FOUND");
    const trip = tripFromRow(row);
    const records: ItemRecord[] = results[1].results.map((item) => ({
      id: String(item.id),
      kind: item.kind as ItemKind,
      data: JSON.parse(String(item.data_json)) as Record<string, unknown>,
      version: Number(item.version),
      updatedAt: String(item.updated_at),
      updatedBy: String(item.updated_by),
    }));
    return {
      trip,
      records,
      members: results[2].results as unknown as Member[],
      revision: trip.revision,
    };
  }

  private async permission(id: string, user: CurrentUser, owner = false): Promise<Row> {
    uuid(id);
    const row = await this.statement(
      "SELECT t.*,m.role FROM trips t JOIN trip_members m ON m.trip_id=t.id AND m.user_id=? WHERE t.id=?",
      user.id,
      id,
    ).first<Row>();
    if (!row) throw new ApiError(404, "여행을 찾을 수 없거나 접근 권한이 없습니다.", "NOT_FOUND");
    if (owner ? row.role !== "owner" : row.role === "viewer")
      throw new ApiError(
        403,
        owner ? "여행 소유자만 관리할 수 있습니다." : "열람 권한으로는 수정할 수 없습니다.",
        "FORBIDDEN",
      );
    return row;
  }

  async create(user: CurrentUser, input: unknown): Promise<Workspace> {
    const data = tripData(input);
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    const results = await this.db.batch([
      this.userStatement(user, now),
      this.statement(
        `INSERT INTO trips (id,title,destination,start_date,end_date,currency,timezone,version,revision,created_at,updated_at) SELECT ?,?,?,?,?,?,?,1,1,?,? WHERE (SELECT COUNT(*) FROM trip_members WHERE user_id=?)<100`,
        id,
        data.title,
        data.destination,
        data.startDate,
        data.endDate,
        data.currency,
        data.timezone,
        now,
        now,
        user.id,
      ),
      this.statement(
        "INSERT INTO trip_members (trip_id,user_id,role,created_at) SELECT ?,?,'owner',? WHERE EXISTS(SELECT 1 FROM trips WHERE id=?)",
        id,
        user.id,
        now,
        id,
      ),
    ]);
    if (!results[1].meta.changes)
      throw new ApiError(409, "계정당 여행은 최대 100개까지 만들 수 있습니다.", "CAPACITY");
    return this.workspace(id, user);
  }

  async mutate(id: string, user: CurrentUser, input: unknown): Promise<Workspace> {
    const current = await this.permission(id, user);
    const body = object(input);
    const now = new Date().toISOString();
    if (body.action === "update-trip") {
      const data = tripData({
        title: current.title,
        destination: current.destination,
        startDate: current.start_date,
        endDate: current.end_date,
        currency: current.currency,
        timezone: current.timezone,
        ...object(body.data),
      });
      const expectedVersion = version(body.version);
      const result = await this.statement(
        `UPDATE trips SET title=?,destination=?,start_date=?,end_date=?,currency=?,timezone=?,version=version+1,revision=revision+1,updated_at=? WHERE id=? AND version=? AND ${accessSql(WRITE_ROLES)} AND NOT EXISTS(SELECT 1 FROM trip_records r WHERE r.trip_id=trips.id AND r.deleted=0 AND r.kind='plan' AND (json_extract(r.data_json,'$.date')<? OR json_extract(r.data_json,'$.date')>?))`,
        data.title,
        data.destination,
        data.startDate,
        data.endDate,
        data.currency,
        data.timezone,
        now,
        id,
        expectedVersion,
        id,
        user.id,
        data.startDate,
        data.endDate,
      ).run();
      if (!result.meta.changes) {
        await this.permission(id, user);
        throw new ApiError(
          409,
          "다른 기기에서 여행이 수정되었거나 새 기간 밖에 일정이 있습니다. 새로고침 후 확인하세요.",
          "CONFLICT",
        );
      }
      return this.workspace(id, user);
    }
    if (body.action !== "upsert" && body.action !== "delete")
      throw new ApiError(400, "지원하지 않는 작업입니다.");
    const recordId =
      body.id === undefined && body.action === "upsert" ? crypto.randomUUID() : uuid(body.id);
    let kind: ItemKind;
    if (body.kind === undefined && body.action === "delete") {
      const record = await this.statement(
        "SELECT kind FROM trip_records WHERE id=? AND trip_id=? AND deleted=0",
        recordId,
        id,
      ).first<Row>();
      if (!record) throw new ApiError(409, "항목이 이미 삭제되었거나 변경되었습니다.", "CONFLICT");
      kind = itemKind(record.kind);
    } else kind = itemKind(body.kind);
    const expectedVersion =
      body.version === undefined && body.action === "upsert" ? null : version(body.version);
    const data = body.action === "upsert" ? itemData(kind, body.data) : {};
    if (
      kind === "plan" &&
      body.action === "upsert" &&
      (String(data.date) < String(current.start_date) ||
        String(data.date) > String(current.end_date))
    )
      throw new ApiError(400, "일정 날짜는 여행 기간 안에 있어야 합니다.");
    const json = JSON.stringify(data);
    const mutation = crypto.randomUUID();
    let operation: D1PreparedStatement;
    // The range and referenced-place checks are part of the mutation itself to
    // protect against concurrent trip/date/place changes after validation.
    const planGuard = `(? <> 'plan' OR EXISTS(SELECT 1 FROM trips t WHERE t.id=? AND json_extract(?,'$.date') BETWEEN t.start_date AND t.end_date AND (COALESCE(json_extract(?,'$.placeId'),'')='' OR EXISTS(SELECT 1 FROM trip_records p WHERE p.id=json_extract(?,'$.placeId') AND p.trip_id=t.id AND p.kind='place' AND p.deleted=0))))`;
    if (body.action === "delete") {
      operation = this.statement(
        `UPDATE trip_records SET deleted=1,version=version+1,updated_at=?,updated_by=?,mutation_id=? WHERE id=? AND trip_id=? AND kind=? AND version=? AND deleted=0 AND ${accessSql(WRITE_ROLES)} AND (kind<>'place' OR NOT EXISTS(SELECT 1 FROM trip_records p WHERE p.trip_id=? AND p.kind='plan' AND p.deleted=0 AND json_extract(p.data_json,'$.placeId')=?))`,
        now,
        user.id,
        mutation,
        recordId,
        id,
        kind,
        expectedVersion,
        id,
        user.id,
        id,
        recordId,
      );
    } else if (expectedVersion !== null) {
      operation = this.statement(
        `UPDATE trip_records SET data_json=?,version=version+1,updated_at=?,updated_by=?,mutation_id=? WHERE id=? AND trip_id=? AND kind=? AND version=? AND deleted=0 AND ${accessSql(WRITE_ROLES)} AND ${planGuard} AND COALESCE((SELECT SUM(length(CAST(data_json AS BLOB))) FROM trip_records budget WHERE budget.trip_id=? AND budget.deleted=0),0)-length(CAST(data_json AS BLOB))+length(CAST(? AS BLOB))<=?`,
        json,
        now,
        user.id,
        mutation,
        recordId,
        id,
        kind,
        expectedVersion,
        id,
        user.id,
        kind,
        id,
        json,
        json,
        json,
        id,
        json,
        MAX_WORKSPACE_BYTES,
      );
    } else {
      // Globally unique primary keys plus DO NOTHING prevent cross-trip overwrite
      // and prevent resurrection of a deleted ID when an old client reconnects.
      operation = this.statement(
        `INSERT INTO trip_records (id,trip_id,kind,data_json,version,deleted,mutation_id,updated_at,updated_by) SELECT ?,?,?,?,1,0,?,?,? WHERE ${accessSql(WRITE_ROLES)} AND (SELECT COUNT(*) FROM trip_records WHERE trip_id=? AND deleted=0)<? AND (SELECT COUNT(*) FROM trip_records WHERE trip_id=?)<? AND COALESCE((SELECT SUM(length(CAST(data_json AS BLOB))) FROM trip_records WHERE trip_id=? AND deleted=0),0)+length(CAST(? AS BLOB))<=? AND ${planGuard} ON CONFLICT(id) DO NOTHING`,
        recordId,
        id,
        kind,
        json,
        mutation,
        now,
        user.id,
        id,
        user.id,
        id,
        MAX_LIVE_RECORDS,
        id,
        MAX_STORED_RECORDS,
        id,
        json,
        MAX_WORKSPACE_BYTES,
        kind,
        id,
        json,
        json,
        json,
      );
    }
    const results = await this.db.batch([
      operation,
      this.statement(
        "UPDATE trips SET revision=revision+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM trip_records WHERE id=? AND trip_id=? AND mutation_id=?)",
        now,
        id,
        recordId,
        id,
        mutation,
      ),
    ]);
    if (!results[0].meta.changes) {
      await this.permission(id, user);
      throw new ApiError(
        409,
        "항목이 변경·삭제되었거나 연결 장소·일정 범위·여행 용량을 확인해야 합니다. 새로고침 후 다시 시도하세요.",
        "CONFLICT",
      );
    }
    return this.workspace(id, user);
  }

  async listInvites(id: string, user: CurrentUser) {
    await this.permission(id, user, true);
    const result = await this.statement(
      `SELECT id,role,expires_at expiresAt,revoked_at revokedAt,created_at createdAt FROM trip_invites WHERE trip_id=? AND ${accessSql("('owner')")} ORDER BY (revoked_at IS NULL) DESC,created_at DESC LIMIT 100`,
      id,
      id,
      user.id,
    ).all<Row>();
    return result.results;
  }

  async createInvite(id: string, user: CurrentUser, input: unknown, origin: string) {
    await this.permission(id, user, true);
    const role = inviteRole(object(input).role);
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const url = invitationUrl(origin, token);
    const hash = await hashToken(token);
    const inviteId = crypto.randomUUID(),
      now = new Date().toISOString(),
      expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const result = await this.statement(
      `INSERT INTO trip_invites (id,trip_id,token_hash,role,expires_at,revoked_at,created_at,created_by) SELECT ?,?,?,?,?,NULL,?,? WHERE ${accessSql("('owner')")} AND (SELECT COUNT(*) FROM trip_invites WHERE trip_id=? AND revoked_at IS NULL AND expires_at>?)<20 AND (SELECT COUNT(*) FROM trip_invites WHERE trip_id=?)<1000`,
      inviteId,
      id,
      hash,
      role,
      expiresAt,
      now,
      user.id,
      id,
      user.id,
      id,
      now,
      id,
    ).run();
    if (!result.meta.changes) {
      await this.permission(id, user, true);
      throw new ApiError(
        409,
        "활성 초대는 20개, 누적 초대는 여행당 1000개까지 만들 수 있습니다.",
        "CAPACITY",
      );
    }
    return { id: inviteId, expiresAt, url };
  }

  async revokeInvite(id: string, user: CurrentUser, input: unknown) {
    await this.permission(id, user, true);
    const inviteId = uuid(object(input).id),
      now = new Date().toISOString();
    const result = await this.statement(
      `UPDATE trip_invites SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND trip_id=? AND ${accessSql("('owner')")}`,
      now,
      inviteId,
      id,
      id,
      user.id,
    ).run();
    if (!result.meta.changes) throw new ApiError(404, "초대를 찾을 수 없습니다.", "NOT_FOUND");
    return { ok: true };
  }

  async invitePreview(token: string) {
    const hash = await hashToken(token),
      now = new Date().toISOString();
    const row = await this.statement(
      "SELECT t.title tripTitle,t.destination,i.role,i.expires_at expiresAt FROM trip_invites i JOIN trips t ON t.id=i.trip_id WHERE i.token_hash=? AND i.revoked_at IS NULL AND i.expires_at>?",
      hash,
      now,
    ).first<Row>();
    if (!row) throw new ApiError(404, "초대가 만료되었거나 취소되었습니다.", "INVITE_UNAVAILABLE");
    return row;
  }

  async join(token: string, user: CurrentUser): Promise<Workspace> {
    const hash = await hashToken(token),
      now = new Date().toISOString();
    const results = await this.db.batch([
      this.userStatement(user, now),
      this.statement(
        `INSERT INTO trip_members (trip_id,user_id,role,created_at) SELECT i.trip_id,?,i.role,? FROM trip_invites i WHERE i.token_hash=? AND i.revoked_at IS NULL AND i.expires_at>? AND (SELECT COUNT(*) FROM trip_members WHERE trip_id=i.trip_id)<100 AND (SELECT COUNT(*) FROM trip_members WHERE user_id=?)<100 ON CONFLICT(trip_id,user_id) DO NOTHING`,
        user.id,
        now,
        hash,
        now,
        user.id,
      ),
      // changes() refers directly to the preceding membership insert in this
      // transaction. Existing memberships retain their role and revision.
      this.statement(
        "UPDATE trips SET revision=revision+1,updated_at=? WHERE id=(SELECT trip_id FROM trip_invites WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?) AND changes()=1",
        now,
        hash,
        now,
      ),
      this.statement(
        "SELECT i.trip_id FROM trip_invites i JOIN trip_members m ON m.trip_id=i.trip_id AND m.user_id=? WHERE i.token_hash=? AND i.revoked_at IS NULL AND i.expires_at>?",
        user.id,
        hash,
        now,
      ),
    ]);
    const row = results[3].results[0] as Row | undefined;
    if (!row)
      throw new ApiError(
        409,
        "초대가 만료·취소되었거나 여행/멤버 수 제한에 도달했습니다.",
        "INVITE_UNAVAILABLE",
      );
    return this.workspace(String(row.trip_id), user);
  }

  async removeMember(id: string, targetUser: string, user: CurrentUser) {
    await this.permission(id, user, true);
    if (targetUser === user.id)
      throw new ApiError(400, "소유자는 자신의 멤버십을 제거할 수 없습니다.");
    if (!targetUser || targetUser.length > 256) throw new ApiError(400, "멤버 ID를 확인하세요.");
    const now = new Date().toISOString();
    const results = await this.db.batch([
      this.statement(
        `DELETE FROM trip_members WHERE trip_id=? AND user_id=? AND role<>'owner' AND ${accessSql("('owner')")}`,
        id,
        targetUser,
        id,
        user.id,
      ),
      this.statement(
        "UPDATE trips SET revision=revision+1,updated_at=? WHERE id=? AND changes()=1",
        now,
        id,
      ),
    ]);
    if (!results[0].meta.changes) {
      await this.permission(id, user, true);
      throw new ApiError(404, "멤버를 찾을 수 없습니다.", "NOT_FOUND");
    }
    return this.workspace(id, user);
  }
}

export async function hashToken(token: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(token))
    throw new ApiError(404, "초대 링크를 확인하세요.", "INVITE_UNAVAILABLE");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function invitationUrl(origin: string, token: string): string {
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    throw new ApiError(400, "초대 링크의 앱 주소를 확인하세요.");
  }
  if (
    (base.protocol !== "https:" && base.protocol !== "http:") ||
    base.origin !== origin ||
    base.username ||
    base.password
  )
    throw new ApiError(400, "초대 링크에는 앱의 기본 출처 주소가 필요합니다.");
  if (!/^[0-9a-f]{64}$/.test(token)) throw new ApiError(400, "초대 토큰 형식을 확인하세요.");
  return new URL(`/invite/${token}`, base).href;
}
