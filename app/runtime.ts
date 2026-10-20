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
