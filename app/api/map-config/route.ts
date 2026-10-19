export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({provider:"openfreemap", searchReady:Boolean(process.env.GEOAPIFY_API_KEY)},
    {headers:{"Cache-Control":"no-store"}});
}
