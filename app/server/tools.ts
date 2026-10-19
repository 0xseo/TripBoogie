import { countryCodes } from "../countries";
import { boundedJson } from "./http";
import type { CurrentUser } from "../types";
import { ApiError, object, readJson, date } from "./validation";
type Deps = {
  resolveUser: (r: Request) => Promise<CurrentUser | null>;
  budget: (r: Request) => Promise<unknown>;
  fetch?: typeof fetch;
};
const cache = new Map<string, { expires: number; value: unknown }>();
async function getJson(url: URL, fetcher: typeof fetch) {
  const r = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!r.ok)
    throw new ApiError(
      503,
      "외부 여행 정보 서비스를 불러오지 못했습니다. 직접 입력하거나 잠시 후 다시 확인하세요.",
    );
  return object(await boundedJson(r, 1048576));
}
export function createToolsHandler(deps: Deps) {
  return async (request: Request) => {
    const headers = {
      "Cache-Control": "private, no-store",
      Vary: "Authorization",
    };
    try {
      const input = await readJson(request);
      if (!(await deps.resolveUser(request)))
        throw new ApiError(401, "로그인이 필요합니다.");
      const op = input.operation;
      if (op === "holidays") {
        const country = String(input.country ?? ""),
          year = Number(input.year);
        if (
          !countryCodes.includes(country) ||
          !Number.isInteger(year) ||
          year < 1900 ||
          year > 2100
        )
          throw new ApiError(400, "공휴일 국가·연도를 확인하세요.");
        const key = `holidays:${country}:${year}`,
          hit = cache.get(key);
        if (hit && hit.expires > Date.now())
          return Response.json(hit.value, { headers });
        await deps.budget(request);
        const response = await (deps.fetch ?? fetch)(
          new URL(
            `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`,
          ),
          {
            redirect: "error",
            signal: AbortSignal.timeout(10000),
            cache: "no-store",
          },
        );
        if (response.status === 204 || response.status === 404)
          return Response.json(
            {
              country,
              holidays: [],
              supported: false,
              message: "이 국가의 공휴일 정보가 제공되지 않습니다.",
            },
            { headers },
          );
        if (!response.ok)
          throw new ApiError(503, "공휴일 정보를 불러오지 못했습니다.");
        const raw = await boundedJson(response, 262144);
        if (!Array.isArray(raw) || raw.length > 400)
          throw new ApiError(502, "공휴일 응답을 확인하지 못했습니다.");
        const holidays = raw.flatMap((v) => {
          const d = object(v);
          return d.global === true &&
            Array.isArray(d.types) &&
            d.types.includes("Public") &&
            typeof d.localName === "string"
            ? [{ date: date(d.date), name: d.localName.slice(0, 200) }]
            : [];
        });
        const result = {
          country,
          holidays,
          supported: true,
          source: "Nager.Date",
        };
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: Date.now() + 86400000, value: result });
        return Response.json(result, { headers });
      }
      const outlook = op === "outlook";
      let url: URL;
      let weatherAvailable = true;
      let weatherMessage = "예보가 제공되는 날짜만 표시합니다.";
      if (op === "rate") {
        if (
          typeof input.base !== "string" ||
          typeof input.quote !== "string" ||
          !/^[A-Z]{3}$/.test(input.base) ||
          !/^[A-Z]{3}$/.test(input.quote)
        )
          throw new ApiError(400, "통화를 확인하세요.");
        if (input.base === input.quote)
          return Response.json(
            {
              base: input.base,
              quote: input.quote,
              rate: 1,
              date: new Date().toISOString().slice(0, 10),
            },
            { headers },
          );
        url = new URL(
          `https://api.frankfurter.dev/v2/rate/${input.base}/${input.quote}`,
        );
        if (input.date) url.searchParams.set("date", date(input.date));
      } else if (op === "weather" || outlook) {
        if (
          typeof input.lat !== "number" ||
          !Number.isFinite(input.lat) ||
          Math.abs(input.lat) > 90 ||
          typeof input.lng !== "number" ||
          !Number.isFinite(input.lng) ||
          Math.abs(input.lng) > 180
        )
          throw new ApiError(400, "여행지 좌표를 확인하세요.");
        const start = date(input.start),
          end = date(input.end),
          today = new Date().toISOString().slice(0, 10),
          limit = new Date(Date.now() + (outlook ? 45 : 15) * 86400000)
            .toISOString()
            .slice(0, 10);
        if (end < start || Date.parse(end) - Date.parse(start) > 364 * 86400000)
          throw new ApiError(400, "여행 기간을 확인하세요.");
        const first = outlook
          ? new Date(Date.now() + 16 * 86400000).toISOString().slice(0, 10)
          : today;
        const a = start > first ? start : first,
          b = end < limit ? end : limit;
        if (a > b) {
          weatherAvailable = false;
          weatherMessage =
            end < today
              ? "지난 여행의 예보는 제공하지 않습니다."
              : "날씨 예보는 오늘부터 최대 16일 범위에서 제공됩니다.";
        }
        url = new URL(
          outlook
            ? "https://seasonal-api.open-meteo.com/v1/seasonal"
            : "https://api.open-meteo.com/v1/forecast",
        );
        Object.entries({
          latitude: String(input.lat),
          longitude: String(input.lng),
          start_date: weatherAvailable ? a : today,
          end_date: weatherAvailable ? b : today,
          timezone: "auto",
          daily: outlook
            ? "temperature_2m_mean,precipitation_sum"
            : "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        }).forEach(([k, v]) => url.searchParams.set(k, v));
        if (outlook) {
          url.searchParams.delete("start_date");
          url.searchParams.delete("end_date");
          url.searchParams.set("models", "ecmwf_ec46_ensemble_mean");
          url.searchParams.set("forecast_days", "46");
          if (!weatherAvailable)
            return Response.json(
              {
                timezone:
                  typeof input.timezone === "string" ? input.timezone : null,
                daily: [],
                message:
                  end < today
                    ? "지난 기간의 전망은 제공하지 않습니다."
                    : "46일 이후에는 일별 장기 전망을 제공하지 않습니다.",
              },
              { headers },
            );
        }
      } else throw new ApiError(400, "지원하지 않는 여행 도구입니다.");
      const key =
        url.href +
        (op === "weather" || outlook
          ? JSON.stringify([input.start, input.end])
          : "");
      for (const [k, v] of cache) if (v.expires < Date.now()) cache.delete(k);
      const hit = cache.get(key);
      if (hit) return Response.json(hit.value, { headers });
      await deps.budget(request);
      const raw = await getJson(url, deps.fetch ?? fetch);
      let result: unknown;
      if (op === "rate") {
        if (
          raw.base !== input.base ||
          raw.quote !== input.quote ||
          typeof raw.rate !== "number" ||
          !Number.isFinite(raw.rate) ||
          raw.rate <= 0 ||
          typeof raw.date !== "string"
        )
          throw new ApiError(502, "환율 응답을 확인하지 못했습니다.");
        result = {
          base: raw.base,
          quote: raw.quote,
          rate: raw.rate,
          date: date(raw.date),
        };
      } else {
        const daily = object(raw.daily),
          times = daily.time;
        if (
          !Array.isArray(times) ||
          times.length > (outlook ? 46 : 16) ||
          typeof raw.timezone !== "string"
        )
          throw new ApiError(502, "날씨 응답을 확인하지 못했습니다.");
        const number = (key: string, i: number) => {
          const values = daily[key];
          return Array.isArray(values) &&
            typeof values[i] === "number" &&
            Number.isFinite(values[i])
            ? values[i]
            : null;
        };
        result = {
          timezone: raw.timezone,
          daily: weatherAvailable
            ? times
                .map((d, i) => ({
                  date: date(d),
                  code: number("weather_code", i),
                  high: number("temperature_2m_max", i),
                  low: number("temperature_2m_min", i),
                  rain: number("precipitation_probability_max", i),
                  ...(outlook
                    ? {
                        mean: number("temperature_2m_mean", i),
                        rainMm: number("precipitation_sum", i),
                      }
                    : {}),
                }))
                .filter(
                  (d) =>
                    !outlook ||
                    (d.date >= String(input.start) &&
                      d.date <= String(input.end) &&
                      d.date >=
                        new Date(Date.now() + 16 * 86400000)
                          .toISOString()
                          .slice(0, 10)),
                )
            : [],
          ...(outlook
            ? { kind: "outlook", model: "ECMWF EC46 · 51개 앙상블 평균" }
            : {}),
          message: outlook
            ? "17~46일 장기 전망 · 지역 평균 경향이며 일별 확정 예보가 아닙니다."
            : weatherMessage,
        };
      }
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: Date.now() + 1800000, value: result });
      return Response.json(result, { headers });
    } catch (e) {
      return Response.json(
        {
          error:
            e instanceof ApiError
              ? e.message
              : "여행 정보를 불러오지 못했습니다.",
        },
        { status: e instanceof ApiError ? e.status : 503, headers },
      );
    }
  };
}
