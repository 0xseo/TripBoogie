import type { ItemRecord } from "./types";

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const normalized = (value: unknown) =>
  String(value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR");

/** Every word must match, even when the words occur in different visible fields. */
export function matchesListQuery(query: string, fields: unknown[]) {
  if (!query.trim()) return true;
  const value = fields.map(normalized).join(" ");
  return normalized(query).trim().split(/\s+/).every((word) => value.includes(word));
}

export function compareListRecords(a: ItemRecord, b: ItemRecord, order: string) {
  const byName = () => collator.compare(String(a.data.title ?? ""), String(b.data.title ?? ""));
  if (order === "title") return byName() || a.id.localeCompare(b.id);
  if (order === "updated-desc")
    return b.updatedAt.localeCompare(a.updatedAt) || byName() || a.id.localeCompare(b.id);
  const date = (r: ItemRecord) => String(r.data.startDate || r.data.date || "");
  // Missing dates stay at the end in either direction.
  if (!date(a) || !date(b)) return Number(!date(a)) - Number(!date(b)) || byName();
  const direction = order === "date-desc" ? -1 : 1;
  return direction * (date(a).localeCompare(date(b)) ||
    String(a.data.startTime || "").localeCompare(String(b.data.startTime || ""))) ||
    byName() || a.id.localeCompare(b.id);
}
