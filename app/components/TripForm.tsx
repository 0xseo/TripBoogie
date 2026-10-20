"use client";
import Form from "./Form";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, MapPin, Search, Trash2, Copy } from "lucide-react";
import { countryName } from "../countries";
import { ImagePicker, Photo, ImageCredit, loadDetails } from "./Media";
import type { Trip, TravelCity } from "../types";
import type { MapPlace } from "../server/maps";
import { useSearchLanguage } from "./SearchLanguage";
import { apiFetch as api, jsonRequest } from "../client-api";
import {
  Dialog,
  Field,
  CurrencySelect,
  RangeCalendar,
  days,
  dateLabel,
} from "./ui";
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
    [title, setTitle] = useState(trip?.title ?? ""),
    [cities, setCities] = useState<TravelCity[]>(trip?.settings.cities ?? []),
    [start, setStart] = useState(trip?.startDate ?? ""),
    [end, setEnd] = useState(trip?.endDate ?? ""),
    [currency, setCurrency] = useState(trip?.currency ?? "KRW"),
    [manualCurrency, setManualCurrency] = useState(false),
    [query, setQuery] = useState(trip?.destination || ""),
    [queryChanged, setQueryChanged] = useState(!trip?.settings.cities?.length),
    [results, setResults] = useState<MapPlace[]>([]),
    [searching, setSearching] = useState(false),
    [active, setActive] = useState(0),
    [searchError, setSearchError] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [imageCity, setImageCity] = useState<TravelCity | null>(null),
    [imagePending, setImagePending] = useState(0),
    [cityPeriod, setCityPeriod] = useState<string | null>(null);
  const sequence = useRef(0);
  const language = useSearchLanguage();
  useEffect(() => {
    if (step !== 0 || !queryChanged || query.trim().length < 2) return;
    const controller = new AbortController(),
      n = ++sequence.current;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError("");
      api<{ places: MapPlace[] }>(
        "/api/maps/autocomplete",
        jsonRequest(
          { query, type: "city", language },
          { signal: controller.signal }
        )
      )
        .then(async (r) => {
          if (!r.places.some((p) => p.countryCode && p.timezone))
            r = await api<{ places: MapPlace[] }>(
              "/api/maps/search",
              jsonRequest(
                { query, type: "city", language },
                { signal: controller.signal }
              )
            );
          if (sequence.current === n) {
            const valid = r.places.filter(
              (p) => !!p.countryCode && !!p.timezone
            );
            setResults(valid);
            if (!valid.length)
              setSearchError("도시를 찾지 못했어북. 이름을 다시 확인해북.");
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted && sequence.current === n)
            setSearchError(e.message);
        })
        .finally(() => {
          if (sequence.current === n) setSearching(false);
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (sequence.current === n) sequence.current = n + 1;
    };
  }, [query, language, step, queryChanged]);
  const duration = days(start, end).length,
    city = cities.find((c) => c.id === cityPeriod);
  function changeRange(a: string, b: string) {
    setCities((rows) =>
      rows.map((c) => ({
        ...c,
        startDate: !c.startDate || c.startDate === start ? a : c.startDate,
        endDate: !c.endDate || c.endDate === end ? b : c.endDate,
      }))
    );
    setStart(a);
    setEnd(b);
  }
  function add(p: MapPlace) {
    if (cities.length >= 20) {
      setSearchError("최대 20개 도시까지 선택할 수 있어북");
      return;
    }
    if (
      cities.some(
        (c) =>
          Math.abs(c.lat - p.lat) < 0.001 && Math.abs(c.lng - p.lng) < 0.001
      )
    ) {
      setQuery("");
      setResults([]);
      return;
    }
    if (!cities.length && !manualCurrency) setCurrency(p.currency || "");
    const id = crypto.randomUUID();
    setCities([
      ...cities,
      {
        ...p,
        id,
        countryCode: p.countryCode!,
        timezone: p.timezone!,
        currency: p.currency || "",
        startDate: start,
        endDate: end,
      },
    ]);
    setQuery("");
    setResults([]);
    setSearching(false);
    setImagePending((n) => n + 1);
    void loadDetails(p, "city")
      .then((details) =>
        setCities((rows) =>
          rows.map((c) =>
            c.id === id && c.image === undefined
              ? details.photos[0]
                ? { ...c, image: details.photos[0] }
                : c
              : c
          )
        )
      )
      .catch(() => {})
      .finally(() => setImagePending((n) => n - 1));
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
  const placeNames = cities.map((c) => c.name).join(" · ");
  return (
    <Dialog
      mobilePage
      title={city ? `${city.name} 방문 기간` : trip ? "여행 수정" : "새 여행"}
      onClose={onClose}
      wide
    >
      {imageCity && (
        <ImagePicker
          place={imageCity}
          onClose={() => setImageCity(null)}
          onChoose={(image) => {
            setCities((rows) =>
              rows.map((c) =>
                c.id === imageCity.id
                  ? { ...c, image, imageDisabled: image === null }
                  : c
              )
            );
            setImageCity(null);
          }}
        />
      )}
      <Form
        className="stack wizard"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trip && step < 2 && !city) {
            if (step === 0 && !cities.length && !trip) {
              setError("도시를 선택하세요.");
              return;
            }
            if (step === 1 && (!start || !end)) {
              setError("여행 기간을 선택하세요.");
              return;
            }
            setError("");
            setStep(step + 1);
            return;
          }
          if (city) return;
          void act(async () => {
            if (!cities.length && !trip)
              throw new Error("먼저 여행 도시를 선택하세요.");
            if (!currency) throw new Error("여행 기본 통화를 선택하세요.");
            if (!duration) throw new Error("여행 기간을 선택하세요.");
            await onSave({
              title: title.trim() || `${placeNames} 여행`,
              destination: placeNames || trip?.destination,
              startDate: start,
              endDate: end,
              currency,
              timezone: cities[0]?.timezone || trip?.timezone || "Asia/Seoul",
              shiftDates: true,
              cities: cities.map((c) => ({
                ...c,
                currency: c.currency || currency,
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
        {!city && (
          <nav className="wizard-steps" aria-label="여행 만들기 단계">
            {(trip
              ? ["도시", "날짜", "여행 정보"]
              : ["도시", "날짜", "확인"]
            ).map((s, i) => (
              <button
                type="button"
                key={s}
                className={step === i ? "active" : ""}
                onClick={() => setStep(i)}
              >
                {trip ? s : `${i + 1}. ${s}`}
              </button>
            ))}
          </nav>
        )}
        {city ? (
          <>
            <RangeCalendar
              start={city.startDate || start}
              end={city.endDate || end}
              min={start}
              max={end}
              onChange={(a, b) =>
                setCities(
                  cities.map((c) =>
                    c.id === city.id ? { ...c, startDate: a, endDate: b } : c
                  )
                )
              }
            />
            <button
              type="button"
              className="primary"
              disabled={!city.startDate || !city.endDate}
              onClick={() => setCityPeriod(null)}
            >
              방문 기간 적용
            </button>
          </>
        ) : (
          <>
            {step === 0 && (
              <>
                <div className="searchbox">
                  <Search size={20} />
                  <input
                    autoFocus
                    aria-label="여행 도시 검색"
                    placeholder="어디로 떠나나요?"
                    value={query}
                    onChange={(e) => {
                      setQueryChanged(true);
                      setQuery(e.target.value);
                      setResults([]);
                      setActive(0);
                      if (e.target.value.trim().length < 2) {
                        setSearching(false);
                        setResults([]);
                        setSearchError("");
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setResults([]);
                        return;
                      }
                      if (!results.length) return;
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        setActive(
                          (active +
                            (e.key === "ArrowDown" ? 1 : results.length - 1)) %
                            results.length
                        );
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        add(results[active] || results[0]);
                      }
                    }}
                    aria-activedescendant={
                      results.length ? `city-option-${active}` : undefined
                    }
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={results.length > 0}
                    aria-controls="city-suggestions"
                  />
                  {searching && <span className="spinner" />}
                </div>
                {results.length > 0 && (
                  <ul
                    className="suggestions"
                    role="listbox"
                    id="city-suggestions"
                  >
                    {results.map((p, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          role="option"
                          id={`city-option-${i}`}
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
                {searchError && <p className="info">{searchError}</p>}
                <div className="city-list">
                  {cities.map((c) => (
                    <div className="city-chip" key={c.id}>
                      {c.image ? (
                        <Photo
                          image={c.image}
                          alt={`${c.name} 대표 이미지`}
                          className="city-thumbnail"
                        />
                      ) : (
                        <MapPin size={18} />
                      )}
                      <span>
                        <strong>{c.name}</strong>
                        <small>{countryName(c.countryCode)}</small>
                      </span>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setImageCity(c)}
                      >
                        사진 변경
                      </button>
                      <button
                        type="button"
                        className="icon"
                        aria-label={`${c.name} 제외`}
                        onClick={() => {
                          const next = cities.filter((x) => x.id !== c.id);
                          setCities(next);
                          if (!manualCurrency)
                            setCurrency(next[0]?.currency || "KRW");
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </div>
                {imagePending > 0 && (
                  <small className="muted">
                    도시 대표 이미지를 찾는 중이에요…
                  </small>
                )}
                {cities
                  .filter((c) => c.image)
                  .map((c) => (
                    <ImageCredit key={c.id} image={c.image!} />
                  ))}
              </>
            )}
            {step === 1 && (
              <>
                <RangeCalendar start={start} end={end} onChange={changeRange} />
              </>
            )}
            {step === 2 && (
              <>
                <Field label="여행 이름">
                  <input
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={
                      placeNames ? `${placeNames} 여행` : "여행 이름"
                    }
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
                  <div className="compact-detail-row">
                    <span>방문 도시</span>
                    <div>
                      {cities.length
                        ? cities.map((c) => (
                            <button
                              key={c.id}
                              className="city-name-chip"
                              type="button"
                              aria-label={`${c.name} 방문 기간 수정`}
                              onClick={() => setCityPeriod(c.id)}
                            >{`${countryName(c.countryCode)} ${
                              c.name
                            }`}</button>
                          ))
                        : trip?.destination}
                    </div>
                  </div>
                </section>
                <Field label="여행 기본 통화">
                  <CurrencySelect
                    value={currency}
                    onChange={(c) => {
                      setCurrency(c);
                      setManualCurrency(true);
                    }}
                  />
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

              {!trip && step < 2 ? (
                <button
                  type="submit"
                  className="primary"
                  disabled={
                    busy ||
                    (step === 0 && !cities.length && !trip) ||
                    (step === 1 && (!start || !end))
                  }
                >
                  다음
                  <ArrowRight size={17} />
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy || !start || !end || (!cities.length && !trip)}
                >
                  {busy ? "저장 중…" : trip ? "변경 저장" : "여행 만들기"}
                </button>
              )}
            </footer>
          </>
        )}
      </Form>
    </Dialog>
  );
}
