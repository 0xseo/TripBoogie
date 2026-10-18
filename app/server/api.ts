import type { CurrentUser } from "../types";
import { TripRepository } from "./repository";
import { ApiError, assertSameOrigin, readJson } from "./validation";

type Dependencies = {
  repository: (request: Request) => TripRepository;
  resolveUser: (request: Request) => Promise<CurrentUser | null>;
};

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// Identity is injected at the transport boundary. Tests substitute a verified
// identity adapter; production always calls the configured Auth provider.
export function createApiHandler(deps: Dependencies) {
  return async function handle(request: Request, segments: string[]): Promise<Response> {
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
      if (!user) throw new ApiError(401, "로그인이 필요합니다.", "UNAUTHENTICATED");
      const repository = deps.repository(request);
      if (segments.length === 1 && segments[0] === "trips") {
        if (method === "GET") return json({ trips: await repository.list() });
        if (method === "POST")
          return json(await repository.create(await readJson(request)), 201);
      }
      if (segments[0] === "trips" && segments.length === 2) {
        if (method === "GET") return json(await repository.workspace(segments[1]));
        if (method === "POST")
          return json(await repository.mutate(segments[1], await readJson(request)));
      }
      if (segments[0] === "trips" && segments[2] === "invites" && segments.length === 3) {
        if (method === "GET")
          return json({ invites: await repository.listInvites(segments[1]) });
        if (method === "POST")
          return json(
            await repository.createInvite(
              segments[1],
              await readJson(request),
              new URL(request.url).origin,
            ),
            201,
          );
        if (method === "DELETE")
          return json(await repository.revokeInvite(segments[1], await readJson(request)));
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
        if (method === "GET") return json(await repository.invitePreview(segments[1]));
        if (method === "POST") {
          assertSameOrigin(request);
          if (request.body) await readJson(request);
          return json(await repository.join(segments[1]));
        }
      }
      throw new ApiError(404, "API 경로를 찾을 수 없습니다.", "NOT_FOUND");
    } catch (error) {
      if (error instanceof ApiError)
        return json({ error: error.message, code: error.code }, error.status);
      console.error("Trip API operation failed");
      return json(
        { error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.", code: "INTERNAL_ERROR" },
        500,
      );
    }
  };
}
