export type BrainKind = "sheet" | "board";
export type CellValue = { text: string; color?: string; background?: string; bold?: boolean; align?: "left" | "center" | "right" };
export type ShapeValue = {
  type: "pen" | "eraser" | "line" | "arrow" | "rect" | "ellipse" | "text";
  x: number; y: number; x2?: number; y2?: number;
  points?: number[][]; targets?: string[]; origins?: Record<string, number[]>; text?: string;
  color: string; width: number; fontSize?: number; order: string;
};
export type BrainValue = CellValue | ShapeValue | string[] | number | null;
export type BrainEntity = { value: BrainValue; stamp: string; revision: number };
export type BrainEntities = Record<string, BrainEntity>;
export interface BrainSummary {
  id: string; tripId: string; kind: BrainKind; title: string;
  revision: number; metaVersion: number; deletedAt: string | null;
  updatedAt: string; preview: Record<string, BrainValue>;
}
export interface BrainDocument extends BrainSummary { entities: BrainEntities }
export interface BrainDelta extends BrainDocument { reset: boolean }
export type BrainChange = { key: string; expected: string | null; value: BrainValue };
export type BrainMutation = { mutationId: string; changes: BrainChange[]; protect?: boolean };
export const sheetLimits = { rows: 20000, columns: 1000, paste: 1000 };
export const initialRows = Array.from({ length: 100 }, (_, i) => `r${i}`);
export const initialColumns = Array.from({ length: 26 }, (_, i) => `c${i}`);
export function axis(entities: BrainEntities, kind: "rows" | "cols"): string[] {
  const value = entities[`sheet:${kind}`]?.value;
  return Array.isArray(value) ? value as string[] : kind === "rows" ? initialRows : initialColumns;
}
export const cellKey = (row: string, col: string) => `cell:${row}:${col}`;
export function cellValue(entities: BrainEntities, key: string): CellValue {
  return (entities[key]?.value as CellValue | null) ?? { text: "" };
}
export function columnLabel(index: number): string {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return label;
}
export function shapes(entities: BrainEntities): [string, ShapeValue][] {
  return Object.entries(entities).filter(([key, e]) => key.startsWith("shape:") && e.value !== null)
    .map(([key, e]) => [key, e.value as ShapeValue] as [string, ShapeValue])
    .sort((a, b) => a[1].order.localeCompare(b[1].order) || a[0].localeCompare(b[0]));
}
export function previewFor(kind: BrainKind, entities: BrainEntities): Record<string, BrainValue> {
  if (kind === "sheet") {
    const rows = axis(entities, "rows").slice(0, 5), cols = axis(entities, "cols").slice(0, 4);
    return Object.fromEntries(rows.flatMap((r, ri) => cols.map((c, ci) => { const cell = cellValue(entities, cellKey(r, c)); return [`${ri}:${ci}`, { ...cell, text: cell.text.slice(0, 100) }]; })));
  }
  const items = shapes(entities).slice(-24), ids = new Set(items.map(([key]) => key));
  const preview = Object.fromEntries(items.map(([key, shape]) => [key, {
    ...shape, points: shape.points?.filter((_, i) => i % Math.max(1, Math.ceil(shape.points!.length / 40)) === 0),
    ...(shape.targets ? { targets: shape.targets.filter(key => ids.has(key)), origins: Object.fromEntries(Object.entries(shape.origins || {}).filter(([key]) => ids.has(key))) } : {}),
    ...(shape.text ? { text: shape.text.slice(0, 100) } : {}),
  }]));
  return new TextEncoder().encode(JSON.stringify(preview)).length <= 24000 ? preview : {};
}
export function mergeDelta(document: BrainDocument, delta: BrainDelta): BrainDocument {
  if (delta.revision < document.revision) return document;
  return { ...delta, entities: delta.reset ? delta.entities : { ...document.entities, ...delta.entities } };
}
export function projectMutation(document: BrainDocument, mutation: BrainMutation): BrainDocument {
  const entities = { ...document.entities };
  for (const change of mutation.changes) entities[change.key] = { value: change.value, stamp: mutation.mutationId, revision: document.revision + 1 };
  return { ...document, entities };
}
export function sheetTsv(entities: BrainEntities, rows: string[], columns: string[]): string {
  return rows.map(row => columns.map(col => {
    const text = cellValue(entities, cellKey(row, col)).text;
    return /[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join("\t")).join("\n");
}
export function parseTsv(text: string): string[][] {
  const result: string[][] = [[]]; let value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && (!value || quoted)) {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (ch === "\t" || ch === "\n" || ch === "\r")) {
      result[result.length - 1].push(value); value = "";
      if (ch !== "\t") { if (ch === "\r" && text[i + 1] === "\n") i++; result.push([]); }
    } else value += ch;
  }
  result[result.length - 1].push(value);
  if (result.length > 1 && result.at(-1)?.length === 1 && result.at(-1)?.[0] === "") result.pop();
  return result;
}
