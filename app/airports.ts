import records from "./data/airports.json";
export interface Airport {
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  timezone: string;
  lat: number;
  lng: number;
  aliases: string[];
}
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/국제|international|airport|공항/g, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
const index = (records as Airport[]).map((airport) => ({
  airport,
  search: normalize(
    [
      airport.icao,
      airport.iata,
      airport.name,
      airport.city,
      ...airport.aliases,
    ].join(" "),
  ),
}));
export function searchAirports(query: string) {
  const q = normalize(query);
  if (q.length < 2 || q.length > 100) return [];
  return index
    .flatMap(({ airport, search }) => {
      const code =
          q === airport.iata.toLowerCase() || q === airport.icao.toLowerCase(),
        exact = [airport.name, ...airport.aliases].some(
          (n) => normalize(n) === q,
        );
      return search.includes(q)
        ? [{ airport, rank: code ? 0 : exact ? 1 : airport.iata ? 2 : 3 }]
        : [];
    })
    .sort(
      (a, b) => a.rank - b.rank || a.airport.name.localeCompare(b.airport.name),
    )
    .slice(0, 8)
    .map((x) => x.airport);
}
