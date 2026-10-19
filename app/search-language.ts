import type { Profile } from "./types";
import { currencyCountry } from "./countries";
export const searchLanguages = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  zh: "中文",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  it: "Italiano",
  th: "ไทย",
  vi: "Tiếng Việt",
  pt: "Português",
  ru: "Русский",
  id: "Bahasa Indonesia",
  ar: "العربية",
  tr: "Türkçe",
} as const;
export function countryLanguage(country?: string) {
  try {
    const language = new Intl.Locale(`und-${country || "KR"}`).maximize()
      .language;
    return language in searchLanguages ? language : "en";
  } catch {
    return "ko";
  }
}
export function profileSearchLanguage(
  profile?: Pick<
    Profile,
    "searchLanguage" | "holidayCountry" | "baseCurrency"
  > | null,
) {
  return profile?.searchLanguage && profile.searchLanguage in searchLanguages
    ? profile.searchLanguage
    : countryLanguage(
        profile?.holidayCountry ||
          currencyCountry[profile?.baseCurrency || "KRW"],
      );
}
