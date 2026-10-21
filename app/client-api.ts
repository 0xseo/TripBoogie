"use client";
import { createClient, isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { apiUrl, isNativeApp } from "./runtime";
import {
  nativeAuthStorage,
  clearNativeProviderSession,
} from "./native-runtime";
export interface AuthConfig {
  url: string;
  publishableKey: string;
  providers: { email: boolean; google: boolean; kakao: boolean };
}
let configPromise: Promise<AuthConfig> | undefined;
let clientPromise: Promise<SupabaseClient | null> | undefined;
export function getAuthConfig(): Promise<AuthConfig> {
  return (configPromise ??= fetchResponse(apiUrl("/api/auth-config"), {
    cache: "no-store",
  })
    .then(async (r) => {
      if (!r.ok) throw new Error("로그인 연결을 확인하지 못했어북");
      return z
        .object({
          url: z.string(),
          publishableKey: z.string(),
          providers: z.object({
            email: z.boolean(),
            google: z.boolean(),
            kakao: z.boolean(),
          }),
        })
        .parse(await r.json());
    })
    .catch((error) => {
      configPromise = undefined;
      throw error;
    }));
}
export function getSupabaseClient(): Promise<SupabaseClient | null> {
  return (clientPromise ??= getAuthConfig()
    .then((c) =>
      c.url && c.publishableKey
        ? createClient(c.url, c.publishableKey, {
            auth: {
              flowType: "pkce",
              autoRefreshToken: true,
              persistSession: true,
              detectSessionInUrl: false,
              storageKey: "tripboogie-auth",
              ...(isNativeApp() ? { storage: nativeAuthStorage } : {}),
            },
          })
        : null
    )
    .catch((error) => {
      clientPromise = undefined;
      throw error;
    }));
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown
  ) {
    super(message);
  }
}
const connectionError = () => new ApiError(
  "서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
  0,
  { code: "NETWORK_UNAVAILABLE" }
);
export function isTemporaryApiError(error: unknown): boolean {
  return error instanceof ApiError && [0, 502, 503, 504].includes(error.status);
}
async function fetchResponse(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, init); }
  catch (error) {
    if (init.signal?.aborted || (error as {name?:string})?.name === "AbortError") throw error;
    throw connectionError();
  }
}
/** Own JSON serialization and headers together, including empty command payloads. */
export function jsonRequest(
  data: unknown = {},
  init: Omit<RequestInit, "body"> = {}
): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return {
    ...init,
    method: init.method ?? "POST",
    headers,
    body: JSON.stringify(data),
  };
}

type ConditionalRead = { etag?: string; receiveEtag: (etag: string | null) => void };
type ApiActivity = { background?: boolean; conditional?: ConditionalRead };

async function performApiFetch<T>(
  path: string,
  init: RequestInit = {},
  conditional?: ConditionalRead
): Promise<T | undefined> {
  const headers = new Headers(init.headers);
  if (conditional?.etag) headers.set("If-None-Match", conditional.etag);
  const client = await getSupabaseClient();
  if (client) {
    const { data, error } = await client.auth.getSession();
    if (error) {
      if (isAuthRetryableFetchError(error)) throw connectionError();
      throw new ApiError("로그인을 다시 확인해 주세요.", 401);
    }
    if (data.session)
      headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  const response = await fetchResponse(apiUrl(path), {
    ...init,
    headers,
    cache: "no-store",
  });
  if (conditional && (response.ok || response.status === 304)) {
    conditional.receiveEtag(response.headers.get("ETag"));
    if (response.status === 304) return undefined;
  }
  let payload: unknown;
  try { payload = await response.json(); }
  catch (error) {
    if (init.signal?.aborted || (error as {name?:string})?.name === "AbortError") throw error;
    if (response.ok) throw new ApiError("서버 응답을 끝까지 받지 못했어요. 다시 시도해 주세요.", 502);
    payload = {};
  }
  if (!response.ok) {
    const parsed = z
      .object({
        error: z
          .union([z.string(), z.object({ message: z.string().optional() })])
          .optional(),
        message: z.string().optional(),
      })
      .safeParse(payload);
    const detail = parsed.success ? parsed.data : null;
    const message =
      (typeof detail?.error === "string"
        ? detail.error
        : detail?.error?.message) ??
      detail?.message ??
      "변경 사항을 저장하지 못했어북";
    throw new ApiError(message, response.status, payload);
  }
  return payload as T;
}
// A single owner tracks pending API work for visible feedback without blocking navigation.
let apiPending = 0;
const activityListeners = new Set<() => void>();
export const getApiPending = () => apiPending;
export function subscribeApiActivity(listener: () => void) {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}
export function apiFetch<T>(path: string, init: RequestInit, activity: ApiActivity & { conditional: ConditionalRead }): Promise<T | undefined>;
export function apiFetch<T>(path: string, init?: RequestInit, activity?: { background?: boolean }): Promise<T>;
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  activity: ApiActivity = {}
): Promise<T | undefined> {
  if (activity.background) return performApiFetch<T>(path, init, activity.conditional);
  apiPending++;
  activityListeners.forEach((listener) => listener());
  try {
    return await performApiFetch<T>(path, init, activity.conditional);
  } finally {
    apiPending--;
    activityListeners.forEach((listener) => listener());
  }
}
export async function signOut(): Promise<void> {
  const client = await getSupabaseClient();
  if (client) {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
  }
  await clearNativeProviderSession().catch(() => {});
  for (const key of Object.keys(localStorage))
    if (key.startsWith("tripboogie-cache:")) localStorage.removeItem(key);
  // A full navigation clears all in-memory private workspace state after logout.
  location.replace("/");
}

// React can mount the callback twice in development. One authorization code is
// exchanged once, while the official SDK owns PKCE verifier and session storage.
let callbackExchange:
  | ReturnType<SupabaseClient["auth"]["exchangeCodeForSession"]>
  | undefined;
export function exchangeCallbackCode(client: SupabaseClient, code: string) {
  return (callbackExchange ??= client.auth.exchangeCodeForSession(code));
}
