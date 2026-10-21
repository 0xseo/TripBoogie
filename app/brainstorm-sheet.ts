type Point = { x: number; y: number };
export type TableView = { zoom: number; left: number; top: number };

export function zoomTableView(view: TableView, next: number, point: Point, anchor?: Point): TableView {
  const world = anchor || { x: (view.left + point.x) / view.zoom, y: (view.top + point.y) / view.zoom }, zoom = Math.max(.5, Math.min(2.5, next));
  return { zoom, left: Math.max(0, world.x * zoom - point.x), top: Math.max(0, world.y * zoom - point.y) };
}

export class TableTouchGesture {
  private touches = new Map<number, Point>();
  private gesture: { kind: "pan" | "pinch"; point: Point; view: TableView; distance?: number; anchor?: Point } | null = null;
  start(id: number, point: Point, view: TableView) {
    this.touches.set(id, point);
    if (this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.gesture = { kind: "pinch", point: mid, view, distance: Math.hypot(a.x - b.x, a.y - b.y), anchor: { x: (view.left + mid.x) / view.zoom, y: (view.top + mid.y) / view.zoom } };
    } else this.gesture = { kind: "pan", point, view };
  }
  move(id: number, point: Point): TableView | null {
    const g = this.gesture;
    if (!g || !this.touches.has(id)) return null;
    this.touches.set(id, point);
    if (g.kind === "pinch" && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()];
      return zoomTableView(g.view, g.view.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, g.distance!), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, g.anchor);
    }
    return { zoom: g.view.zoom, left: Math.max(0, g.view.left + g.point.x - point.x), top: Math.max(0, g.view.top + g.point.y - point.y) };
  }
  end(id: number, view: TableView) {
    this.touches.delete(id);
    const point = [...this.touches.values()][0];
    this.gesture = point ? { kind: "pan", point, view } : null;
  }
}
