"use client";
import Form from "./Form";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, MapPin, Search, Trash2, Copy, Globe } from "lucide-react";
import {
  countryCodes,
  countryCurrencies,
  countryName,
  currenciesForCountry,
} from "../countries";
import { countryGroups, tripCountries } from "../trip-destinations";
import type { Trip, TravelCity } from "../types";
import type { MapPlace } from "../server/maps";
import { useSearchLanguage } from "./SearchLanguage";
import { apiFetch as api, jsonRequest } from "../client-api";
import { Dialog, Field, RangeCalendar, days, dateLabel } from "./ui";
export default function TripForm({
  trip,
  onSave,
  onClose,
  onCopy,
  onDelete,
}: {
  trip?: Trip;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  onCopy?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [step, setStep] = useState(trip ? 2 : 0),
    [title, setTitle] = useState(trip?.title || ""),
    [cities, setCities] = useState<TravelCity[]>(trip?.settings.cities || []),
    [countries, setCountries] = useState<string[]>(
      trip ? tripCountries(trip) : [],
    ),
    [start, setStart] = useState(trip?.startDate || ""),
    [end, setEnd] = useState(trip?.endDate || ""),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<MapPlace[]>([]),
    [searching, setSearching] = useState(false),
    [active, setActive] = useState(0),
    [searchError, setSearchError] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [cityPeriod, setCityPeriod] = useState<string | null>(null);
  const sequence = useRef(0),
    language = useSearchLanguage(),
    english = new Intl.DisplayNames(["en"], { type: "region" });
  const countryMatches =
    query.trim().length >= 2
      ? countryCodes
          .filter(
            (code) =>
              countryName(code)
                .toLowerCase()
                .includes(query.trim().toLowerCase()) ||
              english
                .of(code)
                ?.toLowerCase()
                .includes(query.trim().toLowerCase()) ||
              code === query.trim().toUpperCase(),
          )
          .slice(0, 6)
      : [];
  useEffect(() => {
    if (step !== 0 || query.trim().length < 2) return;
    const controller = new AbortController(),
      n = ++sequence.current;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError("");
      void api<{ places: MapPlace[] }>(
        "/api/maps/autocomplete",
        jsonRequest(
          { query, type: "city", language },
          { signal: controller.signal },
        ),
      )
        .then(async (r) => {
          if (!r.places.some((p) => p.countryCode && p.timezone))
            r = await api<{ places: MapPlace[] }>(
              "/api/maps/search",
              jsonRequest(
                { query, type: "city", language },
                { signal: controller.signal },
              ),
            );
          if (n === sequence.current) {
            setResults(r.places.filter((p) => p.countryCode && p.timezone));
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted && n === sequence.current)
            setSearchError(e.message);
        })
        .finally(() => {
          if (n === sequence.current) setSearching(false);
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (sequence.current === n) sequence.current = n + 1;
    };
  }, [query, language, step]);
  const city = cities.find((c) => c.id === cityPeriod),
    groups = countryGroups(cities, countries),
    currencies = [
      ...new Set(
        [
          ...cities.map((c) => c.currency || countryCurrencies[c.countryCode]),
          ...countries.flatMap((c) => currenciesForCountry(c)),
        ].filter(Boolean),
      ),
    ],
    currency = currencies[0] || trip?.currency || "KRW",
    duration = days(start, end).length;
  const destination =
    groups
      .map((g) =>
        g.cities.length
          ? `${g.name} | ${g.cities.map((c) => c.name + (c.transit ? "(환승)" : "")).join(", ")}`
          : g.name,
      )
      .join(" · ") ||
    trip?.destination ||
    "";
  function clearSearch() {
    setQuery("");
    setResults([]);
    setSearching(false);
    sequence.current++;
  }
  function addCountry(code: string) {
    if (!countries.includes(code)) setCountries([...countries, code]);
    clearSearch();
  }
  function add(p: MapPlace) {
    if (cities.length >= 20) {
      setSearchError("도시는 최대 20개까지 선택할 수 있어북");
      return;
    }
    if (
      !cities.some(
        (c) =>
          Math.abs(c.lat - p.lat) < 0.001 && Math.abs(c.lng - p.lng) < 0.001,
      )
    )
      setCities([
        ...cities,
        {
          ...p,
          id: crypto.randomUUID(),
          countryCode: p.countryCode!,
          timezone: p.timezone!,
          currency: p.currency || countryCurrencies[p.countryCode!] || currency,
          startDate: start,
          endDate: end,
        },
      ]);
    if (p.countryCode && !countries.includes(p.countryCode))
      setCountries([...countries, p.countryCode]);
    clearSearch();
  }
  function range(a: string, b: string) {
    setCities((rows) =>
      rows.map((c) => ({
        ...c,
        startDate: !c.startDate || c.startDate === start ? a : c.startDate,
        endDate: !c.endDate || c.endDate === end ? b : c.endDate,
      })),
    );
    setStart(a);
    setEnd(b);
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      mobilePage
      wide
      title={city ? `${city.name} 방문 기간` : trip ? "여행 수정" : "새 여행"}
      onClose={onClose}
    >
      <Form
        className="stack wizard trip-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (city) return;
          if (!trip && step < 2) {
            if (step === 0 && !groups.length) {
              setError("국가나 도시를 선택하세요.");
              return;
            }
            if (step === 1 && !duration) {
              setError("여행 기간을 선택하세요.");
              return;
            }
            setError("");
            setStep(step + 1);
            return;
          }
          void act(async () => {
            if (!groups.length && !trip)
              throw new Error("국가나 도시를 선택하세요.");
            if (!duration) throw new Error("여행 기간을 선택하세요.");
            await onSave({
              title: (
                title.trim() || `${groups.map((g) => g.name).join(" · ")} 여행`
              ).slice(0, 200),
              destination: destination.slice(0, 300),
              startDate: start,
              endDate: end,
              currency,
              timezone:
                cities[0]?.timezone ||
                trip?.timezone ||
                Intl.DateTimeFormat().resolvedOptions().timeZone ||
                "Asia/Seoul",
              countries,
              currencies,
              shiftDates: true,
              cities: cities.map((c) => ({
                ...c,
                currency:
                  c.currency || countryCurrencies[c.countryCode] || currency,
                startDate:
                  !c.startDate || c.startDate < start || c.startDate > end
                    ? start
                    : c.startDate,
                endDate:
                  !c.endDate || c.endDate > end || c.endDate < start
                    ? end
                    : c.endDate,
              })),
            });
          });
        }}
      >
        {city ? (
          <>
            <RangeCalendar
              start={city.startDate || start}
              end={city.endDate || end}
              min={start}
              max={end}
              onChange={(a, b) =>
                setCities((rows) =>
                  rows.map((c) =>
                    c.id === city.id ? { ...c, startDate: a, endDate: b } : c,
                  ),
                )
              }
            />
            <label className="inline">
              <input
                type="checkbox"
                checked={!!city.transit}
                onChange={(e) =>
                  setCities((rows) =>
                    rows.map((c) =>
                      c.id === city.id
                        ? { ...c, transit: e.target.checked }
                        : c,
                    ),
                  )
                }
              />
              환승으로 방문
            </label>
            <footer className="wizard-footer">
              <button
                type="button"
                className="primary"
                onClick={() => setCityPeriod(null)}
              >
                방문 기간 적용
              </button>
            </footer>
          </>
        ) : (
          <>
            <nav className="wizard-steps" aria-label="여행 만들기 단계">
              {["국가·도시", "날짜", trip ? "여행 정보" : "확인"].map(
                (label, i) => (
                  <button
                    type="button"
                    key={i}
                    className={step === i ? "active" : ""}
                    onClick={() => setStep(i)}
                  >
                    {trip ? label : `${i + 1}. ${label}`}
                  </button>
                ),
              )}
            </nav>
            {step === 0 && (
              <>
                <div className="searchbox">
                  <Search size={19} />
                  <input
                    autoFocus={!trip}
                    aria-label="여행 국가·도시 검색"
                    placeholder="뉴질랜드 또는 오클랜드처럼 검색해북"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setResults([]);
                      setActive(0);
                    }}
                    onKeyDown={(e) => {
                      if (!results.length) return;
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        setActive(
                          (active +
                            (e.key === "ArrowDown" ? 1 : results.length - 1)) %
                            results.length,
                        );
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        add(results[active] || results[0]);
                      }
                    }}
                  />
                  {searching && <span className="spinner" />}
                </div>
                {countryMatches.length > 0 && (
                  <div className="country-search-results">
                    {countryMatches.map((code) => (
                      <button
                        type="button"
                        key={code}
                        onClick={() => addCountry(code)}
                      >
                        <Globe size={18} />
                        <span>
                          {countryName(code)}
                          <small>국가만 선택 · 도시는 나중에 추가</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {results.length > 0 && (
                  <ul className="suggestions" role="listbox">
                    {results.map((p, i) => (
                      <li key={`${p.lat}-${p.lng}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active === i}
                          onClick={() => add(p)}
                        >
                          <MapPin size={18} />
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {p.address} · {p.currency}
                            </small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {searchError && !countryMatches.length && (
                  <p className="info">{searchError}</p>
                )}
                <p className="muted">
                  국가만 골라 여행을 만들고, 숙소나 장소를 입력하면서 도시를
                  추가할 수 있어북.
                </p>
                <div className="trip-country-groups">
                  {groups.map((g) => (
                    <section key={g.code}>
                      <header>
                        <strong>{g.name}</strong>
                        <button
                          type="button"
                          className="icon"
                          aria-label={`${g.name} 제외`}
                          onClick={() => {
                            setCountries(countries.filter((c) => c !== g.code));
                            setCities(
                              cities.filter((c) => c.countryCode !== g.code),
                            );
                          }}
                        >
                          <Trash2 size={17} />
                        </button>
                      </header>
                      <div>
                        {g.cities.length ? (
                          g.cities.map((c) => (
                            <span className="destination-city" key={c.id}>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => setCityPeriod(c.id)}
                              >
                                {c.name}
                                {c.transit ? "(환승)" : ""}
                              </button>
                              <button
                                type="button"
                                className="icon"
                                aria-label={`${c.name} 제외`}
                                onClick={() =>
                                  setCities(
                                    cities.filter((row) => row.id !== c.id),
                                  )
                                }
                              >
                                <Trash2 size={14} />
                              </button>
                            </span>
                          ))
                        ) : (
                          <small>도시 미정</small>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </>
            )}
            {step === 1 && (
              <RangeCalendar start={start} end={end} onChange={range} />
            )}
            {step === 2 && (
              <>
                <Field label="여행 이름">
                  <input
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={`${groups.map((g) => g.name).join(" · ")} 여행`}
                  />
                </Field>
                <section className="trip-period-summary">
                  <div className="trip-date-pair">
                    <div>
                      <small>출발</small>
                      <strong>{start ? dateLabel(start) : "날짜 선택"}</strong>
                    </div>
                    <span className="trip-length-badge">
                      {duration ? `${duration - 1}박 ${duration}일` : "→"}
                    </span>
                    <div>
                      <small>도착</small>
                      <strong>{end ? dateLabel(end) : "날짜 선택"}</strong>
                    </div>
                  </div>
                </section>
                <section className="trip-city-summary">
                  <span>방문 국가·도시</span>
                  <div className="grouped-city-summary">
                    {groups.map((g) => (
                      <div key={g.code}>
                        <strong>{g.name}</strong>
                        <span> | </span>
                        {g.cities.length ? (
                          g.cities.map((c, i) => (
                            <span key={c.id}>
                              {i > 0 ? ", " : ""}
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => setCityPeriod(c.id)}
                              >
                                {c.name}
                                {c.transit ? "(환승)" : ""}
                              </button>
                            </span>
                          ))
                        ) : (
                          <span>도시 미정</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                <Field label="여행 통화 · 방문 국가·도시 기준 자동 설정">
                  <div className="trip-currency-list">
                    {(currencies.length ? currencies : [currency]).map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </div>
                </Field>
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer className="wizard-footer">
              {trip && step === 2 && (
                <div className="settings-footer">
                  {onCopy && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(onCopy)}
                    >
                      <Copy size={17} />
                      여행 복사
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      className="danger-text"
                      disabled={busy}
                      onClick={() => void act(onDelete)}
                    >
                      <Trash2 size={17} />
                      여행 삭제
                    </button>
                  )}
                </div>
              )}
              <button
                className="primary"
                disabled={
                  busy ||
                  (!trip && step === 0 && !groups.length) ||
                  (!trip && step > 0 && !duration)
                }
              >
                {busy ? (
                  "저장 중…"
                ) : !trip && step < 2 ? (
                  <>
                    다음
                    <ArrowRight size={17} />
                  </>
                ) : trip ? (
                  "변경 저장"
                ) : (
                  "여행 만들기"
                )}
              </button>
            </footer>
          </>
        )}
      </Form>
    </Dialog>
  );
}
