import { distanceMeters } from "../route-graph";
import { countryCurrencies } from "../countries";
import { searchLanguages } from "../search-language";
import { normalizePlaceName, resolvePlaceAlias } from "./place-alias";
import { boundedJson } from "./http";
import {cityQuery,searchCities} from "./city-search";
import { chineseCityBoundary, chineseParentCity } from "./map-city";
import type { CurrentUser } from "../types";
import { ApiError, object, readJson } from "./validation";

import type { PlaceDetails, TravelImage } from "../media";
export type MapPlace = {
  cityName?: string;
  providerId?: string;
  image?: TravelImage | null;
  details?: PlaceDetails;
  searchLabel?: string;
  nativeName?: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  countryCode?: string;
  timezone?: string;
  currency?: string;
};
export type MapRoute = {
  geometry: { type: "MultiLineString"; coordinates: number[][][] };
  distance: number;
  time: number;
  legs: { distance: number; time: number }[];
};
type Deps = {
  key: string;
  resolveUser: (r: Request) => Promise<CurrentUser | null>;
  budget: (r: Request) => Promise<unknown>;
  fetch?: typeof globalThis.fetch;
};
const cache = new Map<
  string,
  { expires: number; bytes: number; value: unknown }
>();
let cacheBytes = 0;
const number = (v: unknown, max: number) =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;
function coord(v: unknown): { lat: number; lng: number } {
  const p = object(v);
  if (!number(p.lat, 90) || !number(p.lng, 180))
    throw new ApiError(400, "위도와 경도를 확인하세요.");
  return { lat: p.lat as number, lng: p.lng as number };
}
function cleanRoute(raw: unknown): MapRoute {
  const root = object(raw),
    features = root.features;
  if (!Array.isArray(features) || !features.length)
    throw new ApiError(
      404,
      "이 지점 사이의 경로를 찾지 못했습니다. 다른 이동 수단이나 장소를 선택하세요.",
      "NO_ROUTE",
    );
  const feature = object(features[0]),
    geometry = object(feature.geometry),
    props = object(feature.properties);
  if (
    geometry.type !== "MultiLineString" ||
    !Array.isArray(geometry.coordinates) ||
    !geometry.coordinates.every(
      (line) =>
        Array.isArray(line) &&
        line.length > 0 &&
        line.every(
          (p) => Array.isArray(p) && number(p[0], 180) && number(p[1], 90),
        ),
    ) ||
    !number(props.distance, 100_000_000) ||
    Number(props.distance) < 0 ||
    !number(props.time, 100_000_000) ||
    Number(props.time) < 0 ||
    !Array.isArray(props.legs)
  )
    throw new ApiError(
      502,
      "경로 서비스의 응답을 확인하지 못했습니다.",
      "MAP_UNAVAILABLE",
    );
  const legs = props.legs.map((value) => {
    const leg = object(value);
    if (
      !number(leg.distance, 100_000_000) ||
      Number(leg.distance) < 0 ||
      !number(leg.time, 100_000_000) ||
      Number(leg.time) < 0
    )
      throw new ApiError(
        502,
        "경로 구간의 응답을 확인하지 못했습니다.",
        "MAP_UNAVAILABLE",
      );
    return { distance: leg.distance as number, time: leg.time as number };
  });
  return {
    geometry: {
      type: "MultiLineString",
      coordinates: geometry.coordinates as number[][][],
    },
    distance: props.distance as number,
    time: props.time as number,
    legs,
  };
}
function providerPlaces(raw: unknown): MapPlace[] {
  const features = object(raw).features;
  if (!Array.isArray(features))
    throw new ApiError(
      502,
      "검색 응답을 확인하지 못했습니다.",
      "MAP_UNAVAILABLE",
    );
  const places: MapPlace[] = features.slice(0, 16).flatMap((value) => {
    const props = object(object(value).properties);
    if (!number(props.lat, 90) || !number(props.lon, 180)) return [];
    return [
      {
        name: String(
          props.name ??
            props.address_line1 ??
            props.formatted ??
            "검색한 장소",
        ).slice(0, 300),
        address: String(props.formatted ?? "").slice(0, 1000),
        ...(typeof (props.city??props.town??props.village)==="string"?{cityName:String(props.city??props.town??props.village).slice(0,300)}:{}),
        ...(typeof props.place_id === "string" && /^[a-f0-9]{10,2048}$/.test(props.place_id) ? { providerId: props.place_id } : {}),
        lat: props.lat as number,
        lng: props.lon as number,
        ...(typeof props.country_code === "string" &&
        /^[a-z]{2}$/i.test(props.country_code)
          ? {
              countryCode: props.country_code.toUpperCase(),
              currency:
                countryCurrencies[props.country_code.toUpperCase()],
            }
          : {}),
        ...(props.timezone &&
        typeof props.timezone === "object" &&
        typeof (props.timezone as Record<string, unknown>).name ===
          "string"
          ? { timezone: (props.timezone as { name: string }).name }
          : {}),
      },
    ];
  });
  return places;
}

export function createMapHandler(deps: Deps) {
  return async (
    request: Request,
    operation: "search" | "autocomplete" | "route" | "reverse",
  ) => {
    const headers = {
      "Cache-Control": "private, no-store",
      Vary: "Authorization",
      "Referrer-Policy": "no-referrer",
    };
    try {
      const input = await readJson(request);
      if (!(await deps.resolveUser(request)))
        throw new ApiError(
          401,
          "지도 검색과 경로는 로그인 후 사용할 수 있습니다.",
          "UNAUTHENTICATED",
        );
      if (!deps.key)
        throw new ApiError(
          503,
          "장소 검색·경로용 Geoapify 키가 아직 설정되지 않았습니다. 지도와 직접 마커 추가는 사용할 수 있어요.",
          "MAP_NOT_CONFIGURED",
        );
      const language =
        input.language === undefined ? "ko" : String(input.language);
      if (operation !== "route" && !(language in searchLanguages))
        throw new ApiError(400, "검색 언어를 확인하세요.");
      if (
        input.countryCode !== undefined &&
        (typeof input.countryCode !== "string" ||
          !/^[A-Z]{2}$/.test(input.countryCode))
      )
        throw new ApiError(400, "여행지 국가를 확인하세요.");
      const url = new URL(
        operation === "reverse" ? "https://api.geoapify.com/v1/geocode/reverse" : operation === "route"
          ? "https://api.geoapify.com/v1/routing"
          : operation === "autocomplete"
            ? "https://api.geoapify.com/v1/geocode/autocomplete"
            : "https://api.geoapify.com/v1/geocode/search",
      );
      if(operation==="reverse"){
        const p=coord(input);url.searchParams.set("lat",String(p.lat));url.searchParams.set("lon",String(p.lng));url.searchParams.set("type","city");url.searchParams.set("lang",language);url.searchParams.set("limit","1");
      } else if (operation !== "route") {
        if (
          typeof input.query !== "string" ||
          input.query.trim().length < 2 ||
          input.query.length > 300
        )
          throw new ApiError(400, "검색어를 2~300자로 입력하세요.");
        url.searchParams.set("text", input.type==="city"?cityQuery(input.query,language).query:input.query.trim());
        if (input.type === "city") url.searchParams.set("type", "city");
        else if (input.type !== undefined)
          throw new ApiError(400, "검색 유형을 확인하세요.");
        url.searchParams.set("limit", "8");
        url.searchParams.set("lang", language);
        if (input.bias !== undefined) {
          const p = coord(input.bias);
          url.searchParams.set("bias", `proximity:${p.lng},${p.lat}`);
        } else url.searchParams.set("bias", "countrycode:none");
        if (input.type !== "city" && input.countryCode)
          url.searchParams.set("filter", `countrycode:${String(input.countryCode).toLowerCase()}`);
      } else {
        // Bound URL length, provider work and per-click credits. Larger days can
        // select a subset; no silent truncation or simulated road geometry.
        if (
          !Array.isArray(input.points) ||
          input.points.length < 2 ||
          input.points.length > 50
        )
          throw new ApiError(
            400,
            "한 번에 2~50개 마커의 경로를 계산할 수 있습니다.",
          );
        const points = input.points.map(coord);
        if (!["walk", "drive", "bicycle"].includes(String(input.mode)))
          throw new ApiError(400, "이동 수단을 확인하세요.");
        url.searchParams.set(
          "waypoints",
          points.map((p) => `${p.lat},${p.lng}`).join("|"),
        );
        url.searchParams.set("mode", String(input.mode));
        url.searchParams.set("units", "metric");
        url.searchParams.set("lang", "en");
      }
      const cacheKey = `${url.href}|${input.countryCode || ""}|${input.type==="city"?input.query:""}`;
      for (const [key, entry] of cache)
        if (entry.expires < Date.now()) {
          cache.delete(key);
          cacheBytes -= entry.bytes;
        }
      const cached = cache.get(cacheKey);
      if (cached) return Response.json(cached.value, { headers });
      await deps.budget(request);
      url.searchParams.set("apiKey", deps.key);
      let response: Response;
      try {
        response = await (deps.fetch ?? globalThis.fetch)(url, {
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
        });
      } catch {
        throw new ApiError(
          503,
          "지도 서비스에 연결하지 못했습니다. 잠시 후 다시 시도하세요.",
          "MAP_UNAVAILABLE",
        );
      }
      if (!response.ok) {
        if (response.status === 429)
          throw new ApiError(
            429,
            "무료 지도 서비스의 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.",
            "RATE_LIMITED",
          );
        if (response.status === 400 && operation === "route")
          throw new ApiError(
            404,
            "이 마커 사이의 경로를 찾지 못했습니다. 이동 수단이나 지점을 바꿔 주세요.",
            "NO_ROUTE",
          );
        throw new ApiError(
          503,
          "지도 서비스 설정 또는 연결을 확인해 주세요.",
          "MAP_UNAVAILABLE",
        );
      }
      let raw: unknown;
      try {
        raw = await boundedJson(response);
      } catch {
        throw new ApiError(
          502,
          "지도 서비스의 응답을 읽지 못했습니다.",
          "MAP_UNAVAILABLE",
        );
      }
      let cityMatches: MapPlace[] = [];
      if (operation === "reverse") {
        let city = providerPlaces(raw).find(p => p.countryCode && p.timezone);
        if (city?.countryCode === "CN") {
          const boundaryUrl = new URL("https://api.geoapify.com/v1/boundaries/part-of");
          boundaryUrl.search = new URLSearchParams({ lat: String(input.lat), lon: String(input.lng), boundaries: "administrative", geometry: "point", lang: language, apiKey: deps.key }).toString();
          let parent: Record<string, unknown> | undefined;
          // Charge every upstream request. A failed boundary lookup may use a
          // verified parent from the geocoder, never the original district.
          await deps.budget(request);
          try {
            const boundaryResponse = await (deps.fetch ?? globalThis.fetch)(boundaryUrl, { redirect: "manual", cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]) });
            if (boundaryResponse.ok) parent = chineseCityBoundary(await boundedJson(boundaryResponse));
          } catch { /* The explicit parent fallback below is safe during outages. */ }
          parent ??= chineseParentCity(raw);
          city = parent ? providerPlaces({ features: [{ properties: {
            ...parent, name: parent.name, city: parent.name,
            country_code: "cn", timezone: { name: city.timezone },
            lat: number(parent.lat, 90) ? parent.lat : city.lat,
            lon: number(parent.lon, 180) ? parent.lon : city.lng,
          } }] })[0] : undefined;
        }
        if (city?.cityName) city = { ...city, name: city.cityName };
        raw = { places: city ? [city] : [] };
        // Reverse results share the normal bounded cache, including canonical
        // city lookups used to compare existing trip destinations.
      }
      const country = input.type !== "city" ? input.countryCode as string | undefined : undefined;
      const inCountry = (p: MapPlace) => !country || p.countryCode === country;
      const directPlaces = operation !== "route" && operation !== "reverse" ? providerPlaces(raw).filter(inCountry) : [];
      if (operation !== "route" && operation !== "reverse" && input.type === "city" && !directPlaces.some(p => p.countryCode && p.timezone)) {
        try { cityMatches = await searchCities(String(input.query), language, input.countryCode as string | undefined, deps.fetch ?? globalThis.fetch, request.signal); }
        catch { /* A fallback outage never discards valid direct results. */ }
      }
      const center = operation !== "route" && input.bias !== undefined ? coord(input.bias) : undefined;
      const exactDirect = directPlaces.some(p => normalizePlaceName(p.name) === normalizePlaceName(String(input.query)) && (!center || distanceMeters(center, p) <= 100000));
      let aliasPlaces: MapPlace[] = [], alternativeQuery = "", aliasSource = "";
      // Fuzzy suggestions are not proof the requested place was found. Resolve
      // linked names in autocomplete too, before the client accepts unrelated hits.
      if (operation !== "route" && operation !== "reverse" && input.type !== "city" && (operation === "search" || !exactDirect)) {
        try {
          const alias = await resolvePlaceAlias(String(input.query).trim(), language, input.countryCode as string | undefined, deps.fetch ?? globalThis.fetch, request.signal);
          if (alias) {
            await deps.budget(request);
            const translated = new URL(url);
            translated.pathname = "/v1/geocode/search";
            translated.searchParams.set("text", alias.query);
            const response = await (deps.fetch ?? globalThis.fetch)(translated, { redirect: "manual", cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]) });
            if (response.ok) {
              const matches = providerPlaces(await boundedJson(response)).filter(inCountry);
              const firstName = matches[0]?.name;
              aliasPlaces = matches.map(p => ({...p, ...(/[가-힣]/u.test(String(input.query)) && (p.name === firstName || normalizePlaceName(p.name) === normalizePlaceName(alias.query)) ? {searchLabel: String(input.query).trim()} : {})}));
              if (aliasPlaces.length) { alternativeQuery = alias.query; aliasSource = alias.source; }
            }
          }
        } catch { /* Optional language links never discard a valid direct result. */ }
      }
      let result: unknown;
      if (operation === "reverse") result = raw;
      else if (operation !== "route") {
        const candidates = [...cityMatches, ...aliasPlaces, ...directPlaces];
        const unique = candidates.filter((p, i) => candidates.findIndex(other => Math.abs(other.lat-p.lat)<0.00001 && Math.abs(other.lng-p.lng)<0.00001)===i);
        if (input.type !== "city") {
          const rank = (p: MapPlace) => aliasPlaces.includes(p) ? 0 : normalizePlaceName(p.name) === normalizePlaceName(String(input.query)) ? 1 : 2;
          unique.sort((a,b) => rank(a)-rank(b) || (center ? distanceMeters(center,a)-distanceMeters(center,b) : 0));
        }
        result = {
          places: unique.slice(0, 8),
          ...(alternativeQuery ? { alternativeQuery, aliasSource } : {}),
        };
      } else {
        result = cleanRoute(raw);
        if (
          (result as MapRoute).legs.length !==
          (input.points as unknown[]).length - 1
        )
          throw new ApiError(
            502,
            "경로 구간 수가 일치하지 않습니다.",
            "MAP_UNAVAILABLE",
          );
      }
      const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
      while (cache.size >= 128 || cacheBytes + bytes > 16_777_216) {
        const first = cache.keys().next().value;
        if (first === undefined) break;
        cacheBytes -= cache.get(first)!.bytes;
        cache.delete(first);
      }
      cache.set(cacheKey, {
        value: result,
        expires: Date.now() + 900_000,
        bytes,
      });
      cacheBytes += bytes;
      return Response.json(result, { headers });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof ApiError
              ? error.message
              : "지도 요청을 처리하지 못했습니다.",
          code: error instanceof ApiError ? error.code : "MAP_UNAVAILABLE",
        },
        { status: error instanceof ApiError ? error.status : 503, headers },
      );
    }
  };
}
