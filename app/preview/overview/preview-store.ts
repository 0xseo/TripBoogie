import type { OverviewChange, OverviewRow } from "../../types";
import { overviewPreviewDraft } from "./fixture";

const key = "tripboogie:overview:collaboration-preview:v1";
export const previewSeedRows: OverviewRow[] = Object.entries(overviewPreviewDraft.days).map(([date, day]) => ({date,...day,version:1,updatedAt:"2026-10-21T00:00:00Z",updatedBy:"preview"}));
let cached: OverviewRow[] = previewSeedRows;
let lastValue: string | null | undefined;

export function readPreviewRows() {
  try {
    const value = localStorage.getItem(key);
    if (value === lastValue) return cached;
    lastValue = value;
    const rows: unknown = value ? JSON.parse(value) : previewSeedRows;
    cached = Array.isArray(rows) && rows.every(row => row && typeof row.date === "string" && typeof row.text === "string" && Array.isArray(row.sourceIds) && Number.isSafeInteger(row.version) && row.version > 0) ? rows : previewSeedRows;
  } catch { cached = previewSeedRows; }
  return cached;
}

export function subscribePreviewRows(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) notify(); };
  window.addEventListener("storage",onStorage);
  window.addEventListener("overview-preview-save",notify);
  return () => { window.removeEventListener("storage",onStorage); window.removeEventListener("overview-preview-save",notify); };
}

/** Browser-only demonstration. Production uses Postgres transactions and per-day CAS. */
export async function savePreviewRows(changes: OverviewChange[]) {
  const rows = readPreviewRows();
  for (const change of changes) {
    const row = rows.find(row => row.date === change.date);
    if ((row?.version ?? 0) !== change.version && (row?.text !== change.text || JSON.stringify(row?.sourceIds ?? []) !== JSON.stringify(change.sourceIds))) throw Object.assign(new Error("동행이 이 날짜를 먼저 수정했어요. 최신 내용을 확인해 주세요."),{status:409});
  }
  const result = [...rows];
  for (const change of changes) {
    const index = result.findIndex(row => row.date === change.date);
    if (index >= 0 && result[index].text === change.text && JSON.stringify(result[index].sourceIds) === JSON.stringify(change.sourceIds)) continue;
    const next = {...change,version:(result[index]?.version??0)+1,updatedAt:new Date().toISOString(),updatedBy:"preview"};
    if (index < 0) result.push(next); else result[index] = next;
  }
  localStorage.setItem(key,JSON.stringify(result));
  window.dispatchEvent(new Event("overview-preview-save"));
}
