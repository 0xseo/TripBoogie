import type { ItemRecord } from "./types";

export function airportCode(value: unknown, fallback: unknown = "") {
  const airport = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const code = airport.iata || airport.icao;
  if (typeof code === "string" && code) return code;
  const label = typeof fallback === "string" ? fallback : "";
  return label.match(/\(([A-Z0-9]{3,8})\)/)?.[1] || label;
}
export function flightRoute(data: Record<string, unknown>) {
  return [airportCode(data.departureAirport, data.departure), airportCode(data.arrivalAirport, data.arrival)].filter(Boolean).join(" → ");
}
export function bookingTitle(data: Record<string, unknown>) {
  return data.type === "flight" && flightRoute(data)
    ? [flightRoute(data), data.flightNumber].filter(Boolean).join(" · ")
    : String(data.title || "예약");
}
export function compareBookings(a: ItemRecord, b: ItemRecord) {
  return String(a.data.startDate || "9999").localeCompare(String(b.data.startDate || "9999"))
    || String(a.data.startTime || "99:99").localeCompare(String(b.data.startTime || "99:99"))
    || a.id.localeCompare(b.id);
}
