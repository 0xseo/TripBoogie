"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Columns3, Rows3, Plus, Trash2 } from "lucide-react";
import { axis, cellKey, cellValue, columnLabel, parseTsv, sheetLimits, sheetTsv, type BrainDocument, type BrainValue, type CellValue } from "../brainstorm";
import type { BrainStore } from "../brainstorm-store";
import styles from "./Brainstorming.module.css";

type Selection = { row: number; col: number; endRow: number; endCol: number };
const prefix = (ids: string[], size: (id: string) => number) => { const out = [0]; for (const id of ids) out.push(out[out.length - 1] + size(id)); return out; };
function firstVisible(offsets: number[], position: number) { let lo = 0, hi = offsets.length - 1; while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); if (offsets[mid] <= position) lo = mid; else hi = mid - 1; } return lo; }

export default function BrainSheet({ document: doc, store, disabled, onCell }: { document: BrainDocument; store: BrainStore; disabled: boolean; onCell?: (label: string) => void }) {
  const entities = doc.entities, rows = useMemo(() => axis(entities, "rows"), [entities]), columns = useMemo(() => axis(entities, "cols"), [entities]);
  const viewport = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), dragging = useRef(false);
  const [view, setView] = useState({ left: 0, top: 0, width: 900, height: 500 });
  const [rangeMode, setRangeMode] = useState(false);
  const [selection, setSelection] = useState<Selection>({ row: 0, col: 0, endRow: 0, endCol: 0 });
  const row = Math.min(selection.row, rows.length - 1), col = Math.min(selection.col, columns.length - 1);
  const key = cellKey(rows[row], columns[col]), value = cellValue(entities, key);
  const [buffer, setBuffer] = useState({ key, text: value.text, stamp: entities[key]?.stamp ?? null, dirty: false });
  const draft = buffer.text; const [message, setMessage] = useState("");
  if (buffer.key !== key || (!buffer.dirty && (buffer.text !== value.text || buffer.stamp !== (entities[key]?.stamp ?? null)))) setBuffer({ key, text: value.text, stamp: entities[key]?.stamp ?? null, dirty: false });
  const rowOffsets = useMemo(() => prefix(rows, id => Number(entities[`rowheight:${id}`]?.value) || 36), [rows, entities]);
  const colOffsets = useMemo(() => prefix(columns, id => Number(entities[`colwidth:${id}`]?.value) || 144), [columns, entities]);
  const commit = () => {
    const b = buffer;
    if (!b.dirty || disabled) return;
    const current = cellValue(store.getSnapshot().document.entities, b.key);
    store.edit({ [b.key]: { ...current, text: b.text } }, { [b.key]: b.stamp }); setBuffer(b => ({ ...b, dirty: false }));
  };
  const commitRef = useRef(commit);
  useLayoutEffect(() => { commitRef.current = commit; });
  useEffect(() => () => commitRef.current(), []);
  useEffect(() => { onCell?.(`${columnLabel(col)}${row + 1}`); }, [col, row, onCell]);
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const observer = new ResizeObserver(() => setView(v => ({ ...v, width: el.clientWidth, height: el.clientHeight })));
    observer.observe(el); return () => observer.disconnect();
  }, []);
  useEffect(() => { const end = () => { dragging.current = false; }; window.addEventListener("pointerup", end); return () => window.removeEventListener("pointerup", end); }, []);
  const bounds = { r0: Math.min(row, selection.endRow), r1: Math.min(rows.length - 1, Math.max(row, selection.endRow)), c0: Math.min(col, selection.endCol), c1: Math.min(columns.length - 1, Math.max(col, selection.endCol)) };
  const selectedKeys = () => {
    const keys: string[] = [];
    for (let r = bounds.r0; r <= bounds.r1; r++) for (let c = bounds.c0; c <= bounds.c1; c++) keys.push(cellKey(rows[r], columns[c]));
    if (keys.length > sheetLimits.paste) { setMessage("한 번에 1000개 셀까지 편집할 수 있어요."); return []; }
    return keys;
  };
  const format = (patch: Partial<CellValue>) => { commit(); store.edit(Object.fromEntries(selectedKeys().map(k => [k, { ...cellValue(store.getSnapshot().document.entities, k), ...patch }]))); };
  const select = (r: number, c: number, extend = false) => { commit(); setSelection(s => extend ? { ...s, endRow: r, endCol: c } : { row: r, col: c, endRow: r, endCol: c }); };
  const scrollTo = (r: number, c: number) => {
    const el = viewport.current; if (!el) return;
    if (rowOffsets[r] < el.scrollTop) el.scrollTop = rowOffsets[r];
    else if (rowOffsets[r + 1] + 32 > el.scrollTop + el.clientHeight) el.scrollTop = rowOffsets[r + 1] + 32 - el.clientHeight;
    if (colOffsets[c] < el.scrollLeft) el.scrollLeft = colOffsets[c];
    else if (colOffsets[c + 1] + 48 > el.scrollLeft + el.clientWidth) el.scrollLeft = colOffsets[c + 1] + 48 - el.clientWidth;
  };
  const move = (r: number, c: number, extend = false) => { r = Math.max(0, Math.min(rows.length - 1, r)); c = Math.max(0, Math.min(columns.length - 1, c)); select(r, c, extend); scrollTo(r, c); };
  const keyboard = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).matches("input,textarea,select")) return;
    const r = e.shiftKey ? selection.endRow : row, c = e.shiftKey ? selection.endCol : col;
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Tab"].includes(e.key)) {
      e.preventDefault(); move(r + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0), c + (e.key === "ArrowRight" || e.key === "Tab" ? 1 : e.key === "ArrowLeft" ? -1 : 0), e.shiftKey && e.key !== "Tab");
    } else if (!disabled && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); format({ text: "" }); }
    else if (!disabled && (e.key === "Enter" || e.key === "F2")) { e.preventDefault(); input.current?.focus(); }
    else if (!disabled && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); input.current?.focus(); setBuffer({ key, text: e.key, stamp: entities[key]?.stamp ?? null, dirty: true }); }
  };
  const copy = (e: ClipboardEvent) => { if ((e.target as HTMLElement).matches("input,textarea")) return; e.preventDefault(); e.clipboardData.setData("text/plain", sheetTsv(entities, rows.slice(bounds.r0, bounds.r1 + 1), columns.slice(bounds.c0, bounds.c1 + 1))); };
  const paste = (e: ClipboardEvent) => {
    if ((e.target as HTMLElement).matches("input,textarea") || disabled) return;
    e.preventDefault(); const text = e.clipboardData.getData("text/plain");
    if (text.length > 500000) { setMessage("붙여넣을 내용이 너무 커요. 나누어 붙여넣어 주세요."); return; }
    const table = parseTsv(text), count = table.reduce((n, cells) => n + cells.length, 0);
    if (count > sheetLimits.paste || table.some(cells => cells.some(t => t.length > 5000))) { setMessage("한 번에 1000개 셀, 셀당 5000자까지 붙여넣을 수 있어요."); return; }
    const nextRows = [...rows], nextCols = [...columns], changes: Record<string, BrainValue> = {};
    const wantedRows = row + table.length, wantedCols = col + Math.max(...table.map(c => c.length));
    if (wantedRows > sheetLimits.rows || wantedCols > sheetLimits.columns) { setMessage("표의 최대 행·열 수를 초과했어요."); return; }
    while (nextRows.length < wantedRows) nextRows.push(`r${crypto.randomUUID().replaceAll("-", "")}`);
    while (nextCols.length < wantedCols) nextCols.push(`c${crypto.randomUUID().replaceAll("-", "")}`);
    if (nextRows.length !== rows.length) changes["sheet:rows"] = nextRows;
    if (nextCols.length !== columns.length) changes["sheet:cols"] = nextCols;
    table.forEach((cells, ri) => cells.forEach((text, ci) => { const k = cellKey(nextRows[row + ri], nextCols[col + ci]); changes[k] = { ...cellValue(entities, k), text }; }));
    if (Object.keys(changes).length > 1000) { setMessage("행·열 확장을 포함해 1000개 항목까지 붙여넣을 수 있어요."); return; }
    store.edit(changes); setMessage("");
  };
  const changeAxis = (which: "rows" | "cols", action: "append" | "insert" | "delete") => {
    commit(); const list = [...(which === "rows" ? rows : columns)], index = which === "rows" ? row : col;
    if (action === "delete") { if (list.length <= 1) return; list.splice(index, 1); }
    else {
      const count = action === "append" ? which === "rows" ? 100 : 10 : 1;
      if (list.length + count > (which === "rows" ? sheetLimits.rows : sheetLimits.columns)) { setMessage("표의 최대 행·열 수에 도달했어요."); return; }
      list.splice(action === "append" ? list.length : index, 0, ...Array.from({ length: count }, () => `${which === "rows" ? "r" : "c"}${crypto.randomUUID().replaceAll("-", "")}`));
    }
    store.edit({ [`sheet:${which}`]: list }); setSelection({ row: Math.min(row, which === "rows" ? list.length - 1 : rows.length - 1), col: Math.min(col, which === "cols" ? list.length - 1 : columns.length - 1), endRow: Math.min(row, which === "rows" ? list.length - 1 : rows.length - 1), endCol: Math.min(col, which === "cols" ? list.length - 1 : columns.length - 1) });
  };
  const rStart = Math.max(0, firstVisible(rowOffsets, view.top) - 1), rEnd = Math.min(rows.length, firstVisible(rowOffsets, view.top + view.height) + 2);
  const cStart = Math.max(0, firstVisible(colOffsets, view.left) - 1), cEnd = Math.min(columns.length, firstVisible(colOffsets, view.left + view.width) + 2);
  return <div className={styles.sheet} onKeyDown={keyboard} onCopy={copy} onPaste={paste}>
    <div className={styles.sheetToolbar} aria-label="표 편집 도구">
      <button title="굵게" aria-label="굵게" aria-pressed={!!value.bold} disabled={disabled} onClick={() => format({ bold: !value.bold })}><Bold size={17}/></button>
      <label title="글자색">글자<input aria-label="셀 글자색" type="color" value={value.color || "#203d35"} disabled={disabled} onChange={e => format({ color: e.target.value })}/></label>
      <label title="배경색">배경<input aria-label="셀 배경색" type="color" value={value.background || "#ffffff"} disabled={disabled} onChange={e => format({ background: e.target.value })}/></label>
      {([AlignLeft, AlignCenter, AlignRight] as const).map((Icon, i) => <button key={i} aria-label={["왼쪽 정렬", "가운데 정렬", "오른쪽 정렬"][i]} aria-pressed={value.align === ["left", "center", "right"][i]} disabled={disabled} onClick={() => format({ align: (["left", "center", "right"] as const)[i] })}><Icon size={17}/></button>)}
      <button aria-pressed={rangeMode} onClick={() => setRangeMode(v => !v)}>범위 선택</button><span className={styles.toolDivider}/>
      <button disabled={disabled} onClick={() => changeAxis("rows", "insert")}><Rows3 size={16}/>행 삽입</button><button disabled={disabled} onClick={() => changeAxis("cols", "insert")}><Columns3 size={16}/>열 삽입</button>
      <button disabled={disabled} onClick={() => changeAxis("rows", "delete")}><Trash2 size={15}/>행 삭제</button><button disabled={disabled} onClick={() => changeAxis("cols", "delete")}><Trash2 size={15}/>열 삭제</button>
      <label>열 너비<input aria-label="열 너비" type="range" min="64" max="400" value={Number(entities[`colwidth:${columns[col]}`]?.value) || 144} disabled={disabled} onChange={e => store.edit({ [`colwidth:${columns[col]}`]: Number(e.target.value) })}/></label>
      <label>행 높이<input aria-label="행 높이" type="range" min="28" max="180" value={Number(entities[`rowheight:${rows[row]}`]?.value) || 36} disabled={disabled} onChange={e => store.edit({ [`rowheight:${rows[row]}`]: Number(e.target.value) })}/></label>
    </div>
    <div className={styles.formula}><span>{columnLabel(col)}{row + 1}</span><span aria-hidden="true">내용</span><input ref={input} aria-label="선택한 셀 내용" maxLength={5000} value={draft} readOnly={disabled} placeholder="셀을 선택하고 내용을 입력하세요" onFocus={() => { if (!buffer.dirty) setBuffer(b => ({ ...b, stamp: entities[key]?.stamp ?? null })); }} onChange={e => { setBuffer(b => ({ ...b, text: e.target.value, dirty: true })); }} onBlur={commit} onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") { commit(); move(row + 1, col); viewport.current?.focus(); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setBuffer({ key, text: value.text, stamp: entities[key]?.stamp ?? null, dirty: false }); viewport.current?.focus(); } }}/><button disabled={disabled} onClick={() => { commit(); viewport.current?.focus(); }}>적용</button></div>
    {buffer.dirty && buffer.stamp !== (entities[key]?.stamp ?? null) && <p className={styles.inlineMessage}>동행이 이 셀을 변경했어요. 입력한 내용은 유지되며 저장할 때 충돌을 확인합니다.</p>}
    {message && <p role="status" className={styles.inlineMessage}>{message}<button onClick={() => setMessage("")}>닫기</button></p>}
    <div ref={viewport} className={styles.sheetViewport} tabIndex={0} aria-label="스프레드시트. 방향키로 이동하고 Enter로 편집" onScroll={e => { const el = e.currentTarget; setView({ left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight }); }}>
      <div role="grid" aria-label={doc.title} aria-rowcount={rows.length + 1} aria-colcount={columns.length + 1} style={{ width: colOffsets.at(-1)! + 48, height: rowOffsets.at(-1)! + 32, position: "relative" }}>
        <div role="row" className={styles.columnHeaders} style={{ top: view.top }}>
          {columns.slice(cStart, cEnd).map((id, ci) => { const c = ci + cStart; return <div role="columnheader" key={id} style={{ left: colOffsets[c] + 48, width: colOffsets[c + 1] - colOffsets[c] }}>{columnLabel(c)}</div>; })}
        </div>
        {rows.slice(rStart, rEnd).map((id, ri) => { const r = ri + rStart; return <div role="row" aria-rowindex={r + 2} key={id} className={styles.gridRow} style={{ top: rowOffsets[r] + 32, height: rowOffsets[r + 1] - rowOffsets[r], width: "100%" }}>
          <div role="rowheader" className={styles.rowHeader} style={{ left: view.left }}>{r + 1}</div>
          {columns.slice(cStart, cEnd).map((cid, ci) => { const c = ci + cStart, k = cellKey(id, cid), cell = cellValue(entities, k), selected = r >= bounds.r0 && r <= bounds.r1 && c >= bounds.c0 && c <= bounds.c1; return <div key={cid} role="gridcell" aria-colindex={c + 2} aria-label={`${columnLabel(c)}${r + 1}${cell.text ? `: ${cell.text}` : ""}`} aria-selected={selected} className={styles.gridCell} data-current={r === row && c === col} data-selected={selected} style={{ left: colOffsets[c] + 48, width: colOffsets[c + 1] - colOffsets[c], color: cell.color, backgroundColor: cell.background, fontWeight: cell.bold ? 700 : 400, textAlign: cell.align || "left" }} onPointerDown={e => { if (e.button !== 0) return; if (e.pointerType === "mouse") { e.preventDefault(); dragging.current = true; } viewport.current?.focus({ preventScroll: true }); select(r, c, e.shiftKey || rangeMode); }} onPointerEnter={() => { if (dragging.current) setSelection(s => ({ ...s, endRow: r, endCol: c })); }} onDoubleClick={() => input.current?.focus()}>{cell.text}</div>; })}
        </div>; })}
        <div className={styles.gridCorner} style={{ top: view.top, left: view.left }} aria-hidden="true"/>
      </div>
    </div>
    <footer className={styles.sheetFooter}><span>{rows.length.toLocaleString()}행 × {columns.length.toLocaleString()}열 · {bounds.r1 - bounds.r0 + 1} × {bounds.c1 - bounds.c0 + 1} 선택</span><div><button disabled={disabled} onClick={() => changeAxis("rows", "append")}><Plus size={14}/>100행 추가</button><button disabled={disabled} onClick={() => changeAxis("cols", "append")}><Plus size={14}/>10열 추가</button></div></footer>
  </div>;
}
