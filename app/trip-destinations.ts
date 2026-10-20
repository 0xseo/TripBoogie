import type { Trip, TravelCity } from "./types";
import {
  countryCurrencies,
  countryName,
  currenciesForCountry,
} from "./countries";
export function tripCountries(trip: Trip) {
  return [
    ...new Set([
      ...(trip.settings.countries || []),
      ...(trip.settings.cities || []).map((c) => c.countryCode),
    ]),
  ].filter(Boolean);
}
export function tripCurrencies(trip: Trip) {
  const derived = [
    ...(trip.settings.cities || []).map(
      (c) => c.currency || countryCurrencies[c.countryCode],
    ),
    ...tripCountries(trip).flatMap((c) => currenciesForCountry(c)),
  ].filter(Boolean);
  return [
    ...new Set(
      derived.length
        ? derived
        : trip.settings.currencies?.length
          ? trip.settings.currencies
          : [trip.currency],
    ),
  ];
}
export function countryGroups(cities: TravelCity[], countries: string[] = []) {
  return [...new Set([...countries, ...cities.map((c) => c.countryCode)])].map(
    (code) => ({
      code,
      name: countryName(code),
      cities: cities.filter((c) => c.countryCode === code),
    }),
  );
}
export function currencyForDate(trip: Trip, date: string, country?: string) {
  const matches = (trip.settings.cities || []).filter(
      (c) =>
        (!country || c.countryCode === country) &&
        c.startDate <= date &&
        c.endDate >= date,
    ),
    city = matches.find((c) => !c.transit) || matches[0];
  return (
    (country && countryCurrencies[country]) ||
    city?.currency ||
    tripCurrencies(trip)[0] ||
    trip.currency
  );
}
