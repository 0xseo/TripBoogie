"use client";
import Form from "./Form";
import ChoiceField from "./ChoiceField";
import AddButton from "./AddButton";
import FeatureToolbar from "./FeatureToolbar";
import ListControls from "./ListControls";
import { matchesListQuery, compareListRecords } from "../list-records";
import { useConfirm } from "./Confirmation";
import DateField from "./DateField";
import TurtleIcon from "./TurtleIcon";
import TimeField from "./TimeField";
import { bookingExpenseCategory } from "../expense-categories";
import { bookingCategories } from "../booking-categories";
import { useEffect, useRef, useState } from "react";
import {
  airportCode,
  bookingTitle as displayBookingTitle,
  compareBookings,
} from "../booking-display";
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
  Coins,
} from "lucide-react";
import type { Workspace, ItemRecord, Profile } from "../types";
import type { MapPlace } from "../server/maps";
import { Dialog, Field, Empty, RangeCalendar, text, dateLabel } from "./ui";
import { ExpenseForm, useRate } from "./Expenses";
import {
  convert,
  units,
  splitAmount,
  currencyDigits,
  recordedRate,
} from "../money";
import { tripCurrencies, tripCountries } from "../trip-destinations";
import { travelContext } from "../travel-context";
import type { Airport } from "../airports";
import AirportInput from "./AirportInput";
import StayDates from "./StayDates";
import { money } from "./ui";
import PlacePicker from "./PlacePicker";
const bookingEventLabels: Record<string, string> = {
  checkin: "체크인",
  checkout: "체크아웃",
  departure: "출발",
  arrival: "도착",
  stay: "숙박",
};
export default function Bookings({
  workspace,
  profile,
  readOnly,
  onSave,
  onDelete,
  fileCommand,
  focused,
  onPlan,
  onExpense,
  onNotice,
}: {
  workspace: Workspace;
  profile: Profile;
  readOnly: boolean;
  onSave: (
    data: Record<string, unknown>,
    record?: ItemRecord,
    place?: MapPlace,
    expense?: BookingExpenseChange | null,
    expenseVersion?: number,
    addToPlan?: boolean,
  ) => Promise<void>;
  onDelete: (r: ItemRecord) => void;
  fileCommand: FileCommand;
  focused?: string;
  onPlan: (plan: ItemRecord) => void;
  onExpense?: (id: string) => void;
  onNotice: (message: string) => void;
}) {
  const [query, setQuery] = useState(""), [order, setOrder] = useState("date-asc");
  const [type, setType] = useState(() => {
      const booking = workspace.records.find(
        (r) => r.kind === "booking" && r.id === focused,
      );
      return booking
        ? String(booking.data.category || booking.data.type)
        : "all";
    }),
    [editing, setEditing] = useState<ItemRecord | "new" | null>(null),
    [reviewPayment, setReviewPayment] = useState(false),
    [showFiles, setShowFiles] = useState(false);
  const scrolledTo = useRef("");
  useEffect(() => {
    if (!focused) {
      scrolledTo.current = "";
      return;
    }
    if (scrolledTo.current === focused) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`booking-${focused}`);
      if (target) {
        target.scrollIntoView({ block: "center" });
        scrolledTo.current = focused;
      }
    });
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
  const rows = workspace.records
    .filter(
      (r) =>
        r.kind === "booking" &&
        (type === "all" || (r.data.category || r.data.type) === selectedCategory.id) &&
        matchesListQuery(query, [displayBookingTitle(r.data), r.data.title, r.data.note, r.data.platform, r.data.reference, r.data.flightNumber, r.data.departure, r.data.arrival, r.data.startDate, r.data.roomName,
          categories.find(c => c.id === (r.data.category || r.data.type))?.label]),
    )
    .sort((a,b) => order === "date-asc" ? compareBookings(a,b) : compareListRecords(a,b,order));
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
          <button type="button" aria-current={!showFiles && type === "all" ? "page" : undefined} onClick={() => selectBookingCategory("all")}>전체</button>
          {categories.map((t) => (
            <button
              type="button"
              aria-current={
                !showFiles && type !== "all" && selectedCategory.id === t.id ? "page" : undefined
              }
              key={t.id}
              onClick={() => selectBookingCategory(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </FeatureToolbar>
      {!showFiles && <ListControls label="예약" query={query} onQuery={setQuery} order={order} onOrder={setOrder} count={rows.length} options={[
        {id:"date-asc",label:"날짜 빠른순"},{id:"date-desc",label:"날짜 늦은순"},
        {id:"title",label:"이름순"},{id:"updated-desc",label:"최근 수정순"},
      ]}/>}
      {!showFiles && (
        <div className="booking-grid">
          {rows.map((r) => (
            <article
              className="booking-card"
              key={r.id}
              id={`booking-${r.id}`}
              data-focused={focused === r.id}
            >
              <div className="inline">
                <div className="booking-kind">
                  <span className="booking-type">
                    {r.data.type === "hotel" ? (
                      <Hotel />
                    ) : r.data.type === "flight" ? (
                      <Plane />
                    ) : r.data.type === "tour" ? (
                      <Ticket />
                    ) : (
                      <TurtleIcon />
                    )}
                  </span>
                  {r.data.type === "flight" && (
                    <span className="flight-tag">
                      {
                        {
                          outbound: "출발",
                          inbound: "도착",
                          transfer: "여행 중 이동",
                        }[
                          text(r.data.flightRole, "outbound") as
                            "outbound" | "inbound" | "transfer"
                        ]
                      }
                    </span>
                  )}
                </div>
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
              <h3>{displayBookingTitle(r.data)}</h3>
              <p>
                {dateLabel(text(r.data.startDate))} {text(r.data.startTime)} →{" "}
                {dateLabel(text(r.data.endDate))} {text(r.data.endTime)}
              </p>
              {r.data.type === "hotel" && Boolean(r.data.roomName) && (
                <p className="booking-room">방 · {text(r.data.roomName)}</p>
              )}
              {Boolean(r.data.platform) && (
                <p className="booking-platform">
                  예약 플랫폼 · {text(r.data.platform)}
                </p>
              )}
              {Boolean(r.data.reference) && (
                <p className="muted">예약번호 {text(r.data.reference)}</p>
              )}
              {r.data.type === "flight" && (
                <div className="booking-flight-extras">
                  {Boolean(
                    r.data.flightSeat ||
                    ((r.data.flightExtras as FlightExtra[]) || [])
                      .map((e) => e.seat)
                      .filter(Boolean)
                      .join(", "),
                  ) && (
                    <p>
                      좌석{" "}
                      {String(
                        r.data.flightSeat ||
                          ((r.data.flightExtras as FlightExtra[]) || [])
                            .map((e) => e.seat)
                            .filter(Boolean)
                            .join(", "),
                      )}
                    </p>
                  )}
                  {((r.data.flightExtras as FlightExtra[]) || [])
                    .filter(
                      (e) =>
                        (e.baggageCount != null &&
                          String(e.baggageCount) !== "") ||
                        (e.baggageKg != null && String(e.baggageKg) !== ""),
                    )
                    .map((e) => (
                      <p key={e.id}>
                        수하물{" "}
                        {[
                          e.baggageCount != null &&
                          String(e.baggageCount) !== ""
                            ? `${e.baggageCount}개`
                            : "",
                          e.baggageKg != null && String(e.baggageKg) !== ""
                            ? `${e.baggageKg}kg`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ))}
                </div>
              )}
              {Boolean(r.data.note) && (
                <p className="preserve">{text(r.data.note)}</p>
              )}
              <div className="booking-plan-links">
                {workspace.records
                  .filter((p) => p.kind === "plan" && p.data.bookingId === r.id)
                  .sort(
                    (a, b) =>
                      String(a.data.date).localeCompare(String(b.data.date)) ||
                      String(a.data.time || "").localeCompare(
                        String(b.data.time || ""),
                      ),
                  )
                  .map((plan) => (
                    <button
                      type="button"
                      className="text-button"
                      key={plan.id}
                      onClick={() => onPlan(plan)}
                    >
                      <CalendarDays size={15} />
                      {dateLabel(text(plan.data.date))} {text(plan.data.time)} ·{" "}
                      {r.data.type === "flight" || r.data.type === "hotel"
                        ? `${
                            bookingEventLabels[text(plan.data.bookingEvent)] ||
                            text(plan.data.title, "연결")
                          } `
                        : ""}
                      일정 보기
                    </button>
                  ))}
              </div>
              {r.data.moneyAmount != null && (
                <BookingPrice
                  booking={r}
                  currency={workspace.trip.currency}
                  onExpense={onExpense}
                />
              )}
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
      {!rows.length && !showFiles && <Empty title={query.trim() ? "검색 결과가 없어북" : "아직 예약이 없어북"} />}
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
          onNotice={onNotice}
          workspace={workspace}
          profile={profile}
          type={selectedCategory.kind}
          category={selectedCategory.id}
          reviewPayment={reviewPayment}
          record={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(data, place, expense, expenseVersion, addToPlan) =>
            onSave(
              data,
              editing === "new" ? undefined : editing,
              place,
              expense,
              expenseVersion,
              addToPlan,
            )
          }
        />
      )}
    </section>
  );
}
function BookingPrice({
  booking,
  currency,
  onExpense,
}: {
  booking: ItemRecord;
  currency: string;
  onExpense?: (id: string) => void;
}) {
  const linked = String(booking.data.expenseId || ""),
    content = (
      <>
        <Coins size={19} />
        <strong>
          {money(
            booking.data.moneyAmount,
            text(booking.data.moneyCurrency, currency),
          )}
        </strong>
        <span className={linked ? "paid-badge" : ""}>
          {linked ? "경비에 반영됨" : "결제 전"}
        </span>
      </>
    );
  return linked ? (
    <button
      type="button"
      className="booking-expense-link"
      aria-label="연결된 경비 보기"
      onClick={() => onExpense?.(linked)}
    >
      {content}
    </button>
  ) : (
    <div className="booking-expense-link">{content}</div>
  );
}
type FlightExtra = {
  id: string;
  seat: string;
  baggageCount: string;
  baggageKg: string;
};
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
  onNotice,
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
    expenseVersion?: number,
    addToPlan?: boolean,
  ) => Promise<void>;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const confirm = useConfirm();
  const d = record?.data ?? {},
    [linked] = useState(() =>
      workspace.records.find(
        (r) => r.kind === "expense" && r.id === d.expenseId,
      ),
    );
  const hasLinkedPlans =
    !!record &&
    workspace.records.some(
      (r) => r.kind === "plan" && r.data.bookingId === record.id,
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
      roomName: text(d.roomName),
      note: text(d.note),
      flightNumber: text(d.flightNumber),
      flightSeat: text(
        d.flightSeat,
        Array.isArray(d.flightExtras)
          ? d.flightExtras
              .map((e) => text((e as Record<string, unknown>).seat))
              .filter(Boolean)
              .join(", ")
          : "",
      ),
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
    [flightExtras, setFlightExtras] = useState<FlightExtra[]>(() =>
      Array.isArray(d.flightExtras)
        ? d.flightExtras
            .filter((row) => {
              const e = row as Record<string, unknown>;
              return (
                (e.baggageCount != null && String(e.baggageCount) !== "") ||
                (e.baggageKg != null && String(e.baggageKg) !== "")
              );
            })
            .map((row) => {
              const e = row as Record<string, unknown>;
              return {
                id: String(e.id),
                seat: String(e.seat || ""),
                baggageCount:
                  e.baggageCount == null ? "" : String(e.baggageCount),
                baggageKg: e.baggageKg == null ? "" : String(e.baggageKg),
              };
            })
        : [],
    ),
    [payerIds, setPayerIds] = useState<string[]>(() =>
      Array.isArray(linked?.data.payers)
        ? (linked.data.payers as { userId: string }[]).map((p) => p.userId)
        : [profile.id],
    ),
    [manualCounterpartValue, setCounterpart] = useState(() =>
      linked && linked.data.baseCurrency === profile.baseCurrency
        ? String(
            d.moneyCurrency === profile.baseCurrency
              ? (linked.data.tripAmount ?? "")
              : (linked.data.baseAmount ?? ""),
          )
        : "",
    ),
    [manualCounterpart, setManualCounterpart] = useState(
      !!linked && linked.data.baseCurrency === profile.baseCurrency,
    ),
    [participantIds, setParticipantIds] = useState<string[]>(() =>
      Array.isArray(linked?.data.participants)
        ? (linked.data.participants as { userId: string }[]).map(
            (p) => p.userId,
          )
        : workspace.members.map((m) => m.id),
    ),
    [addToPlan, setAddToPlan] = useState(
      hasLinkedPlans ||
        (!record && ["flight", "hotel", "tour"].includes(text(d.type, type))),
    ),
    [showRoom, setShowRoom] = useState(!!d.roomName),
    [showPlatform, setShowPlatform] = useState(!!d.platform),
    [showReference, setShowReference] = useState(!!d.reference),
    [paid, setPaid] = useState(d.isPaid === true && !!linked),
    [step, setStep] = useState(0),
    [place, setPlace] = useState<MapPlace | undefined>(),
    [picker, setPicker] = useState(false),
    [payment, setPayment] = useState(reviewPayment),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const announced = useRef(new Set<string>());
  const hasLinkedTour =
    !!record &&
    form.type === "tour" &&
    workspace.records.some(
      (p) => p.kind === "plan" && p.data.bookingId === record.id,
    );
  function notifyLinkedChange(key: string) {
    if (!hasLinkedTour) return;
    const group =
      key === "note"
        ? "note"
        : key.endsWith("Date")
          ? "date"
          : key.endsWith("Time")
            ? "time"
            : "info";
    if (announced.current.has(group)) return;
    announced.current.add(group);
    onNotice(
      group === "note"
        ? "메모를 바꾸면 연결된 일정 메모도 함께 변경돼요."
        : group === "date"
          ? "날짜를 바꾸면 연결된 일정 날짜도 함께 변경돼요."
          : group === "time"
            ? "예약 시간만 변경돼요. 기존 일정 시간은 유지됩니다."
            : "이 예약에 연결된 일정이 있어요. 날짜·메모는 함께 변경돼요.",
    );
  }
  function set(key: string, value: string) {
    if (form[key] !== value) notifyLinkedChange(key);
    if (
      (key === "moneyAmount" || key === "moneyCurrency") &&
      form[key] !== value
    ) {
      setManualCounterpart(false);
      setCounterpart("");
    }
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setDates(startDate: string, endDate: string) {
    if (form.startDate !== startDate || form.endDate !== endDate)
      notifyLinkedChange("startDate");
    setForm((f) => ({ ...f, startDate, endDate }));
  }
  const lastStep = 2;
  const paymentLocal =
    form.moneyCurrency === profile.baseCurrency
      ? profile.baseCurrency
      : form.moneyCurrency;
  const paymentRate = useRate(
    paymentLocal || workspace.trip.currency,
    profile.baseCurrency,
  );
  const counterpart =
    paymentLocal === profile.baseCurrency
      ? form.moneyAmount
      : manualCounterpart
        ? manualCounterpartValue
        : (() => {
            if (!form.moneyAmount) return "";
            if (paymentLocal === profile.baseCurrency) return form.moneyAmount;
            if (paymentRate.quote)
              try {
                return convert(
                  form.moneyAmount,
                  String(Number(paymentRate.quote.rate.toFixed(6))),
                  form.moneyCurrency === profile.baseCurrency,
                );
              } catch {
                return "";
              }
            return "";
          })();
  function paymentExpense(): BookingExpenseChange {
    if (!payerIds.length) throw new Error("결제자를 선택하세요.");
    if (!participantIds.length) throw new Error("분담할 사람을 선택하세요.");
    const basePaid = form.moneyCurrency === profile.baseCurrency,
      a = basePaid ? counterpart : form.moneyAmount,
      b = basePaid ? form.moneyAmount : counterpart;
    units(a);
    units(b);
    const quote =
      paymentLocal === profile.baseCurrency
        ? "1"
        : paymentRate.quote
          ? String(Number(paymentRate.quote.rate.toFixed(6)))
          : "";
    let rate = quote;
    try {
      rate = recordedRate(a, b);
    } catch {
      if (!rate) throw new Error("환산 금액이나 환율을 확인하세요.");
    }
    const members = Array.from(
      new Map(
        [
          ...workspace.members.map((m) => ({ userId: m.id, name: m.name })),
          ...((linked?.data.payers as { userId: string; name: string }[]) ||
            []),
          ...((linked?.data.participants as {
            userId: string;
            name: string;
          }[]) || []),
        ].map((m) => [m.userId, m]),
      ).values(),
    );
    const allocate = (ids: string[]) => {
      const amounts = splitAmount(
        form.moneyAmount,
        ids.length,
        currencyDigits(form.moneyCurrency),
      );
      return ids.map((id, i) => ({
        userId: id,
        name: members.find((m) => m.userId === id)?.name || "동행",
        amount: amounts[i],
      }));
    };
    const amountsChanged =
      changed || String(linked?.data.paidCurrency) !== form.moneyCurrency;
    const oldPayers = Array.isArray(linked?.data.payers)
        ? (linked.data.payers as {
            userId: string;
            name: string;
            amount: string;
          }[])
        : [],
      samePayers =
        oldPayers.length === payerIds.length &&
        oldPayers.every((p) => payerIds.includes(p.userId));
    const sameParticipants =
      Array.isArray(linked?.data.participants) &&
      linked.data.participants.length === participantIds.length &&
      (linked.data.participants as { userId: string }[]).every((p) =>
        participantIds.includes(p.userId),
      );
    return {
      id: linked?.id,
      version: linked?.version,
      data: {
        ...expenseSeed(),
        ...linked?.data,
        tripCurrency: paymentLocal,
        baseCurrency: profile.baseCurrency,
        paidCurrency: form.moneyCurrency,
        tripAmount: a,
        baseAmount: b,
        exchangeRate: rate,
        rateDate: manualCounterpart
          ? linked?.data.rateDate || ""
          : paymentRate.quote?.date || "",
        countryCode:
          linked?.data.countryCode ||
          (workspace.trip.settings.cities || []).find(
            (c) =>
              !c.transit &&
              c.startDate <= form.startDate &&
              c.endDate >= form.startDate,
          )?.countryCode ||
          tripCountries(workspace.trip)[0] ||
          "",
        payers: !amountsChanged && samePayers ? oldPayers : allocate(payerIds),
        participants:
          !amountsChanged && sameParticipants && linked?.data.participants
            ? linked.data.participants
            : allocate(participantIds),
      },
    };
  }
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
    const category = bookingExpenseCategory(form.type);
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
        form.moneyCurrency,
      )
    )
      return undefined;
    try {
      const isTrip = form.moneyCurrency === linked.data.tripCurrency,
        other = convert(
          form.moneyAmount,
          String(linked.data.exchangeRate),
          !isTrip,
        );
      const people = (v: unknown) => {
        const rows = Array.isArray(v)
          ? (v as { userId: string; name: string }[])
          : [];
        const values = splitAmount(
          form.moneyAmount,
          rows.length,
          currencyDigits(form.moneyCurrency),
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
    updated?: Record<string, unknown>,
  ) {
    await onSave(
      {
        ...form,
        title: bookingTitle,
        ...airports,
        flightExtras,
        isPaid: paid,
        ...updated,
      },
      place,
      expense,
      linked?.version,
      addToPlan,
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
              currency === data.tripCurrency
                ? data.tripAmount
                : data.baseAmount,
            );
          await persist(
            { data, id: linked?.id, version: linked?.version },
            { moneyCurrency: currency, moneyAmount: amount, isPaid: true },
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
        <Form
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
                await persist(paymentExpense());
                onClose();
                return;
              }
              if (!paid && linked) {
                if (
                  !(await confirm(
                    "결제 완료를 해제하면 연결된 경비도 삭제됩니다. 계속할까요?",
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
              ? ["항공편", "예약 상세", "금액·결제"]
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
                    onChange={(category) => {
                      const kind = bookingCategories(
                        workspace.trip.settings,
                      ).find((c) => c.id === category)!.kind;
                      setForm((f) => ({ ...f, category, type: kind }));
                      if (!record)
                        setAddToPlan(
                          ["flight", "hotel", "tour"].includes(kind),
                        );
                    }}
                  />
                </Field>
                {form.type === "flight" && (
                  <Field label="이동 종류">
                    <ChoiceField
                      label="이동 종류"
                      value={form.flightRole}
                      options={[
                        { id: "outbound", label: "출발" },
                        { id: "inbound", label: "도착" },
                        { id: "transfer", label: "여행 중 이동" },
                      ]}
                      onChange={(value) => set("flightRole", value)}
                    />
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
                        .name || "숙소 위치 검색",
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
                          e.target.value.toUpperCase().replace(/\s/g, ""),
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
              {form.type === "hotel" && (
                <div className="booking-optional-field">
                  <button
                    type="button"
                    className="text-button"
                    aria-expanded={showRoom}
                    onClick={() => setShowRoom((v) => !v)}
                  >
                    {showRoom ? <Minus size={15} /> : <Plus size={15} />} 방
                    이름
                  </button>
                  {showRoom && (
                    <input
                      aria-label="방 이름"
                      value={form.roomName}
                      maxLength={200}
                      onChange={(e) => set("roomName", e.target.value)}
                      placeholder="예: 디럭스 트윈"
                    />
                  )}
                </div>
              )}
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
              {form.type === "flight" && (
                <>
                  <Field label="좌석">
                    <input
                      aria-label="좌석"
                      maxLength={300}
                      value={form.flightSeat}
                      onChange={(e) => set("flightSeat", e.target.value)}
                      placeholder="예: 18A"
                    />
                  </Field>
                  <div className="flight-extras">
                    <strong>수하물 제한</strong>
                    {flightExtras.map((extra, index) => (
                      <section className="flight-extra" key={extra.id}>
                        <header>
                          <strong>수하물 {index + 1}</strong>
                          <button
                            type="button"
                            className="icon"
                            aria-label={`수하물 ${index + 1} 삭제`}
                            onClick={() =>
                              setFlightExtras((rows) =>
                                rows.filter((e) => e.id !== extra.id),
                              )
                            }
                          >
                            <Trash2 size={17} />
                          </button>
                        </header>
                        <div className="form-grid baggage-fields">
                          <Field label="개수">
                            <input
                              aria-label={`수하물 개수 ${index + 1}`}
                              type="number"
                              min={0}
                              max={20}
                              value={extra.baggageCount}
                              onChange={(e) =>
                                setFlightExtras((rows) =>
                                  rows.map((r) =>
                                    r.id === extra.id
                                      ? { ...r, baggageCount: e.target.value }
                                      : r,
                                  ),
                                )
                              }
                            />
                          </Field>
                          <Field label="무게 제한 · kg">
                            <input
                              aria-label={`수하물 무게 ${index + 1}`}
                              type="number"
                              min={0}
                              max={200}
                              step="0.01"
                              value={extra.baggageKg}
                              onChange={(e) =>
                                setFlightExtras((rows) =>
                                  rows.map((r) =>
                                    r.id === extra.id
                                      ? { ...r, baggageKg: e.target.value }
                                      : r,
                                  ),
                                )
                              }
                            />
                          </Field>
                        </div>
                      </section>
                    ))}
                    <button
                      type="button"
                      className="text-button"
                      aria-label="수하물 추가"
                      disabled={flightExtras.length >= 50}
                      onClick={() =>
                        setFlightExtras((rows) => [
                          ...rows,
                          {
                            id: crypto.randomUUID(),
                            seat: "",
                            baggageCount: "",
                            baggageKg: "",
                          },
                        ])
                      }
                    >
                      <Plus size={16} />
                      수하물 추가
                    </button>
                  </div>
                </>
              )}
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

          {step === (form.type === "flight" ? 0 : 1) && (
            <label className="booking-add-plan">
              <input
                type="checkbox"
                checked={addToPlan}
                disabled={hasLinkedPlans}
                onChange={(e) => setAddToPlan(e.target.checked)}
              />
              일정에도 추가하기
            </label>
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
                  onChange={setDates}
                />
              ) : (
                <RangeCalendar
                  start={form.startDate}
                  end={form.endDate}
                  onChange={setDates}
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
                  <ChoiceField
                    label="예약 통화"
                    value={form.moneyCurrency}
                    options={[
                      ...new Set([
                        ...tripCurrencies(workspace.trip),
                        profile.baseCurrency,
                        form.moneyCurrency,
                      ]),
                    ]
                      .filter(Boolean)
                      .map((id) => ({ id, label: id }))}
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
              {paid && form.moneyCurrency !== profile.baseCurrency && (
                <div className="form-grid booking-conversion-row">
                  <Field label="기준통화">
                    <div className="fixed-currency" aria-label="기준통화 고정">
                      {profile.baseCurrency}
                    </div>
                  </Field>
                  <Field label="기준통화 환산 금액">
                    <input
                      aria-label="기준통화 환산 금액"
                      inputMode="decimal"
                      value={counterpart}
                      onChange={(e) => {
                        setCounterpart(e.target.value);
                        setManualCounterpart(true);
                      }}
                      placeholder={
                        paymentRate.error
                          ? "직접 입력"
                          : "자동 환산 · 수정 가능"
                      }
                    />
                  </Field>
                </div>
              )}
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

              {paid && (
                <section className="booking-payers">
                  <strong>누가 결제했나요?</strong>
                  <div>
                    {Array.from(
                      new Map(
                        [
                          ...workspace.members,
                          ...(
                            (linked?.data.payers as {
                              userId: string;
                              name: string;
                            }[]) || []
                          ).map((p) => ({ id: p.userId, name: p.name })),
                        ].map((m) => [m.id, m]),
                      ).values(),
                    ).map((m) => (
                      <label key={m.id}>
                        <input
                          type="checkbox"
                          checked={payerIds.includes(m.id)}
                          onChange={(e) =>
                            setPayerIds((ids) =>
                              e.target.checked
                                ? [...ids, m.id]
                                : ids.filter((id) => id !== m.id),
                            )
                          }
                        />
                        {m.name}
                      </label>
                    ))}
                  </div>
                  <strong className="booking-participants">
                    분담하는 사람
                  </strong>
                  <div className="booking-participant-options">
                    {Array.from(
                      new Map(
                        [
                          ...workspace.members,
                          ...(
                            (linked?.data.participants as {
                              userId: string;
                              name: string;
                            }[]) || []
                          ).map((p) => ({ id: p.userId, name: p.name })),
                        ].map((m) => [m.id, m]),
                      ).values(),
                    ).map((m) => (
                      <label key={m.id}>
                        <input
                          type="checkbox"
                          checked={participantIds.includes(m.id)}
                          onChange={(e) =>
                            setParticipantIds((ids) =>
                              e.target.checked
                                ? [...ids, m.id]
                                : ids.filter((id) => id !== m.id),
                            )
                          }
                        />
                        {m.name}
                      </label>
                    ))}
                  </div>
                  {payerIds.length > 1 && (
                    <small className="muted">
                      여러 명을 선택하면 결제 금액을 균등하게 나눠 기록해요.
                    </small>
                  )}
                  <small className="muted">
                    예약을 저장하면 경비에 바로 반영돼북
                  </small>
                </section>
              )}
              {linked && paid && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setPayment(true)}
                >
                  연결 경비 세부 수정
                </button>
              )}
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
              {busy ? "저장 중…" : step < lastStep ? "다음" : "예약 저장"}
            </button>
          </footer>
        </Form>
      )}
    </Dialog>
  );
}
