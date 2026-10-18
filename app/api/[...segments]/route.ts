import { env } from "cloudflare:workers";
import { createApiHandler } from "../../server/api";
import { resolveRequestUser } from "../../server/auth-provider";

export const dynamic = "force-dynamic";

async function route(request: Request, context: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await context.params;
  if (!env.DB)
    return Response.json(
      { error: "데이터베이스 연결이 준비되지 않았습니다.", code: "DATABASE_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  return createApiHandler({ db: env.DB, resolveUser: resolveRequestUser })(request, segments);
}

export { route as GET, route as POST, route as DELETE };
