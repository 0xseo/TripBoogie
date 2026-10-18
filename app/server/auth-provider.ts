import { env } from "cloudflare:workers";
import type { CurrentUser } from "../types";

/** Verify every bearer at the authentication boundary. */
export async function resolveRequestUser(request: Request): Promise<CurrentUser | null> {
  const authorization = request.headers.get("authorization");
  if (
    !authorization ||
    !/^Bearer [A-Za-z0-9._-]+$/.test(authorization) ||
    authorization.length > 16384
  )
    return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
    throw new Error("Authentication is not configured");
  const endpoint = new URL("/auth/v1/user", env.SUPABASE_URL);
  if (endpoint.protocol !== "https:") throw new Error("Authentication URL must use HTTPS");
  const response = await fetch(endpoint, {
    headers: { authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("Authentication service is unavailable");
  const raw: unknown = await response.json();
  if (typeof raw !== "object" || raw === null || !("id" in raw) || typeof raw.id !== "string")
    throw new Error("Invalid authentication response");
  const u = raw as { id: string; email?: unknown; user_metadata?: Record<string, unknown> };
  const email = typeof u.email === "string" ? u.email : "";
  const display = u.user_metadata?.full_name ?? u.user_metadata?.name ?? u.user_metadata?.nickname;
  // User metadata is display-only; membership uses the verified stable user ID.
  return {
    id: u.id,
    email,
    name:
      typeof display === "string" && display.trim()
        ? display.slice(0, 200)
        : email.split("@")[0] || "여행 친구",
  };
}
