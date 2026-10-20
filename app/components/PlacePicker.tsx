"use client";
import { useEffect, useRef, useState } from "react";
import { Search, MapPin } from "lucide-react";
import MapPanel from "../MapPanel";
import ManualPlacePicker from "./ManualPlacePicker";
import { apiFetch as api, jsonRequest } from "../client-api";
import type { MapPlace } from "../server/maps";
import { useSearchLanguage } from "./SearchLanguage";
import { PlaceMedia } from "./Media";
import { distanceLabel, distanceMeters } from "../route-graph";
import { Field } from "./ui";
export default function PlacePicker({
  initial,
  onChoose,
  bias,
  countryCode,
  previous,
}: {
  initial?: MapPlace;
  onChoose: (p: MapPlace) => void;
  bias?: { lat: number; lng: number };
  countryCode?: string;
  previous?: { lat: number; lng: number; name: string };
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<MapPlace[]>([]),
    [draft, setDraft] = useState<MapPlace | null>(initial ?? null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [searched, setSearched] = useState(false),
    [manual, setManual] = useState(false),
    [active, setActive] = useState(0);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const language = useSearchLanguage();
  useEffect(() => {
    if (manual || query.trim().length < 2) return;
    const controller = new AbortController(),
      n = ++sequence.current;
    pending.current = controller;
    const timer = setTimeout(() => {
      setBusy(true);
      setError("");
      setSearched(false);

      api<{ places: MapPlace[] }>(
        "/api/maps/autocomplete",
        jsonRequest(
          { query, bias, language, countryCode },
          { signal: controller.signal }
        )
      )
        .then(async (r) => {
          if (!r.places.length)
            r = await api<{ places: MapPlace[]; alternativeQuery?: string }>(
              "/api/maps/search",
              jsonRequest(
                { query, bias, language, countryCode },
                { signal: controller.signal }
              )
            );
          if (sequence.current === n) {
            setResults(r.places);
            setSearched(true);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted && sequence.current === n)
            setError(e.message);
        })
        .finally(() => {
          if (sequence.current === n) setBusy(false);
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (sequence.current === n) sequence.current = n + 1;
    };
  }, [query, bias, language, countryCode, manual]);
  const choose = (p: MapPlace) => {
    pending.current?.abort();
    sequence.current += 1;
    setError("");
    setSearched(false);
    setDraft(
      p.searchLabel ? { ...p, nativeName: p.name, name: p.searchLabel } : p
    );
    setBusy(false);
    setResults([]);
    setQuery("");
  };
  return (
    <div className="place-picker">
      <div className="searchbox">
        <Search size={20} aria-hidden="true" />
        <input
          autoFocus={!initial}
          placeholder="가고 싶은 장소를 찾아북"
          aria-label="장소·주소 검색"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError("");
            setSearched(false);
            setResults([]);
            setActive(0);
            if (e.target.value.length < 2) {
              setBusy(false);
              setSearched(false);
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
                (active + (e.key === "ArrowDown" ? 1 : results.length - 1)) %
                  results.length
              );
            }
            if (e.key === "Enter") {
              e.preventDefault();
              choose(results[active] || results[0]);
            }
          }}
          aria-activedescendant={
            results.length ? `place-option-${active}` : undefined
          }
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls="place-suggestions"
        />
        {busy && <span className="spinner" />}
      </div>
      {results.length > 0 && (
        <ul className="suggestions" id="place-suggestions" role="listbox">
          {results.map((p, i) => (
            <li key={`${p.lat}-${p.lng}-${i}`}>
              <button
                type="button"
                role="option"
                id={`place-option-${i}`}
                aria-selected={active === i}
                onClick={() => choose(p)}
              >
                <MapPin size={18} />
                <span>
                  <strong>{p.searchLabel || p.name}</strong>
                  <small>{p.address}</small>
                  {previous && (
                    <small className="place-distance">
                      이전 일정에서 직선{" "}
                      {distanceLabel(distanceMeters(previous, p))}
                    </small>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {searched &&
        !busy &&
        !results.length &&
        query.trim().length >= 2 &&
        !error && <p className="info search-empty">검색 결과가 없어북</p>}
      <button
        type="button"
        className="text-button"
        onClick={() => {
          pending.current?.abort();
          sequence.current += 1;
          setBusy(false);
          setManual(true);
        }}
      >
        지도에서 직접 선택
      </button>
      <MapPanel
        points={
          draft
            ? [{ ...draft, id: "draft", planId: "draft", number: 0 }]
            : bias
            ? [
                {
                  ...bias,
                  id: "center",
                  planId: "center",
                  number: 0,
                  name: "여행지",
                },
              ]
            : []
        }
        label="장소 선택 지도"
      />
      {manual && (
        <ManualPlacePicker
          initial={draft ?? undefined}
          center={bias}
          onClose={() => setManual(false)}
          onChoose={(p) => {
            choose(p);
            setManual(false);
          }}
        />
      )}
      {draft && (
        <div className="place-choice">
          {previous && (
            <p className="place-distance">
              {previous.name}에서 직선{" "}
              {distanceLabel(distanceMeters(previous, draft))}
            </p>
          )}
          <PlaceMedia place={{ ...draft }} />
          <Field label="장소 이름">
            <input
              maxLength={300}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <p className="muted">{draft.address}</p>
          <button
            type="button"
            className="primary"
            disabled={busy || !draft.name.trim()}
            onClick={() => onChoose(draft)}
          >
            이 장소로 정해북
          </button>
        </div>
      )}
      <small>
        장소 검색 제공 ·{" "}
        <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">
          Geoapify
        </a>
      </small>
    </div>
  );
}
