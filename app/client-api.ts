"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
export interface AuthConfig {
  url: string;
  publishableKey: string;
  providers: { email: boolean; google: boolean; kakao: boolean };
}
let configPromise: Promise<AuthConfig> | undefined;
let clientPromise: Promise<SupabaseClient | null> | undefined;
export function getAuthConfig(): Promise<AuthConfig> {
  return (configPromise ??= fetch("/api/auth-config", { cache: "no-store" })
    .then(async (r) => {
      if (!r.ok) throw new Error("로그인 연결을 확인하지 못했어요.");
      return z
        .object({
          url: z.string(),
          publishableKey: z.string(),
          providers: z.object({ email: z.boolean(), google: z.boolean(), kakao: z.boolean() }),
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
              detectSessionInUrl: true,
              storageKey: "tripboogie-auth",
            },
          })
        : null,
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
    public payload?: unknown,
  ) {
    super(message);
  }
}
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const client = await getSupabaseClient();
  if (client) {
    const { data, error } = await client.auth.getSession();
    if (error) throw new ApiError("로그인을 다시 확인해 주세요.", 401);
    if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = z
      .object({
        error: z.union([z.string(), z.object({ message: z.string().optional() })]).optional(),
        message: z.string().optional(),
      })
      .safeParse(payload);
    const detail = parsed.success ? parsed.data : null;
    const message =
      (typeof detail?.error === "string" ? detail.error : detail?.error?.message) ??
      detail?.message ??
      "변경 사항을 저장하지 못했어요.";
    throw new ApiError(message, response.status, payload);
  }
  return payload as T;
}
export async function signOut(): Promise<void> {
  const client = await getSupabaseClient();
  if (client) {
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }
  for (const key of Object.keys(localStorage))
    if (key.startsWith("tripboogie-cache:")) localStorage.removeItem(key);
  location.assign("/");
}
