export type SocialProvider = "google" | "kakao";
export interface NativeAuthPlugin {
  signIn(options: { provider: SocialProvider; nonce: string }): Promise<{ idToken: string }>;
  clearProviderSession(): Promise<void>;
  getItem(options: { key: string }): Promise<{ value: string | null }>;
  setItem(options: { key: string; value: string }): Promise<void>;
  removeItem(options: { key: string }): Promise<void>;
}
/** Show fixed messages only; provider responses may contain credentials or account data. */
export function nativeLoginErrorMessage(provider: SocialProvider, failure: unknown): string {
  const details = typeof failure === "object" && failure !== null ? failure as { code?: unknown; message?: unknown } : {};
  const code = typeof details.code === "string" ? details.code : typeof details.message === "string" ? details.message : "";
  switch (code) {
    case "CANCELLED": return "로그인이 취소됐어요. 다시 시작할 수 있어요.";
    case "ID_TOKEN_MISSING": return provider === "kakao"
      ? "카카오 ID 토큰이 발급되지 않았어요. 서비스 관리자는 카카오 Developers → 카카오 로그인 → OpenID Connect가 ON인지 확인해 주세요. [ID_TOKEN_MISSING]"
      : "Google 인증 정보를 받지 못했어요. 다시 로그인해 주세요. [ID_TOKEN_MISSING]";
    case "KAKAO_LOGIN_FAILED": return "카카오 인증을 완료하지 못했어요. 카카오 로그인과 앱 등록 설정을 확인해 주세요. [KAKAO_LOGIN_FAILED]";
    case "GOOGLE_LOGIN_FAILED": return "Google 인증을 완료하지 못했어요. 앱 등록 설정과 네트워크를 확인해 주세요. [GOOGLE_LOGIN_FAILED]";
    case "NATIVE_TOKEN_VERIFICATION_FAILED": return "로그인 인증 정보의 서버 검증에 실패했어요. 서비스 관리자는 로그인 제공자 설정을 확인해 주세요. [NATIVE_TOKEN_VERIFICATION_FAILED]";
    case "NATIVE_SESSION_VERIFICATION_FAILED": return "로그인 세션을 확인하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요. [NATIVE_SESSION_VERIFICATION_FAILED]";
    case "SECURE_STORAGE_FAILED": return "로그인 정보를 기기에 안전하게 저장하거나 불러오지 못했어요. 앱을 다시 열어 주세요. [SECURE_STORAGE_FAILED]";
    case "BUSY": return "이미 로그인을 진행하고 있어요. 현재 로그인을 마친 뒤 다시 시도해 주세요.";
    default: return "앱 로그인에 실패했어요. 네트워크와 로그인 서비스 설정을 확인해 주세요.";
  }
}
/** Accept app-owned auth/invitation links; never forward tokens from arbitrary URLs. */
export function nativeLinkPath(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (value.length > 8192 || url.username || url.password || url.port || url.hash) return null;
  if (url.protocol === "tripboogie:" && url.hostname === "auth" && url.pathname === "/callback") {
    if ([...url.searchParams.keys()].some((key) => !["code", "error", "error_code", "error_description", "next", "recovery"].includes(key))) return null;
    if ([...new Set(url.searchParams.keys())].some((key) => url.searchParams.getAll(key).length !== 1)) return null;
    const code = url.searchParams.get("code");
    if (code && !/^[A-Za-z0-9._~-]{1,2048}$/.test(code)) return null;
    const next = url.searchParams.get("next");
    if (next && !/^\/invite\/[a-f0-9]{64}$/.test(next)) return null;
    if (!code && !url.searchParams.has("error") && !url.searchParams.has("error_code")) return null;
    return "/auth/callback" + url.search;
  }
  if (url.protocol === "https:" && url.origin === "https://tripboogie.0xseo94.com" && /^\/invite\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) return url.pathname;
  if (url.protocol === "tripboogie:" && url.hostname === "invite" && /^\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) return "/invite" + url.pathname;
  return null;
}
