"use client";
import { useState } from "react";
import { days, dateLabel } from "./ui";
export default function StayDates({
  start,
  end,
  min,
  max,
  onChange,
}: {
  start: string;
  end: string;
  min: string;
  max: string;
  onChange: (a: string, b: string) => void;
}) {
  const [part, setPart] = useState<"start" | "end">("start");
  const count = days(start, end).length;
  return (
    <section className="stay-dates">
      <div className="stay-date-fields">
        <button
          type="button"
          aria-pressed={part === "start"}
          onClick={() => setPart("start")}
        >
          <small>체크인</small>
          <strong>{dateLabel(start)}</strong>
        </button>
        <span>{count > 1 ? `${count - 1}박` : "당일"}</span>
        <button
          type="button"
          aria-pressed={part === "end"}
          onClick={() => setPart("end")}
        >
          <small>체크아웃</small>
          <strong>{dateLabel(end)}</strong>
        </button>
      </div>
      <p className="muted">
        {part === "start" ? "체크인" : "체크아웃"} 날짜 선택
      </p>
      <div className="stay-day-grid">
        {days(min, max).map((d, i) => (
          <button
            type="button"
            key={d}
            disabled={part === "end" && d < start}
            data-between={d > start && d < end}
            aria-pressed={d === start || d === end}
            onClick={() => {
              if (part === "start") {
                onChange(d, end >= d ? end : d);
                setPart("end");
              } else {
                onChange(start, d);
                setPart("start");
              }
            }}
          >
            <small>DAY {i + 1}</small>
            <strong>{dateLabel(d)}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
