import type { Trip } from "./types";
export type TripSort = "upcoming" | "newest" | "oldest" | "title";
export type TripColumns = 3 | 2 | 1;
export type TripFilter = { status: "all" | "upcoming" | "ongoing" | "past"; ownership: "all" | "owned" | "invited"; destination: string };
export const initialTripFilter: TripFilter = { status: "all", ownership: "all", destination: "" };
export const tripSortLabels: Record<TripSort, string> = { upcoming: "다가오는 순 · 지난 여행 최신순", newest: "출발일 최신순", oldest: "출발일 오래된순", title: "제목순" };
export const nextColumns = (columns: TripColumns, maximum: 2 | 3 = 3): TripColumns =>
  maximum === 2 ? columns === 2 ? 1 : 2 : columns === 3 ? 2 : columns === 2 ? 1 : 3;
/** Initial selection uses departure date, never array order or the current sort. */
export function preferredTrip(trips: Trip[], today: string): Trip | null {
  const ongoing=trips.filter(t=>tripStatus(t,today)==="ongoing").sort((a,b)=>b.startDate.localeCompare(a.startDate)||a.id.localeCompare(b.id));
  return ongoing[0] ?? trips.filter(t=>t.startDate>today).sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.id.localeCompare(b.id))[0] ?? null;
}
/** Date-only countdowns must not gain or lose a day across timezones or DST. */
export function tripCountdown(startDate: string, today: string) {
  const remaining = Math.round((Date.parse(`${startDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  return !Number.isFinite(remaining) ? "" : remaining === 0 ? "D-DAY" : remaining > 0 ? `D-${remaining}` : `D+${-remaining}`;
}
export const nextTripSort = (sort: TripSort): TripSort => sort === "upcoming" ? "newest" : sort === "newest" ? "oldest" : sort === "oldest" ? "title" : "upcoming";
export function tripStatus(trip: Trip, today: string): Exclude<TripFilter["status"], "all"> {
  return trip.startDate > today ? "upcoming" : trip.endDate < today ? "past" : "ongoing";
}
function compareUpcomingTrips(a: Trip, b: Trip, today: string) {
  const rank = { ongoing: 0, upcoming: 1, past: 2 };
  const aStatus = tripStatus(a, today), bStatus = tripStatus(b, today);
  const group = rank[aStatus] - rank[bStatus];
  if (group) return group;
  if (aStatus === "upcoming") return a.startDate.localeCompare(b.startDate);
  if (aStatus === "past") return b.endDate.localeCompare(a.endDate) || b.startDate.localeCompare(a.startDate);
  return b.startDate.localeCompare(a.startDate);
}
export function filterTrips(trips: Trip[], query: string, filter: TripFilter, sort: TripSort, today: string): Trip[] {
  const search = query.trim().normalize("NFC").toLocaleLowerCase("ko");
  return trips.filter(t => {
    const names = [t.title, t.destination, ...(t.settings.cities ?? []).map(c => c.name)].join(" ").normalize("NFC").toLocaleLowerCase("ko");
    return (!search || names.includes(search)) && (filter.status === "all" || tripStatus(t, today) === filter.status) && (filter.ownership === "all" || (filter.ownership === "owned" ? t.role === "owner" : t.role !== "owner")) && (!filter.destination || t.destination === filter.destination);
  }).sort((a,b) => {
    const first = sort === "upcoming" ? compareUpcomingTrips(a,b,today) : sort === "title" ? a.title.localeCompare(b.title, "ko", {numeric:true}) : sort === "oldest" ? a.startDate.localeCompare(b.startDate) : b.startDate.localeCompare(a.startDate);
    return first || a.title.localeCompare(b.title, "ko", {numeric:true}) || a.id.localeCompare(b.id);
  });
}

/** Calendar nights minus verified flight nights; old trips fall back to their date range. */
export function tripLengthLabel(trip:Pick<Trip,"startDate"|"endDate"|"flightNights">) {
 const span=Math.floor((Date.parse(`${trip.endDate}T12:00:00Z`)-Date.parse(`${trip.startDate}T12:00:00Z`))/86400000)+1;
 if(!Number.isFinite(span)||span<1)return "";
 const flight=Number.isInteger(trip.flightNights)?Math.max(0,trip.flightNights!):0;
 return `${Math.max(0,span-1-flight)}박 ${span}일`;
}
