"use client";
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { ArrowUpRight, Circle, Eraser, Hand, Minus, MousePointer2, Pencil, RectangleHorizontal, Trash2, Type, ZoomIn, ZoomOut, LocateFixed } from "lucide-react";
import { shapes, type BrainChange, type BrainDocument, type ShapeValue } from "../brainstorm";
import { attachLegacyErasers, eraserTransform, pathFor, shapeBounds } from "../brainstorm-board";
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
  if (!items.length) return <div className={styles.emptyBoard}><Pencil size={30}/><span>생각을 자유롭게 그려 보세요</span></div>;
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
  const [selected, setSelected] = useState<string | null>(null), [textEdit, setTextEdit] = useState<{ key?: string; x: number; y: number; text: string; stamp: string | null } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null), [message, setMessage] = useState("");
  const [showSizePreview, setShowSizePreview] = useState(false);
  const svg = useRef<SVGSVGElement>(null), pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "draw" | "pan" | "pinch" | "move" | "resize"; startX: number; startY: number; camera: Camera; distance?: number; anchor?: { x: number; y: number }; original?: ShapeValue; key?: string; stamp?: string | null; erasers?: BrainChange[] } | null>(null);
  const id = useId().replaceAll(":", ""), items = useMemo(() => shapes(doc.entities), [doc.entities]), chosen = selected ? doc.entities[selected]?.value as ShapeValue | null : null;
  const point = (e: { clientX: number; clientY: number }) => { const rect = svg.current!.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; };
  const world = (p: { x: number; y: number }, c = cameraRef.current) => ({ x: (p.x - c.x) / c.zoom, y: (p.y - c.y) / c.zoom });
  const changeDraft = (value: ShapeValue | null) => { draftRef.current = value; setDraft(value); };
  const attachErasers = (key: string, original: ShapeValue) => { const changes = attachLegacyErasers(doc.entities, key, original); setDraftErasers(changes); return changes; };
  const cancelGesture = () => { gesture.current = null; pointers.current.clear(); changeDraft(null); };
  const updateZoom = (factor: number, anchor?: { x: number; y: number }) => { const c = cameraRef.current, p = anchor || { x: (svg.current?.clientWidth || 800) / 2, y: (svg.current?.clientHeight || 500) / 2 }, w = world(p, c), zoom = Math.max(.1, Math.min(8, c.zoom * factor)); setCamera({ zoom, x: p.x - w.x * zoom, y: p.y - w.y * zoom }); };
  const begin = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault(); svg.current?.focus(); svg.current?.setPointerCapture(e.pointerId);
    const p = point(e), w = world(p); pointers.current.set(e.pointerId, p);
    if (pointers.current.size >= 2) {
      changeDraft(null); const [a, b] = [...pointers.current.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture.current = { kind: "pinch", startX: mid.x, startY: mid.y, camera: cameraRef.current, distance: Math.hypot(a.x - b.x, a.y - b.y), anchor: world(mid) }; return;
    }
    if (gesture.current?.kind === "move" || gesture.current?.kind === "resize") return;
    if (tool === "hand" || e.button === 1 || disabled) { gesture.current = { kind: "pan", startX: p.x, startY: p.y, camera: cameraRef.current }; return; }
    if (tool === "select") { setSelected(null); return; }
    if (tool === "text") { setTextEdit({ x: w.x, y: w.y, text: "", stamp: null }); return; }
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
    if (g.kind === "move" && g.original) {
      const dx = w.x - g.startX, dy = w.y - g.startY, s = g.original;
      changeDraft({ ...s, x: s.x + dx, y: s.y + dy, ...(s.x2 !== undefined ? { x2: s.x2 + dx, y2: s.y2! + dy } : {}), ...(s.points ? { points: s.points.map(([x, y]) => [x + dx, y + dy]) } : {}) }); return;
    }
    if (g.kind === "resize" && g.original) { changeDraft({ ...g.original, x2: w.x, y2: w.y }); return; }
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
    if (!cancel && draftRef.current && !disabled && g && ["draw", "move", "resize"].includes(g.kind)) {
      const key = g.key || `shape:${crypto.randomUUID()}`;
      store.edit({ ...Object.fromEntries((g.erasers || []).map(change => [change.key, change.value])), [key]: draftRef.current }, g.key ? { ...Object.fromEntries((g.erasers || []).map(change => [change.key, change.expected])), [key]: g.stamp ?? null } : undefined);
    }
    gesture.current = null; changeDraft(null);
  };
  const selectShape = (key: string, e: ReactPointerEvent<SVGGElement>) => {
    if (tool !== "select" || disabled || pointers.current.size) return;
    e.preventDefault(); e.stopPropagation(); const p = point(e), w = world(p), original = doc.entities[key]?.value as ShapeValue;
    setSelected(key); setDraftKey(key); svg.current?.focus({ preventScroll: true }); svg.current?.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, p);
    gesture.current = { kind: "move", key, original, startX: w.x, startY: w.y, camera: cameraRef.current, stamp: doc.entities[key]?.stamp ?? null, erasers: attachErasers(key, original) };
  };
  const wheel = (e: WheelEvent<SVGSVGElement>) => { if (e.ctrlKey || e.metaKey) updateZoom(Math.exp(-e.deltaY * .005), point(e)); else setCamera(c => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY })); };
  useEffect(() => { const el = svg.current; const prevent = (e: globalThis.WheelEvent) => e.preventDefault(); el?.addEventListener("wheel", prevent, { passive: false }); return () => el?.removeEventListener("wheel", prevent); }, []);
  const boundErasers = new Map(draftErasers.map(change => [change.key, change.value as ShapeValue]));
  const workingItems = draft && draftKey ? items.map(([key, shape]) => [key, key === draftKey ? draft : boundErasers.get(key) || shape] as [string, ShapeValue]) : draft ? [...items, ["draft", draft] as [string, ShapeValue]] : items;
  const brushSize = tool === "eraser" ? eraserSize : penSize, previewSize = brushSize * camera.zoom;
  const previewWidth = Math.max(144, previewSize + 96), previewHeight = Math.max(64, previewSize + 16);
  const shownChosen = draftKey === selected && draft ? draft : chosen;
  const box = shownChosen && shownChosen.type !== "eraser" ? shapeBounds(shownChosen) : null;
  const fit = () => {
    const boxes = items.filter(([, s]) => s.type !== "eraser").map(([, s]) => shapeBounds(s)); if (!boxes.length) { setCamera({ x: 80, y: 80, zoom: 1 }); return; }
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y)), right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
    const width = svg.current?.clientWidth || 800, height = svg.current?.clientHeight || 500, zoom = Math.max(.1, Math.min(2, (width - 100) / Math.max(1, right - x), (height - 100) / Math.max(1, bottom - y)));
    setCamera({ x: (width - (right - x) * zoom) / 2 - x * zoom, y: (height - (bottom - y) * zoom) / 2 - y * zoom, zoom });
  };
  const remove = () => { if (selected && !disabled) { store.edit({ [selected]: null }); setSelected(null); } };
  return <div className={styles.board}>
    <div className={styles.drawingTools} aria-label="그림 도구">{tools.map(({ id, label, Icon }) => <button key={id} aria-label={label} title={label} aria-pressed={tool === id} disabled={disabled && id !== "hand"} onClick={() => { cancelGesture(); setTool(id); }}><Icon size={20}/><span>{label}</span></button>)}</div>
    <div className={styles.penOptions}>
      <label>색상<input type="color" aria-label="펜 색상" value={color} disabled={disabled} onChange={e => setColor(e.target.value)}/></label>
      <label>{tool === "eraser" ? "지우개" : "펜"} 크기 <input type="range" aria-label={tool === "eraser" ? "지우개 크기" : "펜 크기"} min="1" max={tool === "eraser" ? 80 : 30} value={brushSize} disabled={disabled} onFocus={() => setShowSizePreview(true)} onBlur={() => setShowSizePreview(false)} onChange={e => { setShowSizePreview(true); if (tool === "eraser") setEraserSize(Number(e.target.value)); else setPenSize(Number(e.target.value)); }}/><output>{brushSize}</output></label>
      {tool === "text" && <label>글자 크기<input aria-label="글자 크기" type="range" min="12" max="96" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}/><output>{fontSize}</output></label>}
      {selected && <><button disabled={disabled} onClick={remove}><Trash2 size={16}/>선택 삭제</button>{chosen?.type === "text" && <button disabled={disabled} onClick={() => setTextEdit({ key: selected, x: chosen.x, y: chosen.y, text: chosen.text || "", stamp: doc.entities[selected].stamp })}>글씨 편집</button>}</>}
    </div>
    {showSizePreview && !disabled && <div className={styles.brushPreview} role="img" aria-label={`${tool === "eraser" ? "지우개" : "펜"} 굵기 미리보기 ${brushSize}, 확대율 ${Math.round(camera.zoom * 100)}%`}>
      <span>{tool === "eraser" ? "지우개" : "펜"} 크기 <strong>{brushSize}</strong></span>
      <svg width={previewWidth} height={previewHeight} aria-hidden="true">{tool === "eraser" ? <circle cx={previewWidth / 2} cy={previewHeight / 2} r={previewSize / 2} fill="#fff" stroke="#6f817b" strokeWidth="1"/> : <line x1={previewWidth / 2 - 32} y1={previewHeight / 2} x2={previewWidth / 2 + 32} y2={previewHeight / 2} stroke={color} strokeWidth={previewSize} strokeLinecap="round"/>}</svg>
      <small>현재 화면에서 보이는 굵기 · {Math.round(camera.zoom * 100)}%</small>
    </div>}
    {message && <p role="status" className={styles.boardMessage}>{message}<button onClick={() => setMessage("")}>닫기</button></p>}
    <svg ref={svg} className={styles.boardCanvas} role="application" aria-label={`${doc.title} 그림판. 도구를 선택해 그리거나 두 손가락으로 확대하세요.`} tabIndex={0} data-tool={disabled ? "hand" : tool} onPointerDown={begin} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onPointerLeave={() => setCursor(null)} onWheel={wheel} onKeyDown={e => { if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); } if (e.key === "Escape") { cancelGesture(); setSelected(null); } }}>
      <defs><pattern id={`${id}-dots`} x={camera.x % (24 * camera.zoom)} y={camera.y % (24 * camera.zoom)} width={24 * camera.zoom} height={24 * camera.zoom} patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="currentColor" opacity=".16"/></pattern></defs>
      <rect width="100%" height="100%" fill={`url(#${id}-dots)`}/>
      <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}><BoardArtwork items={draft && (draft.type === "eraser" || draftKey) ? workingItems : items} prefix={id} onSelect={tool === "select" && !disabled ? selectShape : undefined}/>{draft && draft.type !== "eraser" && !draftKey && <BoardArtwork items={[["draft", draft]]} prefix={`${id}-draft`}/> }
        {box && tool === "select" && <g><rect x={box.x - 6} y={box.y - 6} width={box.width + 12} height={box.height + 12} fill="none" stroke="#358872" strokeWidth={1.5 / camera.zoom} strokeDasharray={`${5 / camera.zoom} ${4 / camera.zoom}`} pointerEvents="none"/>{chosen && ["rect", "ellipse", "line", "arrow"].includes(chosen.type) && <rect x={box.x + box.width - 5 / camera.zoom} y={box.y + box.height - 5 / camera.zoom} width={10 / camera.zoom} height={10 / camera.zoom} fill="#358872" style={{ cursor: "nwse-resize" }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); const p = point(e); pointers.current.set(e.pointerId, p); svg.current?.setPointerCapture(e.pointerId); setDraftKey(selected); gesture.current = { kind: "resize", key: selected!, original: chosen, startX: 0, startY: 0, camera: cameraRef.current, stamp: doc.entities[selected!].stamp, erasers: attachErasers(selected!, chosen) }; }}/>}</g>}
      </g>
      {cursor && tool === "eraser" && !disabled && <circle cx={cursor.x} cy={cursor.y} r={eraserSize * camera.zoom / 2} fill="#ffffff50" stroke="#6f817b" strokeWidth="1" pointerEvents="none"/>}
      {cursor && tool === "pen" && !disabled && !showSizePreview && <circle cx={cursor.x} cy={cursor.y} r={penSize * camera.zoom / 2} fill={color} opacity=".45" pointerEvents="none"/>}
    </svg>
    <div className={styles.boardHint}>{tool === "hand" ? "드래그해서 화면 이동" : tool === "select" ? "그림을 눌러 이동 · 모서리로 도형 크기 조절" : "한 손가락으로 그리기 · 두 손가락으로 이동·확대"}</div>
    <div className={styles.zoomTools}><button aria-label="축소" onClick={() => updateZoom(.8)}><ZoomOut size={18}/></button><output>{Math.round(camera.zoom * 100)}%</output><button aria-label="확대" onClick={() => updateZoom(1.25)}><ZoomIn size={18}/></button><button aria-label="전체 그림에 맞추기" title="전체 그림에 맞추기" onClick={fit}><LocateFixed size={18}/></button></div>
    {textEdit && <Dialog title="그림판 글씨" onClose={() => setTextEdit(null)}><form className="stack" onSubmit={e => { e.preventDefault(); const edit = textEdit; if (edit.text.trim()) { const k = edit.key || `shape:${crypto.randomUUID()}`; store.edit({ [k]: { ...(edit.key ? doc.entities[edit.key]?.value as ShapeValue : {}), type: "text", x: edit.x, y: edit.y, text: edit.text, color: edit.key ? (doc.entities[edit.key]?.value as ShapeValue).color : color, width: edit.key ? (doc.entities[edit.key]?.value as ShapeValue).width : penSize, fontSize: edit.key ? ((doc.entities[edit.key]?.value as ShapeValue).fontSize || 24) : fontSize, order: edit.key ? (doc.entities[edit.key]?.value as ShapeValue).order : `${Date.now()}:${crypto.randomUUID()}` } }, { [k]: edit.stamp }); } setTextEdit(null); }}><textarea autoFocus aria-label="그림판 글씨 내용" maxLength={2000} rows={5} value={textEdit.text} onChange={e => setTextEdit({ ...textEdit, text: e.target.value })}/><button className="primary" disabled={!textEdit.text.trim()}>글씨 적용</button></form></Dialog>}
  </div>;
}
