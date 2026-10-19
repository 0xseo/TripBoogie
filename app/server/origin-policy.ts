const nativeOrigins = new Set(["capacitor://localhost", "https://localhost"]);
export function isNativeOrigin(origin: string | null): boolean {
  return origin !== null && nativeOrigins.has(origin);
}
export function nativeCorsHeaders(origin: string | null): Record<string, string> {
  return isNativeOrigin(origin) ? {
    "Access-Control-Allow-Origin": origin!,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  } : {};
}
