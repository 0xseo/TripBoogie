import type { Invite, Trip, Workspace } from "../types";
import { ApiError, object, uuid } from "./validation";

type Options = {
  url: string;
  publishableKey: string;
  authorization: string;
  fetch?: typeof globalThis.fetch;
};

/** The user's JWT reaches Postgres; management credentials never enter runtime. */
export class TripRepository {
  private endpoint: URL;
  constructor(private options: Options) {
    this.endpoint = new URL("/rest/v1/rpc/tripboogie_api", options.url);
    if (this.endpoint.protocol !== "https:" || !options.publishableKey)
      throw new ApiError(503, "데이터베이스 연결이 준비되지 않았습니다.", "DATABASE_UNAVAILABLE");
    if (!/^Bearer [A-Za-z0-9._-]+$/.test(options.authorization) || options.authorization.length > 16384)
      throw new ApiError(401, "로그인이 필요합니다.", "UNAUTHENTICATED");
  }

  private async rpc<T>(operation: string, tripId: string | null = null, payload: unknown = {}): Promise<T> {
    let response: Response;
    try {
      response = await (this.options.fetch ?? globalThis.fetch)(this.endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          apikey: this.options.publishableKey,
          authorization: this.options.authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_operation: operation, p_trip_id: tripId, p_payload: payload }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApiError(503, "여행 저장소에 연결하지 못했습니다. 연결 후 다시 확인해 주세요.", "DATABASE_UNAVAILABLE");
    }
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = value as { code?: unknown; message?: unknown; details?: unknown } | null;
      const status = typeof error?.code === "string" && /^PT(400|401|403|404|409|413)$/.test(error.code)
        ? Number(error.code.slice(2)) : null;
      if (status && typeof error?.message === "string")
        throw new ApiError(status, error.message,
          typeof error.details === "string" && /^[A-Z_]+$/.test(error.details) ? error.details : "INVALID_REQUEST");
      if (response.status === 401)
        throw new ApiError(401, "로그인이 만료되었습니다. 다시 로그인해 주세요.", "UNAUTHENTICATED");
      throw new ApiError(503, "여행 저장소 설정을 확인하지 못했습니다. 잠시 후 다시 시도하세요.", "DATABASE_UNAVAILABLE");
    }
    if (value === null) throw new ApiError(503, "여행 저장소 응답이 올바르지 않습니다.", "DATABASE_UNAVAILABLE");
    return value as T;
  }

  list(): Promise<Trip[]> { return this.rpc("list"); }
  workspace(id: string): Promise<Workspace> { return this.rpc("workspace", uuid(id)); }
  create(input: unknown): Promise<Workspace> { return this.rpc("create", null, { data: object(input) }); }
  mutate(id: string, input: unknown): Promise<Workspace> { return this.rpc("mutate", uuid(id), object(input)); }
  listInvites(id: string): Promise<Invite[]> { return this.rpc("list-invites", uuid(id)); }
  async createInvite(id: string, input: unknown, origin: string) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const url = invitationUrl(origin, token);
    const result = await this.rpc<{ id: string; expiresAt: string }>("create-invite", uuid(id), { ...object(input), token });
    return { ...result, url };
  }
  revokeInvite(id: string, input: unknown): Promise<{ ok: true }> { return this.rpc("revoke-invite", uuid(id), object(input)); }
  invitePreview(token: string): Promise<{ tripTitle: string; destination: string; role: string; expiresAt: string }> { return this.rpc("preview-invite", null, { token }); }
  join(token: string): Promise<Workspace> { return this.rpc("join", null, { token }); }
  removeMember(id: string, userId: string): Promise<Workspace> { return this.rpc("remove-member", uuid(id), { userId }); }
}

export function invitationUrl(origin: string, token: string): string {
  let base: URL;
  try { base = new URL(origin); } catch { throw new ApiError(400, "초대 링크의 앱 주소를 확인하세요."); }
  if ((base.protocol !== "https:" && base.protocol !== "http:") || base.origin !== origin || base.username || base.password)
    throw new ApiError(400, "초대 링크에는 앱의 기본 출처 주소가 필요합니다.");
  if (!/^[0-9a-f]{64}$/.test(token)) throw new ApiError(400, "초대 토큰 형식을 확인하세요.");
  return new URL(`/invite/${token}`, base).href;
}
