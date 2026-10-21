import type { Workspace } from "./types";

/** Keep recent trips warm without retaining every private workspace visited this session. */
export class WorkspaceCache {
  private entries = new Map<string, Workspace>();
  constructor(private limit = 3) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Cache limit must be positive");
  }
  get size() { return this.entries.size; }
  get(id: string) {
    const value = this.entries.get(id);
    if (value) {
      this.entries.delete(id);
      this.entries.set(id, value);
    }
    return value;
  }
  set(id: string, value: Workspace) {
    this.entries.delete(id);
    this.entries.set(id, value);
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }
  delete(id: string) { return this.entries.delete(id); }
  clear() { this.entries.clear(); }
}

// Compare JSON data without allocating two serialized copies of a large workspace.
// Revision alone is insufficient: member profiles and file state can change independently.
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a))
    return Array.isArray(b) && a.length === b.length && a.every((value, i) => sameJson(value, b[i]));
  if (Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}
export function sameWorkspace(previous: Workspace, next: Workspace) {
  return previous.revision === next.revision && sameJson(previous, next);
}

/** Preserve unaffected array references so summary polling cannot rebuild the itinerary/map. */
export function reconcileWorkspace(previous: Workspace | null, next: Workspace): Workspace {
  if (!previous || previous.trip.id !== next.trip.id) return next;
  const keys = Object.keys(next) as (keyof Workspace)[];
  const shared: Record<string, unknown> = { ...next };
  let unchanged = keys.length === Object.keys(previous).length;
  for (const key of keys) {
    if (Object.hasOwn(previous, key) && sameJson(previous[key], next[key])) shared[key] = previous[key];
    else unchanged = false;
  }
  return unchanged ? previous : shared as unknown as Workspace;
}
