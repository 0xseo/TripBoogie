import { boundedJson } from "./http";
import { countryLanguage } from "../search-language";
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export const normalizePlaceName = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}]/gu, "");
/** Wikipedia language links identify the same page; a similar title is never used as a translation. */
export async function resolvePlaceAlias(
  query: string,
  language: string,
  country: string | undefined,
  fetcher: typeof fetch,
  parentSignal?: AbortSignal,
) {
  if ((language === "ko" && !/[가-힣]/u.test(query)) || query.includes("|")) return null;
  const target = country ? countryLanguage(country) : "en";
  if (target === language) return null;
  const source = `https://${language}.wikipedia.org/`;
  const deadline = AbortSignal.any([
    ...(parentSignal ? [parentSignal] : []),
    AbortSignal.timeout(8000),
  ]);
  async function read(params: Record<string, string>) {
    const url = new URL("w/api.php", source);
    Object.entries({ ...params, format: "json" }).forEach(([k, v]) =>
      url.searchParams.set(k, v),
    );
    const response = await fetcher(url, {
      redirect: "error",
      cache: "no-store",
      signal: deadline,
      headers: { "User-Agent": "TripBoogie/0.1.0 (https://tripboogie.0xseo94.com)", Accept: "application/json" },
    });
    return response.ok ? object(await boundedJson(response, 262144)) : {};
  }
  function linkedName(linked: Record<string, unknown>) {
    const pages = object(object(linked.query).pages);
    for (const page of Object.values(pages)) {
      const p = object(page);
      if ("missing" in p || "invalid" in p || "disambiguation" in object(p.pageprops)) continue;
      if (!Array.isArray(p.langlinks)) continue;
      const link = p.langlinks.find((l) => object(l).lang === target);
      const name = object(link)["*"];
      if (
        typeof name === "string" &&
        name.length <= 300 &&
        normalizePlaceName(name) !== normalizePlaceName(query)
      )
        return { query: name, source };
    }
    return null;
  }
  // Exact title resolution follows explicit redirects, avoiding fuzzy search ranking.
  // A city/station alias may redirect to a canonical article with a different title.
  const direct = linkedName(await read({
    action: "query", prop: "langlinks|pageprops", titles: query,
    redirects: "1", lllang: target, lllimit: "1",
  }));
  if (direct) return direct;
  const data = await read({
    action: "query", list: "search", srsearch: `"${query}"`, srlimit: "3",
  });
  const hits = object(data.query).search;
  if (!Array.isArray(hits)) return null;
  // Only an explicit bilingual parenthesis can identify a name in a broader article.
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const hit of hits) {
    const snippet = String(object(hit).snippet ?? "").replace(/<[^>]*>/g, "");
    const alias = snippet.match(new RegExp(escaped +
      "\\s*[（(]([\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}·\\s]{2,60})[)）]", "u"))?.[1]?.trim();
    if (alias && normalizePlaceName(alias) !== normalizePlaceName(query)) return { query: alias, source };
  }
  const exact = hits.find(h => normalizePlaceName(String(object(h).title ?? "")) === normalizePlaceName(query));
  if (!exact) return null;
  return linkedName(await read({
    action: "query", prop: "langlinks|pageprops", titles: String(object(exact).title),
    redirects: "1", lllang: target, lllimit: "1",
  }));
}
