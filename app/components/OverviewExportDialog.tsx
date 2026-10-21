"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, FileImage, Share2 } from "lucide-react";
import { shortDate } from "../calendar";
import { renderOverviewImages, type OverviewImageRow } from "../overview-image";
import { saveDownload } from "../download";
import { canShareImages, isExportCancelled, saveImagesToPhotos, shareImages } from "../image-export";
import { isNativeApp } from "../runtime";
import Dialog from "./Dialog";
import styles from "./TripOverview.module.css";

type PreviewImage = { blob: Blob; url: string; width: number; height: number };
export default function OverviewExportDialog({ title, rows, onClose }: { title: string; rows: OverviewImageRow[]; onClose: () => void }) {
  const [start, setStart] = useState(rows[0].date), [end, setEnd] = useState(rows[rows.length - 1].date);
  const [images, setImages] = useState<PreviewImage[]>([]);
  const [action, setAction] = useState<"generate" | "save" | "share" | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const active = useRef(true), native = isNativeApp(), busy = action !== null;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => () => images.forEach(image => URL.revokeObjectURL(image.url)), [images]);
  const filename = `${title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 80)}_한눈에보기_${start}_${end}`;
  const files = images.map((image, i) => ({ blob: image.blob, name: `${filename}${images.length > 1 ? `_${i + 1}` : ""}.png` }));
  function reset() { setImages([]); setNotice(""); setError(""); }
  async function generate() {
    setAction("generate"); setError(""); setNotice(""); setProgress("");
    try {
      const result = await renderOverviewImages(title, rows.filter(row => row.date >= start && row.date <= end), (done, total) => {
        if (active.current) setProgress(`${Math.min(done + 1, total)} / ${total}`);
      });
      if (active.current) setImages(result.map(image => ({ ...image, url: URL.createObjectURL(image.blob) })));
    } catch (cause) { if (active.current) setError((cause as Error).message); }
    finally { if (active.current) setAction(null); }
  }
  async function download(index?: number) {
    setAction("save"); setError(""); setNotice("");
    try {
      if (native) {
        const chosen = index === undefined ? files : [files[index]];
        await saveImagesToPhotos(chosen);
        if (active.current) setNotice(`이미지 ${chosen.length}장을 사진에 저장했어요.`);
      } else if (index !== undefined || images.length === 1) {
        const file = files[index ?? 0]; await saveDownload(file.blob, file.name);
      } else {
        const { zipSync } = await import("fflate");
        const entries = await Promise.all(files.map(async file => [file.name, new Uint8Array(await file.blob.arrayBuffer())] as const));
        const zip = zipSync(Object.fromEntries(entries), { level: 0 });
        await saveDownload(new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }), `${filename}.zip`);
      }
    } catch (cause) { if (active.current) setError((cause as Error).message); }
    finally { if (active.current) setAction(null); }
  }
  async function share() {
    setAction("share"); setError(""); setNotice("");
    try { await shareImages(files, title); }
    catch (cause) { if (active.current && !isExportCancelled(cause)) setError("이미지를 공유하지 못했어요. 다시 시도해 주세요."); }
    finally { if (active.current) setAction(null); }
  }
  return <Dialog title="한눈에 보기 이미지 저장" wide onClose={() => { if (!busy) onClose(); }}>
    <div className={styles.exportContent}>
      <div className={styles.range}>
        <label>시작 날짜<select disabled={busy} value={start} onChange={event => { setStart(event.target.value); if (event.target.value > end) setEnd(event.target.value); reset(); }}>{rows.map(row => <option key={row.date} value={row.date}>{shortDate(row.date)}</option>)}</select></label>
        <label>마지막 날짜<select disabled={busy} value={end} onChange={event => { setEnd(event.target.value); if (event.target.value < start) setStart(event.target.value); reset(); }}>{rows.map(row => <option key={row.date} value={row.date}>{shortDate(row.date)}</option>)}</select></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {!!images.length && <div className={styles.imagePreviews}>{images.map((image, index) => <figure key={image.url}>
        {/* These object URLs are generated locally from the user's draft. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} width={image.width} height={image.height} alt={`한눈에 보기 이미지 ${index + 1} / ${images.length}`} />
        <figcaption>{index + 1} / {images.length}{images.length > 1 && <button type="button" disabled={busy} onClick={() => void download(index)}><ArrowDownToLine size={14} />이 장 저장</button>}</figcaption>
      </figure>)}</div>}
      <div className={styles.dialogActions}>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>닫기</button>
        {images.length ? <>
          {canShareImages(files) && <button type="button" className="secondary" disabled={busy} onClick={() => void share()}><Share2 size={17} />{action === "share" ? "공유 준비 중…" : "공유"}</button>}
          <button type="button" className="primary" disabled={busy} onClick={() => void download()}><ArrowDownToLine size={17} />{action === "save" ? "저장 중…" : native ? images.length === 1 ? "기기에 저장" : `${images.length}장 기기에 저장` : images.length === 1 ? "PNG 저장" : `이미지 ${images.length}장 ZIP 저장`}</button>
        </> : <button type="button" className="primary" disabled={busy} onClick={() => void generate()}><FileImage size={17} />{busy ? `이미지 만드는 중… ${progress}` : "이미지 미리보기"}</button>}
      </div>
    </div>
  </Dialog>;
}
