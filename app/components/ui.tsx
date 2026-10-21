"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useId,
  type ReactNode,
} from "react";
import { apiFetch as api, jsonRequest } from "../client-api";
import ChoiceField from "./ChoiceField";
import {useFieldError} from "./Form";
import { shortDate } from "../calendar";
import { DayPicker, type DateRange } from "react-day-picker";
import { ko } from "react-day-picker/locale";
import "react-day-picker/style.css";
import calendarStyles from "./RangeCalendar.module.css";

export const CalendarCountry = createContext("");
type Holidays = {
  holidays: { date: string; name: string }[];
  supported: boolean;
  message?: string;
};
const holidayRequests = new Map<string, Promise<Holidays>>();
function holidays(country: string, year: number) {
  const key = `${country}:${year}`;
  let request = holidayRequests.get(key);
  if (!request) {
    request = api<Holidays>(
      "/api/tools",
      jsonRequest({ operation: "holidays", country, year }),
    );
    holidayRequests.set(key, request);
    request.catch(() => holidayRequests.delete(key));
    if (holidayRequests.size > 12)
      holidayRequests.delete(holidayRequests.keys().next().value!);
  }
  return request;
}
export const text = (v: unknown, f = "") => (typeof v === "string" ? v : f);
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const localDate = (s: string) => new Date(`${s}T12:00:00`);
export function days(start: string, end: string) {
  const a = Date.parse(`${start}T12:00:00Z`),
    b = Date.parse(`${end}T12:00:00Z`);
  return Number.isFinite(a) && b >= a
    ? Array.from(
        { length: Math.min(365, Math.floor((b - a) / 86400000) + 1) },
        (_, i) => new Date(a + i * 86400000).toISOString().slice(0, 10),
      )
    : [];
}
export const dateLabel = shortDate;
export const money = (n: unknown, c: string, currencyDisplay: "symbol" | "narrowSymbol" = "symbol") =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currencyDisplay,
    currency: /^[A-Z]{3}$/.test(c) ? c : "KRW",
    maximumFractionDigits: ["KRW", "JPY", "VND"].includes(c) ? 0 : 2,
  }).format(Number(n) || 0);
export const currencies = [
  "KRW",
  "JPY",
  "USD",
  "EUR",
  "GBP",
  "CNY",
  "TWD",
  "THB",
  "VND",
  "SGD",
  "HKD",
  "AUD",
  "CAD",
  "CHF",
  "NZD",
  "IDR",
  "MYR",
  "PHP",
];
export function CurrencySelect({
  value,
  onChange,
  label = "통화",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return <ChoiceField label={label} value={value} onChange={onChange} options={Array.from(new Set([value,...currencies])).map(id=>({id,label:id||"통화 선택"}))}/>;
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id=useId(),error=useFieldError(id);
  return (
    <label className="field" data-validation-field={id} data-validation-label={label}>
      <span>{label}</span>
      {children}
      {error&&<span id={id} className="field-error" role="alert">{error}</span>}
    </label>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-dot">✦</span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export {default as Dialog} from "./Dialog";
export function RangeCalendar({
  start,
  end,
  onChange,
  min,
  max,
}: {
  min?: string;
  max?: string;
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  const country = useContext(CalendarCountry),
    [month, setMonth] = useState(() => (start ? localDate(start) : new Date())),
    [holidayData, setHolidayData] = useState<{
      key: string;
      data: Holidays;
    } | null>(null);
  const year = month.getFullYear(),
    key = `${country}:${year}`;
  useEffect(() => {
    if (!country) return;
    let active = true;
    const years = [
      year,
      ...(month.getMonth() === 0
        ? [year - 1]
        : month.getMonth() === 11
          ? [year + 1]
          : []),
    ];
    Promise.all(years.map((y) => holidays(country, y)))
      .then((values) => ({
        holidays: values.flatMap((v) => v.holidays),
        supported: values.every((v) => v.supported),
      }))
      .then((data) => {
        if (active) {
          setHolidayData({ key: `${country}:${year}`, data });
        }
      })
      .catch(()=>{});
    return () => {
      active = false;
    };
  }, [country, year, month]);
  const names = new Map(
      holidayData?.key === key
        ? holidayData.data.holidays.map((h) => [h.date, h.name])
        : [],
    ),
    nights = days(start, end).length;
  const selected: DateRange | undefined = start
    ? { from: localDate(start), to: end ? localDate(end) : undefined }
    : undefined;
  return (
    <div className={`range-calendar ${calendarStyles.calendar}`}>
      <div className="range-label">
        <span>
          출발 <strong>{start ? dateLabel(start) : "날짜 선택"}</strong>
        </span>
        <span>→</span>
        <span>
          도착 <strong>{end ? dateLabel(end) : "날짜 선택"}</strong>
        </span>
      </div>
      <DayPicker
        locale={ko}
        mode="range"
        selected={selected}
        month={month}
        onMonthChange={setMonth}
        weekStartsOn={0}
        startMonth={new Date(1900, 0, 1)}
        endMonth={new Date(2100, 11, 31)}
        disabled={[
          ...(min ? [{ before: localDate(min) }] : []),
          ...(max ? [{ after: localDate(max) }] : []),
        ]}
        modifiers={{
          sunday: { dayOfWeek: [0] },
          saturday: { dayOfWeek: [6] },
          holiday: (d) => names.has(iso(d)),
        }}
        modifiersClassNames={{
          sunday: "calendar-sunday",
          saturday: "calendar-saturday",
          holiday: "calendar-holiday",
        }}
        labels={{
          labelDayButton: (d) =>
            `${d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}${names.has(iso(d)) ? ` · ${names.get(iso(d))}` : ""}`,
        }}
        max={364}
        onSelect={(range) =>
          onChange(
            range?.from ? iso(range.from) : "",
            range?.to ? iso(range.to) : "",
          )
        }
        showOutsideDays
      />
      <div className="calendar-footer">
        <strong>
          {nights
            ? `${nights - 1}박 ${nights}일`
            : "출발일과 도착일을 선택하세요"}
        </strong>

      </div>
    </div>
  );
}
