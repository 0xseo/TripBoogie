import { Capacitor } from "@capacitor/core";
export const productionOrigin = "https://tripboogie.0xseo94.com";
export const isNativeApp = () => Capacitor.isNativePlatform();
export function apiUrl(path: string) {
  if (!path.startsWith("/api/") || path.startsWith("//") || path.includes("\\"))
    throw new Error("Invalid API path");
  const url = new URL(path, productionOrigin);
  if (url.origin !== productionOrigin || !url.pathname.startsWith("/api/")) throw new Error("Invalid API path");
  return isNativeApp() ? url.href : path;
}
export function authRedirect(returnPath = "/", recovery = false) {
  const url = new URL("tripboogie://auth/callback");
  if (/^\/invite\/[a-f0-9]{64}$/.test(returnPath)) url.searchParams.set("next", returnPath);
  if (recovery) url.searchParams.set("recovery", "1");
  return url.href;
}
