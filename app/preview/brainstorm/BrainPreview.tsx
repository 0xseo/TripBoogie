"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import Brainstorming from "../../components/Brainstorming";
import { ConfirmationProvider } from "../../components/Confirmation";
import KeyboardFocus from "../../components/KeyboardFocus";
import { overviewPreviewWorkspace } from "../overview/fixture";
import { previewBrainService } from "./preview-service";
import styles from "../overview/preview.module.css";
export default function BrainPreview() {
  const service = useMemo(() => previewBrainService(), []), [viewer, setViewer] = useState(false);
  return <ConfirmationProvider><KeyboardFocus/><main className={styles.preview}><header className={styles.header}><Link href="/">트립부기<span>TripBoogie</span></Link><span>브레인스토밍 미리보기</span></header><div className={styles.banner}>예시 데이터입니다. 같은 브라우저의 두 탭에서 공동 편집·충돌·복원을 확인할 수 있습니다. 실제 서버에는 전송되지 않습니다.</div><div className={styles.content}><label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, marginBottom: 24 }}><input type="checkbox" checked={viewer} onChange={e => setViewer(e.target.checked)}/>열람자 화면으로 보기</label><Brainstorming workspace={overviewPreviewWorkspace} accountId="preview" disabled={viewer} service={service}/></div></main></ConfirmationProvider>;
}
