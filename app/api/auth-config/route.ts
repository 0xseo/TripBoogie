export const dynamic = "force-dynamic";
export async function GET() {
  const url = process.env.SUPABASE_URL ?? "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  let providers = { email: false, google: false, kakao: false };
  if (url && publishableKey) {
    try {
      const r = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
        headers: { apikey: publishableKey },
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const settings = (await r.json()) as { external?: Record<string, boolean> };
        providers = {
          email: settings.external?.email === true,
          google: settings.external?.google === true,
          kakao: settings.external?.kakao === true,
        };
      }
    } catch {
      /* Availability remains explicitly false. */
    }
  }
  return Response.json(
    { url, publishableKey, providers },
    { headers: { "Cache-Control": "no-store" } },
  );
}
