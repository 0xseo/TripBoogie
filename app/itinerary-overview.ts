import type { ItemRecord, Workspace, OverviewRow, OverviewChange } from "./types";
import { comparePlans } from "./planning";
import { airportLabel } from "./booking-display";
import { memoText } from "./memo";

export const overviewTextLimit = 10000;
export type OverviewDay = { text: string; sourceIds: string[] };
export type OverviewDraft = { schema: 1; days: Record<string, OverviewDay> };
export type OverviewCandidate = {
  id: string;
  date: string;
  text: string;
  sourceIds: string[];
  hotel: boolean;
};
export type OverviewSeparator = " · " | "\n";
export const emptyOverview = (): OverviewDraft => ({ schema: 1, days: {} });

export function overviewFromRows(rows: OverviewRow[] = []): OverviewDraft {
  return { schema: 1, days: Object.fromEntries(rows.map(row => [row.date, { text: row.text, sourceIds: [...row.sourceIds] }])) };
}

/** Expected versions belong to the snapshot the user actually edited. Never rebase them. */
export function overviewChanges(before: OverviewDraft, after: OverviewDraft, rows: OverviewRow[] = []): OverviewChange[] {
  const versions = new Map(rows.map(row => [row.date, row.version]));
  return Object.entries(after.days).filter(([date, day]) => day.text !== (before.days[date]?.text ?? "") || JSON.stringify(day.sourceIds) !== JSON.stringify(before.days[date]?.sourceIds ?? []))
    .map(([date, day]) => ({ date, text: day.text, sourceIds: [...day.sourceIds], version: versions.get(date) ?? 0 }));
}

/** Key for migrating the previous account/trip-scoped local draft once. */
export function overviewStorageKey(accountId: string, tripId: string) {
  return `tripboogie:overview:v1:${encodeURIComponent(accountId)}:${encodeURIComponent(tripId)}`;
}

export function parseOverview(value: string | null): OverviewDraft {
  if (!value) return emptyOverview();
  const raw: unknown = JSON.parse(value);
  if (!raw || typeof raw !== "object" || !("schema" in raw) || raw.schema !== 1 || !("days" in raw) || !raw.days || typeof raw.days !== "object" || Array.isArray(raw.days))
    throw new Error("저장된 한눈에 보기 형식을 읽을 수 없어요.");
  const entries = Object.entries(raw.days);
  if (entries.length > 730) throw new Error("저장된 날짜가 너무 많아요.");
  const days: OverviewDraft["days"] = {};
  for (const [date, day] of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day || typeof day !== "object" || typeof day.text !== "string" || day.text.length > overviewTextLimit || !Array.isArray(day.sourceIds) || day.sourceIds.length > 5000 || !day.sourceIds.every((id: unknown) => typeof id === "string" && id.length <= 100))
      throw new Error("저장된 한눈에 보기 내용을 확인해 주세요.");
    days[date] = { text: day.text, sourceIds: [...new Set<string>(day.sourceIds)] };
  }
  return { schema: 1, days };
}

/** Imported text is an independent snapshot. Even its source ID array is copied. */
export function writeOverviewDay(draft: OverviewDraft, date: string, text: string): OverviewDraft {
  return { schema: 1, days: { ...draft.days, [date]: { text: text.slice(0, overviewTextLimit), sourceIds: [...(draft.days[date]?.sourceIds ?? [])] } } };
}

const string = (value: unknown) => typeof value === "string" ? value : "";
const clock = (plan: ItemRecord, times: boolean) => times && string(plan.data.time) ? `${plan.data.time} ` : "";
const customTitle = (plan: ItemRecord) => Array.isArray(plan.data.bookingOverrides) ? plan.data.bookingOverrides.includes("title") : plan.data.bookingManaged === false;

export function overviewDuration(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return "";
  const hours = Math.floor(value / 60), minutes = value % 60;
  return ` (${[hours ? `${hours}시간` : "", minutes ? `${minutes}분` : ""].filter(Boolean).join(" ")})`;
}

export function overviewCandidates(workspace: Workspace, date: string, times = true): OverviewCandidate[] {
  const bookings = new Map(workspace.records.filter(r => r.kind === "booking").map(r => [r.id, r]));
  const plans = workspace.records.filter(r => r.kind === "plan" && r.data.date === date).sort(comparePlans);
  const consumed = new Set<string>();
  const result: OverviewCandidate[] = [];
  for (const [index, plan] of plans.entries()) {
    if (consumed.has(plan.id)) continue;
    const booking = bookings.get(string(plan.data.bookingId));
    const hotel = booking?.data.type === "hotel";
    const sourceIds = [plan.id];
    const duration = overviewDuration(plan.data.duration);
    let text = `${clock(plan, times)}${string(plan.data.title)}${duration}`;
    if (plan.data.entryType === "memo") text = memoText(plan.data);
    else if (booking?.data.type === "flight" && ["departure", "arrival"].includes(string(plan.data.bookingEvent))) {
      const overridden = customTitle(plan);
      const next = plans[index + 1];
      const pair = !overridden && plan.data.bookingEvent === "departure" && next?.data.bookingId === booking.id && next.data.bookingEvent === "arrival" && !customTitle(next);
      if (pair) {
        consumed.add(next.id);
        sourceIds.push(next.id);
        text = `${clock(plan, times)}${airportLabel(booking.data.departureAirport, booking.data.departure)}${duration} → ${clock(next, times)}${airportLabel(booking.data.arrivalAirport, booking.data.arrival)}${overviewDuration(next.data.duration)}`;
      } else if (!overridden) {
        const departure = plan.data.bookingEvent === "departure";
        text = `${clock(plan, times)}${airportLabel(departure ? booking.data.departureAirport : booking.data.arrivalAirport, departure ? booking.data.departure : booking.data.arrival)} ${departure ? "출발" : "도착"}${duration}`;
      }
    }
    result.push({ id: plan.id, date, text: hotel ? `숙소: ${text}` : text, sourceIds, hotel });
  }
  return result;
}

/** Whole-trip imports are atomic: an overlong row leaves every previous row intact. */
export function importOverview(draft: OverviewDraft, candidates: OverviewCandidate[], mode: "append" | "replace", separator: OverviewSeparator = "\n"): OverviewDraft {
  const grouped = new Map<string, OverviewCandidate[]>();
  for (const candidate of candidates) grouped.set(candidate.date, [...(grouped.get(candidate.date) ?? []), candidate]);
  const days = { ...draft.days };
  for (const [date, items] of grouped) {
    const existing = draft.days[date];
    const activities = items.filter(item => !item.hotel).map(item => item.text).join(separator);
    const hotels = items.filter(item => item.hotel).map(item => item.text).join("\n");
    const imported = [activities, hotels].filter(Boolean).join("\n");
    const text = mode === "append" ? [existing?.text, imported].filter(Boolean).join("\n") : imported;
    if (text.length > overviewTextLimit) throw new Error(`${date} 내용이 너무 길어요. 하루에 ${overviewTextLimit.toLocaleString("ko-KR")}자까지 입력할 수 있어요.`);
    days[date] = { text, sourceIds: [...new Set([...(mode === "append" ? existing?.sourceIds ?? [] : []), ...items.flatMap(item => item.sourceIds)])] };
  }
  return { schema: 1, days };
}
