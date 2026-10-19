"use client";
import { useEffect, useState } from "react";
import {
  CloudSun,
  Clock,
  MapPin,
  LoaderCircle,
  ArrowRightLeft,
  RefreshCw,
} from "lucide-react";
import { useRate } from "./Expenses";
import type { Profile, Workspace } from "../types";
import { travelContext } from "../travel-context";
import { apiFetch as api, jsonRequest } from "../client-api";
import { dateLabel, localDate } from "./ui";
type Weather = {
  timezone: string | null;
  message: string;
  daily: {
    date: string;
    code: number | null;
    high: number | null;
    low: number | null;
    rain: number | null;
    mean?: number | null;
    rainMm?: number | null;
  }[];
};
const cache = new Map<
  string,
  {
    at: number;
    weather: Weather;
    outlook: Weather | null;
  }
>();
const label = (code: number | null) =>
  code === null
    ? "—"
    : code === 0
    ? "맑음"
    : code <= 3
    ? "구름"
    : code <= 48
    ? "안개"
    : code <= 67
    ? "비"
    : code <= 77
    ? "눈"
    : code <= 82
    ? "소나기"
    : code <= 86
    ? "눈"
    : "뇌우";
function offsetAt(date: Date, zone: string) {
  const value =
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = value.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
export default function Tools({
  workspace,
  profile,
  readOnly,
  onTripSettings,
}: {
  workspace: Workspace;
  profile: Profile;
  readOnly: boolean;
  onTripSettings: () => void;
}) {
  const rate = useRate(workspace.trip.currency, profile.baseCurrency);
  const [cityId, setCityId] = useState(""),
    [now, setNow] = useState<Date | null>(null),
    [state, setState] = useState<{
      key: string;
      weather: Weather;
      outlook: Weather | null;
    } | null>(null),
    [error, setError] = useState("");
  const { cities, city, location, start, end, timezone } = travelContext(
    workspace.trip,
    { cityId }
  );
  const key = JSON.stringify([
    location?.lat,
    location?.lng,
    start,
    end,
    city?.timezone,
  ]);
  const current = state?.key === key ? state : cache.get(key),
    weather = current?.weather,
    outlook = current?.outlook,
    zone = city?.timezone || weather?.timezone || timezone;
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = setInterval(update, 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!location) return;
    const saved = cache.get(key);
    if (saved && new Date().getTime() - saved.at < 600000) return;
    const controller = new AbortController();
    let active = true;
    const body = { lat: location.lat, lng: location.lng, start, end };
    const first = new Date(new Date().getTime() + 16 * 86400000)
        .toISOString()
        .slice(0, 10),
      last = new Date(new Date().getTime() + 45 * 86400000)
        .toISOString()
        .slice(0, 10);
    const forecast = api<Weather>(
      "/api/tools",
      jsonRequest(
        { operation: "weather", ...body },
        { signal: controller.signal }
      )
    );
    const long =
      end >= first && start <= last
        ? api<Weather>(
            "/api/tools",
            jsonRequest(
              { operation: "outlook", ...body, timezone: city?.timezone },
              { signal: controller.signal }
            )
          ).catch(() => null)
        : Promise.resolve(null);
    let received: Weather | undefined,
      longRange: Weather | null = null;
    const publish = (weather: Weather, outlook: Weather | null) => {
      if (!active) return;
      if (cache.size >= 20) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: new Date().getTime(), weather, outlook });
      setState({ key, weather, outlook });
      setError("");
    };
    void forecast
      .then((weather) => {
        received = weather;
        publish(weather, longRange);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    void long.then((outlook) => {
      longRange = outlook;
      if (received) publish(received, outlook);
    });
    return () => {
      active = false;
      controller.abort();
    };
    // Location and visit dates uniquely own a forecast request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const diff =
    (offsetAt(localDate(start), zone) -
      offsetAt(
        localDate(start),
        Intl.DateTimeFormat().resolvedOptions().timeZone
      )) /
    60;
  return (
    <section className="travel-tools">
      {cities.length > 1 && (
        <nav className="tools-cities" aria-label="도시 선택">
          {cities.map((c) => (
            <button
              type="button"
              key={c.id}
              aria-pressed={city?.id === c.id}
              onClick={() => setCityId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </nav>
      )}
      <article className="local-clock">
        <span className="clock-icon">
          <Clock size={22} />
        </span>
        <div>
          <span>
            {city?.name || location?.name || workspace.trip.destination}
          </span>
          <strong>
            {now
              ? now.toLocaleTimeString("en-GB", {
                  timeZone: zone,
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </strong>
        </div>
        <small>
          {diff === 0
            ? "시차 없음"
            : `${Math.abs(diff)}시간 ${diff > 0 ? "빠름" : "느림"}`}
        </small>
      </article>
      <article className="compact-weather">
        <header>
          <div>
            <CloudSun size={19} />
            <h2>날씨</h2>
          </div>
          <span>
            {dateLabel(start)} – {dateLabel(end)}
          </span>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!location ? (
          <div className="tools-empty">
            <MapPin size={22} />
            <p>도시를 선택해북</p>
            <button
              type="button"
              className="secondary"
              disabled={readOnly}
              onClick={onTripSettings}
            >
              여행 수정
            </button>
          </div>
        ) : !weather && !error ? (
          <div
            className="tools-loading"
            role="status"
            aria-label="날씨 확인 중"
          >
            <LoaderCircle className="spinner" size={20} />
          </div>
        ) : null}
        {weather?.daily.length ? (
          <div className="compact-weather-days">
            {weather.daily.map((d) => (
              <div key={d.date}>
                <small>{dateLabel(d.date)}</small>
                <CloudSun size={23} />
                <strong>{label(d.code)}</strong>
                <span>
                  <b>{d.high ?? "—"}°</b> {d.low ?? "—"}°
                </span>
                <small>강수 {d.rain ?? "—"}%</small>
              </div>
            ))}
          </div>
        ) : weather ? (
          <p className="weather-message">아직 예보가 없어북</p>
        ) : null}
        {outlook && outlook.daily.length > 0 && (
          <details className="weather-outlook">
            <summary>장기 전망</summary>
            <p>앙상블 평균으로 실제 날씨와 달라질 수 있어북</p>
            <div className="compact-weather-days">
              {outlook.daily.map((d) => (
                <div key={d.date}>
                  <small>{dateLabel(d.date)}</small>
                  <strong>{d.mean ?? "—"}°</strong>
                  <small>{d.rainMm ?? "—"} mm</small>
                </div>
              ))}
            </div>
          </details>
        )}
      </article>
      <article className="compact-exchange">
        <ArrowRightLeft size={19} />
        <div>
          <h2>환율</h2>
          {rate.quote ? (
            <>
              <strong>
                1 {rate.quote.base} ={" "}
                {rate.quote.rate.toLocaleString("ko-KR", {
                  maximumFractionDigits: 4,
                })}{" "}
                {rate.quote.quote}
              </strong>
              {rate.quote.base !== rate.quote.quote && (
                <span className="inverse-rate">
                  1 {rate.quote.quote} ={" "}
                  {(1 / rate.quote.rate).toLocaleString("ko-KR", {
                    maximumFractionDigits: 6,
                  })}{" "}
                  {rate.quote.base}
                </span>
              )}
              <small>{rate.quote.date} 기준</small>
            </>
          ) : (
            <small>
              {rate.error || (
                <LoaderCircle
                  size={16}
                  className="spinner"
                  aria-label="환율 확인 중"
                />
              )}
            </small>
          )}
        </div>
        <button
          type="button"
          className="icon"
          aria-label="환율 새로고침"
          onClick={rate.refresh}
        >
          <RefreshCw size={17} />
        </button>
      </article>
    </section>
  );
}
