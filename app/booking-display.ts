import type { ItemRecord } from "./types";
import localizedAirportNames from "./data/airport-labels.json";

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
export function airportLabel(value: unknown, fallback: unknown = "") {
  const airport = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const code = airportCode(value, fallback);
  if (!/^[A-Z0-9]{3,8}$/.test(code)) return String(airport.name || fallback || code);
  const names = localizedAirportNames as Record<string, string>;
  const name = names[String(airport.icao || "")] || names[code] || String(airport.name || fallback || "")
    .replace(/\s*\([A-Z0-9]{3,8}\)\s*/g, "")
    .replace(/국제\s*공항|공항|\bInternational\b|\bAirport\b/gi, "").trim();
  return name && name !== code ? `${name}(${code})` : name || code;
}
/** Render from the linked booking so existing events follow reservation edits too. */
export function itineraryTitle(plan: ItemRecord, booking?: ItemRecord) {
  const event = plan.data.bookingEvent;
  if (booking?.data.type !== "flight" || !["departure", "arrival"].includes(String(event))) return String(plan.data.title || "");
  const data = booking.data;
  const route = [airportLabel(data.departureAirport, data.departure), airportLabel(data.arrivalAirport, data.arrival)].filter(Boolean).join(" → ");
  return [route || "항공", event === "departure" ? "출발" : "도착", data.flightNumber].filter(Boolean).join(" · ");
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
