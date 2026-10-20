"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDownToLine, Check, FileImage, FolderInput, Pencil, Trash2 } from "lucide-react";
import type { Workspace, OverviewRow, OverviewChange } from "../types";
import { shortDate } from "../calendar";
import { emptyOverview, importOverview, overviewCandidates, overviewStorageKey, overviewTextLimit, parseOverview, overviewFromRows, overviewChanges, type OverviewCandidate, type OverviewDraft, type OverviewSeparator } from "../itinerary-overview";
import { renderOverviewImages, type OverviewImageRow } from "../overview-image";
import { saveDownload } from "../download";
import { useConfirm } from "./Confirmation";
import Dialog from "./Dialog";
import styles from "./TripOverview.module.css";

type Props = { workspace: Workspace; days: string[]; accountId: string; disabled?: boolean; onSave: (rows: OverviewChange[]) => Promise<void>; preview?: boolean };
type ImportRequest = { dates: string[]; draft: OverviewDraft; rows: OverviewRow[] };
const subscribe = () => () => {};
const failureText = (cause: unknown) => cause instanceof Error ? cause.message : "저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.";

export default function TripOverview(props: Props) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return mounted ? <OverviewEditor key={overviewStorageKey(props.accountId, props.workspace.trip.id)} {...props} /> : <p className={styles.loading}>한눈에 보기를 준비하고 있어요…</p>;
}

function readLegacy(key: string) {
  try { return parseOverview(localStorage.getItem(key)); } catch { return emptyOverview(); }
}

function OverviewEditor({ workspace, days, accountId, disabled = false, onSave, preview = false }: Props) {
  const key = overviewStorageKey(accountId, workspace.trip.id);
  const [legacy, setLegacy] = useState(() => readLegacy(key));
  const [editing, setEditing] = useState<{date: string; initial?: OverviewRow} | null>(null);
  const [importRequest, setImportRequest] = useState<ImportRequest | null>(null), [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const confirm = useConfirm();
  const rows = workspace.overview ?? [];
  const dates = [...new Set([...days, ...rows.map(row => row.date)])].sort();
  const draft = overviewFromRows(rows);
  const filled = dates.filter(date => draft.days[date]?.text.trim()).length;
  const ready = workspace.overview !== undefined;
  const locked = disabled || saving || !ready;
  const hasLegacy = Object.values(legacy.days).some(day => day.text.trim());

  async function saveRows(changes: OverviewChange[]) {
    if (!changes.length) return;
    setSaving(true); setError("");
    try { await onSave(changes); } finally { setSaving(false); }
  }
  async function emptyTable() {
    if (!await confirm("동행과 공유하는 요약표 내용을 모두 비울까요? 원본 일정·예약은 그대로 유지됩니다.", { title: "요약표 비우기", confirmLabel: "비우기" })) return;
    try { await saveRows(rows.filter(row => row.text || row.sourceIds.length).map(row => ({date:row.date,text:"",sourceIds:[],version:row.version}))); }
    catch (cause) { setError(failureText(cause)); }
  }
  async function uploadLegacy() {
    if (Object.entries(legacy.days).some(([date,day])=>day.text.trim()&&!dates.includes(date))) {
      setError("이 기기의 표에 현재 여행 기간 밖의 날짜가 있어요. 여행 기간을 확인해 주세요. 기기에 저장된 표는 유지했어요.");
      return;
    }
    if (!await confirm("이 브라우저에 저장했던 표를 동행과 공유할까요? 이미 공유 중인 날짜에는 기존 내용 아래에 추가됩니다.", {title:"이 기기의 표 올리기",confirmLabel:"공유하기",intent:"default"})) return;
    const next = {schema:1 as const, days:{...draft.days}};
    for (const [date, day] of Object.entries(legacy.days)) {
      if (!dates.includes(date) || !day.text.trim()) continue;
      const saved = draft.days[date];
      next.days[date] = {text:saved?.text === day.text ? day.text : [saved?.text,day.text].filter(Boolean).join("\n"),sourceIds:[...new Set([...(saved?.sourceIds??[]),...day.sourceIds])]};
    }
    try { await saveRows(overviewChanges(draft,next,rows)); setLegacy(emptyOverview()); try { localStorage.removeItem(key); } catch {} }
    catch (cause) { setError(failureText(cause)); }
  }
  return <section className={styles.overview} aria-label="일정 한눈에 보기">
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>YOUR TRIP, AT A GLANCE</p><h2>여행을 한눈에</h2><p>하루의 흐름을 자유롭게 적고, 나만의 여행표로 저장해 보세요.</p></div>
      <span className={styles.localBadge}><Check size={14}/>{preview ? "예시 여행" : "동행과 공유"}</span>
    </div>
    <div className={styles.toolbar}><div className={styles.actions}>
      <button type="button" className="secondary" disabled={locked} onClick={()=>setImportRequest({dates,draft,rows})}><FolderInput size={17}/>기존 일정 불러오기</button>
      <button type="button" className="primary" disabled={!ready || !dates.length} onClick={()=>setExporting(true)}><FileImage size={17}/>이미지 저장</button>
    </div><button type="button" className={styles.clear} disabled={locked || !filled} onClick={()=>void emptyTable()}><Trash2 size={15}/><span>표 비우기</span></button></div>
    <p className={styles.help}>{preview ? "예시 데이터로 편집과 충돌 처리를 확인할 수 있어요." : "저장한 내용은 여행 멤버에게 공유돼요."} 표를 고쳐도 원본 일정·예약은 바뀌지 않아요.</p>
    {hasLegacy && <div className={styles.legacy}><span>이 브라우저에 저장했던 요약표가 있어요.</span><button type="button" className="secondary" disabled={locked} onClick={()=>void uploadLegacy()}>이 기기의 표 올리기</button></div>}
    {!ready && <p className="error" role="alert">요약표 저장소를 확인하지 못했어요. 새로고침해 주세요.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className={styles.tableWrap}><table className={styles.table}>
      <caption className={styles.caption}>{workspace.trip.title} · {dates.length}일 중 {filled}일 작성</caption>
      <thead><tr><th scope="col">날짜</th><th scope="col">일정<span>{disabled ? "열람 권한" : "날짜 칸을 눌러 편집"}</span></th></tr></thead>
      <tbody>{dates.map((date,index)=><tr key={date}><th scope="row"><small>DAY {index+1}</small><strong>{shortDate(date)}</strong></th><td>
        <button type="button" className={styles.cellPreview} disabled={locked} aria-label={`${shortDate(date)} 요약 일정 편집`} onClick={()=>setEditing({date,initial:rows.find(row=>row.date===date)})}>
          <span className={draft.days[date]?.text ? undefined : styles.placeholder}>{draft.days[date]?.text || "일정 입력"}</span><Pencil size={13} aria-hidden="true"/>
        </button>
      </td></tr>)}</tbody>
    </table></div>
    <p className={styles.footnote}>시간은 각 장소의 현지 시각이에요. 원본 일정의 최신 내용을 반영하려면 다시 불러와 주세요.</p>
    {editing && <CellEditor key={editing.date} workspace={workspace} date={editing.date} initial={editing.initial} latest={rows.find(row=>row.date===editing.date)} disabled={disabled} onSave={async row=>{await saveRows([row]);setEditing(null);}} onClose={()=>setEditing(null)}/>}
    {importRequest && <ImportDialog workspace={workspace} days={importRequest.dates} draft={importRequest.draft} onClose={()=>setImportRequest(null)} onImport={async(items,mode,separator)=>{const next=importOverview(importRequest.draft,items,mode,separator);await saveRows(overviewChanges(importRequest.draft,next,importRequest.rows));setImportRequest(null);}}/>}
    {exporting && <ExportDialog title={workspace.trip.title} rows={dates.map(date=>({date,text:draft.days[date]?.text??""}))} onClose={()=>setExporting(false)}/>}
  </section>;
}

function CellEditor({workspace,date,initial,latest,disabled,onSave,onClose}:{workspace:Workspace;date:string;initial?:OverviewRow;latest?:OverviewRow;disabled:boolean;onSave:(row:OverviewChange)=>Promise<void>;onClose:()=>void}) {
  const [base,setBase]=useState({text:initial?.text??"",sourceIds:initial?.sourceIds??[],version:initial?.version??0});
  const [value,setValue]=useState(base.text),[sourceIds,setSourceIds]=useState(base.sourceIds);
  const [saving,setSaving]=useState(false),[importing,setImporting]=useState(false),[error,setError]=useState("");
  const confirm=useConfirm();
  const input=useRef<HTMLTextAreaElement|null>(null);
  const focus=useCallback((node:HTMLTextAreaElement|null)=>{input.current=node;if(node)requestAnimationFrame(()=>{if(node.isConnected){node.focus();node.setSelectionRange(node.value.length,node.value.length);}});},[]);
  const dirty=value!==base.text||JSON.stringify(sourceIds)!==JSON.stringify(base.sourceIds);
  const conflict=!saving&&(latest?.version??0)!==base.version&&((latest?.text??"")!==value||JSON.stringify(latest?.sourceIds??[])!==JSON.stringify(sourceIds));
  async function close(){if(saving)return;if(dirty&&!await confirm("입력한 내용을 저장하지 않고 닫을까요?",{title:"편집 중인 내용",confirmLabel:"저장하지 않고 닫기"}))return;onClose();}
  function merge(){const remote={text:latest?.text??"",sourceIds:latest?.sourceIds??[],version:latest?.version??0};setValue(dirty&&remote.text!==value?[remote.text,value].filter(Boolean).join("\n"):remote.text);setSourceIds([...new Set([...remote.sourceIds,...sourceIds])]);setBase(remote);setError("");}
  async function save(){if(disabled||saving||conflict)return;setSaving(true);setError("");try{await onSave({date,text:value,sourceIds,version:base.version});}catch(cause){setError(failureText(cause));}finally{setSaving(false);}}
  const localDraft:OverviewDraft={schema:1,days:{[date]:{text:value,sourceIds}}};
  return <Dialog title={`${shortDate(date)} 요약 편집`} mobilePage onClose={()=>void close()}>
    <form className={`${styles.cellEditorForm} overview-cell-editor`} onSubmit={event=>{event.preventDefault();void save();}} onKeyDown={event=>{if(event.key==="Enter"&&(event.metaKey||event.ctrlKey)){event.preventDefault();event.currentTarget.requestSubmit();}}}>
      <div className={styles.editorToolbar}><button type="button" className="secondary" disabled={disabled||saving} onClick={()=>setImporting(true)}><FolderInput size={15}/>일정 불러오기</button><small className={styles.editorHelp}>일정마다 줄을 바꿔 적어 주세요.</small></div>
      {conflict&&<div className={styles.conflict} role="alert"><p>동행이 이 날짜를 수정했어요. 내 입력은 유지했어요.</p><details><summary>최신 내용 확인</summary><pre>{latest?.text||"(비어 있음)"}</pre></details><button type="button" className="secondary" onClick={merge}>최신 내용 합쳐서 편집</button></div>}
      {error&&<p className="error" role="alert">{error}</p>}
      <textarea ref={focus} className={styles.editorInput} aria-label={`${shortDate(date)} 요약 일정`} value={value} maxLength={overviewTextLimit} disabled={disabled||saving} onChange={event=>setValue(event.target.value)} placeholder="일정을 직접 적거나 불러와 주세요."/>
      <footer className={styles.editorFooter}><small>{value.length.toLocaleString("ko-KR")} / {overviewTextLimit.toLocaleString("ko-KR")}</small><div><button type="button" className="secondary" disabled={saving} onClick={()=>void close()}>취소</button><button type="submit" className="primary" disabled={disabled||saving||conflict||value.length>overviewTextLimit}>{saving?"저장 중…":"저장"}</button></div></footer>
    </form>
    {importing&&<ImportDialog workspace={workspace} days={[date]} draft={localDraft} onClose={()=>setImporting(false)} onImport={(items,mode,separator)=>{const next=importOverview(localDraft,items,mode,separator).days[date];if(next){setValue(next.text);setSourceIds(next.sourceIds);}setImporting(false);requestAnimationFrame(()=>input.current?.focus());}}/>}
  </Dialog>;
}

function ImportDialog({ workspace, days, draft, onClose, onImport }: { workspace: Workspace; days: string[]; draft: OverviewDraft; onClose: () => void; onImport: (items: OverviewCandidate[], mode: "append" | "replace", separator: OverviewSeparator) => void | Promise<void> }) {
  const [times, setTimes] = useState(true), [hotels, setHotels] = useState(false);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [separator, setSeparator] = useState<OverviewSeparator>("\n");
  const [selected, setSelected] = useState(() => new Set(days.flatMap(date => overviewCandidates(workspace, date).filter(item => !item.hotel && !item.sourceIds.some(id => draft.days[date]?.sourceIds.includes(id))).map(item => item.id))));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const candidates = days.flatMap(date => overviewCandidates(workspace, date, times));
  const visible = candidates.filter(item => hotels || !item.hotel);
  const chosen = visible.filter(item => selected.has(item.id));
  async function apply() {
    if (mode === "replace" && chosen.some(item => draft.days[item.date]?.text.trim()) && !await confirm("선택한 날짜의 표 내용을 선택한 일정으로 바꿀까요? 직접 적은 내용도 교체됩니다.", { title: "표 내용 바꾸기", confirmLabel: "바꾸기", intent: "default" })) return;
    setBusy(true);
    try { await onImport(chosen, mode, separator); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
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
      <div className={styles.dialogActions}><button type="button" className="secondary" onClick={onClose}>취소</button><button type="button" className="primary" disabled={busy || !chosen.length} onClick={() => void apply()}><FolderInput size={17} />{busy ? "저장 중…" : `${chosen.length}개 불러오기`}</button></div>
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
