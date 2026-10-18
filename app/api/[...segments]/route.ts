import { env } from "cloudflare:workers";
import { createApiHandler } from "../../server/api";
import { resolveRequestUser } from "../../server/auth-provider";
import { TripRepository } from "../../server/repository";
import { ApiError } from "../../server/validation";

export const dynamic = "force-dynamic";

async function route(request: Request, context: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await context.params;
  return createApiHandler({
    resolveUser: resolveRequestUser,
    repository: (currentRequest) => {
      if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
        throw new ApiError(503, "데이터베이스 연결이 준비되지 않았습니다.", "DATABASE_UNAVAILABLE");
      return new TripRepository({
        url: env.SUPABASE_URL,
        publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
        authorization: currentRequest.headers.get("authorization") ?? "",
      });
    },
  })(request, segments);
}

export { route as GET, route as POST, route as DELETE };
