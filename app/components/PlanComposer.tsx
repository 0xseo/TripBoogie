"use client";
import Form from "./Form";
import TimeField from "./TimeField";
import ChoiceField from "./ChoiceField";
import { memoText } from "../memo";
import { useState, useRef } from "react";
import { MapPin, StickyNote, CalendarDays, X, Hotel } from "lucide-react";
import {bookingTitle,compareBookings} from "../booking-display";
import type { Workspace, ItemRecord } from "../types";
import type { MapPlace } from "../server/maps";
import { previousPlanPlace, itineraryDays } from "../planning";
import { PlaceMedia } from "./Media";
import { travelContext } from "../travel-context";
import PlacePicker from "./PlacePicker";
import { Dialog, Field, text, dateLabel } from "./ui";

export default function PlanComposer({
  workspace,
  date,
  record,
  onSave,
  onClose,
  onNotice,
  onHotel,
  initialBookingId,
}: {
  initialBookingId?:string;
  workspace: Workspace;
  date: string;
  record?: ItemRecord;
  onSave: (data: Record<string, unknown>, place?: MapPlace) => Promise<void>;
  onClose: () => void;
  onNotice: (message:string)=>void;
  onHotel: (booking:ItemRecord,date:string)=>Promise<void>;
}) {
  const initialBooking=workspace.records.find(b=>b.kind==="booking"&&b.id===(record?.data.bookingId||initialBookingId));
  const announced=useRef(new Set<string>());
  function announce(key:string,message:string){if(!announced.current.has(key)){announced.current.add(key);onNotice(message);}}
  const original = workspace.records.find((p) => p.id === record?.data.placeId),
    [kind, setKind] = useState(text(record?.data.entryType, "plan")),
    [title, setTitle] = useState(text(record?.data.title,initialBooking?bookingTitle(initialBooking.data):"")),
    [note, setNote] = useState(record?.data.entryType==="memo"?memoText(record.data):text(initialBooking?.data.note, text(record?.data.note))),
    [day, setDay] = useState(text(record?.data.date,text(initialBooking?.data.startDate,date))),
    [time, setTime] = useState(text(record?.data.time,text(initialBooking?.data.startTime))),
    [duration, setDuration] = useState(String(record?.data.duration || "")),
    [place, setPlace] = useState<MapPlace | undefined>(undefined),
    [placeId, setPlaceId] = useState(original?.id ?? ""),
    [bookingId,setBookingId]=useState(text(record?.data.bookingId,initialBookingId)),
    [showHotels,setShowHotels]=useState(false),
    [picker, setPicker] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const placeName =
    place?.name || String(original?.id === placeId ? original.data.name : "");
  const context = travelContext(workspace.trip, { date: day });
  const location = context.location;
  const bookings=workspace.records.filter(r=>r.kind==="booking").sort(compareBookings);
  const hotels=bookings.filter(r=>r.data.type==="hotel"&&text(r.data.startDate)<=day&&text(r.data.endDate)>=day);
  async function addHotel(booking:ItemRecord){setBusy(true);try{await onHotel(booking,day);onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return (
    <Dialog
      mobilePage
      onBack={picker?()=>setPicker(false):undefined}
      hideTitle={picker}
      title={
        picker ? "일정에 장소 연결" : kind === "memo" ? (record ? "메모 수정" : "메모 추가") : record ? "일정 수정" : "일정 추가"
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
        <Form
          className={`stack plan-composer ${kind === "memo" ? "memo-composer" : ""}`}
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
                  bookingId:kind==="memo"?"":bookingId,
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
            <ChoiceField label="일정 날짜" value={day} options={Array.from(new Set([...itineraryDays(workspace.trip,workspace.records),day])).sort().map((id,i)=>({id,label:`DAY ${i+1} · ${dateLabel(id)}`}))} onChange={value=>{setDay(value);if(bookingId)announce("date","날짜를 바꾸면 연결된 예약 날짜도 함께 변경돼요.");}}/>
          </Field>
          {kind === "plan" && (
            <div className="plan-place-actions"><div className="place-input">
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
            </div>{!record&&<button type="button" className="stay-shortcut" disabled={busy} onClick={()=>{if(!hotels.length){onNotice("이날은 예약된 숙소가 없어요.");return;}if(hotels.length===1){void addHotel(hotels[0]);return;}setShowHotels(!showHotels);}}><Hotel size={18}/>숙소</button>}</div>
          )}
          {kind==="plan"&&showHotels&&<div className="hotel-shortcut-options">{hotels.map(hotel=><button type="button" key={hotel.id} disabled={busy} onClick={()=>void addHotel(hotel)}><Hotel size={17}/>{bookingTitle(hotel.data)}</button>)}</div>}
          {kind === "plan" && original?.id === placeId && <PlaceMedia place={original.data} compact />}
          {kind==="plan"&&<Field label="예약 연결 · 선택 사항"><ChoiceField label="연결할 예약" value={bookingId} options={[{id:"",label:"연결 안 함"},...bookings.map(booking=>({id:booking.id,label:`${bookingTitle(booking.data)} · ${dateLabel(text(booking.data.startDate))}`}))]} onChange={id=>{setBookingId(id);announced.current.clear();const booking=bookings.find(b=>b.id===id);if(booking){if(!title)setTitle(bookingTitle(booking.data));setDay(text(booking.data.startDate));setTime(text(booking.data.startTime));setNote(text(booking.data.note));}}}/></Field>}
          {kind === "plan" && <><Field label="일정 이름"><input required maxLength={300} placeholder="일정 이름" value={title} onChange={e=>setTitle(e.target.value)}/></Field><div className="optional-time"><TimeField value={time} onChange={value=>{setTime(value);if(bookingId)announce("time","일정 시간만 변경돼요. 예약 시간은 유지됩니다.");}}/><Field label="머무를 시간 · 분"><input aria-label="머무를 시간 · 분" type="number" min={0} max={1440} value={duration} onChange={e=>setDuration(e.target.value)} placeholder="분"/></Field></div></>}
          <div className={kind === "memo" ? "memo-editor-field" : ""}><Field label="메모">
            <textarea
              required={kind === "memo"}
              maxLength={10000}
              rows={3}
              placeholder="메모 입력"
              value={note}
              onChange={(e) => {setNote(e.target.value);if(bookingId)announce("note","메모를 바꾸면 연결된 예약 메모도 함께 변경돼요.");}}
            />
          </Field></div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "저장 중…" : "저장하기"}
          </button>
        </Form>
      )}
    </Dialog>
  );
}
