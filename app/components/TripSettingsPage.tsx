"use client";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Pencil,
  Users,
  Download,
  Upload,
} from "lucide-react";
import { dateLabel } from "./ui";
import type { Workspace } from "../types";
export default function TripSettingsPage({
  workspace,
  disabled,
  onEdit,
  onBackup,
  onImport,
  members,
}: {
  workspace: Workspace;
  disabled: boolean;
  onEdit: () => void;
  onBackup: () => void;
  onImport: () => void;
  members: ReactNode;
}) {
  const [section, setSection] = useState<"main" | "members" | "backup">("main");
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (section === "main") return;
    const back = (event: Event) => {
      event.preventDefault();
      setSection("main");
    };
    window.addEventListener("tripboogie:back", back);
    return () => window.removeEventListener("tripboogie:back", back);
  }, [section]);
  return (
    <section className="trip-settings-page">
      <div className="settings-page-heading">
        {section !== "main" && (
          <button
            type="button"
            className="back-link"
            aria-label="여행 설정으로 돌아가기"
            onClick={() => setSection("main")}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        {section !== "main" && (
          <h2>{section === "members" ? <>여행 동행<small>{workspace.members.length}명</small></> : "백업"}</h2>
        )}
        {section === "main" && (
          <button
            type="button"
            className="travel-details-row"
            disabled={disabled || workspace.trip.role === "viewer"}
            onClick={onEdit}
          >
            <span>
              <strong>{workspace.trip.title}</strong>
              <small>
                {workspace.trip.destination} ·{" "}
                {dateLabel(workspace.trip.startDate)} –{" "}
                {dateLabel(workspace.trip.endDate)}
              </small>
            </span>
            <Pencil size={15} />
            <small>수정</small>
          </button>
        )}
      </div>
      {section === "main" ? (
        <>
          <div className="settings-menu">
            <button type="button" onClick={() => setSection("members")}>
              <Users />
              <span>
                <strong>여행 동행</strong>
                <small>{workspace.members.length}명 · 참여 권한</small>
              </span>
              <ArrowRight size={18} />
            </button>
            <button type="button" onClick={() => setSection("backup")}>
              <Download />
              <span>
                <strong>백업</strong>
                <small>JSON 내보내기 · 가져오기</small>
              </span>
              <ArrowRight size={18} />
            </button>
          </div>
        </>
      ) : section === "members" ? (
        members
      ) : (
        <div className="settings-card backup-settings">
          <Download size={27} />
          <h3>이 여행 JSON 백업</h3>
          <p>첨부파일은 복원이 안돼북</p>
          <button
            type="button"
            className="primary"
            disabled={disabled}
            onClick={onBackup}
          >
            <Download size={18} />
            JSON 백업 받기
          </button>
          <hr />
          <Upload size={27} />
          <h3>백업에서 여행 가져오기</h3>
          <p>새로운 여행 노트로 가져와북</p>
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={onImport}
          >
            <Upload size={18} />
            JSON 가져오기
          </button>
        </div>
      )}
    </section>
  );
}
