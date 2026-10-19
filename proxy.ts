import { NextResponse, type NextRequest } from "next/server";
import { nativeCorsHeaders, isNativeOrigin } from "./app/server/origin-policy";
export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: isNativeOrigin(origin) ? 204 : 403, headers: nativeCorsHeaders(origin) });
  }
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(nativeCorsHeaders(origin))) response.headers.set(key, value);
  return response;
}
export const config = { matcher: "/api/:path*" };
