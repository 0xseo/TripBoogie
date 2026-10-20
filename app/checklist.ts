/** Counts and checkmarks share one interpretation of the signed-in member's completion. */
import type { ItemRecord } from "./types";
export function compareChecklist(a: ItemRecord, b: ItemRecord) {
 const position = (r: ItemRecord) => typeof r.data.position === "number" ? r.data.position : Number.MAX_SAFE_INTEGER;
 return position(a) - position(b) || a.id.localeCompare(b.id);
}
export function checklistState(data:Record<string,unknown>,userId:string){
 const value=data.checks;
 const checks=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
 return {checks,done:data.scope==="all"?!!checks[userId]:data.done===true};
}
/** Completion is personal; manual order is kept within each completion group. */
export function checklistEntries(rows: ItemRecord[], userId: string, hideCompleted = false) {
 return rows.map(record => ({record, ...checklistState(record.data, userId)}))
  .filter(entry => !hideCompleted || !entry.done)
  .sort((a, b) => Number(a.done) - Number(b.done) || compareChecklist(a.record, b.record));
}
/** A visible drag must keep hidden/completed tasks in their saved slots. */
export function mergeChecklistOrder(rows: ItemRecord[], ids: string[]) {
 const moved = new Set(ids), next = [...ids];
 return [...rows].sort(compareChecklist).map(row => moved.has(row.id) ? next.shift()! : row.id);
}
