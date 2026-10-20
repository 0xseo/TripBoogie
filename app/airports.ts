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
  const matches: { airport: Airport; rank: number }[] = [];
  for (const { airport, search } of index) {
    // Most airports do not match. Avoid normalizing their names on every keystroke.
    if (!search.includes(q)) continue;
    const code = q === airport.iata.toLowerCase() || q === airport.icao.toLowerCase();
    const exact = code || [airport.name, ...airport.aliases].some(name => normalize(name) === q);
    const match = { airport, rank: code ? 0 : exact ? 1 : airport.iata ? 2 : 3 };
    let position = 0;
    while (position < matches.length &&
      (matches[position].rank - match.rank || matches[position].airport.name.localeCompare(airport.name)) <= 0)
      position++;
    // Only the best eight candidates are retained; ties preserve source order.
    if (position < 8) {
      matches.splice(position, 0, match);
      if (matches.length > 8) matches.pop();
    }
  }
  return matches.map(match => match.airport);
}
