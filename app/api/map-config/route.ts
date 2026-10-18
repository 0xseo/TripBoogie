import { env } from "cloudflare:workers";
export async function GET() {
  return Response.json(
    { browserKey: env.GOOGLE_MAPS_BROWSER_KEY ?? "", mapId: env.GOOGLE_MAPS_MAP_ID ?? "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
