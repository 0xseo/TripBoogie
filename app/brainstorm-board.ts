import { shapes, type BrainChange, type BrainEntities, type ShapeValue } from "./brainstorm";

export function pathFor(points: number[][] = []) {
  return points.length === 1 ? `M${points[0][0]},${points[0][1]} l0.01,0` : points.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
}

export function shapeBounds(shape: ShapeValue) {
  const points = shape.points || [[shape.x, shape.y], [shape.x2 ?? shape.x + Math.max(40, (shape.text?.length || 1) * (shape.fontSize || 24) * .65), shape.y2 ?? shape.y + (shape.fontSize || 24) * (shape.text?.split("\n").length || 1) * 1.4]];
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
}

export function eraserTransform(shape: ShapeValue, key: string, eraser: ShapeValue) {
  const origin = eraser.origins?.[key];
  if (!origin) return undefined;
  const box = shapeBounds(shape);
  return `translate(${box.x} ${box.y}) scale(${box.width / Math.max(1, origin[2])} ${box.height / Math.max(1, origin[3])}) translate(${-origin[0]} ${-origin[1]})`;
}

// Older boards stored erasers in canvas coordinates. Bind each cut to its
// original shape before a move, keeping other targets of the same eraser intact.
export function attachLegacyErasers(entities: BrainEntities, key: string, original: ShapeValue): BrainChange[] {
  const box = shapeBounds(original);
  return shapes(entities).filter(([, eraser]) => eraser.type === "eraser" && eraser.targets?.includes(key) && !eraser.origins?.[key]).map(([id, eraser]) => ({
    key: id,
    expected: entities[id].stamp,
    value: { ...eraser, origins: { ...eraser.origins, [key]: [box.x, box.y, box.width, box.height] } },
  }));
}

export type BoardPoint = { x: number; y: number };
export type BoardBox = BoardPoint & { width: number; height: number };
export function dragBox(a: BoardPoint, b: BoardPoint): BoardBox {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
export function shapesInBox(items: [string, ShapeValue][], box: BoardBox) {
  return items.filter(([, shape]) => {
    if (shape.type === "eraser") return false;
    const b = shapeBounds(shape), pad = shape.width / 2;
    return b.x - pad <= box.x + box.width && b.x + b.width + pad >= box.x && b.y - pad <= box.y + box.height && b.y + b.height + pad >= box.y;
  }).map(([key]) => key);
}
export function selectionBounds(items: [string, ShapeValue][]): BoardBox | null {
  const boxes = items.filter(([, shape]) => shape.type !== "eraser").map(([, shape]) => shapeBounds(shape));
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
}
export function translateShape(shape: ShapeValue, dx: number, dy: number): ShapeValue {
  return { ...shape, x: shape.x + dx, y: shape.y + dy, ...(shape.x2 !== undefined ? { x2: shape.x2 + dx } : {}), ...(shape.y2 !== undefined ? { y2: shape.y2 + dy } : {}), ...(shape.points ? { points: shape.points.map(([x, y]) => [x + dx, y + dy]) } : {}) };
}
export function attachSelectionErasers(entities: BrainEntities, originals: Record<string, ShapeValue>) {
  const boxes = new Map(Object.entries(originals).map(([key, shape]) => { const b = shapeBounds(shape); return [key, [b.x, b.y, b.width, b.height]]; }));
  return shapes(entities).flatMap(([key, shape]): BrainChange[] => {
    if (shape.type !== "eraser") return [];
    const additions = (shape.targets || []).filter(target => boxes.has(target) && !shape.origins?.[target]);
    if (!additions.length) return [];
    return [{ key, expected: entities[key].stamp, value: { ...shape, origins: { ...shape.origins, ...Object.fromEntries(additions.map(target => [target, boxes.get(target)!])) } } }];
  });
}

function pointDistance(p: number[], a: number[], b: number[]) {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function segmentDistance(a: number[], b: number[], c: number[], d: number[]) {
  const cross = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0 && Math.max(a[0], b[0]) >= Math.min(c[0], d[0]) && Math.max(c[0], d[0]) >= Math.min(a[0], b[0]) && Math.max(a[1], b[1]) >= Math.min(c[1], d[1]) && Math.max(c[1], d[1]) >= Math.min(a[1], b[1])) return 0;
  return Math.min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b));
}
export function objectsAlongEraser(items: [string, ShapeValue][], from: BoardPoint, to: BoardPoint, radius: number) {
  const a = [from.x, from.y], b = [to.x, to.y];
  return items.filter(([, shape]) => {
    if (shape.type === "eraser") return false;
    const box = shapeBounds(shape), distance = radius + shape.width / 2;
    if (!shapesInBox([["candidate", shape]], { x: Math.min(from.x, to.x) - radius, y: Math.min(from.y, to.y) - radius, width: Math.abs(to.x - from.x) + radius * 2, height: Math.abs(to.y - from.y) + radius * 2 }).length) return false;
    let points: number[][];
    if (shape.type === "pen") points = shape.points || [[shape.x, shape.y]];
    else if (shape.type === "line" || shape.type === "arrow") {
      points = [[shape.x, shape.y], [shape.x2 ?? shape.x, shape.y2 ?? shape.y]];
      if (shape.type === "arrow") {
        const [end] = points.slice(-1), angle = Math.atan2(end[1] - shape.y, end[0] - shape.x), size = Math.max(12, shape.width * 4);
        points.push([end[0] - size * Math.cos(angle - Math.PI / 6), end[1] - size * Math.sin(angle - Math.PI / 6)], end, [end[0] - size * Math.cos(angle + Math.PI / 6), end[1] - size * Math.sin(angle + Math.PI / 6)]);
      }
    } else if (shape.type === "ellipse") points = Array.from({ length: 65 }, (_, i) => [box.x + box.width / 2 * (1 + Math.cos(i * Math.PI / 32)), box.y + box.height / 2 * (1 + Math.sin(i * Math.PI / 32))]);
    else {
      points = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height], [box.x, box.y]];
      if (shape.type === "text" && [from, to].some(p => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height)) return true;
    }
    if (points.length === 1) return pointDistance(points[0], a, b) <= distance;
    return points.some((point, i) => i > 0 && segmentDistance(a, b, points[i - 1], point) <= distance);
  }).map(([key]) => key);
}
