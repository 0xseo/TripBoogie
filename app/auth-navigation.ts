const invitation = /^\/invite\/[a-f0-9]{64}$/;
export function safeReturnPath(value: unknown) {
  return typeof value === "string" && invitation.test(value) ? value : "/";
}
export function callbackUrl(origin: string, returnPath = "/") {
  const url = new URL("/auth/callback", origin);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("보안 연결에서 로그인해 주세요.");
  const next = safeReturnPath(returnPath);
  if (next !== "/") url.searchParams.set("next", next);
  return url.href;
}
export function embeddedBrowser(userAgent: string) {
  return /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|; wv\)|\bwv\b/i.test(userAgent);
}
export function callbackFailure(params: URLSearchParams) {
  if (!params.has("error") && !params.has("error_code")) return "";
  return /access_denied|cancel/i.test(params.get("error") || "")
    ? "로그인이 취소됐어요. 다시 시작할 수 있어요."
    : "로그인을 완료하지 못했어요. 같은 브라우저에서 다시 시작해 주세요.";
}
