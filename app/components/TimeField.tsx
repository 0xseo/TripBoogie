"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { normalizeTimeInput } from "../time-input";
import { Dialog } from "./ui";

const itemHeight = 44;
function Wheel({ value, count, label, onChange }: {
  value: string; count: number; label: string; onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null), id = useId();
  const gesture = useRef<{ y: number; top: number; index: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const indexAt = (top: number) => Math.max(0, Math.min(count - 1, Math.round(top / itemHeight)));
  function select(index: number) {
    const next = Math.max(0, Math.min(count - 1, index));
    onChange(String(next).padStart(2, "0"));
    ref.current?.scrollTo({ top: next * itemHeight, behavior: "instant" });
  }
  useEffect(() => {
    // External typing moves the wheel; scrolling itself stays free until it snaps.
    const frame = requestAnimationFrame(() => {
      const root = ref.current;
      if (root && !gesture.current && Math.round(root.scrollTop / itemHeight) !== Number(value)) {
        root.scrollTo({ top: Number(value) * itemHeight, behavior: "instant" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <div className="time-wheel-wrap">
    <small>{label}</small>
    <div className="time-wheel" ref={ref} role="listbox" aria-label={label}
      tabIndex={0} aria-activedescendant={`${id}-${Number(value)}`} data-dragging={dragging}
      onScroll={event => onChange(String(indexAt(event.currentTarget.scrollTop)).padStart(2, "0"))}
      onKeyDown={event => {
        const next = { ArrowUp: Number(value) - 1, ArrowDown: Number(value) + 1,
          PageUp: Number(value) - 5, PageDown: Number(value) + 5, Home: 0, End: count - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        select(next);
      }}
      onPointerDown={event => {
        suppressClick.current = false;
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        event.preventDefault();
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
        gesture.current = { y: event.clientY, top: event.currentTarget.scrollTop,
          index: button ? Number(button.value) : Number(value), moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={event => {
        const drag = gesture.current;
        if (!drag) return;
        const distance = drag.y - event.clientY;
        if (Math.abs(distance) > 4) drag.moved = true;
        if (drag.moved) event.currentTarget.scrollTop = drag.top + distance;
      }}
      onPointerUp={event => {
        const drag = gesture.current;
        if (!drag) return;
        gesture.current = null;
        suppressClick.current = true;
        setDragging(false);
        select(drag.moved ? indexAt(event.currentTarget.scrollTop) : drag.index);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => { gesture.current = null; setDragging(false); }}
      onPointerCancel={() => { gesture.current = null; setDragging(false); }}
      onClickCapture={event => {
        if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
      }}>
      {Array.from({ length: count }, (_, i) => <button key={i} id={`${id}-${i}`} value={i}
        type="button" role="option" tabIndex={-1} aria-selected={i === Number(value)}
        onClick={() => select(i)}>{String(i).padStart(2, "0")}</button>)}
    </div>
  </div>;
}

export default function TimeField({ value, onChange, disabled = false, label = "시간", showLabel = false, placeholder }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; label?: string; showLabel?: boolean; placeholder?: string;
}) {
  const [open, setOpen] = useState(false), [hour, setHour] = useState("09"), [minute, setMinute] = useState("00");
  const [input, setInput] = useState("09:00"), [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null), helpId = useId();
  useEffect(() => {
    if (!open || !window.matchMedia("(min-width: 961px) and (hover: hover) and (pointer: fine)").matches) return;
    const frame = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  function syncInput() {
    const normalized = normalizeTimeInput(input);
    if (!normalized) { setError("00:00~23:59 사이의 시간을 입력해 주세요."); return null; }
    setInput(normalized);
    setHour(normalized.slice(0, 2));
    setMinute(normalized.slice(3));
    setError("");
    return normalized;
  }
  function apply() {
    const normalized = syncInput();
    if (normalized) { onChange(normalized); setOpen(false); }
    else inputRef.current?.focus();
  }
  return <>
    <button type="button" className={`time-trigger ${value ? "has-time" : ""}`}
      aria-label={`${label}${value ? ` ${value}` : " 추가"}`} aria-haspopup="dialog" aria-expanded={open}
      disabled={disabled} onClick={() => {
        const initial = normalizeTimeInput(value) ?? "09:00";
        setHour(initial.slice(0, 2)); setMinute(initial.slice(3)); setInput(initial); setError(""); setOpen(true);
      }}><Clock size={16}/>{showLabel && <span>{label}</span>}{(value || placeholder) && <span>{value || placeholder}</span>}</button>
    {open && <Dialog title={label} onClose={() => setOpen(false)}>
      <div className="time-entry">
        <label htmlFor={`${helpId}-input`}>직접 입력</label>
        <input id={`${helpId}-input`} ref={inputRef} type="text" inputMode="decimal"
          aria-label={`${label} 직접 입력`} aria-describedby={helpId} aria-invalid={!!error}
          autoComplete="off" spellCheck={false} placeholder="09:30" value={input}
          onChange={event => { setInput(event.target.value); setError(""); }} onBlur={syncInput}
          onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); apply(); } }}/>
        <small id={helpId} className={error ? "error" : "muted"} role={error ? "alert" : undefined}>
          {error || "24시간 형식 · 9:30 또는 0930"}
        </small>
      </div>
      <div className="time-picker">
        <Wheel value={hour} count={24} label="시" onChange={next => { setHour(next); setInput(`${next}:${minute}`); setError(""); }}/>
        <span aria-hidden="true">:</span>
        <Wheel value={minute} count={60} label="분" onChange={next => { setMinute(next); setInput(`${hour}:${next}`); setError(""); }}/>
      </div>
      <div className="filter-actions time-actions">
        <button className="secondary" type="button" onClick={() => { onChange(""); setOpen(false); }}>시간 지우기</button>
        <button className="primary" type="button" onClick={apply}>적용</button>
      </div>
    </Dialog>}
  </>;
}
