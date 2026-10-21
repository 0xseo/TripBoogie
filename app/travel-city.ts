import type { MapPlace } from "./server/maps";
import type { TravelCity } from "./types";
import { distanceMeters } from "./route-graph";

type Point = { lat: number; lng: number };
type ResolveCity = (point: Point) => Promise<MapPlace | undefined>;
const normalize = (name: string, country?: string) => {
  const value = name.normalize("NFKC").trim().toLocaleLowerCase();
  return (country === "CN" ? value.replace(/(?:市|시|\s+city|\s+municipality)$/iu, "") : value).replace(/\s+/g, "");
};
function sameCity(a: MapPlace | TravelCity, b: MapPlace | TravelCity, canonical = false) {
  if (!a.countryCode || a.countryCode !== b.countryCode) return false;
  if (a.providerId && b.providerId && a.providerId === b.providerId) return true;
  // Nearby points can belong to different Chinese cities. Use the containing
  // city identity, rather than a larger distance threshold to merge districts.
  const sameName = normalize(a.name, a.countryCode) === normalize(b.name, b.countryCode);
  if (a.countryCode === "CN")
    return sameName && !(a.providerId && b.providerId) && (canonical || distanceMeters(a, b) < 1000);
  return sameName || distanceMeters(a, b) < 1000;
}
export function createTravelCityLookup(resolve: ResolveCity): ResolveCity {
  const cache = new Map<string, { expires: number; result: Promise<MapPlace | undefined> }>();
  return point => {
    const key = `${point.lat},${point.lng}`, cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    const result = resolve(point).then(city => {
      if (!city) cache.delete(key);
      return city;
    }, error => { cache.delete(key); throw error; });
    cache.set(key, { expires: Date.now() + 900_000, result });
    return result;
  };
}
export async function includesTravelCity(candidate: MapPlace, cities: TravelCity[], resolve: ResolveCity) {
  if (cities.some(city => sameCity(city, candidate))) return true;
  if (candidate.countryCode !== "CN") return false;
  // Older trips can contain a district or a differently localized city name.
  // Resolve their saved coordinates with the same hierarchy before prompting.
  for (const city of cities.filter(city => city.countryCode === "CN")) {
    const canonical = await resolve(city);
    if (!canonical) throw new Error("방문 도시를 확인하지 못했습니다.");
    if (sameCity(canonical, candidate, true)) return true;
  }
  return false;
}
