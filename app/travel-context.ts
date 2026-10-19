import type { Trip } from "./types";
export function hasCoordinates(
  value: unknown,
): value is { lat: number; lng: number } {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.lat === "number" &&
    Number.isFinite(p.lat) &&
    Math.abs(p.lat) <= 90 &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lng) <= 180
  );
}
/** One source for saved destination coordinates used by maps, search and weather. */
export function travelContext(
  trip: Trip,
  options: { cityId?: string; date?: string } = {},
) {
  const cities = (trip.settings.cities ?? []).filter(hasCoordinates);
  const city =
    cities.find((c) => c.id === options.cityId) ||
    (options.date
      ? cities.find(
          (c) => c.startDate <= options.date! && c.endDate >= options.date!,
        )
      : undefined) ||
    cities[0];
  const location =
    city ||
    (hasCoordinates(trip.settings.location)
      ? trip.settings.location
      : undefined);
  return {
    cities,
    city,
    location,
    start: city?.startDate || trip.startDate,
    end: city?.endDate || trip.endDate,
    timezone: city?.timezone || trip.timezone,
  };
}
