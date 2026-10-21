"use client";
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { ArrowUpRight, Check, ChevronDown, Circle, Eraser, Hand, Minus, MousePointer2, Pencil, RectangleHorizontal, Trash2, Type, ZoomIn, ZoomOut, LocateFixed } from "lucide-react";
import { shapes, type BrainChange, type BrainDocument, type ShapeValue } from "../brainstorm";
import { attachSelectionErasers, dragBox, eraserTransform, objectsAlongEraser, pathFor, pointInBox, resizeSelection, selectionBounds, shapeBounds, shapesInBox, translateShape, type BoardBox } from "../brainstorm-board";
import type { BrainStore } from "../brainstorm-store";
import Dialog from "./Dialog";
import styles from "./Brainstorming.module.css";

type Tool = ShapeValue["type"] | "hand" | "select";
type Camera = { x: number; y: number; zoom: number };
const tools = [{ id: "select", label: "선택", Icon: MousePointer2 }, { id: "pen", label: "펜", Icon: Pencil }, { id: "eraser", label: "지우개", Icon: Eraser }, { id: "hand", label: "손 · 이동", Icon: Hand }, { id: "line", label: "선분", Icon: Minus }, { id: "arrow", label: "화살표", Icon: ArrowUpRight }, { id: "rect", label: "사각형", Icon: RectangleHorizontal }, { id: "ellipse", label: "원", Icon: Circle }, { id: "text", label: "글씨", Icon: Type }] as const;
export const BoardArtwork = memo(function BoardArtwork({ items, prefix = "board", onSelect }: { items: [string, ShapeValue][]; prefix?: string; onSelect?: (key: string, event: ReactPointerEvent<SVGGElement>) => void }) {
  const erasers = items.filter(([, s]) => s.type === "eraser");
  return <>{items.filter(([, s]) => s.type !== "eraser").map(([key, shape]) => {
    const masks = erasers.filter(([, e]) => e.targets?.includes(key));
    const maskId = `${prefix}-${key.replaceAll(":", "")}`;
    const box = shapeBounds(shape), x2 = shape.x2 ?? shape.x, y2 = shape.y2 ?? shape.y;
    const angle = Math.atan2(y2 - shape.y, x2 - shape.x), arrowSize = Math.max(12, shape.width * 4);
    const arrow = [[x2 - arrowSize * Math.cos(angle - Math.PI / 6), y2 - arrowSize * Math.sin(angle - Math.PI / 6)], [x2, y2], [x2 - arrowSize * Math.cos(angle + Math.PI / 6), y2 - arrowSize * Math.sin(angle + Math.PI / 6)]];
    return <g key={key} onPointerDown={event => onSelect?.(key, event)} style={{ cursor: onSelect ? "move" : undefined }}>
      {masks.length > 0 && <defs><mask id={maskId} maskUnits="userSpaceOnUse" x={box.x - 100} y={box.y - 100} width={box.width + 200} height={box.height + 200}><rect x={box.x - 100} y={box.y - 100} width={box.width + 200} height={box.height + 200} fill="white"/>{masks.map(([id, e]) => <path key={id} d={pathFor(e.points)} fill="none" stroke="black" strokeWidth={e.width} strokeLinecap="round" strokeLinejoin="round" transform={eraserTransform(shape, key, e)}/>)}</mask></defs>}
      <g mask={masks.length ? `url(#${maskId})` : undefined} fill="none" stroke={shape.color} strokeWidth={shape.width} strokeLinecap="round" strokeLinejoin="round">
        {shape.type === "pen" && <path d={pathFor(shape.points)} pointerEvents="stroke"/>}
        {(shape.type === "line" || shape.type === "arrow") && <><line x1={shape.x} y1={shape.y} x2={x2} y2={y2} pointerEvents="stroke"/>{shape.type === "arrow" && <path d={pathFor(arrow)} pointerEvents="stroke"/>}</>}
        {shape.type === "rect" && <rect x={box.x} y={box.y} width={box.width} height={box.height} pointerEvents="all"/>}
        {shape.type === "ellipse" && <ellipse cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} pointerEvents="all"/>}
        {shape.type === "text" && <text x={shape.x} y={shape.y} fontSize={shape.fontSize || 24} stroke="none" fill={shape.color} style={{ whiteSpace: "pre" }} pointerEvents="all">{(shape.text || "").split("\n").map((line, i) => <tspan key={i} x={shape.x} dy={i ? "1.4em" : "1em"}>{line || " "}</tspan>)}</text>}
      </g>
    </g>;
  })}</>;
});
export function BoardPreview({ preview, id }: { preview: Record<string, unknown>; id: string }) {
  const items = Object.entries(preview).filter(([key, value]) => key.startsWith("shape:") && value && typeof value === "object" && "type" in value) as [string, ShapeValue][];
  if (!items.length) return <div className={styles.emptyBoard}><Pencil size={30}/><span>빈 그림판</span></div>;
  const boxes = items.filter(([, v]) => v.type !== "eraser").map(([, v]) => shapeBounds(v));
  if (!boxes.length) return <div className={styles.emptyBoard}>빈 그림판</div>;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y)), right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
  return <svg viewBox={`${x - 30} ${y - 30} ${Math.max(180, right - x + 60)} ${Math.max(100, bottom - y + 60)}`} aria-hidden="true"><BoardArtwork items={items} prefix={`preview-${id}`}/></svg>;
}
export default function BrainBoard({ document: doc, store, disabled }: { document: BrainDocument; store: BrainStore; disabled: boolean }) {
  const [tool, setTool] = useState<Tool>("pen"), [penSize, setPenSize] = useState(4), [eraserSize, setEraserSize] = useState(24), [color, setColor] = useState("#254c41"), [fontSize, setFontSize] = useState(24);
  const [camera, setCamera] = useState<Camera>({ x: 80, y: 80, zoom: 1 }), cameraRef = useRef(camera);
  useLayoutEffect(() => { cameraRef.current = camera; }, [camera]);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draftErasers, setDraftErasers] = useState<BrainChange[]>([]);
  const [draft, setDraft] = useState<ShapeValue | null>(null), draftRef = useRef<ShapeValue | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [textEdit, setTextEdit] = useState<{ key?: string; x: number; y: number; text: string; stamp: string | null } | null>(null);
  const [transformDraft, setTransformDraft] = useState<Record<string, ShapeValue | null>>({}), [marquee, setMarquee] = useState<BoardBox | null>(null);
  const [eraserMode, setEraserMode] = useState<"area" | "object">("area"), [eraserMenu, setEraserMenu] = useState<{ x: number; y: number } | null>(null);
  const eraserButton = useRef<HTMLButtonElement>(null), eraserMenuRef = useRef<HTMLDivElement>(null), menuFocus = useRef(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null), menuClose = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null), [message, setMessage] = useState("");
  const [showSizePreview, setShowSizePreview] = useState(false);
  const svg = useRef<SVGSVGElement>(null), pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "draw" | "pan" | "pinch" | "move" | "resize" | "marquee" | "objectErase"; startX: number; startY: number; camera: Camera; distance?: number; anchor?: { x: number; y: number }; bounds?: BoardBox; originals?: Record<string, ShapeValue>; edits?: Record<string, ShapeValue | null>; stamps?: Record<string, string | null>; selection?: string[]; key?: string; stamp?: string | null; erasers?: BrainChange[] } | null>(null);
  const id = useId().replaceAll(":", ""), items = useMemo(() => shapes(doc.entities), [doc.entities]), chosenKey = selected.length === 1 ? selected[0] : null, chosen = chosenKey ? doc.entities[chosenKey]?.value as ShapeValue | null : null;
  const point = (e: { clientX: number; clientY: number }) => { const rect = svg.current!.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; };
  const world = (p: { x: number; y: number }, c = cameraRef.current) => ({ x: (p.x - c.x) / c.zoom, y: (p.y - c.y) / c.zoom });
  const changeDraft = (value: ShapeValue | null) => { draftRef.current = value; setDraft(value); };
  const attachErasers = (originals: Record<string, ShapeValue>) => { const changes = attachSelectionErasers(doc.entities, originals); setDraftErasers(changes); return changes; };
  const cancelGesture = () => { gesture.current = null; pointers.current.clear(); changeDraft(null); setTransformDraft({}); setMarquee(null); };
  const clearLongPress = () => { if (longPress.current) clearTimeout(longPress.current); longPress.current = null; };
  const keepEraserMenu = () => { if (menuClose.current) clearTimeout(menuClose.current); };
  const closeEraserMenuSoon = () => { keepEraserMenu(); menuClose.current = setTimeout(() => setEraserMenu(null), 180); };
  const openEraserMenu = () => {
    if (disabled) return;
    keepEraserMenu(); const button = eraserButton.current?.getBoundingClientRect(), board = svg.current?.getBoundingClientRect();
    if (button && board) setEraserMenu({ x: Math.max(10, Math.min(board.width - 230, button.left - board.left)), y: button.bottom - board.top + 8 });
  };
  useEffect(() => () => { if (longPress.current) clearTimeout(longPress.current); if (menuClose.current) clearTimeout(menuClose.current); }, []);
  useEffect(() => {
    if (!eraserMenu) return;
    if (menuFocus.current) { eraserMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); menuFocus.current = false; }
    const outside = (event: globalThis.PointerEvent) => { if (!eraserMenuRef.current?.contains(event.target as Node) && !eraserButton.current?.contains(event.target as Node)) setEraserMenu(null); };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside);
  }, [eraserMenu]);
  const eraseObjects = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const g = gesture.current; if (!g || g.kind !== "objectErase") return;
    for (const key of objectsAlongEraser(items, from, to, eraserSize / 2)) {
      if (g.edits![key] === null) continue;
      if (Object.keys(g.edits!).length >= 1000) { setMessage("한 번에 1000개 개체까지 지울 수 있어요. 손을 떼고 이어서 지워 주세요."); break; }
      g.edits![key] = null; g.stamps![key] = doc.entities[key]?.stamp ?? null;
    }
    setTransformDraft({ ...g.edits }); g.startX = to.x; g.startY = to.y;
  };
  const updateZoom = (factor: number, anchor?: { x: number; y: number }) => { const c = cameraRef.current, p = anchor || { x: (svg.current?.clientWidth || 800) / 2, y: (svg.current?.clientHeight || 500) / 2 }, w = world(p, c), zoom = Math.max(.1, Math.min(8, c.zoom * factor)); setCamera({ zoom, x: p.x - w.x * zoom, y: p.y - w.y * zoom }); };
  const beginTransform = (kind: "move" | "resize", keys: string[], e: ReactPointerEvent<SVGElement>) => {
    const originals = Object.fromEntries(items.filter(([key, shape]) => keys.includes(key) && shape.type !== "eraser")), bounds = selectionBounds(Object.entries(originals));
    if (!bounds) return;
    if (keys.length > 1000) { setMessage("한 번에 1000개 개체까지 조절할 수 있어요. 개체를 나누어 선택해 주세요."); return; }
    e.preventDefault(); e.stopPropagation(); const p = point(e), w = world(p);
    setSelected(Object.keys(originals)); setDraftKey(null); svg.current?.focus({ preventScroll: true }); svg.current?.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, p);
    gesture.current = { kind, originals, bounds, startX: w.x, startY: w.y, camera: cameraRef.current, stamps: Object.fromEntries(Object.keys(originals).map(key => [key, doc.entities[key]?.stamp ?? null])), erasers: attachErasers(originals) };
  };
  const begin = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault(); svg.current?.focus(); svg.current?.setPointerCapture(e.pointerId);
    const p = point(e), w = world(p); pointers.current.set(e.pointerId, p);
    if (pointers.current.size >= 2) {
      changeDraft(null); setTransformDraft({}); setMarquee(null); const [a, b] = [...pointers.current.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture.current = { kind: "pinch", startX: mid.x, startY: mid.y, camera: cameraRef.current, distance: Math.hypot(a.x - b.x, a.y - b.y), anchor: world(mid) }; return;
    }
    if (gesture.current?.kind === "move" || gesture.current?.kind === "resize") return;
    if (tool === "hand" || e.button === 1 || disabled) { gesture.current = { kind: "pan", startX: p.x, startY: p.y, camera: cameraRef.current }; return; }
    if (tool === "select" && !e.shiftKey && pointInBox(w, selectionBounds(items.filter(([key]) => selected.includes(key))), 6 / cameraRef.current.zoom)) { beginTransform("move", selected, e); return; }
    if (tool === "select") { const base = e.shiftKey ? selected : []; setSelected(base); setMarquee({ x: w.x, y: w.y, width: 0, height: 0 }); gesture.current = { kind: "marquee", startX: w.x, startY: w.y, camera: cameraRef.current, selection: base }; return; }
    if (tool === "text") { setTextEdit({ x: w.x, y: w.y, text: "", stamp: null }); return; }
    if (tool === "eraser" && eraserMode === "object") { setDraftKey(null); setSelected([]); gesture.current = { kind: "objectErase", startX: w.x, startY: w.y, camera: cameraRef.current, edits: {}, stamps: {} }; eraseObjects(w, w); return; }
    if (items.length >= 5000) { setMessage("문서에 그림 요소가 많아요. 새 그림판으로 나누어 주세요."); return; }
    setDraftKey(null); gesture.current = { kind: "draw", startX: w.x, startY: w.y, camera: cameraRef.current };
    changeDraft({ type: tool, x: w.x, y: w.y, x2: w.x, y2: w.y, color, width: tool === "eraser" ? eraserSize : penSize, order: `${Math.round(performance.timeOrigin + e.timeStamp)}:${crypto.randomUUID()}`, ...(tool === "pen" || tool === "eraser" ? { points: [[w.x, w.y]] } : {}), ...(tool === "eraser" ? { targets: items.filter(([, shape]) => shape.type !== "eraser").map(([key]) => key), origins: Object.fromEntries(items.filter(([, shape]) => shape.type !== "eraser").map(([key, shape]) => { const b = shapeBounds(shape); return [key, [b.x, b.y, b.width, b.height]]; })) } : {}) });
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = point(e); if (tool === "eraser" || tool === "pen") setCursor(p); if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, p); const g = gesture.current; if (!g) return;
    if (g.kind === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom = Math.max(.1, Math.min(8, g.camera.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, g.distance!)));
      setCamera({ zoom, x: mid.x - g.anchor!.x * zoom, y: mid.y - g.anchor!.y * zoom }); return;
    }
    if (g.kind === "pan") { setCamera({ ...g.camera, x: g.camera.x + p.x - g.startX, y: g.camera.y + p.y - g.startY }); return; }
    const w = world(p);
    if (g.kind === "marquee") { const box = dragBox({ x: g.startX, y: g.startY }, w); setMarquee(box); setSelected([...new Set([...(g.selection || []), ...shapesInBox(items, box)])]); return; }
    if (g.kind === "objectErase") { eraseObjects({ x: g.startX, y: g.startY }, w); return; }
    if (g.kind === "move" && g.originals) { g.edits = Object.fromEntries(Object.entries(g.originals).map(([key, shape]) => [key, translateShape(shape, w.x - g.startX, w.y - g.startY)])); setTransformDraft(g.edits); return; }
    if (g.kind === "resize" && g.originals && g.bounds) { g.edits = resizeSelection(g.originals, g.bounds, { x: g.startX, y: g.startY }, w); setTransformDraft(g.edits); return; }
    const s = draftRef.current; if (!s) return;
    if (s.points) {
      const last = s.points[s.points.length - 1]; if (Math.hypot(last[0] - w.x, last[1] - w.y) < 1 / cameraRef.current.zoom) return;
      if (s.points.length >= 4096) { setMessage("한 획의 최대 길이에 도달했어요. 손을 떼고 이어서 그려 주세요."); return; }
      changeDraft({ ...s, points: [...s.points, [w.x, w.y]] });
    } else changeDraft({ ...s, x2: w.x, y2: w.y });
  };
  const finish = (e: ReactPointerEvent<SVGSVGElement>, cancel = false) => {
    pointers.current.delete(e.pointerId); const g = gesture.current;
    if (g?.kind === "pinch") { if (pointers.current.size === 0) gesture.current = null; return; }
    if (!cancel && !disabled && g?.edits && Object.keys(g.edits).length) {
      const values = { ...Object.fromEntries((g.erasers || []).map(change => [change.key, change.value])), ...g.edits };
      if (Object.keys(values).length <= 1000) store.edit(values, { ...Object.fromEntries((g.erasers || []).map(change => [change.key, change.expected])), ...g.stamps });
      else setMessage("한 번에 1000개 항목까지 조절할 수 있어요. 개체를 나누어 선택해 주세요.");
    }
    if (!cancel && draftRef.current && !disabled && g && ["draw", "move", "resize"].includes(g.kind)) {
      const key = g.key || `shape:${crypto.randomUUID()}`;
      store.edit({ ...Object.fromEntries((g.erasers || []).map(change => [change.key, change.value])), [key]: draftRef.current }, g.key ? { ...Object.fromEntries((g.erasers || []).map(change => [change.key, change.expected])), [key]: g.stamp ?? null } : undefined);
    }
    gesture.current = null; changeDraft(null); setTransformDraft({}); setMarquee(null);
  };
  const selectShape = (key: string, e: ReactPointerEvent<SVGGElement>) => {
    if (tool !== "select" || disabled || pointers.current.size || e.button !== 0 || (e.pointerType === "touch" && !e.isPrimary)) return;
    if (e.shiftKey) { e.preventDefault(); e.stopPropagation(); setSelected(all => all.includes(key) ? all.filter(id => id !== key) : [...all, key]); return; }
    const insideSelection = pointInBox(world(point(e)), selectionBounds(items.filter(([id]) => selected.includes(id))), 6 / cameraRef.current.zoom);
    beginTransform("move", insideSelection || selected.includes(key) ? selected : [key], e);
  };
  const wheel = (e: WheelEvent<SVGSVGElement>) => { if (e.ctrlKey || e.metaKey) updateZoom(Math.exp(-e.deltaY * .005), point(e)); else setCamera(c => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY })); };
  useEffect(() => { const el = svg.current; const prevent = (e: globalThis.WheelEvent) => e.preventDefault(); el?.addEventListener("wheel", prevent, { passive: false }); return () => el?.removeEventListener("wheel", prevent); }, []);
  const hasTransform = Object.keys(transformDraft).length > 0;
  const workingItems = useMemo(() => {
    const boundErasers = new Map(draftErasers.map(change => [change.key, change.value as ShapeValue]));
    const result = items.filter(([key]) => transformDraft[key] !== null).map(([key, shape]) => [key, key === draftKey && draft ? draft : transformDraft[key] || boundErasers.get(key) || shape] as [string, ShapeValue]);
    if (draft?.type === "eraser") result.push(["draft", draft]);
    return result;
  }, [items, draft, draftKey, draftErasers, transformDraft]);
  const brushSize = tool === "eraser" ? eraserSize : penSize, previewSize = brushSize * camera.zoom;
  const previewWidth = Math.max(144, previewSize + 96), previewHeight = Math.max(64, previewSize + 16);
  const box = selectionBounds(workingItems.filter(([key]) => selected.includes(key)));
  const fit = () => {
    const boxes = items.filter(([, s]) => s.type !== "eraser").map(([, s]) => shapeBounds(s)); if (!boxes.length) { setCamera({ x: 80, y: 80, zoom: 1 }); return; }
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y)), right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
    const width = svg.current?.clientWidth || 800, height = svg.current?.clientHeight || 500, zoom = Math.max(.1, Math.min(2, (width - 100) / Math.max(1, right - x), (height - 100) / Math.max(1, bottom - y)));
    setCamera({ x: (width - (right - x) * zoom) / 2 - x * zoom, y: (height - (bottom - y) * zoom) / 2 - y * zoom, zoom });
  };
  const remove = () => { if (selected.length && !disabled) { if (selected.length > 1000) { setMessage("한 번에 1000개 개체까지 삭제할 수 있어요."); return; } store.edit(Object.fromEntries(selected.map(key => [key, null]))); setSelected([]); } };
  return <div className={styles.board}>
    <div className={styles.drawingTools} aria-label="그림 도구">{tools.map(({ id, label, Icon }) => <button key={id} ref={id === "eraser" ? eraserButton : undefined} aria-label={label} title={id === "eraser" ? `지우개 · ${eraserMode === "area" ? "영역 삭제" : "개체 삭제"}` : label} aria-pressed={tool === id} aria-haspopup={id === "eraser" ? "menu" : undefined} aria-expanded={id === "eraser" ? !!eraserMenu : undefined} disabled={disabled && id !== "hand"}
      onPointerEnter={e => { if (id === "eraser" && e.pointerType === "mouse") openEraserMenu(); }} onPointerLeave={() => { if (id === "eraser") { clearLongPress(); closeEraserMenuSoon(); } }}
      onPointerDown={e => { if (id === "eraser" && e.button === 0) { clearLongPress(); longPress.current = setTimeout(openEraserMenu, 450); } }} onPointerUp={clearLongPress} onPointerCancel={clearLongPress}
      onContextMenu={e => { if (id === "eraser") { e.preventDefault(); cancelGesture(); setTool("eraser"); openEraserMenu(); } }}
      onClick={e => { cancelGesture(); setTool(id); if (id === "eraser") { menuFocus.current = e.detail === 0; openEraserMenu(); } else setEraserMenu(null); }}><Icon size={20}/><span>{label}{id === "eraser" && <ChevronDown size={9}/>}</span></button>)}</div>
    {eraserMenu && <div ref={eraserMenuRef} role="menu" aria-label="지우개 삭제 방식" className={styles.eraserMenu} style={{ left: eraserMenu.x, top: eraserMenu.y }} onPointerEnter={keepEraserMenu} onPointerLeave={closeEraserMenuSoon} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEraserMenu(null); eraserButton.current?.focus(); } if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")], index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus(); } }}>
      {(["area", "object"] as const).map(mode => <button key={mode} role="menuitemradio" aria-checked={eraserMode === mode} onClick={() => { cancelGesture(); keepEraserMenu(); setEraserMode(mode); setTool("eraser"); setSelected([]); setEraserMenu(null); svg.current?.focus(); }}><span><strong>{mode === "area" ? "영역 삭제" : "개체 삭제"}</strong><small>{mode === "area" ? "지나간 부분만 지워요" : "닿은 그림을 통째로 지워요"}</small></span>{eraserMode === mode && <Check size={17}/>}</button>)}
    </div>}
    <div className={styles.penOptions}>
      <label>색상<input type="color" aria-label="펜 색상" value={color} disabled={disabled} onChange={e => setColor(e.target.value)}/></label>
      {tool === "eraser" && <button aria-label="지우개 삭제 방식 선택" onClick={openEraserMenu}>{eraserMode === "area" ? "영역 삭제" : "개체 삭제"}<ChevronDown size={12}/></button>}
      <label>{tool === "eraser" ? "지우개" : "펜"} 크기 <input type="range" aria-label={tool === "eraser" ? "지우개 크기" : "펜 크기"} min="1" max={tool === "eraser" ? 80 : 30} value={brushSize} disabled={disabled} onFocus={() => setShowSizePreview(true)} onBlur={() => setShowSizePreview(false)} onChange={e => { setShowSizePreview(true); if (tool === "eraser") setEraserSize(Number(e.target.value)); else setPenSize(Number(e.target.value)); }}/><output>{brushSize}</output></label>
      {tool === "text" && <label>글자 크기<input aria-label="글자 크기" type="range" min="12" max="96" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}/><output>{fontSize}</output></label>}
      {selected.length > 0 && <><span className={styles.selectionCount} role="status">{selected.length}개 선택</span><button disabled={disabled} onClick={remove}><Trash2 size={16}/>선택 삭제</button>{chosen?.type === "text" && chosenKey && <button disabled={disabled} onClick={() => setTextEdit({ key: chosenKey, x: chosen.x, y: chosen.y, text: chosen.text || "", stamp: doc.entities[chosenKey].stamp })}>글씨 편집</button>}</>}
    </div>
    {showSizePreview && !disabled && <div className={styles.brushPreview} role="img" aria-label={`${tool === "eraser" ? "지우개" : "펜"} 굵기 미리보기 ${brushSize}, 확대율 ${Math.round(camera.zoom * 100)}%`}>
      <span>{tool === "eraser" ? "지우개" : "펜"} 크기 <strong>{brushSize}</strong></span>
      <svg width={previewWidth} height={previewHeight} aria-hidden="true">{tool === "eraser" ? <circle cx={previewWidth / 2} cy={previewHeight / 2} r={previewSize / 2} fill="#fff" stroke="#6f817b" strokeWidth="1"/> : <line x1={previewWidth / 2 - 32} y1={previewHeight / 2} x2={previewWidth / 2 + 32} y2={previewHeight / 2} stroke={color} strokeWidth={previewSize} strokeLinecap="round"/>}</svg>
      <small>현재 화면에서 보이는 굵기 · {Math.round(camera.zoom * 100)}%</small>
    </div>}
    {message && <p role="status" className={styles.boardMessage}>{message}<button onClick={() => setMessage("")}>닫기</button></p>}
    <svg ref={svg} className={styles.boardCanvas} role="application" aria-label={`${doc.title} 그림판. 도구를 선택해 그리거나 두 손가락으로 확대하세요.`} tabIndex={0} data-tool={disabled ? "hand" : tool} onPointerDown={begin} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onPointerLeave={() => setCursor(null)} onWheel={wheel} onKeyDown={e => { if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); } if (e.key === "Escape") { cancelGesture(); setSelected([]); } }}>
      <defs><pattern id={`${id}-dots`} x={camera.x % (24 * camera.zoom)} y={camera.y % (24 * camera.zoom)} width={24 * camera.zoom} height={24 * camera.zoom} patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="currentColor" opacity=".16"/></pattern></defs>
      <rect width="100%" height="100%" fill={`url(#${id}-dots)`}/>
      <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}><BoardArtwork items={hasTransform || (draft && (draft.type === "eraser" || draftKey)) ? workingItems : items} prefix={id} onSelect={tool === "select" && !disabled ? selectShape : undefined}/>{draft && draft.type !== "eraser" && !draftKey && <BoardArtwork items={[["draft", draft]]} prefix={`${id}-draft`}/> }
        {box && tool === "select" && <g>
          <rect x={box.x - 6 / camera.zoom} y={box.y - 6 / camera.zoom} width={box.width + 12 / camera.zoom} height={box.height + 12 / camera.zoom} fill="none" stroke="#358872" strokeWidth={1.5 / camera.zoom} strokeDasharray={`${5 / camera.zoom} ${4 / camera.zoom}`} pointerEvents="none"/>
          {!disabled && <g aria-label="선택 영역 크기 조절" style={{ cursor: "nwse-resize" }} onPointerDown={e => {
            if (e.button !== 0 || pointers.current.size || (e.pointerType === "touch" && !e.isPrimary)) return;
            beginTransform("resize", selected, e);
          }}>
            <title>선택 영역 크기 조절</title>
            <rect x={box.x + box.width - 9 / camera.zoom} y={box.y + box.height - 9 / camera.zoom} width={30 / camera.zoom} height={30 / camera.zoom} fill="transparent"/>
            <rect x={box.x + box.width} y={box.y + box.height} width={12 / camera.zoom} height={12 / camera.zoom} rx={2 / camera.zoom} fill="#358872" stroke="white" strokeWidth={1.5 / camera.zoom}/>
          </g>}
        </g>}
        {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} fill="#35887218" stroke="#358872" strokeWidth={1 / camera.zoom} pointerEvents="none"/>}
      </g>
      {cursor && tool === "eraser" && !disabled && <circle cx={cursor.x} cy={cursor.y} r={eraserSize * camera.zoom / 2} fill="#ffffff50" stroke="#6f817b" strokeWidth="1" pointerEvents="none"/>}
      {cursor && tool === "pen" && !disabled && !showSizePreview && <circle cx={cursor.x} cy={cursor.y} r={penSize * camera.zoom / 2} fill={color} opacity=".45" pointerEvents="none"/>}
    </svg>
    <div className={styles.boardHint}>{tool === "hand" ? "드래그해서 화면 이동" : tool === "select" ? "빈 곳을 드래그해 선택 · 선택 영역 안에서 이동 · 오른쪽 아래에서 크기 조절" : tool === "eraser" ? eraserMode === "area" ? "지나간 부분만 삭제 · 지우개에서 삭제 방식 변경" : "닿은 개체 전체 삭제 · 실행 취소로 복원" : "한 손가락으로 그리기 · 두 손가락으로 이동·확대"}</div>
    <div className={styles.zoomTools}><button aria-label="축소" onClick={() => updateZoom(.8)}><ZoomOut size={18}/></button><output>{Math.round(camera.zoom * 100)}%</output><button aria-label="확대" onClick={() => updateZoom(1.25)}><ZoomIn size={18}/></button><button aria-label="전체 그림에 맞추기" title="전체 그림에 맞추기" onClick={fit}><LocateFixed size={18}/></button></div>
    {textEdit && <Dialog title="그림판 글씨" onClose={() => setTextEdit(null)}><form className="stack" onSubmit={e => { e.preventDefault(); const edit = textEdit; if (edit.text.trim()) { const k = edit.key || `shape:${crypto.randomUUID()}`; store.edit({ [k]: { ...(edit.key ? doc.entities[edit.key]?.value as ShapeValue : {}), type: "text", x: edit.x, y: edit.y, text: edit.text, color: edit.key ? (doc.entities[edit.key]?.value as ShapeValue).color : color, width: edit.key ? (doc.entities[edit.key]?.value as ShapeValue).width : penSize, fontSize: edit.key ? ((doc.entities[edit.key]?.value as ShapeValue).fontSize || 24) : fontSize, order: edit.key ? (doc.entities[edit.key]?.value as ShapeValue).order : `${Date.now()}:${crypto.randomUUID()}` } }, { [k]: edit.stamp }); } setTextEdit(null); }}><textarea autoFocus aria-label="그림판 글씨 내용" maxLength={2000} rows={5} value={textEdit.text} onChange={e => setTextEdit({ ...textEdit, text: e.target.value })}/><button className="primary" disabled={!textEdit.text.trim()}>글씨 적용</button></form></Dialog>}
  </div>;
}
