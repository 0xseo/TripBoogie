"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDownToLine, ArrowRight, Check, FileImage, FolderInput, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import type { Workspace } from "../types";
import { shortDate } from "../calendar";
import { emptyOverview, importOverview, overviewCandidates, overviewStorageKey, overviewTextLimit, parseOverview, writeOverviewDay, type OverviewCandidate, type OverviewDraft, type OverviewSeparator } from "../itinerary-overview";
import { renderOverviewImages, type OverviewImageRow } from "../overview-image";
import { saveDownload } from "../download";
import { useConfirm } from "./Confirmation";
import Dialog from "./Dialog";
import styles from "./TripOverview.module.css";

type Props = { workspace: Workspace; days: string[]; accountId: string; disabled?: boolean; initialDraft?: OverviewDraft };
const subscribe = () => () => {};

export default function TripOverview(props: Props) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return mounted ? <OverviewEditor key={overviewStorageKey(props.accountId, props.workspace.trip.id)} {...props} /> : <p className={styles.loading}>한눈에 보기를 준비하고 있어요…</p>;
}

function readDraft(key: string, fallback?: OverviewDraft) {
  try { return { draft: parseOverview(localStorage.getItem(key) ?? (fallback ? JSON.stringify(fallback) : null)), error: "" }; }
  catch { return { draft: emptyOverview(), error: "저장된 내용을 읽지 못했어요. 새로고침하거나 ‘표 비우기’로 새 표를 시작해 주세요." }; }
}

function OverviewEditor({ workspace, days, accountId, disabled = false, initialDraft }: Props) {
  const key = overviewStorageKey(accountId, workspace.trip.id);
  const [initial] = useState(() => readDraft(key, initialDraft));
  const [draft, setDraft] = useState(initial.draft);
  const [past, setPast] = useState<OverviewDraft[]>([]), [future, setFuture] = useState<OverviewDraft[]>([]);
  const [blocked, setBlocked] = useState(!!initial.error), [storageError, setStorageError] = useState(initial.error);
  const [importDate, setImportDate] = useState<string | null>(null), [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const typingDate = useRef<string | null>(null);
  const confirm = useConfirm();
  const locked = disabled || blocked;
  const filled = days.filter(date => draft.days[date]?.text.trim()).length;

  function persist(next: OverviewDraft) {
    try { localStorage.setItem(key, JSON.stringify(next)); setStorageError(""); setBlocked(false); }
    catch { setStorageError("브라우저에 저장하지 못했어요. 이 화면을 닫기 전에 이미지를 저장하거나 저장을 다시 시도해 주세요."); }
  }
  function change(next: OverviewDraft, checkpoint = true) {
    if (checkpoint) setPast(items => [...items.slice(-29), draft]);
    setFuture([]); setDraft(next); persist(next); setNotice("");
  }
  function undo() {
    const next = past.at(-1); if (!next) return;
    setFuture(items => [...items, draft]); setPast(items => items.slice(0, -1)); setDraft(next); persist(next); typingDate.current = null; setNotice("");
  }
  function redo() {
    const next = future.at(-1); if (!next) return;
    setPast(items => [...items, draft]); setFuture(items => items.slice(0, -1)); setDraft(next); persist(next); typingDate.current = null; setNotice("");
  }
  async function clear() {
    if (!await confirm("한눈에 보기의 내용을 모두 비울까요? 원본 일정은 그대로 유지됩니다.", { title: "표 비우기", confirmLabel: "비우기" })) return;
    change(emptyOverview());
  }

  return <section className={styles.overview} aria-label="일정 한눈에 보기">
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>YOUR TRIP, AT A GLANCE</p><h2>여행을 한눈에</h2><p>하루의 흐름을 자유롭게 적고, 나만의 여행표로 저장해 보세요.</p></div>
      <span className={styles.localBadge}><Check size={14} />로컬 검토용 · 이 브라우저에 저장</span>
    </div>
    <div className={styles.toolbar}>
      <div className={styles.actions}>
        <button type="button" className="secondary" disabled={locked} onClick={() => setImportDate("")}><FolderInput size={17} />기존 일정 불러오기</button>
        <button type="button" className="primary" disabled={!days.length} onClick={() => setExporting(true)}><FileImage size={17} />이미지 저장</button>
      </div>
      <div className={styles.actions}>
        <button type="button" className="icon" aria-label="표 편집 실행 취소" title="실행 취소" disabled={locked || !past.length} onClick={undo}><Undo2 size={17} /></button>
        <button type="button" className="icon" aria-label="표 편집 다시 실행" title="다시 실행" disabled={locked || !future.length} onClick={redo}><Redo2 size={17} /></button>
        <button type="button" className={styles.clear} disabled={disabled || !filled && !blocked} onClick={() => void clear()}><Trash2 size={15} /><span>표 비우기</span></button>
      </div>
    </div>
    <p className={styles.help}>지금은 로컬 검토 단계라 요약표만 이 브라우저에 저장해요. 표를 수정하거나 지워도 원본 일정·예약은 바뀌지 않아요.</p>
    {storageError && <div className="error" role="alert">{storageError}{!blocked && <button type="button" className="secondary" onClick={() => persist(draft)}>저장 다시 시도</button>}</div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.caption}>{workspace.trip.title} · {days.length}일 중 {filled}일 작성</caption>
        <thead><tr><th scope="col">날짜</th><th scope="col">일정<span>클릭해서 바로 편집</span></th></tr></thead>
        <tbody>{days.map((date, index) => <tr key={date}>
          <th scope="row"><small>DAY {index + 1}</small><strong>{shortDate(date)}</strong></th>
          <td><DayCell date={date} value={draft.days[date]?.text ?? ""} disabled={locked} onChange={value => { change(writeOverviewDay(draft, date, value), typingDate.current !== date); typingDate.current = date; }} onBlur={() => { typingDate.current = null; }} onImport={() => setImportDate(date)} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className={styles.footnote}>시간은 각 장소의 현지 시각이에요. 원본의 최신 내용을 반영하려면 일정을 다시 불러와 주세요.</p>
    {importDate !== null && <ImportDialog workspace={workspace} days={importDate ? [importDate] : days} draft={draft} onClose={() => setImportDate(null)} onImport={(items, mode, separator) => { change(importOverview(draft, items, mode, separator)); setImportDate(null); setNotice(`${items.length}개 항목을 표에 복사했어요.`); }} />}
    {exporting && <ExportDialog title={workspace.trip.title} rows={days.map(date => ({ date, text: draft.days[date]?.text ?? "" }))} onClose={() => setExporting(false)} />}
  </section>;
}

function DayCell({ date, value, disabled, onChange, onBlur, onImport }: { date: string; value: string; disabled: boolean; onChange: (value: string) => void; onBlur: () => void; onImport: () => void }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = textarea.current; if (!node) return;
    const fit = () => { node.style.height = "0px"; node.style.height = `${Math.max(56, node.scrollHeight)}px`; };
    fit();
    const observer = new ResizeObserver(fit); observer.observe(node.parentElement!);
    return () => observer.disconnect();
  }, [value]);
  function insert(text: string) {
    const node = textarea.current; if (!node) return;
    const start = node.selectionStart, end = node.selectionEnd;
    const next = value.slice(0, start) + text + value.slice(end);
    if (next.length > overviewTextLimit) return;
    onChange(next);
    requestAnimationFrame(() => { node.focus(); node.setSelectionRange(start + text.length, start + text.length); });
  }
  return <div className={styles.cell}>
    <textarea ref={textarea} aria-label={`${shortDate(date)} 요약 일정`} value={value} disabled={disabled} maxLength={overviewTextLimit} rows={2} placeholder="일정을 직접 적거나, 기존 일정을 불러오세요." onChange={event => onChange(event.target.value)} onBlur={onBlur} />
    <div className={styles.cellTools}>
      <button type="button" disabled={disabled} onClick={onImport} aria-label={`${shortDate(date)} 기존 일정 불러오기`}><Plus size={14} />일정 불러오기</button>
      <div className={styles.insertTools}>
        <button type="button" disabled={disabled} onPointerDown={event => event.preventDefault()} onClick={() => insert(" → ")} aria-label={`${shortDate(date)} 이동 화살표 넣기`}><ArrowRight size={15} /></button>
        <button type="button" disabled={disabled} onPointerDown={event => event.preventDefault()} onClick={() => insert(" · ")} aria-label={`${shortDate(date)} 구분점 넣기`}>·</button>
        <button type="button" disabled={disabled} onPointerDown={event => event.preventDefault()} onClick={() => insert("\n")} aria-label={`${shortDate(date)} 줄바꿈 넣기`}>줄바꿈</button>
      </div>
    </div>
  </div>;
}

function ImportDialog({ workspace, days, draft, onClose, onImport }: { workspace: Workspace; days: string[]; draft: OverviewDraft; onClose: () => void; onImport: (items: OverviewCandidate[], mode: "append" | "replace", separator: OverviewSeparator) => void }) {
  const [times, setTimes] = useState(true), [hotels, setHotels] = useState(false);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [separator, setSeparator] = useState<OverviewSeparator>("\n");
  const [selected, setSelected] = useState(() => new Set(days.flatMap(date => overviewCandidates(workspace, date).filter(item => !item.hotel && !item.sourceIds.some(id => draft.days[date]?.sourceIds.includes(id))).map(item => item.id))));
  const [error, setError] = useState("");
  const confirm = useConfirm();
  const candidates = days.flatMap(date => overviewCandidates(workspace, date, times));
  const visible = candidates.filter(item => hotels || !item.hotel);
  const chosen = visible.filter(item => selected.has(item.id));
  async function apply() {
    if (mode === "replace" && chosen.some(item => draft.days[item.date]?.text.trim()) && !await confirm("선택한 날짜의 표 내용을 선택한 일정으로 바꿀까요? 직접 적은 내용도 교체되며, 실행 취소로 복원할 수 있어요.", { title: "표 내용 바꾸기", confirmLabel: "바꾸기", intent: "default" })) return;
    try { onImport(chosen, mode, separator); } catch (cause) { setError((cause as Error).message); }
  }
  return <Dialog title={days.length === 1 ? `${shortDate(days[0])} 일정 불러오기` : "기존 일정 불러오기"} wide onClose={onClose}>
    <div className={styles.importContent}>
      <p className={styles.help}>표에 넣을 일정을 선택해 주세요. 원본의 시간과 이름을 복사하고, 이후에는 자유롭게 고칠 수 있어요.</p>
      <div className={styles.importOptions}>
        <label><input type="checkbox" checked={times} onChange={event => setTimes(event.target.checked)} />시간 포함</label>
        <label><input type="checkbox" checked={hotels} onChange={event => { setHotels(event.target.checked); if (event.target.checked) setSelected(current => new Set([...current, ...candidates.filter(item => item.hotel).map(item => item.id)])); }} />숙소 포함</label>
        <label>연결 방식<select value={separator} onChange={event => setSeparator(event.target.value as typeof separator)}><option value={"\n"}>일정마다 줄바꿈</option><option value=" · ">구분점으로 연결</option></select></label>
        <label>넣을 위치<select value={mode} onChange={event => { const next = event.target.value as typeof mode; setMode(next); if (next === "replace") setSelected(new Set(visible.map(item => item.id))); }}><option value="append">기존 내용 아래에 추가</option><option value="replace">해당 날짜 내용 바꾸기</option></select></label>
      </div>
      <div className={styles.selectionBar}><span>{chosen.length}개 선택</span><div><button type="button" onClick={() => setSelected(new Set(visible.map(item => item.id)))}>전체 선택</button><button type="button" onClick={() => setSelected(new Set())}>선택 해제</button></div></div>
      <div className={styles.candidates}>
        {!visible.length && <p className={styles.empty}>불러올 일정이 없어요. 표에 직접 입력하거나 숙소 포함을 선택해 주세요.</p>}
        {days.map(date => { const items = visible.filter(item => item.date === date); return !!items.length && <fieldset key={date}><legend>{shortDate(date)}</legend>{items.map(item => <label className={styles.candidate} key={item.id}><input type="checkbox" checked={selected.has(item.id)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /><span>{item.text}{item.sourceIds.some(id => draft.days[date]?.sourceIds.includes(id)) && <small>이전에 불러온 항목</small>}</span></label>)}</fieldset>; })}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className={styles.dialogActions}><button type="button" className="secondary" onClick={onClose}>취소</button><button type="button" className="primary" disabled={!chosen.length} onClick={() => void apply()}><FolderInput size={17} />{chosen.length}개 불러오기</button></div>
    </div>
  </Dialog>;
}

type PreviewImage = { blob: Blob; url: string; width: number; height: number };
function ExportDialog({ title, rows, onClose }: { title: string; rows: OverviewImageRow[]; onClose: () => void }) {
  const [start, setStart] = useState(rows[0].date), [end, setEnd] = useState(rows[rows.length - 1].date);
  const [images, setImages] = useState<PreviewImage[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => () => images.forEach(image => URL.revokeObjectURL(image.url)), [images]);
  const filename = `${title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 80)}_한눈에보기_${start}_${end}`;
  async function generate() {
    setBusy(true); setError("");
    try {
      const result = await renderOverviewImages(title, rows.filter(row => row.date >= start && row.date <= end));
      if (active.current) setImages(result.map(image => ({ ...image, url: URL.createObjectURL(image.blob) })));
    } catch (cause) { if (active.current) setError((cause as Error).message); }
    finally { if (active.current) setBusy(false); }
  }
  async function download(index?: number) {
    setBusy(true); setError("");
    try {
      if (index !== undefined || images.length === 1) { const i = index ?? 0; await saveDownload(images[i].blob, `${filename}${images.length > 1 ? `_${i + 1}` : ""}.png`); }
      else {
        const { zipSync } = await import("fflate");
        const entries = await Promise.all(images.map(async (image, i) => [`${filename}_${i + 1}.png`, new Uint8Array(await image.blob.arrayBuffer())] as const));
        const zip = zipSync(Object.fromEntries(entries), { level: 0 });
        await saveDownload(new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }), `${filename}.zip`);
      }
    } catch (cause) { if (active.current) setError((cause as Error).message); }
    finally { if (active.current) setBusy(false); }
  }
  return <Dialog title="한눈에 보기 이미지 저장" wide onClose={onClose}>
    <div className={styles.exportContent}>
      <p className={styles.help}>선택한 기간을 흰 배경의 PNG로 만들어요. 긴 일정은 글자가 잘리지 않도록 여러 장으로 나눠요.</p>
      <div className={styles.range}>
        <label>시작 날짜<select disabled={busy} value={start} onChange={event => { setStart(event.target.value); if (event.target.value > end) setEnd(event.target.value); setImages([]); }}>{rows.map(row => <option key={row.date} value={row.date}>{shortDate(row.date)}</option>)}</select></label>
        <label>마지막 날짜<select disabled={busy} value={end} onChange={event => { setEnd(event.target.value); if (event.target.value < start) setStart(event.target.value); setImages([]); }}>{rows.map(row => <option key={row.date} value={row.date}>{shortDate(row.date)}</option>)}</select></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!!images.length && <div className={styles.imagePreviews}>{images.map((image, index) => <figure key={image.url}>
        {/* Object URLs are generated locally from the user's draft. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} width={image.width} height={image.height} alt={`한눈에 보기 이미지 ${index + 1} / ${images.length}`} />
        <figcaption>{index + 1} / {images.length}{images.length > 1 && <button type="button" disabled={busy} onClick={() => void download(index)}><ArrowDownToLine size={14} />이 장 저장</button>}</figcaption>
      </figure>)}</div>}
      <div className={styles.dialogActions}><button type="button" className="secondary" onClick={onClose}>닫기</button>{images.length ? <button type="button" className="primary" disabled={busy} onClick={() => void download()}><ArrowDownToLine size={17} />{busy ? "저장 중…" : images.length === 1 ? "PNG 저장" : `이미지 ${images.length}장 ZIP 저장`}</button> : <button type="button" className="primary" disabled={busy} onClick={() => void generate()}><FileImage size={17} />{busy ? "이미지 만드는 중…" : "이미지 미리보기"}</button>}</div>
    </div>
  </Dialog>;
}
