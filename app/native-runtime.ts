import { registerPlugin } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NativeAuthPlugin, SocialProvider } from "./native-contract";
import { nativeLinkPath } from "./native-contract";
import { isNativeApp } from "./runtime";
const NativeAuth = registerPlugin<NativeAuthPlugin>("TripBoogieAuth");
export const nativeAuthStorage = {
  async getItem(key: string) { return (await NativeAuth.getItem({ key })).value; },
  async setItem(key: string, value: string) { await NativeAuth.setItem({ key, value }); },
  async removeItem(key: string) { await NativeAuth.removeItem({ key }); },
};
export async function nativeSocialSignIn(client: SupabaseClient, provider: SocialProvider) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) => v.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
  const hashedNonce = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
  const { idToken } = await NativeAuth.signIn({ provider, nonce: hashedNonce });
  if (!idToken || idToken.length > 32768) throw new Error("ID_TOKEN_MISSING");
  const { error } = await client.auth.signInWithIdToken({ provider, token: idToken, nonce });
  if (error) throw new Error("NATIVE_TOKEN_VERIFICATION_FAILED");
  const verified = await client.auth.getUser();
  if (verified.error || !verified.data.user) {
    await client.auth.signOut({ scope: "local" });
    throw new Error("NATIVE_SESSION_VERIFICATION_FAILED");
  }
}
export async function clearNativeProviderSession() {
  if (isNativeApp()) await NativeAuth.clearProviderSession();
}
export async function startNativeApp() {
  if (!isNativeApp()) return;
  const { App } = await import("@capacitor/app");
  let starting = true;
  const opened = (url: string) => {
    const path = nativeLinkPath(url);
    if (!path) return;
    if (starting) history.replaceState(null, "", path);
    else location.replace(path);
  };
  await App.addListener("appUrlOpen", ({ url }) => opened(url));
  const launch = await App.getLaunchUrl();
  if (launch?.url) opened(launch.url);
  starting = false;
}
export async function observeNativeSession(client: SupabaseClient | null) {
  if (!isNativeApp()) return;
  const { App } = await import("@capacitor/app");
  await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) {
      client?.auth.startAutoRefresh();
      window.dispatchEvent(new Event("tripboogie:foreground"));
    }
    else client?.auth.stopAutoRefresh();
  });
  const state = await App.getState();
  if (state.isActive) client?.auth.startAutoRefresh();
}
