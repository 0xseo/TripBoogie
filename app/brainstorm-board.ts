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
