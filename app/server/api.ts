import type { CurrentUser } from "../types";
import { TripRepository } from "./repository";
import { isNativeOrigin, nativeCorsHeaders } from "./origin-policy";
import {
  ApiError,
  assertSameOrigin,
  readJson,
  requestOrigin,
} from "./validation";

type Dependencies = {
  repository: (request: Request) => TripRepository;
  resolveUser: (request: Request) => Promise<CurrentUser | null>;
};

const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: privateHeaders });
}
async function workspaceJson(request: Request, value: unknown) {
  const body = JSON.stringify(value);
  const origin = request.headers.get("Origin");
  const headers = { ...privateHeaders, ...nativeCorsHeaders(origin), Vary: "Authorization, Origin", "Content-Type": "application/json" };
  // Production 304 delivery strips native CORS even when attached here.
  // Full snapshots retire existing APK validators and avoid that delivery path.
  if (isNativeOrigin(origin)) return new Response(body, { headers });
  // No private response cache: authentication and the repository run before every comparison.
  let etag: string | undefined;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    etag = `W/"${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}"`;
  } catch { /* A missing digest implementation must not prevent reading a trip. */ }
  const unchanged = etag !== undefined && request.headers.get("If-None-Match")?.split(",").some(candidate => candidate.trim() === etag);
  return new Response(unchanged ? null : body, {
    status: unchanged ? 304 : 200,
    headers: { ...headers, ...(etag ? { ETag: etag } : {}) },
  });
}

// Identity is injected at the transport boundary. Tests substitute a verified
// identity adapter; production always calls the configured Auth provider.
export function createApiHandler(deps: Dependencies) {
  return async function handle(
    request: Request,
    segments: string[],
  ): Promise<Response> {
    try {
      let user: CurrentUser | null;
      try {
        user = await deps.resolveUser(request);
      } catch {
        throw new ApiError(
          503,
          "로그인 서비스에 연결하지 못했습니다. 잠시 후 다시 시도하세요.",
          "AUTH_UNAVAILABLE",
        );
      }
      const method = request.method.toUpperCase();
      if (segments.length === 1 && segments[0] === "me" && method === "GET")
        return json({ user, signInUrl: "#login", signOutUrl: "#logout" });
      if (segments.length === 1 && segments[0] === "bootstrap" && method === "GET") {
        if (!user) return json({ user: null, profile: null, trips: [] });
        const repository = deps.repository(request);
        const [profile, trips] = await Promise.all([repository.profile(), repository.list()]);
        return json({ user, profile, trips });
      }
      if (!user)
        throw new ApiError(401, "로그인이 필요합니다.", "UNAUTHENTICATED");
      const repository = deps.repository(request);
      if(segments.length===1&&segments[0]==="account"&&(method==="DELETE"||method==="POST"))return json(await repository.accountStatus(method==="DELETE"?"withdraw":"restore",await readJson(request)));
      if (segments.length === 1 && segments[0] === "profile") {
        if (method === "GET") return json(await repository.profile());
        if (method === "POST")
          return json(await repository.updateProfile(await readJson(request)));
      }
      if (
        segments[0] === "trips" &&
        segments[2] === "actions" &&
        segments.length === 4 &&
        method === "POST" &&
        [
          "save-plan",
          "save-overview",
          "save-travel-time",
          "save-booking",
          "save-expense",
          "ensure-hotel-plan",
          "update-settings",
          "checklist-toggle",
          "reorder-checklist",
          "prepare-file",
          "set-file-tags",
          "set-files-tags",
          "mark-files-delete",
          "finish-files-delete",
          "finish-file",
          "mark-file-delete",
          "finish-file-delete",
        ].includes(segments[3])
      )
        return json(
          await repository.command(
            segments[1],
            segments[3],
            await readJson(request, ["reorder-checklist", "save-overview"].includes(segments[3]) ? 262144 : 65536),
          ),
        );
      if (segments.length === 1 && segments[0] === "trips") {
        if (method === "GET") return json({ trips: await repository.list() });
        if (method === "POST")
          return json(await repository.create(await readJson(request)), 201);
      }
      if (segments.join("/") === "trips/import" && method === "POST")
        return json(
          await repository.import(await readJson(request, 4194304)),
          201,
        );
      if (segments[0] === "trips" && segments.length === 2) {
        if (method === "GET")
          return await workspaceJson(request, await repository.workspace(segments[1]));
        if (method === "DELETE")
          return json(
            await repository.deleteTrip(segments[1], await readJson(request)),
          );
        if (method === "POST")
          return json(
            await repository.mutate(segments[1], await readJson(request)),
          );
      }
      if (
        segments[0] === "trips" &&
        segments[2] === "map-place" &&
        segments.length === 3 &&
        method === "POST"
      )
        return json(
          await repository.addPlace(segments[1], await readJson(request)),
          201,
        );
      if (
        segments[0] === "trips" &&
        segments[2] === "schedule" &&
        segments.length === 3 &&
        method === "POST"
      )
        return json(
          await repository.schedule(
            segments[1],
            await readJson(request, 262144),
          ),
        );
      if (
        segments[0] === "trips" &&
        segments[2] === "invites" &&
        segments.length === 3
      ) {
        if (method === "GET")
          return json({ invites: await repository.listInvites(segments[1]) });
        if (method === "POST")
          return json(
            await repository.createInvite(
              segments[1],
              await readJson(request),
              requestOrigin(request),
            ),
            201,
          );
        if (method === "DELETE")
          return json(
            await repository.revokeInvite(segments[1], await readJson(request)),
          );
      }
      if (
        segments[0] === "trips" &&
        segments[2] === "members" &&
        segments.length === 4 &&
        method === "DELETE"
      ) {
        assertSameOrigin(request);
        return json(await repository.removeMember(segments[1], segments[3]));
      }
      if (segments[0] === "invites" && segments.length === 2) {
        if (method === "GET")
          return json(await repository.invitePreview(segments[1]));
        if (method === "POST") {
          await readJson(request);
          return json(await repository.join(segments[1]));
        }
      }
      throw new ApiError(404, "API 경로를 찾을 수 없습니다.", "NOT_FOUND");
    } catch (error) {
      if (error instanceof ApiError)
        return json({ error: error.message, code: error.code }, error.status);
      console.error("Trip API operation failed");
      return json(
        {
          error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.",
          code: "INTERNAL_ERROR",
        },
        500,
      );
    }
  };
}
