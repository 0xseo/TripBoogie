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
