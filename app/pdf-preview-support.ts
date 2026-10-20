// PDF.js legacy browser baseline: https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsersenvironments-are-supported
export function pdfBrowserError(userAgent: string): string | null {
  const chromium = userAgent.match(/(?:Chrome|Chromium)\/(\d+)/);
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) && userAgent.match(/OS (\d+)[_\.]/);
  const safari =
    /Safari\//.test(userAgent) &&
    !chromium &&
    userAgent.match(/Version\/(\d+)/);
  if (
    (chromium && Number(chromium[1]) < 125) ||
    (ios && Number(ios[1]) < 18) ||
    (safari && Number(safari[1]) < 18)
  )
    return "PDF 미리보기를 사용하려면 브라우저 또는 Android System WebView를 업데이트해 주세요.";
  return null;
}
