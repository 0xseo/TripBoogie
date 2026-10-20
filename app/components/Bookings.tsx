"use client";
import ChoiceField from "./ChoiceField";
import AddButton from "./AddButton";
import FeatureToolbar from "./FeatureToolbar";
import { useConfirm } from "./Confirmation";
import DateField from "./DateField";
import TurtleIcon from "./TurtleIcon";
import TimeField from "./TimeField";
import { bookingCategories } from "../booking-categories";
import { useEffect, useState } from "react";
import { airportCode, flightRoute, bookingTitle as displayBookingTitle, compareBookings } from "../booking-display";
import Files, { type FileCommand } from "./Files";
import {
  Plus,
  Minus,
  Plane,
  Hotel,
  Ticket,
  Pencil,
  Trash2,
  ArrowRight,
  CalendarDays,
} from "lucide-react";
import type { Workspace, ItemRecord, Profile } from "../types";
import type { MapPlace } from "../server/maps";
import { Dialog, Field, Empty, RangeCalendar, text, dateLabel } from "./ui";
import { ExpenseForm } from "./Expenses";
import { convert, units, splitAmount, currencyDigits } from "../money";
import { travelContext } from "../travel-context";
import type { Airport } from "../airports";
import AirportInput from "./AirportInput";
import StayDates from "./StayDates";
import { money, CurrencySelect } from "./ui";
import PlacePicker from "./PlacePicker";
export default function Bookings({
  workspace,
  profile,
  readOnly,
  onSave,
  onDelete,
  fileCommand,
  focused,
  onPlan,
}: {
  workspace: Workspace;
  profile: Profile;
  readOnly: boolean;
  onSave: (
    data: Record<string, unknown>,
    record?: ItemRecord,
    place?: MapPlace,
    expense?: BookingExpenseChange | null,
    expenseVersion?: number
  ) => Promise<void>;
  onDelete: (r: ItemRecord) => void;
  fileCommand: FileCommand;
  focused?: string;
  onPlan: (plan: ItemRecord) => void;
}) {
  const [type, setType] = useState(() => {
      const booking = workspace.records.find((r) => r.kind === "booking" && r.id === focused);
      return booking ? String(booking.data.category || booking.data.type) : "hotel";
    }),
    [editing, setEditing] = useState<ItemRecord | "new" | null>(null),
    [reviewPayment, setReviewPayment] = useState(false),
    [showFiles, setShowFiles] = useState(false);
  useEffect(() => {
    if (!focused) return;
    const frame = requestAnimationFrame(() => document.getElementById(`booking-${focused}`)?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [focused, type, showFiles]);
  function selectBookingCategory(id: string, files = false) {
    setEditing(null);
    setReviewPayment(false);
    setShowFiles(files);
    if (!files) setType(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const categories = bookingCategories(workspace.trip.settings),
    selectedCategory = categories.find((c) => c.id === type) || categories[0];
  const rows = workspace.records.filter(
    (r) =>
      r.kind === "booking" &&
      (r.data.category || r.data.type) === selectedCategory.id
  ).sort(compareBookings);
  return (
    <section className="feature">
      <FeatureToolbar
        tabs
        action={
          !showFiles && (
            <AddButton
              label="예약 추가"
              disabled={readOnly}
              onClick={() => {
                setReviewPayment(false);
                setEditing("new");
              }}
            />
          )
        }
      >
        <nav className="booking-category-tabs" aria-label="예약 분류">
          <button
            type="button"
            className="booking-files-tab"
            aria-current={showFiles ? "page" : undefined}
            onClick={() => selectBookingCategory("", true)}
          >
            자료함
          </button>
          {categories.map((t) => (
            <button
              type="button"
              aria-current={
                !showFiles && selectedCategory.id === t.id ? "page" : undefined
              }
              key={t.id}
              onClick={() => selectBookingCategory(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </FeatureToolbar>
      {!showFiles && (
        <div className="booking-grid">
          {rows.map((r) => (
            <article className="booking-card" key={r.id} id={`booking-${r.id}`} data-focused={focused === r.id}>
              <div className="inline">
                <span className="booking-type">
                  {selectedCategory.kind === "hotel" ? (
                    <Hotel />
                  ) : selectedCategory.kind === "flight" ? (
                    <Plane />
                  ) : selectedCategory.kind === "tour" ? (
                    <Ticket />
                  ) : (
                    <TurtleIcon />
                  )}
                </span>
                <div className="row-actions">
                  <button
                    className="icon"
                    aria-label="예약 수정"
                    disabled={readOnly}
                    onClick={() => {
                      setReviewPayment(false);
                      setEditing(r);
                    }}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    className="icon"
                    aria-label="예약 삭제"
                    disabled={readOnly}
                    onClick={() => onDelete(r)}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              {r.data.type === "flight" && (
                <span className="flight-tag">
                  {
                    {
                      outbound: "출발",
                      inbound: "도착",
                      transfer: "여행 중 이동",
                    }[
                      text(r.data.flightRole, "outbound") as
                        | "outbound"
                        | "inbound"
                        | "transfer"
                    ]
                  }
                </span>
              )}
              <h3>{displayBookingTitle(r.data)}</h3>
              {Boolean(r.data.flightNumber) && (
                <strong className="flight-number">
                  {text(r.data.flightNumber)}
                </strong>
              )}
              <p>
                {dateLabel(text(r.data.startDate))} {text(r.data.startTime)} →{" "}
                {dateLabel(text(r.data.endDate))} {text(r.data.endTime)}
              </p>
              {Boolean(r.data.departure) && (
                <p>
                  {flightRoute(r.data)}
                </p>
              )}
              {Boolean(r.data.platform) && (
                <p className="booking-platform">
                  예약 플랫폼 · {text(r.data.platform)}
                </p>
              )}
              {r.data.moneyAmount !== null &&
                r.data.moneyAmount !== undefined && (
                  <div className="booking-money">
                    <strong>
                      {money(
                        r.data.moneyAmount,
                        text(r.data.moneyCurrency, workspace.trip.currency)
                      )}
                    </strong>
                    <span className={r.data.isPaid ? "paid-badge" : ""}>
                      {r.data.isPaid ? "경비에 반영됨" : "결제 전"}
                    </span>
                  </div>
                )}
              {Boolean(r.data.expenseId) && (
                <button
                  className="text-button"
                  disabled={readOnly}
                  onClick={() => {
                    setReviewPayment(true);
                    setEditing(r);
                  }}
                >
                  연결 경비 수정
                </button>
              )}
              {Boolean(r.data.reference) && (
                <p className="muted">예약번호 {text(r.data.reference)}</p>
              )}
              {Boolean(r.data.note) && (
                <p className="preserve">{text(r.data.note)}</p>
              )}
              <div className="booking-plan-links">
                {workspace.records.filter((p) => p.kind === "plan" && p.data.bookingId === r.id).sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)) || String(a.data.time || "").localeCompare(String(b.data.time || ""))).map((plan) => (
                  <button type="button" className="text-button" key={plan.id} onClick={() => onPlan(plan)}>
                    <CalendarDays size={15}/>{dateLabel(text(plan.data.date))} {text(plan.data.time)} · {text(plan.data.bookingEvent) === "checkin" ? "체크인" : text(plan.data.bookingEvent) === "checkout" ? "체크아웃" : text(plan.data.bookingEvent) === "departure" ? "출발" : text(plan.data.bookingEvent) === "arrival" ? "도착" : "투어"} 일정 보기
                  </button>
                ))}
              </div>
              <Files
                key={`${workspace.trip.id}:${r.id}`}
                workspace={workspace}
                bookingId={r.id}
                readOnly={readOnly}
                command={fileCommand}
              />
            </article>
          ))}
        </div>
      )}
      {!rows.length && !showFiles && <Empty title="아직 예약이 없어북" />}
      {showFiles && (
        <section className="reservation-files">
          <Files
            key={workspace.trip.id}
            workspace={workspace}
            readOnly={readOnly}
            command={fileCommand}
          />
        </section>
      )}
      {editing && (
        <BookingForm
          workspace={workspace}
          profile={profile}
          type={selectedCategory.kind}
          category={selectedCategory.id}
          reviewPayment={reviewPayment}
          record={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(data, place, expense, expenseVersion) =>
            onSave(
              data,
              editing === "new" ? undefined : editing,
              place,
              expense,
              expenseVersion
            )
          }
        />
      )}
    </section>
  );
}
export type BookingExpenseChange = {
  data: Record<string, unknown>;
  id?: string;
  version?: number;
};
export function BookingForm({
  workspace,
  profile,
  type,
  category,
  record,
  initialFlightRole = "outbound",
  reviewPayment = false,
  onSave,
  onClose,
}: {
  workspace: Workspace;
  profile: Profile;
  type: string;
  category?: string;
  record?: ItemRecord;
  initialFlightRole?: string;
  reviewPayment?: boolean;
  onSave: (
    data: Record<string, unknown>,
    place?: MapPlace,
    expense?: BookingExpenseChange | null,
    expenseVersion?: number
  ) => Promise<void>;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const d = record?.data ?? {},
    [linked] = useState(() =>
      workspace.records.find(
        (r) => r.kind === "expense" && r.id === d.expenseId
      )
    );
  const [form, setForm] = useState<Record<string, string>>({
      type: text(d.type, type),
      category: text(d.category, category || text(d.type, type)),
      title: text(d.title),
      startDate: text(d.startDate, workspace.trip.startDate),
      endDate: text(d.endDate, workspace.trip.startDate),
      startTime: text(d.startTime),
      endTime: text(d.endTime),
      reference: text(d.reference),
      platform: text(d.platform),
      note: text(d.note),
      flightNumber: text(d.flightNumber),
      flightRole: text(d.flightRole, initialFlightRole),
      departure: airportCode(d.departureAirport, d.departure),
      arrival: airportCode(d.arrivalAirport, d.arrival),
      departureZone: text(d.departureZone),
      arrivalZone: text(d.arrivalZone),
      placeId: text(d.placeId),
      moneyCurrency:
        text(d.moneyCurrency, workspace.trip.currency) ||
        workspace.trip.currency,
      moneyAmount:
        d.moneyAmount === null || d.moneyAmount === undefined
          ? ""
          : String(d.moneyAmount),
    }),
    [airports, setAirports] = useState<{
      departureAirport?: Airport;
      arrivalAirport?: Airport;
    }>({
      departureAirport: d.departureAirport as Airport | undefined,
      arrivalAirport: d.arrivalAirport as Airport | undefined,
    }),
    [showPlatform, setShowPlatform] = useState(!!d.platform),
    [showReference, setShowReference] = useState(!!d.reference),
    [paid, setPaid] = useState(d.isPaid === true && !!linked),
    [step, setStep] = useState(0),
    [place, setPlace] = useState<MapPlace | undefined>(),
    [picker, setPicker] = useState(false),
    [payment, setPayment] = useState(reviewPayment),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const lastStep = form.type === "flight" ? 1 : 2;
  const bookingTitle =
    form.type === "flight"
      ? [
          form.departure && form.arrival
            ? `${form.departure} → ${form.arrival}`
            : form.departure || form.arrival,
          form.flightNumber,
        ]
          .filter(Boolean)
          .join(" · ") || "항공권"
      : form.title.trim();
  function expenseSeed() {
    const today = new Date().toISOString().slice(0, 10),
      period =
        today < workspace.trip.startDate
          ? "before"
          : today > workspace.trip.endDate
          ? "after"
          : "day";
    const tripCurrency =
      form.moneyCurrency === profile.baseCurrency
        ? workspace.trip.currency
        : form.moneyCurrency;
    const category =
      workspace.trip.settings.expenseCategories.find(
        (c) =>
          c.id ===
          (form.type === "hotel"
            ? "stay"
            : form.type === "flight"
            ? "transport"
            : "activity")
      )?.id ||
      workspace.trip.settings.expenseCategories[0]?.id ||
      "other";
    return {
      model: 2,
      title: bookingTitle,
      category,
      tripCurrency,
      baseCurrency: profile.baseCurrency,
      paidCurrency: form.moneyCurrency,
      tripAmount: form.moneyCurrency === tripCurrency ? form.moneyAmount : "",
      baseAmount:
        form.moneyCurrency === profile.baseCurrency ? form.moneyAmount : "",
      period,
      date: today,
    };
  }
  const changed =
    !linked ||
    String(form.moneyAmount) !== String(d.moneyAmount) ||
    form.moneyCurrency !== d.moneyCurrency;
  function reviewRecord() {
    if (!linked || !changed) return linked;
    if (
      ![linked.data.tripCurrency, linked.data.baseCurrency].includes(
        form.moneyCurrency
      )
    )
      return undefined;
    try {
      const isTrip = form.moneyCurrency === linked.data.tripCurrency,
        other = convert(
          form.moneyAmount,
          String(linked.data.exchangeRate),
          !isTrip
        );
      const people = (v: unknown) => {
        const rows = Array.isArray(v)
          ? (v as { userId: string; name: string }[])
          : [];
        const values = splitAmount(
          form.moneyAmount,
          rows.length,
          currencyDigits(form.moneyCurrency)
        );
        return rows.map((p, i) => ({ ...p, amount: values[i] }));
      };
      return {
        ...linked,
        data: {
          ...linked.data,
          paidCurrency: form.moneyCurrency,
          tripAmount: isTrip ? form.moneyAmount : other,
          baseAmount: isTrip ? other : form.moneyAmount,
          payers: people(linked.data.payers),
          participants: people(linked.data.participants),
        },
      };
    } catch {
      return undefined;
    }
  }
  async function persist(
    expense?: BookingExpenseChange | null,
    updated?: Record<string, unknown>
  ) {
    await onSave(
      { ...form, title: bookingTitle, ...airports, isPaid: paid, ...updated },
      place,
      expense,
      linked?.version
    );
  }
  if (payment)
    return (
      <ExpenseForm
        workspace={workspace}
        profile={profile}
        record={reviewRecord()}
        initialData={expenseSeed()}
        categories={workspace.trip.settings.expenseCategories}
        initialPeriod={String(expenseSeed().period)}
        initialDate={String(expenseSeed().date)}
        onClose={() => setPayment(false)}
        onSave={async (data) => {
          const currency = String(data.paidCurrency),
            amount = String(
              currency === data.tripCurrency ? data.tripAmount : data.baseAmount
            );
          await persist(
            { data, id: linked?.id, version: linked?.version },
            { moneyCurrency: currency, moneyAmount: amount, isPaid: true }
          );
          onClose();
        }}
      />
    );
  return (
    <Dialog
      mobilePage
      onBack={picker ? () => setPicker(false) : undefined}
      hideTitle={picker}
      title={picker ? "숙소 장소 선택" : record ? "예약 수정" : "예약 추가"}
      wide
      onClose={onClose}
    >
      {picker ? (
        <PlacePicker
          countryCode={travelContext(workspace.trip).city?.countryCode}
          bias={travelContext(workspace.trip).location}
          onChoose={(p) => {
            setPlace(p);
            if (!form.title) set("title", p.name);
            setPicker(false);
          }}
        />
      ) : (
        <form
          className="stack wizard booking-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (form.type !== "flight" && !bookingTitle) {
              setStep(0);
              setError("예약 이름을 입력하세요.");
              return;
            }
            if (step < lastStep) {
              setStep(step + 1);
              return;
            }
            setBusy(true);
            try {
              if (form.moneyAmount) units(form.moneyAmount);
              if (
                form.type === "hotel" &&
                (form.startDate < workspace.trip.startDate ||
                  form.endDate > workspace.trip.endDate)
              )
                throw new Error("숙소 이용일은 여행 기간 안에서 선택하세요.");
              if (paid) {
                if (!form.moneyAmount || units(form.moneyAmount) <= BigInt(0))
                  throw new Error("결제 금액을 입력하세요.");
                if (changed) {
                  setPayment(true);
                  return;
                }
              }
              if (!paid && linked) {
                if (
                  !(await confirm(
                    "결제 완료를 해제하면 연결된 경비도 삭제됩니다. 계속할까요?"
                  ))
                )
                  return;
                await persist(null);
              } else await persist();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <nav className="wizard-steps" aria-label="예약 입력 단계">
            {(form.type === "flight"
              ? ["항공편", "상세·결제"]
              : ["예약 정보", "이용 날짜", "금액·결제"]
            ).map((label, i) => (
              <button
                type="button"
                key={i}
                className={step === i ? "active" : ""}
                onClick={() => setStep(i)}
              >
                {i + 1}. {label}
              </button>
            ))}
          </nav>
          {step === 0 && (
            <>
              <div className="form-grid">
                <Field label="예약 종류">
                  <ChoiceField
                    label="예약 분류"
                    value={form.category}
                    options={bookingCategories(workspace.trip.settings)}
                    onChange={(category) =>
                      setForm((f) => ({
                        ...f,
                        category,
                        type: bookingCategories(workspace.trip.settings).find(
                          (c) => c.id === category
                        )!.kind,
                      }))
                    }
                  />
                </Field>
                {form.type === "flight" && (
                  <Field label="이동 종류">
                    <div className="flight-tags">
                      {[
                        { id: "outbound", label: "출발" },
                        { id: "inbound", label: "도착" },
                        { id: "transfer", label: "여행 중 이동" },
                      ].map((r) => (
                        <button
                          type="button"
                          key={r.id}
                          aria-label={r.label}
                          aria-pressed={form.flightRole === r.id}
                          onClick={() => set("flightRole", r.id)}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}
              </div>
              {form.type !== "flight" && (
                <Field label="이름">
                  <input
                    required
                    maxLength={300}
                    value={form.title}
                    onChange={(e) => set("title", e.target.value)}
                    placeholder={form.type === "hotel" ? "숙소 이름" : "이름"}
                  />
                </Field>
              )}
              {form.type === "hotel" && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPicker(true)}
                >
                  <Hotel size={18} />
                  {place?.name ||
                    String(
                      workspace.records.find((r) => r.id === form.placeId)?.data
                        .name || "숙소 위치 검색"
                    )}
                </button>
              )}
              {form.type === "flight" && (
                <>
                  <div className="airport-leg-fields">
                    {(["departure", "arrival"] as const).map((key, i) => (
                      <section key={key}>
                        <AirportInput
                          title={i === 0 ? "출발 공항" : "도착 공항"}
                          value={form[key]}
                          onChange={(value) => {
                            set(key, value);
                            setAirports((a) => ({
                              ...a,
                              [`${key}Airport`]: undefined,
                            }));
                          }}
                          onChoose={(airport) => {
                            setAirports((a) => ({
                              ...a,
                              [`${key}Airport`]: airport,
                            }));
                            set(`${key}Zone`, airport.timezone);
                          }}
                        />
                        <div className="form-grid">
                          <Field
                            label={
                              i === 0 ? "출발 현지 날짜" : "도착 현지 날짜"
                            }
                          >
                            <DateField
                              label={i === 0 ? "출발 날짜" : "도착 날짜"}
                              value={i === 0 ? form.startDate : form.endDate}
                              onChange={(value) =>
                                set(i === 0 ? "startDate" : "endDate", value)
                              }
                            />
                          </Field>
                          <Field
                            label={
                              i === 0 ? "출발 현지 시각" : "도착 현지 시각"
                            }
                          >
                            <TimeField
                              value={i === 0 ? form.startTime : form.endTime}
                              onChange={(value) =>
                                set(i === 0 ? "startTime" : "endTime", value)
                              }
                              label={i === 0 ? "출발시각" : "도착시각"}
                              showLabel
                            />
                          </Field>
                        </div>
                      </section>
                    ))}
                  </div>
                  <Field label="항공편명">
                    <input
                      maxLength={20}
                      placeholder="예: KE703"
                      value={form.flightNumber}
                      onChange={(e) =>
                        set(
                          "flightNumber",
                          e.target.value.toUpperCase().replace(/\s/g, "")
                        )
                      }
                    />
                  </Field>
                </>
              )}
            </>
          )}
          {((form.type === "flight" && step === 1) ||
            (form.type !== "flight" && step === 0)) && (
            <div className="stack booking-details">
              <div className="booking-optional-field">
                <button
                  type="button"
                  className="text-button"
                  aria-expanded={showPlatform}
                  onClick={() => setShowPlatform((v) => !v)}
                >
                  {showPlatform ? <Minus size={15} /> : <Plus size={15} />}{" "}
                  예약플랫폼
                </button>
                {showPlatform && (
                  <input
                    aria-label="예약플랫폼"
                    value={form.platform}
                    maxLength={200}
                    onChange={(e) => set("platform", e.target.value)}
                    placeholder="예약플랫폼"
                    autoComplete="off"
                  />
                )}
              </div>
              <div className="booking-optional-field">
                <button
                  type="button"
                  className="text-button"
                  aria-expanded={showReference}
                  onClick={() => setShowReference((v) => !v)}
                >
                  {showReference ? <Minus size={15} /> : <Plus size={15} />}{" "}
                  예약번호
                </button>
                {showReference && (
                  <input
                    aria-label="예약번호"
                    maxLength={300}
                    value={form.reference}
                    onChange={(e) => set("reference", e.target.value)}
                    placeholder="예약번호"
                    autoComplete="off"
                  />
                )}
              </div>
              <Field label="메모">
                <textarea
                  aria-label="예약 메모"
                  rows={3}
                  maxLength={10000}
                  value={form.note}
                  onChange={(e) => set("note", e.target.value)}
                />
              </Field>
            </div>
          )}

          {step === 1 && form.type !== "flight" && (
            <>
              {form.type === "hotel" ? (
                <StayDates
                  min={workspace.trip.startDate}
                  max={workspace.trip.endDate}
                  start={
                    form.startDate < workspace.trip.startDate
                      ? workspace.trip.startDate
                      : form.startDate
                  }
                  end={
                    form.endDate > workspace.trip.endDate
                      ? workspace.trip.endDate
                      : form.endDate
                  }
                  onChange={(a, b) =>
                    setForm((f) => ({ ...f, startDate: a, endDate: b }))
                  }
                />
              ) : (
                <RangeCalendar
                  start={form.startDate}
                  end={form.endDate}
                  onChange={(a, b) =>
                    setForm((f) => ({ ...f, startDate: a, endDate: b }))
                  }
                />
              )}
              <div className="booking-time-range">
                <TimeField
                  value={form.startTime}
                  onChange={(v) => set("startTime", v)}
                  label={form.type === "hotel" ? "체크인시각" : "시작시각"}
                  showLabel
                />
                <ArrowRight size={15} />
                <TimeField
                  value={form.endTime}
                  onChange={(v) => set("endTime", v)}
                  label={form.type === "hotel" ? "체크아웃시각" : "종료시각"}
                  showLabel
                />
              </div>
            </>
          )}
          {step === lastStep && (
            <>
              <div className="booking-payment-head">
                <strong>{bookingTitle || "예약 금액"}</strong>
                <small>
                  {form.platform && `${form.platform} · `}
                  {dateLabel(form.startDate)}
                </small>
              </div>
              <div className="form-grid">
                <Field label="예약 통화">
                  <CurrencySelect
                    value={form.moneyCurrency}
                    onChange={(c) => set("moneyCurrency", c)}
                  />
                </Field>
                <Field label="예약 금액">
                  <input
                    inputMode="decimal"
                    value={form.moneyAmount}
                    onChange={(e) => set("moneyAmount", e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>
              <label className="booking-paid-check">
                <input
                  type="checkbox"
                  checked={paid}
                  onChange={(e) => setPaid(e.target.checked)}
                />
                <span>
                  <strong>결제 완료</strong>
                </span>
              </label>

              {linked && paid && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setPayment(true)}
                >
                  연결 경비 세부 수정
                </button>
              )}
              <small className="muted">
                예약을 저장한 뒤 카드에서 파일을 첨부할 수 있어북
              </small>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer className="wizard-footer">
            <button
              className="primary"
              disabled={busy || !form.startDate || !form.endDate}
            >
              {busy
                ? "저장 중…"
                : step < lastStep
                ? "다음"
                : paid && changed
                ? "경비 확인 후 저장"
                : "예약 저장"}
            </button>
          </footer>
        </form>
      )}
    </Dialog>
  );
}
