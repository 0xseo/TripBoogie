"use client";
import Form from "./Form";
import BookingIcon from "./BookingIcon";
import { bookingTitle } from "../booking-display";
import {
  expenseCategories,
  bookingExpenseCategory,
} from "../expense-categories";
import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2, ArrowRightLeft } from "lucide-react";
import type { Workspace, ItemRecord, Profile } from "../types";
import { apiFetch as api, jsonRequest } from "../client-api";
import {
  convert,
  units,
  decimal,
  splitAmount,
  currencyDigits,
  paidExpenseTotals,
  expenseBaseTotal,
} from "../money";
import { Dialog, Field, Empty, text, days, dateLabel, money } from "./ui";
import {
  tripCountries,
  tripCurrencies,
  currencyForDate,
} from "../trip-destinations";
import { countryCurrencies, countryName } from "../countries";
import ChoiceField from "./ChoiceField";
import AddButton from "./AddButton";
import FeatureToolbar from "./FeatureToolbar";
import type { Category } from "../types";
export type Quote = { base: string; quote: string; rate: number; date: string };
export function useRate(
  base: string,
  quote: string,
  onQuote?: (q: Quote) => void,
  enabled = true,
) {
  const callback = useRef(onQuote);
  useEffect(() => {
    callback.current = onQuote;
  }, [onQuote]);
  const [value, setValue] = useState<Quote | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    (base === quote
      ? Promise.resolve({
          base,
          quote,
          rate: 1,
          date: new Date().toISOString().slice(0, 10),
        })
      : api<Quote>(
          "/api/tools",
          jsonRequest({ operation: "rate", base, quote }),
        )
    )
      .then((r) => {
        if (active) {
          setValue(r);
          setError("");
          callback.current?.(r);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, quote, retry, enabled]);
  return {
    quote:
      enabled && value?.base === base && value.quote === quote ? value : null,
    error,
    refresh: () => setRetry((n) => n + 1),
  };
}
function effectivePeriod(r: ItemRecord, w: Workspace) {
  if (r.data.period === "before" || r.data.period === "after")
    return r.data.period;
  const d = text(r.data.date);
  return d < w.trip.startDate ? "before" : d > w.trip.endDate ? "after" : d;
}
type Person = { userId: string; name: string; amount?: string | number };
export default function Expenses({
  workspace,
  profile,
  date,
  readOnly,
  onSave,
  onDelete,
  onBooking,
  focused = "",
}: {
  workspace: Workspace;
  profile: Profile;
  date: string;
  readOnly: boolean;
  onSave: (data: Record<string, unknown>, record?: ItemRecord) => Promise<void>;
  onDelete: (r: ItemRecord) => void;
  onBooking?: (id: string) => void;
  focused?: string;
}) {
  const [period, setPeriod] = useState("all"),
    [editing, setEditing] = useState<ItemRecord | "new" | null>(null);
  useEffect(() => {
    if (focused)
      document
        .getElementById(`expense-${focused}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);
  const categories = expenseCategories(workspace.trip.settings);
  const all = workspace.records.filter((r) => r.kind === "expense"),
    rows = all.filter(
      (r) => period === "all" || effectivePeriod(r, workspace) === period,
    );
  const [conversionRates, setConversionRates] = useState<{
    base: string;
    rates: Record<string, string>;
    key: string;
  }>({ base: profile.baseCurrency, rates: {}, key: "" });
  const neededCurrencies = expenseBaseTotal(rows, profile.baseCurrency)
      .missing.sort()
      .join(","),
    conversionKey = profile.baseCurrency + ":" + neededCurrencies,
    converting = !!neededCurrencies && conversionRates.key !== conversionKey;
  useEffect(() => {
    if (!neededCurrencies) return;
    const controller = new AbortController();
    let active = true;
    void Promise.allSettled(
      neededCurrencies.split(",").map(async (base) => {
        const quote = await api<Quote>(
          "/api/tools",
          jsonRequest(
            { operation: "rate", base, quote: profile.baseCurrency },
            { signal: controller.signal },
          ),
        );
        return [base, String(Number(quote.rate.toFixed(6)))] as const;
      }),
    ).then((results) => {
      if (active) {
        setConversionRates({
          base: profile.baseCurrency,
          rates: Object.fromEntries(
            results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
          ),
          key: conversionKey,
        });
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [neededCurrencies, profile.baseCurrency, conversionKey]);
  const actualTotals = paidExpenseTotals(rows, workspace.trip.currency),
    totals = [
      ...new Set([
        ...tripCurrencies(workspace.trip),
        profile.baseCurrency,
        ...actualTotals.map((t) => t.currency),
      ]),
    ].map((currency) => ({
      currency,
      amount: actualTotals.find((t) => t.currency === currency)?.amount || "0",
    })),
    baseTotal = expenseBaseTotal(
      rows,
      profile.baseCurrency,
      conversionRates.base === profile.baseCurrency
        ? conversionRates.rates
        : {},
    );
  const periodLabel = (r: ItemRecord) =>
    effectivePeriod(r, workspace) === "before"
      ? "여행 전"
      : effectivePeriod(r, workspace) === "after"
        ? "여행 후"
        : `DAY ${
            days(workspace.trip.startDate, workspace.trip.endDate).indexOf(
              text(r.data.date),
            ) + 1
          }`;
  return (
    <section className="feature">
      <FeatureToolbar
        tabs
        action={
          <AddButton
            label="경비 추가"
            disabled={readOnly}
            onClick={() => setEditing("new")}
          />
        }
      >
        <div className="period-tabs">
          <button
            className={period === "all" ? "active" : ""}
            onClick={() => setPeriod("all")}
          >
            여행 전체
          </button>
          <button
            className={period === "before" ? "active" : ""}
            onClick={() => setPeriod("before")}
          >
            여행 전
          </button>
          {days(workspace.trip.startDate, workspace.trip.endDate).map(
            (d, i) => (
              <button
                key={d}
                className={period === d ? "active" : ""}
                onClick={() => setPeriod(d)}
              >
                DAY {i + 1}
              </button>
            ),
          )}
          <button
            className={period === "after" ? "active" : ""}
            onClick={() => setPeriod("after")}
          >
            여행 후
          </button>
        </div>
      </FeatureToolbar>
      <div className="expense-summary">
        <span>
          사용금액 (
          {baseTotal.missing.length
            ? converting
              ? "환산 중…"
              : "환산 확인 필요"
            : `${profile.baseCurrency} ${money(baseTotal.amount, profile.baseCurrency, "narrowSymbol")}`}
          )
        </span>
        {baseTotal.live && (
          <small className="muted">
            기준통화가 다른 이전 기록은 현재 환율로 환산했어요.
          </small>
        )}
        <div className="expense-totals">
          {totals.map((t) => (
            <strong
              key={t.currency}
              data-currency={t.currency}
              data-kind={
                t.currency === profile.baseCurrency
                  ? "base"
                  : t.currency === workspace.trip.currency
                    ? "trip"
                    : "other"
              }
            >
              <span className="currency-code">{t.currency}</span>{" "}
              {money(t.amount, t.currency, "narrowSymbol")}
            </strong>
          ))}
        </div>
      </div>
      <div className="record-list">
        {rows.map((r) => {
          const d = r.data,
            payers = Array.isArray(d.payers) ? (d.payers as Person[]) : [],
            participants = Array.isArray(d.participants) ? d.participants : [],
            booking = workspace.records.find(
              (b) => b.kind === "booking" && b.id === d.bookingId,
            );
          return (
            <article
              className="expense-row"
              key={r.id}
              id={`expense-${r.id}`}
              data-focused={focused === r.id}
            >
              {booking ? (
                <button
                  type="button"
                  className="record-icon icon"
                  aria-label={`${text(booking.data.title)} 예약 열기`}
                  onClick={() => onBooking?.(booking.id)}
                >
                  <BookingIcon type={booking.data.type} />
                </button>
              ) : (
                <div className="record-icon">₩</div>
              )}
              <div className="record-body">
                <small>
                  {periodLabel(r)} ·{" "}
                  {categories.find((c) => c.id === d.category)?.label ||
                    text(d.category, "기타")}{" "}
                  {booking && (
                    <button
                      type="button"
                      className="expense-booking-link"
                      onClick={() => onBooking?.(booking.id)}
                    >
                      예약
                    </button>
                  )}
                </small>
                <h3>{text(d.title)}</h3>
                <p>
                  {payers.length
                    ? payers
                        .map(
                          (p) =>
                            `${p.name} ${money(p.amount, text(d.paidCurrency))}`,
                        )
                        .join(" · ")
                    : text(d.payer)}{" "}
                  결제 · {participants.length}명 분담
                </p>
                {d.model !== 2 && <small>이전 형식 · 원래 금액 유지</small>}
              </div>
              <div className="amount">
                <strong>
                  {money(
                    d.model === 2
                      ? d.paidCurrency === d.tripCurrency
                        ? d.tripAmount
                        : d.baseAmount
                      : d.amount,
                    text(d.paidCurrency, text(d.currency)),
                  )}
                </strong>
                {d.model === 2 && d.paidCurrency !== d.baseCurrency && (
                  <small>{money(d.baseAmount, text(d.baseCurrency))}</small>
                )}
              </div>
              <div className="row-actions">
                <button
                  className="icon"
                  aria-label={`${text(d.title)} 수정`}
                  disabled={readOnly}
                  onClick={() => setEditing(r)}
                >
                  <Pencil size={17} />
                </button>
                <button
                  className="icon"
                  aria-label={`${text(d.title)} 삭제`}
                  disabled={readOnly}
                  onClick={() => onDelete(r)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!rows.length && (
        <Empty title="첫 경비를 기록해북">
          결제한 통화와 나눌 동행을 골라북
        </Empty>
      )}

      {editing && (
        <ExpenseForm
          workspace={workspace}
          profile={profile}
          record={editing === "new" ? undefined : editing}
          categories={categories}
          initialPeriod={period === "all" ? "day" : period}
          initialDate={date}
          onClose={() => setEditing(null)}
          onSave={(data) =>
            onSave(data, editing === "new" ? undefined : editing)
          }
        />
      )}
    </section>
  );
}
export function ExpenseForm({
  workspace,
  profile,
  record,
  initialData,
  categories: savedCategories,
  initialPeriod,
  initialDate,
  onSave,
  onClose,
}: {
  workspace: Workspace;
  profile: Profile;
  record?: ItemRecord;
  initialData?: Record<string, unknown>;
  categories: Category[];
  initialPeriod: string;
  initialDate: string;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const categories = expenseCategories({
    ...workspace.trip.settings,
    expenseCategories: savedCategories,
  });
  const d = record?.data ?? initialData ?? {},
    old = !!record && d.model !== 2;
  const [bookingId, setBookingId] = useState(text(d.bookingId));
  const linkedBooking = workspace.records.find(
    (r) => r.kind === "booking" && r.id === bookingId,
  );
  const [tripCurrency, setTripCurrency] = useState(() =>
      text(
        d.tripCurrency,
        old ? text(d.currency) : currencyForDate(workspace.trip, initialDate),
      ),
    ),
    [baseCurrency] = useState(() => text(d.baseCurrency, profile.baseCurrency));
  const [country, setCountry] = useState(
    text(
      d.countryCode,
      (workspace.trip.settings.cities || []).find(
        (c) =>
          c.startDate <= initialDate && c.endDate >= initialDate && !c.transit,
      )?.countryCode ||
        tripCountries(workspace.trip)[0] ||
        "",
    ),
  );
  const [paid, setPaid] = useState(text(d.paidCurrency, tripCurrency)),
    [title, setTitle] = useState(text(d.title)),
    [category, setCategory] = useState(
      text(d.category, categories[0]?.id ?? "other"),
    ),
    [a, setA] = useState(String(d.tripAmount ?? d.amount ?? "")),
    [b, setB] = useState(
      String(
        d.baseAmount ?? (tripCurrency === baseCurrency ? (d.amount ?? "") : ""),
      ),
    ),
    [rate, setRate] = useState(
      String(d.exchangeRate ?? (tripCurrency === baseCurrency ? 1 : "")),
    ),
    [rateDate, setRateDate] = useState(text(d.rateDate)),
    [period, setPeriod] = useState(
      record
        ? effectivePeriod(record, workspace) === "before"
          ? "before"
          : effectivePeriod(record, workspace) === "after"
            ? "after"
            : "day"
        : initialPeriod === "before" || initialPeriod === "after"
          ? initialPeriod
          : "day",
    ),
    [date, setDate] = useState(
      text(d.date, initialPeriod.length === 10 ? initialPeriod : initialDate),
    ),
    [note, setNote] = useState(text(d.note));
  const basePaid = paid === baseCurrency;
  const paidAmount = basePaid ? b : a;
  const equal = (
    rows: Person[],
    amount = paidAmount,
    currency = paid,
  ): Person[] => {
    try {
      const values = splitAmount(
        amount || "0",
        rows.length,
        currencyDigits(currency),
      );
      return rows.map((p, i) => ({ ...p, amount: values[i] }));
    } catch {
      return rows.map((p) => ({ ...p, amount: "" }));
    }
  };
  const [payers, setPayers] = useState<Person[]>(() =>
      Array.isArray(d.payers)
        ? (d.payers as Person[])
        : [
            {
              userId: profile.id,
              name: profile.name,
              amount: String(
                paid === tripCurrency
                  ? (d.tripAmount ?? d.amount ?? "0")
                  : (d.baseAmount ?? "0"),
              ),
            },
          ],
    ),
    [participants, setParticipants] = useState<Person[]>(() => {
      const rows: Person[] =
        Array.isArray(d.participants) && d.model === 2
          ? (d.participants as Person[])
          : workspace.members.map((m) => ({ userId: m.id, name: m.name }));
      return rows.every((p) => p.amount !== undefined) ? rows : equal(rows);
    });
  const isEqual = (rows: Person[]) => {
    const expected = equal(rows);
    return rows.every(
      (p, i) => String(p.amount) === String(expected[i].amount),
    );
  };
  const [payerEqual, setPayerEqual] = useState(
      () => !record || isEqual(payers),
    ),
    [shareEqual, setShareEqual] = useState(
      () => !record || isEqual(participants),
    ),
    [screen, setScreen] = useState<
      "money" | "people" | "payers" | "participants" | "rate"
    >("money"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const initialized = useRef(!!record || !!d.exchangeRate);
  const current = useRate(
    tripCurrency,
    baseCurrency,
    (quote) => {
      if (
        !initialized.current &&
        quote &&
        quote.base === tripCurrency &&
        quote.quote === baseCurrency
      ) {
        initialized.current = true;
        setRate(String(Number(quote.rate.toFixed(6))));
        setRateDate(quote.date);
        if (paidAmount && (paid === tripCurrency ? b === "" : a === "")) {
          try {
            const converted = convert(
              paidAmount,
              String(Number(quote.rate.toFixed(6))),
              paid !== tripCurrency,
            );
            if (paid === tripCurrency) setB(converted);
            else setA(converted);
          } catch {
            /* Incomplete amounts stay editable. */
          }
        }
      }
    },
    !basePaid,
  );
  const people = Array.from(
    new Map(
      [
        ...workspace.members.map((m) => ({ userId: m.id, name: m.name })),
        ...payers,
        ...participants,
      ].map((p) => [p.userId, p]),
    ).values(),
  );
  function changeLocalCurrency(next: string) {
    if (next === tripCurrency) return;
    initialized.current = next === baseCurrency;
    setTripCurrency(next);
    setRate(next === baseCurrency ? "1" : "");
    setRateDate("");
    if (next === baseCurrency) {
      setA(paidAmount);
      setB(paidAmount);
      setPaid(next);
    } else if (paid === baseCurrency) setA("");
    else {
      setPaid(next);
      setB("");
    }
  }
  function changeCountry(code: string) {
    setCountry(code);
    changeLocalCurrency(currencyForDate(workspace.trip, date, code));
  }
  function changeAmount(value: string, currency: string) {
    const isTrip = currency === tripCurrency;
    if (isTrip) setA(value);
    else setB(value);
    try {
      if (!basePaid && currency === paid && value !== "" && rate) {
        const converted = convert(value, rate, !isTrip);
        if (isTrip) setB(converted);
        else setA(converted);
      }
      if (tripCurrency === baseCurrency) {
        setA(value);
        setB(value);
      }
      if (currency === paid) {
        if (payerEqual) setPayers(equal(payers, value));
        if (shareEqual) setParticipants(equal(participants, value));
      }
    } catch {
      /* Partially typed money remains editable. */
    }
  }
  function applyRate(value: string, dateValue: string) {
    initialized.current = true;
    try {
      units(value);
      setRate(value);
      setRateDate(dateValue);
      if (paidAmount) {
        const v = convert(paidAmount, value, paid !== tripCurrency);
        if (paid === tripCurrency) setB(v);
        else setA(v);
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const rows = screen === "payers" ? payers : participants,
    setRows = screen === "payers" ? setPayers : setParticipants,
    setEqualMode = screen === "payers" ? setPayerEqual : setShareEqual;
  function validateRows(values: Person[], label: string) {
    if (!values.length) throw new Error(`${label}를 선택하세요.`);
    if (
      values.reduce((sum, p) => sum + units(p.amount), BigInt(0)) !==
      units(paidAmount)
    )
      throw new Error(`${label} 금액 합계가 결제 금액과 같아야 해요.`);
  }
  const navigate = (next: typeof screen) => {
    setError("");
    setScreen(next);
  };
  let difference = "";
  try {
    const diff =
      units(paidAmount) -
      rows.reduce((sum, p) => sum + units(p.amount), BigInt(0));
    difference =
      diff === BigInt(0)
        ? "합계가 맞아요"
        : diff > BigInt(0)
          ? `${money(decimal(diff), paid)} 더 배분하세요`
          : `${money(decimal(-diff), paid)} 초과했어요`;
  } catch {
    difference = "금액을 확인하세요";
  }
  return (
    <Dialog
      mobilePage
      title={
        screen === "payers"
          ? "결제자별 금액 수정"
          : screen === "participants"
            ? "함께 나눌 금액 수정"
            : screen === "rate"
              ? "환율 수정"
              : record
                ? "경비 수정"
                : "경비 기록"
      }
      onClose={onClose}
      wide
    >
      <Form
        className="stack wizard"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            if (screen === "money") {
              if (!title.trim()) throw new Error("경비 이름을 입력하세요.");
              if (units(paidAmount) <= BigInt(0))
                throw new Error("결제 금액을 입력해북");
              if (!basePaid) units(a);
              units(b);
              if (!basePaid && units(rate) <= BigInt(0))
                throw new Error("환율을 확인하세요.");
              navigate("people");
              return;
            }
            if (screen !== "people") return;
            validateRows(payers, "결제자");
            validateRows(participants, "분담자");
            setBusy(true);
            await onSave({
              model: 2,
              title,
              category,
              bookingId,
              bookingVersion: linkedBooking?.version,
              tripCurrency: basePaid ? baseCurrency : tripCurrency,
              baseCurrency,
              paidCurrency: paid,
              tripAmount: basePaid ? b : a,
              baseAmount: b,
              exchangeRate: basePaid ? "1" : rate,
              rateDate: basePaid ? "" : rateDate,
              period,
              date,
              note,
              countryCode: country,
              payers,
              participants,
            });
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {(screen === "money" || screen === "people") && (
          <nav className="wizard-steps" aria-label="경비 입력 단계">
            <button
              type="button"
              className={screen === "money" ? "active" : ""}
              onClick={() => navigate("money")}
            >
              1. 결제 금액
            </button>
            <button
              type="button"
              className={screen === "people" ? "active" : ""}
              onClick={() => {
                try {
                  units(paidAmount);
                  navigate("people");
                } catch {
                  setError("먼저 결제 금액을 입력해북");
                }
              }}
            >
              2. 함께 나누기
            </button>
          </nav>
        )}
        {screen === "money" && (
          <>
            <Field label="연결할 예약">
              <ChoiceField
                label="경비에 연결할 예약"
                value={bookingId}
                options={[
                  { id: "", label: "연결 안 함" },
                  ...workspace.records
                    .filter(
                      (r) =>
                        r.kind === "booking" &&
                        (!r.data.expenseId || r.data.expenseId === record?.id),
                    )
                    .map((r) => ({
                      id: r.id,
                      label: bookingTitle(r.data),
                      icon: <BookingIcon type={r.data.type} size={17} />,
                    })),
                ]}
                onChange={(id) => {
                  setBookingId(id);
                  const booking = workspace.records.find((r) => r.id === id);
                  if (!booking) return;
                  setCategory(bookingExpenseCategory(booking.data.type));
                  if (!title.trim()) setTitle(bookingTitle(booking.data));
                  if (
                    booking.data.moneyAmount != null &&
                    booking.data.moneyCurrency
                  ) {
                    const currency = String(booking.data.moneyCurrency),
                      amount = String(booking.data.moneyAmount);
                    setPaid(currency);
                    setTripCurrency(
                      currency === baseCurrency
                        ? currencyForDate(workspace.trip, date)
                        : currency,
                    );
                    setA(currency === baseCurrency ? "" : amount);
                    setB(currency === baseCurrency ? amount : "");
                    setRate(currency === baseCurrency ? "1" : "");
                    setRateDate("");
                    initialized.current = currency === baseCurrency;
                    if (
                      currency !== baseCurrency &&
                      current.quote?.base === currency
                    ) {
                      const q = String(Number(current.quote.rate.toFixed(6)));
                      setRate(q);
                      setRateDate(current.quote.date);
                      setB(convert(amount, q));
                      initialized.current = true;
                    }
                    if (payerEqual) setPayers(equal(payers, amount, currency));
                    if (shareEqual)
                      setParticipants(equal(participants, amount, currency));
                  }
                }}
              />
            </Field>
            <Field label="어디에 쓴 돈인가요?">
              <input
                required
                maxLength={300}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 첫날 저녁 식사"
              />
            </Field>
            <div className="form-grid">
              <Field label="사용 시점">
                <ChoiceField
                  label="사용 시점"
                  value={period === "day" ? date : period}
                  onChange={(value) => {
                    if (value === "before" || value === "after")
                      setPeriod(value);
                    else {
                      setPeriod("day");
                      setDate(value);
                      const city = (workspace.trip.settings.cities || []).find(
                        (c) =>
                          c.startDate <= value &&
                          c.endDate >= value &&
                          !c.transit,
                      );
                      if (city) {
                        setCountry(city.countryCode);
                        changeLocalCurrency(
                          city.currency ||
                            countryCurrencies[city.countryCode] ||
                            tripCurrency,
                        );
                      }
                    }
                  }}
                  options={[
                    { id: "before", label: "여행 전" },
                    ...days(
                      workspace.trip.startDate,
                      workspace.trip.endDate,
                    ).map((v, i) => ({
                      id: v,
                      label: `DAY ${i + 1} · ${dateLabel(v)}`,
                    })),
                    { id: "after", label: "여행 후" },
                  ]}
                />
              </Field>
              <Field label="분류">
                <ChoiceField
                  label="분류"
                  value={category}
                  options={[{ id: "", label: "미분류" }, ...categories]}
                  onChange={setCategory}
                />
              </Field>
            </div>
            <Field label="사용 국가">
              <ChoiceField
                label="사용 국가"
                value={country}
                options={[
                  ...new Set([...tripCountries(workspace.trip), country]),
                ]
                  .filter(Boolean)
                  .map((code) => ({ id: code, label: countryName(code) }))}
                onChange={changeCountry}
              />
            </Field>
            <div className="soft-panel">
              <Field label="실제로 결제한 통화">
                <ChoiceField
                  label="실제로 결제한 통화"
                  value={paid}
                  onChange={(c) => {
                    if (c !== baseCurrency) {
                      changeLocalCurrency(c);
                      if (c !== tripCurrency) {
                        setA(paidAmount);
                        setB("");
                      }
                      const code = tripCountries(workspace.trip).find(
                        (code) => countryCurrencies[code] === c,
                      );
                      if (code) setCountry(code);
                    }
                    if (c !== baseCurrency && paid === baseCurrency) {
                      initialized.current = false;
                      if (c === tripCurrency) {
                        setA(b);
                        setB("");
                        setRate("");
                      }
                    }
                    setPaid(c);
                    const value =
                      c === baseCurrency
                        ? b
                        : c === tripCurrency && paid !== baseCurrency
                          ? a
                          : paidAmount;
                    if (payerEqual) setPayers(equal(payers, value, c));
                    if (shareEqual)
                      setParticipants(equal(participants, value, c));
                  }}
                  options={Array.from(
                    new Set([
                      ...tripCurrencies(workspace.trip),
                      tripCurrency,
                      baseCurrency,
                    ]),
                  ).map((c) => ({ id: c, label: c }))}
                />
              </Field>
              <div className="form-grid currency-inputs">
                {[
                  paid,
                  ...(basePaid
                    ? []
                    : Array.from(new Set([tripCurrency, baseCurrency]))
                  ).filter((c) => c !== paid),
                ].map((c) => (
                  <Field
                    key={c}
                    label={`${c} · ${c === paid ? "결제 금액" : "환산 금액"}`}
                  >
                    <input
                      required
                      inputMode="decimal"
                      value={c === baseCurrency ? b : a}
                      onChange={(e) => changeAmount(e.target.value, c)}
                      placeholder="0"
                    />
                  </Field>
                ))}
              </div>
            </div>
            {!basePaid && (
              <button
                type="button"
                className="summary-button"
                onClick={() => navigate("rate")}
              >
                <ArrowRightLeft size={18} />
                <span>
                  <strong>
                    1 {tripCurrency} = {rate || "—"} {baseCurrency}
                    {rateDate && (
                      <small className="rate-date"> ({rateDate})</small>
                    )}
                  </strong>
                </span>
                <small>수정</small>
              </button>
            )}
            {old && (
              <small>이전 형식의 경비입니다. 환산 금액을 확인해 주세요.</small>
            )}
          </>
        )}
        {screen === "people" && (
          <>
            <div className="expense-total">
              <small>함께 나눌 결제 금액</small>
              <strong>{money(paidAmount, paid)}</strong>
            </div>
            {(["payers", "participants"] as const).map((kind) => {
              const list = kind === "payers" ? payers : participants;
              return (
                <section className="allocation-section" key={kind}>
                  <div className="section-heading">
                    <h3>
                      {kind === "payers"
                        ? "누가 결제했나요?"
                        : "함께 나눌 사람"}
                    </h3>
                    <button
                      type="button"
                      className="icon"
                      aria-label={
                        kind === "payers" ? "결제자 수정" : "분담자 수정"
                      }
                      onClick={() => navigate(kind)}
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                  <div className="allocation-cards">
                    {list.map((p) => (
                      <button
                        key={p.userId}
                        type="button"
                        className="allocation-card"
                        onClick={() => navigate(kind)}
                      >
                        <span className="avatar">{p.name.slice(0, 1)}</span>
                        <span>
                          {p.name}
                          <strong>{money(p.amount, paid)}</strong>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            <details className="expense-note">
              <summary>메모 추가</summary>
              <textarea
                aria-label="경비 메모"
                rows={2}
                maxLength={10000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </details>
            {(!payerEqual || !shareEqual) && (
              <small className="muted">
                사용자 지정 금액은 총액·통화를 바꾼 뒤 분배 화면에서 다시
                확인하세요.
              </small>
            )}
          </>
        )}
        {(screen === "payers" || screen === "participants") && (
          <>
            <div className="split-total">
              <strong>{money(paidAmount, paid)}</strong>
              <small role="status">{difference}</small>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setRows(equal(rows));
                  setEqualMode(true);
                }}
              >
                균등 분배
              </button>
            </div>
            <div className="people-grid">
              {people.map((p) => (
                <label className="person-check" key={p.userId}>
                  <input
                    type="checkbox"
                    checked={rows.some((x) => x.userId === p.userId)}
                    onChange={() => {
                      const next = rows.some((x) => x.userId === p.userId)
                        ? rows.filter((x) => x.userId !== p.userId)
                        : [...rows, p];
                      setRows(equal(next));
                      setEqualMode(true);
                    }}
                  />
                  <span className="avatar">{p.name.slice(0, 1)}</span>
                  {p.name}
                </label>
              ))}
            </div>
            <div className="allocation-inputs">
              {rows.map((p) => (
                <label className="allocation-input" key={p.userId}>
                  <span>{p.name}</span>
                  <input
                    aria-label={`${p.name} ${
                      screen === "payers" ? "결제" : "분담"
                    } 금액`}
                    inputMode="decimal"
                    value={String(p.amount ?? "")}
                    onChange={(e) => {
                      setRows(
                        rows.map((x) =>
                          x.userId === p.userId
                            ? { ...x, amount: e.target.value }
                            : x,
                        ),
                      );
                      setEqualMode(false);
                    }}
                  />
                  <small>{paid}</small>
                </label>
              ))}
            </div>
            <small className="muted">함께 나눌 사람을 골라북</small>
            <button
              type="button"
              className="primary"
              onClick={() => {
                try {
                  validateRows(rows, screen === "payers" ? "결제자" : "분담자");
                  navigate("people");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              분배 적용
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => navigate("people")}
            >
              금액 확인 화면으로
            </button>
          </>
        )}
        {screen === "rate" && (
          <>
            <Field label={`저장할 환율 · 1 ${tripCurrency} → ${baseCurrency}`}>
              <input
                required
                inputMode="decimal"
                value={rate}
                readOnly={tripCurrency === baseCurrency}
                onChange={(e) => {
                  initialized.current = true;
                  setRate(e.target.value);
                }}
              />
            </Field>
            {current.quote ? (
              <div className="info">
                현재 {current.quote.rate} · {current.quote.date}
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    applyRate(
                      String(Number(current.quote!.rate.toFixed(6))),
                      current.quote!.date,
                    )
                  }
                >
                  현재 환율 적용
                </button>
              </div>
            ) : (
              <p className="info">{current.error || "현재 환율 확인 중…"}</p>
            )}
            <p className="muted">
              환율을 적용하면 결제한 금액에서 환산 금액만 다시 계산해요.
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => {
                try {
                  if (units(rate) <= BigInt(0))
                    throw new Error("환율은 0보다 커야 해요.");
                  applyRate(rate, rateDate);
                  navigate("money");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              이 환율로 계산
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => navigate("money")}
            >
              결제 금액으로
            </button>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {(screen === "money" || screen === "people") && (
          <footer className="wizard-footer">
            <button className="primary" disabled={busy}>
              {busy
                ? "서버에 저장 중…"
                : screen === "money"
                  ? "함께 나누기"
                  : "경비 저장"}
            </button>
          </footer>
        )}
      </Form>
    </Dialog>
  );
}
