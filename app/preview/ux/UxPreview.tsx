"use client";
import { useRef, useState } from "react";
import { FileText, Hotel, Ticket, Trash2, Upload } from "lucide-react";
import TimeField from "../../components/TimeField";
import KeyboardFocus from "../../components/KeyboardFocus";
import styles from "./preview.module.css";

type PreviewFile = { id: string; name: string; size: number };
function PreviewFiles({ initialFiles = [] }: { initialFiles?: PreviewFile[] }) {
  const [files, setFiles] = useState(initialFiles);
  const input = useRef<HTMLInputElement>(null);
  return <div className="files booking-files">
    <div className="file-heading">
      <strong>첨부파일</strong>
      <button type="button" className="secondary" onClick={() => input.current?.click()}>
        <Upload size={17} /><span>파일 올리기</span>
      </button>
    </div>
    <input ref={input} type="file" hidden multiple onChange={event => {
      const selected = Array.from(event.target.files ?? []);
      setFiles(current => [...current, ...selected.map(file => ({ id: crypto.randomUUID(), name: file.name, size: file.size }))]);
      event.target.value = "";
    }} />
    <div className="file-list">
      {files.map(file => <article className="file-row" key={file.id}>
        <FileText size={22} />
        <div className="record-body">
          <strong className="file-name">{file.name}</strong>
          <small>{Math.round(file.size / 1024)} KB · 예시 자료</small>
        </div>
        <button type="button" className="icon" aria-label={`${file.name} 예시에서 제거`} onClick={() => setFiles(current => current.filter(item => item.id !== file.id))}>
          <Trash2 size={17} />
        </button>
      </article>)}
    </div>
  </div>;
}

export default function UxPreview() {
  const [start, setStart] = useState("09:30"), [end, setEnd] = useState("");
  return <><KeyboardFocus /><main className={styles.page}>
    <header className={styles.header}>
      <p>트립부기 · 로컬 미리보기</p>
      <h1>시간 입력을 직접 해보세요</h1>
      <p>시간 버튼을 누르고 9:30 또는 0930을 입력해 보세요. Enter로 적용하거나 휠을 드래그할 수 있어요.</p>
    </header>
    <section className={styles.timeCard} aria-label="시간 입력 예시">
      <div className={styles.timeFields}>
        <div className="optional-time"><label className="field"><span>시작 시간</span>
          <TimeField label="시작 시간" value={start} onChange={setStart} placeholder="시간 선택" />
        </label></div>
        <div className="optional-time"><label className="field"><span>종료 시간 · 선택</span>
          <TimeField label="종료 시간" value={end} onChange={setEnd} placeholder="시간 선택" />
        </label></div>
      </div>
      <div className={styles.result}>
        <div><span>적용된 시간</span><output aria-live="polite">{start || "미정"} → {end || "미정"}</output></div>
        <button type="button" className="text-button" onClick={() => { setStart("09:30"); setEnd(""); }}>초기화</button>
      </div>
    </section>
    <section className={styles.bookings} aria-label="예약 카드 예시">
      <h2>예약 카드 여백도 확인해 보세요</h2>
      <p>파일을 선택하거나 제거하면 첨부파일 유무에 따른 카드 높이를 비교할 수 있어요. 선택한 파일은 서버에 전송되지 않습니다.</p>
      <div className="booking-grid">
        <article className="booking-card">
          <span className="booking-type"><Hotel /></span>
          <h3>로토루아 숙소</h3>
          <p>11/26 (목) 15:00 → 11/28 (토) 10:00</p>
          <PreviewFiles />
        </article>
        <article className="booking-card">
          <span className="booking-type"><Ticket /></span>
          <h3>캐노피 투어</h3>
          <p>11/27 (금) 08:30 → 11/27 (금) 11:30</p>
          <PreviewFiles initialFiles={[{ id: "sample", name: "투어 예약 확인서.pdf", size: 32000 }]} />
        </article>
      </div>
    </section>
  </main></>;
}
