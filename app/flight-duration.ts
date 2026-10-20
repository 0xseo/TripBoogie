import {TZDateMini} from "@date-fns/tz/date/mini";
import {tzOffset} from "@date-fns/tz/tzOffset";

/** Missing zones never fall back to the viewing device's zone. */
function localInstant(date: unknown, time: unknown, zone: unknown): number | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || typeof zone !== "string" || !zone) return null;
  const [year, month, day] = date.split("-").map(Number), [hour, minute] = time.split(":").map(Number);
  try {
    const value = new TZDateMini(year, month - 1, day, hour, minute, 0, zone), stamp = value.getTime();
    if (!Number.isFinite(stamp) || value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day || value.getHours() !== hour || value.getMinutes() !== minute) return null;
    // Repeated wall times at the autumn DST transition need an explicit offset.
    // Do not invent a flight duration when the stored local time is ambiguous.
    const offset = tzOffset(zone, value);
    for (const delta of [-86400000, 86400000]) {
      const otherOffset = tzOffset(zone, new Date(stamp + delta));
      if (otherOffset === offset || !Number.isFinite(otherOffset)) continue;
      const alternative = new TZDateMini(stamp + (offset - otherOffset) * 60000, zone);
      if (alternative.getFullYear() === year && alternative.getMonth() === month - 1 && alternative.getDate() === day && alternative.getHours() === hour && alternative.getMinutes() === minute) return null;
    }
    return stamp;
  } catch { return null; }
}
export function flightDurationMinutes(data: Record<string, unknown>): number | null {
  if (data.type !== "flight") return null;
  const airportZone = (value: unknown, fallback: unknown) => value && typeof value === "object" && "timezone" in value ? value.timezone : fallback;
  const departure = localInstant(data.startDate, data.startTime, airportZone(data.departureAirport, data.departureZone));
  const arrival = localInstant(data.endDate, data.endTime, airportZone(data.arrivalAirport, data.arrivalZone));
  if (departure === null || arrival === null || arrival <= departure) return null;
  return Math.round((arrival - departure) / 60000);
}
export function flightDurationLabel(minutes: number | null) {
  if (minutes === null || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `비행 ${[hours && `${hours}시간`, rest && `${rest}분`].filter(Boolean).join(" ")}`;
}
