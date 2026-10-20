"use client";
import { useState } from "react";
import Link from "next/link";
import TripPlan from "../../components/TripPlan";
import { ConfirmationProvider } from "../../components/Confirmation";
import { comparePlans } from "../../planning";
import { overviewPreviewDays, overviewPreviewDraft, overviewPreviewWorkspace as workspace } from "./fixture";
import styles from "./preview.module.css";

export default function OverviewPreview() {
  const [date, setDate] = useState("2026-11-27"), [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const explain = () => setNotice("예시 화면의 원본 일정은 고정돼 있어요. 한눈에 보기에서 불러오기·자유 입력·이미지 저장을 확인해 주세요.");
  return <ConfirmationProvider><main className={styles.preview}>
    <header className={styles.header}><Link href="/">트립부기<span>TripBoogie</span></Link><span>로컬 기능 미리보기</span></header>
    <div className={styles.banner}>로그인 없이 확인하는 예시 여행입니다. 표 편집은 이 브라우저에만 저장되며 실제 여행·DB에 전송되지 않습니다.</div>
    <div className={styles.content}>
      <p className={styles.period}>2026.11.24 — 12.07 · 14일</p><h1>{workspace.trip.title}</h1>
      {notice && <p className="info" role="status">{notice}<button type="button" onClick={() => setNotice("")}>닫기</button></p>}
      <TripPlan accountId="local-overview-preview" workspace={workspace} days={overviewPreviewDays} date={date} plans={workspace.records.filter(item => item.kind === "plan" && item.data.date === date).sort(comparePlans)} places={workspace.records.filter(item => item.kind === "place")} disabled={false} selected={selected} onSelected={setSelected} onDate={setDate} onSchedule={async () => { explain(); return undefined; }} onEdit={explain} onRemove={explain} onAdd={explain} onError={setNotice} onSave={async () => { explain(); }} onBooking={explain} initialView="overview" initialOverview={overviewPreviewDraft} />
    </div>
  </main></ConfirmationProvider>;
}
