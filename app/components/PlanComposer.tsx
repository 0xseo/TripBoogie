"use client";
import TimeField from "./TimeField";
import ChoiceField from "./ChoiceField";
import { memoText } from "../memo";
import { useState } from "react";
import { MapPin, StickyNote, CalendarDays, X } from "lucide-react";
import type { Workspace, ItemRecord } from "../types";
import type { MapPlace } from "../server/maps";
import { previousPlanPlace } from "../planning";
import { PlaceMedia } from "./Media";
import { travelContext } from "../travel-context";
import PlacePicker from "./PlacePicker";
import { Dialog, Field, text, days, dateLabel } from "./ui";

export default function PlanComposer({
  workspace,
  date,
  record,
  onSave,
  onClose,
}: {
  workspace: Workspace;
  date: string;
  record?: ItemRecord;
  onSave: (data: Record<string, unknown>, place?: MapPlace) => Promise<void>;
  onClose: () => void;
}) {
  const original = workspace.records.find((p) => p.id === record?.data.placeId),
    [kind, setKind] = useState(text(record?.data.entryType, "plan")),
    [title, setTitle] = useState(text(record?.data.title)),
    [note, setNote] = useState(record?.data.entryType==="memo"?memoText(record.data):text(record?.data.note)),
    [day, setDay] = useState(text(record?.data.date, date)),
    [time, setTime] = useState(text(record?.data.time)),
    [duration, setDuration] = useState(String(record?.data.duration || "")),
    [place, setPlace] = useState<MapPlace | undefined>(undefined),
    [placeId, setPlaceId] = useState(original?.id ?? ""),
    [picker, setPicker] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const placeName =
    place?.name || String(original?.id === placeId ? original.data.name : "");
  const context = travelContext(workspace.trip, { date: day });
  const location = context.location;
  return (
    <Dialog
      mobilePage
      onBack={picker?()=>setPicker(false):undefined}
      hideTitle={picker}
      title={
        picker ? "일정에 장소 연결" : record ? "일정 수정" : "일정 추가"
      }
      onClose={onClose}
      wide
    >
      {picker ? (
        <PlacePicker
          initial={place}
          previous={previousPlanPlace(workspace.records,day,record?.id)}
          countryCode={context.city?.countryCode}
          bias={location ? { lat: location.lat, lng: location.lng } : undefined}
          onChoose={(p) => {
            if (!title || title === placeName) setTitle(p.name);
            setPlace(p);
            setPlaceId("");
            setPicker(false);
          }}
        />
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await onSave(
                {
                  ...record?.data,
                  entryType: kind,
                  title: kind==="memo"?note.trim().slice(0,300):title.trim(),
                  date: day,
                  time: kind === "memo" ? "" : time,
                  note,
                  placeId: kind === "memo" ? "" : placeId,
                  duration: kind === "memo" ? 0 : Number(duration) || 0,
                  ...(record?.data.date === day ? {} : { position: undefined }),
                },
                kind === "plan" ? place : undefined,
              );
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!record && (
            <div className="segmented">
              <button
                type="button"
                className={kind === "plan" ? "active" : ""}
                onClick={() => setKind("plan")}
              >
                <CalendarDays size={19} />
                일정
              </button>
              <button
                type="button"
                className={kind === "memo" ? "active" : ""}
                onClick={() => setKind("memo")}
              >
                <StickyNote size={19} />
                메모
              </button>
            </div>
          )}
          <Field label="날짜">
            <ChoiceField label="일정 날짜" value={day} options={days(workspace.trip.startDate,workspace.trip.endDate).map((id,i)=>({id,label:`DAY ${i+1} · ${dateLabel(id)}`}))} onChange={setDay}/>
          </Field>
          {kind === "plan" && (
            <div className="place-input">
              <button type="button" onClick={() => setPicker(true)}>
                <MapPin size={20} />
                <span>{placeName || "장소 검색 · 선택 사항"}</span>
              </button>
              {placeName && (
                <button
                  type="button"
                  className="icon"
                  aria-label="장소 연결 해제"
                  onClick={() => {
                    setPlace(undefined);
                    setPlaceId("");
                  }}
                >
                  <X size={18} />
                </button>
              )}
            </div>
          )}
          {kind === "plan" && original?.id === placeId && <PlaceMedia place={original.data} compact />}
          {kind === "plan" && <><Field label="일정 이름"><input required maxLength={300} placeholder="일정 이름" value={title} onChange={e=>setTitle(e.target.value)}/></Field><div className="optional-time"><TimeField value={time} onChange={setTime}/><details><summary>머무를 시간</summary><input aria-label="머무를 시간 · 분" type="number" min={0} max={1440} value={duration} onChange={e=>setDuration(e.target.value)} placeholder="분"/></details></div></>}
          <Field label="메모">
            <textarea
              required={kind === "memo"}
              maxLength={10000}
              rows={3}
              placeholder="메모 입력"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "저장 중…" : "저장하기"}
          </button>
        </form>
      )}
    </Dialog>
  );
}
