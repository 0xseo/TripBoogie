"use client";
import { useEffect, useState } from "react";
import {
  CloudSun,
  Clock,
  MapPin,
  LoaderCircle,
  ArrowRightLeft,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { useRate } from "./Expenses";
import type { Profile, Workspace, TravelCity } from "../types";
import { travelContext } from "../travel-context";
import { tripCurrencies } from "../trip-destinations";
import { countryName } from "../countries";
import { apiFetch as api, jsonRequest } from "../client-api";
import { dateLabel } from "./ui";
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
  { at: number; weather: Weather; outlook: Weather | null }
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
export function offsetAt(date: Date, zone: string) {
  const name =
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        timeZoneName: "longOffset",
      })
        .formatToParts(date)
        .find((p) => p.type === "timeZoneName")?.value || "GMT",
    m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
function difference(minutes: number) {
  if (!minutes) return "시차 없음";
  const hours = Math.floor(Math.abs(minutes) / 60),
    rest = Math.abs(minutes) % 60;
  return `${hours ? `${hours}시간 ` : ""}${rest ? `${rest}분 ` : ""}${minutes > 0 ? "빠름" : "느림"}`;
}
function WeatherDays({
  weather,
  outlook = false,
}: {
  weather: Weather;
  outlook?: boolean;
}) {
  return weather.daily.length ? (
    <div className="compact-weather-days">
      {weather.daily.map((d) => (
        <div key={d.date}>
          <small>{dateLabel(d.date)}</small>
          {outlook ? (
            <>
              <strong>{d.mean ?? "—"}°</strong>
              <small>{d.rainMm ?? "—"} mm</small>
            </>
          ) : (
            <>
              <CloudSun size={23} />
              <strong>{label(d.code)}</strong>
              <span>
                <b>{d.high ?? "—"}°</b> {d.low ?? "—"}°
              </span>
              <small>강수 {d.rain ?? "—"}%</small>
            </>
          )}
        </div>
      ))}
    </div>
  ) : (
    <p className="weather-message">아직 예보가 없어북</p>
  );
}
function CityWeather({ city }: { city: TravelCity }) {
  const key = JSON.stringify([
      city.lat,
      city.lng,
      city.startDate,
      city.endDate,
      city.timezone,
    ]),
    [state, setState] = useState<{
      weather: Weather;
      outlook: Weather | null;
    } | null>(() => {
      const saved = cache.get(key);
      return saved && Date.now() - saved.at < 600000 ? saved : null;
    }),
    [error, setError] = useState("");
  const current = state;
  useEffect(() => {
    const saved = cache.get(key);
    if (saved && Date.now() - saved.at < 600000) return;
    const controller = new AbortController();
    let active = true;
    const body = {
        lat: city.lat,
        lng: city.lng,
        start: city.startDate,
        end: city.endDate,
      },
      first = new Date(Date.now() + 16 * 86400000).toISOString().slice(0, 10),
      last = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
    const forecast = api<Weather>(
        "/api/tools",
        jsonRequest(
          { operation: "weather", ...body },
          { signal: controller.signal },
        ),
      ),
      long =
        city.endDate >= first && city.startDate <= last
          ? api<Weather>(
              "/api/tools",
              jsonRequest(
                { operation: "outlook", ...body, timezone: city.timezone },
                { signal: controller.signal },
              ),
            ).catch(() => null)
          : Promise.resolve(null);
    let received: Weather | undefined,
      outlook: Weather | null = null;
    const publish = () => {
      if (!active || !received) return;
      if (cache.size >= 40) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), weather: received, outlook });
      setState({ weather: received, outlook });
    };
    void forecast
      .then((w) => {
        received = w;
        publish();
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    void long.then((w) => {
      outlook = w;
      publish();
    });
    return () => {
      active = false;
      controller.abort();
    };
    // The coordinates and visit dates uniquely own this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="city-weather-content">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!current && !error && (
        <div
          className="tools-loading"
          role="status"
          aria-label={`${city.name} 날씨 확인 중`}
        >
          <LoaderCircle className="spinner" />
        </div>
      )}
      {current && <WeatherDays weather={current.weather} />}{" "}
      {!!current?.outlook?.daily.length && (
        <details className="weather-outlook">
          <summary>장기 전망</summary>
          <p>앙상블 평균으로 실제 날씨와 달라질 수 있어북</p>
          <WeatherDays weather={current.outlook} outlook />
        </details>
      )}
    </div>
  );
}
function WeatherCity({ city, first }: { city: TravelCity; first: boolean }) {
  const [open, setOpen] = useState(first);
  return (
    <details
      className="weather-city"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>{city.name}</strong>
          <small>
            {dateLabel(city.startDate)} – {dateLabel(city.endDate)}
          </small>
        </span>
        <ChevronDown size={17} />
      </summary>
      {open && (
        <CityWeather
          key={`${city.lat}:${city.lng}:${city.startDate}:${city.endDate}:${city.timezone}`}
          city={city}
        />
      )}
    </details>
  );
}
function Exchange({ currency, base }: { currency: string; base: string }) {
  const rate = useRate(currency, base);
  return (
    <div className="currency-exchange-row">
      <div>
        <strong>{currency}</strong>
        {rate.quote ? (
          <>
            <span>
              1 {currency} ={" "}
              {rate.quote.rate.toLocaleString("ko-KR", {
                maximumFractionDigits: 6,
              })}{" "}
              {base}
            </span>
            <small className="inverse-rate">1 {base} = {(1/rate.quote.rate).toLocaleString("ko-KR",{maximumFractionDigits:8})} {currency}</small>
            <small>{rate.quote.date} 기준</small>
          </>
        ) : (
          <small>{rate.error || "환율 확인 중…"}</small>
        )}
      </div>
      <button
        type="button"
        className="icon"
        aria-label={`${currency} 환율 새로고침`}
        onClick={rate.refresh}
      >
        <RefreshCw size={17} />
      </button>
    </div>
  );
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
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date()),
      initial = setTimeout(tick, 0),
      timer = setInterval(tick, 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, []);
  const context = travelContext(workspace.trip),
    cities = context.cities.length
      ? context.cities
      : context.location
        ? [
            {
              ...context.location,
              id: "fallback",
              countryCode: "",
              currency: workspace.trip.currency,
              startDate: workspace.trip.startDate,
              endDate: workspace.trip.endDate,
              timezone: workspace.trip.timezone,
              address: context.location.address || "",
            } as TravelCity,
          ]
        : [];
  const groups = new Map<number, TravelCity[]>();
  if (now)
    for (const city of cities) {
      const offset = offsetAt(now, city.timezone);
      groups.set(offset, [...(groups.get(offset) || []), city]);
    }
  const local = now
    ? offsetAt(now, Intl.DateTimeFormat().resolvedOptions().timeZone)
    : 0;
  return (
    <section className="travel-tools multi-city-tools">
      <article className="tools-section">
        <header>
          <Clock size={20} />
          <h2>시간</h2>
          <small>내 기기 시간 기준 시차</small>
        </header>
        {!cities.length && (
          <p className="muted">
            도시를 추가하면 같은 시간인 도시끼리 모아서 보여줘북.
          </p>
        )}
        {[...groups].map(([offset, rows]) => (
          <details className="clock-group" key={offset}>
            <summary>
              <span className="clock-cities">
                {rows.map((c) => c.name).join(", ")}
              </span>
              <strong>
                {now?.toLocaleTimeString("en-GB", {
                  timeZone: rows[0].timezone,
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </strong>
              <small>{difference(offset - local)}</small>
              <ChevronDown size={17} />
            </summary>
            <ul>
              {rows.map((c) => (
                <li key={c.id}>
                  <span>
                    {c.countryCode ? `${countryName(c.countryCode)} | ` : ""}
                    {c.name}
                    {c.transit ? "(환승)" : ""}
                  </span>
                  <small>{c.timezone}</small>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </article>
      <article className="tools-section">
        <header>
          <CloudSun size={20} />
          <h2>날씨</h2>
          <small>도시를 펼쳐 예보 확인</small>
        </header>
        {cities.map((c, i) => (
          <WeatherCity key={c.id} city={c} first={i === 0} />
        ))}
        {!cities.length && (
          <div className="tools-empty">
            <MapPin size={22} />
            <p>날씨를 볼 도시를 추가해북</p>
            <button
              type="button"
              className="secondary"
              disabled={readOnly}
              onClick={onTripSettings}
            >
              여행 수정
            </button>
          </div>
        )}
      </article>
      <article className="tools-section">
        <header>
          <ArrowRightLeft size={20} />
          <h2>환율</h2>
          <small>기준통화 {profile.baseCurrency}</small>
        </header>
        {tripCurrencies(workspace.trip).map((currency) => (
          <Exchange
            key={currency}
            currency={currency}
            base={profile.baseCurrency}
          />
        ))}
      </article>
    </section>
  );
}
