"use client";
import { memoText } from "../memo";
import { useEffect, useRef, useState } from "react";
import {
  Maximize2,
  Plus,
  ChevronLeft,
  ChevronRight,
  MapPin,
  StickyNote,
  Ticket,
} from "lucide-react";
import type { ItemRecord, Workspace } from "../types";
import { travelContext } from "../travel-context";
import { dayGraph } from "../route-graph";
import MapPanel from "../MapPanel";
import ItineraryEditor from "../ItineraryEditor";
import { Dialog, text } from "./ui";
import WeekDays from "./WeekDays";
export default function TripPlan({
  workspace,
  date,
  days,
  plans,
  places,
  disabled,
  selected,
  onSelected,
  onDate,
  onSchedule,
  onEdit,
  onRemove,
  onAdd,
  onError,
  onSave,
  onBooking,
}: {
  workspace: Workspace;
  date: string;
  days: string[];
  plans: ItemRecord[];
  places: ItemRecord[];
  disabled: boolean;
  selected: string;
  onSelected: (id: string) => void;
  onDate: (date: string) => void;
  onSchedule: (data: Record<string, unknown>) => Promise<Workspace | undefined>;
  onEdit: (r: ItemRecord) => void;
  onRemove: (r: ItemRecord) => void;
  onAdd: () => void;
  onError: (message: string) => void;
  onSave: (r: ItemRecord, data: Record<string, unknown>) => Promise<void>;
  onBooking: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!selected) return;
    const frame = requestAnimationFrame(() => document.getElementById(`plan-${selected}`)?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [selected, date]);
  const graph = dayGraph(plans, places);
  function select(id: string) {
    onSelected(id);
    const row = document.getElementById(`plan-${id}`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "center",
    });
  }
  return (
    <>
      <aside className="daily-map">
        <MapPanel
          points={graph.points}
          legs={graph.legs}
          selected={selected}
          onSelect={select}
          center={travelContext(workspace.trip, { date }).location}
        />
        <button
          type="button"
          className="map-expand"
          aria-label="전체 지도와 일정 카드 보기"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 size={18} />
          <span>전체 지도</span>
        </button>
      </aside>
      <WeekDays
        days={days}
        date={date}
        onChange={(d) => {
          onDate(d);
          onSelected("");
        }}
      />
      <ItineraryEditor
        onBooking={onBooking}
        key={date}
        workspace={workspace}
        date={date}
        days={days}
        plans={plans}
        places={places}
        connections={graph.connections}
        disabled={disabled}
        onSchedule={onSchedule}
        onEdit={onEdit}
        onRemove={onRemove}
        onAdd={onAdd}
        onError={onError}
        onSave={onSave}
        focused={selected}
      />
      {expanded && (
        <Dialog fullScreen title="일정 지도" onClose={() => setExpanded(false)}>
          <div className="map-explorer">
            <WeekDays
              days={days}
              date={date}
              onChange={(d) => {
                onDate(d);
                onSelected("");
              }}
            />
            <MapPanel
              center={travelContext(workspace.trip, { date }).location}
              points={graph.points}
              legs={graph.legs}
              selected={selected || plans[0]?.id}
              onSelect={onSelected}
              focusSelected
              interactive
              label="전체 일정 지도"
            />
            <MapCards
              bookings={workspace.records.filter(r=>r.kind === "booking")}
              onBooking={id=>{setExpanded(false);onBooking(id);}}
              key={date}
              plans={plans}
              places={places}
              selected={selected}
              onSelected={onSelected}
              onEdit={onEdit}
              onAdd={() => {
                setExpanded(false);
                onAdd();
              }}
              disabled={disabled}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
function MapCards({
  bookings,
  onBooking,
  plans,
  places,
  selected,
  onSelected,
  onEdit,
  onAdd,
  disabled,
}: {
  bookings: ItemRecord[];
  onBooking: (id: string) => void;
  plans: ItemRecord[];
  places: ItemRecord[];
  selected: string;
  onSelected: (id: string) => void;
  onEdit: (r: ItemRecord) => void;
  onAdd: () => void;
  disabled: boolean;
}) {
  const suppressClick = useRef(false);
  const mouseSwipe = useRef<{
    pointer: number;
    x: number;
    left: number;
    moved: boolean;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null),
    programmatic = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = plans.findIndex((r) => r.id === selected),
    index = active < 0 ? 0 : active;
  useEffect(() => {
    const node = ref.current,
      card = node?.children[index] as HTMLElement | undefined;
    if (!node || !card) return;
    const add = card.nextElementSibling as HTMLElement | null;
    const trailing = add?.classList.contains("map-add-card") ? add.clientWidth + 12 : 0;
    const left = card.offsetLeft - (node.clientWidth - card.clientWidth - trailing) / 2;
    if (Math.abs(node.scrollLeft - left) < 2) return;
    programmatic.current = true;
    node.scrollTo({
      left,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    const timeout = setTimeout(() => {
      programmatic.current = false;
    }, 450);
    return () => {
      clearTimeout(timeout);
      programmatic.current = false;
    };
  }, [index]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  return (
    <div className="map-card-dock" data-no-pull-refresh="true">
      <div className="map-card-count">
        <button
          type="button"
          className="icon"
          disabled={index <= 0}
          aria-label="이전 일정"
          onClick={() => onSelected(plans[index - 1].id)}
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          {plans.length ? `${index + 1} / ${plans.length}` : "일정 없음"}
        </span>
        <button
          type="button"
          className="icon"
          disabled={index >= plans.length - 1}
          aria-label="다음 일정"
          onClick={() => onSelected(plans[index + 1].id)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div
        className="map-card-carousel"
        ref={ref}
        onPointerDown={(e) => {
          programmatic.current = false;
          if (
            e.pointerType !== "mouse" ||
            e.button !== 0 ||
            (e.target as HTMLElement).closest("button")
          )
            return;
          mouseSwipe.current = {
            pointer: e.pointerId,
            x: e.clientX,
            left: e.currentTarget.scrollLeft,
            moved: false,
          };
          suppressClick.current = false;
        }}
        onPointerMove={(e) => {
          const drag = mouseSwipe.current;
          if (!drag || drag.pointer !== e.pointerId) return;
          if (Math.abs(e.clientX - drag.x) > 6 && !drag.moved) {
            drag.moved = true;
            suppressClick.current = true;
            e.currentTarget.style.scrollSnapType = "none";
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          if (drag.moved) {
            e.preventDefault();
            e.currentTarget.scrollLeft = drag.left - (e.clientX - drag.x);
          }
        }}
        onPointerUp={(e) => {
          const drag = mouseSwipe.current;
          mouseSwipe.current = null;
          if (!drag) return;
          e.currentTarget.style.scrollSnapType = "";
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
          if (drag.moved) {
            const node = e.currentTarget,
              center = node.scrollLeft + node.clientWidth / 2,
              cards = Array.from(node.children) as HTMLElement[];
            const nearest = cards.reduce(
              (a, b) =>
                Math.abs(a.offsetLeft + a.clientWidth / 2 - center) <
                Math.abs(b.offsetLeft + b.clientWidth / 2 - center)
                  ? a
                  : b,
              cards[0]
            );
            if (nearest?.dataset.plan) onSelected(nearest.dataset.plan);
          }
        }}
        onPointerCancel={(e) => {
          mouseSwipe.current = null;
          e.currentTarget.style.scrollSnapType = "";
        }}
        onScroll={() => {
          if (programmatic.current || mouseSwipe.current?.moved) return;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            const node = ref.current;
            if (!node) return;
            const cards = Array.from(node.children) as HTMLElement[];
            const center = node.scrollLeft + node.clientWidth / 2;
            const closest = cards.reduce(
              (a, b) =>
                Math.abs(a.offsetLeft + a.clientWidth / 2 - center) <
                Math.abs(b.offsetLeft + b.clientWidth / 2 - center)
                  ? a
                  : b,
              cards[0]
            );
            if (closest?.dataset.plan) onSelected(closest.dataset.plan);
          }, 70);
        }}
      >
        {plans.map((r, i) => {
          const place = places.find((p) => p.id === r.data.placeId), booking = bookings.find(b=>b.id===r.data.bookingId);
          return (
            <article
              className="map-schedule-card"
              data-plan={r.id}
              key={r.id}
              role="button"
              tabIndex={0}
              aria-label={`${text(r.data.title)} ${booking ? "예약 열기" : "장소 보기"}`}
              onClick={(e) => {
                if (
                  !suppressClick.current &&
                  !(e.target as HTMLElement).closest("button")
                )
                  { if (booking) onBooking(booking.id); else onSelected(r.id); }
              }}
              onKeyDown={(e) => {
                if (
                  e.target === e.currentTarget &&
                  (e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  { if (booking) onBooking(booking.id); else onSelected(r.id); }
                }
              }}
              aria-current={index === i ? "true" : undefined}
            >
              <div className="map-card-heading">
                <span className="map-card-number">
                  {r.data.entryType === "memo" ? (
                    <StickyNote size={15} />
                  ) : (
                    plans
                      .slice(0, i + 1)
                      .filter((p) => p.data.entryType !== "memo").length
                  )}
                </span>
                {r.data.entryType === "memo" ? (
                  <p className="map-memo-body">{memoText(r.data)}</p>
                ) : (
                  <h3>{text(r.data.title)}</h3>
                )}
                <button
                  type="button"
                  className="text-button"
                  disabled={booking ? false : disabled}
                  aria-label={booking ? "예약 열기" : "일정 수정"}
                  onClick={() => booking ? onBooking(booking.id) : onEdit(r)}
                >
                  {booking ? <Ticket size={18}/> : "수정"}
                </button>
              </div>
              <div className="map-card-meta">
                {r.data.entryType !== "memo" && (
                  <>
                    <span>
                      <MapPin size={13} />
                      {place ? text(place.data.name) : "장소 없음"}
                    </span>
                    {text(r.data.time) && <small>{text(r.data.time)}</small>}
                  </>
                )}
              </div>
            </article>
          );
        })}
        {plans.length > 0 && !disabled && <button type="button" className="map-add-card" aria-label="이날 일정 추가" onClick={onAdd}><Plus size={25}/></button>}
        {!plans.length && (
          <button
            type="button"
            className="map-schedule-card empty-map-card"
            disabled={disabled}
            onClick={onAdd}
          >
            이날의 일정을 추가해북
          </button>
        )}
      </div>
    </div>
  );
}
