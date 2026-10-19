"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Plane, Search } from "lucide-react";
import type { Airport } from "../airports";
import { apiFetch as api, jsonRequest } from "../client-api";
const label = (a: Airport) => `${a.aliases[0] || a.name} (${a.iata || a.icao})`;
export default function AirportInput({
  title,
  value,
  onChange,
  onChoose,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onChoose: (airport: Airport) => void;
}) {
  const [results, setResults] = useState<Airport[]>([]),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [active, setActive] = useState(0);
  const seq = useRef(0),
    id = useId();
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController(),
      n = ++seq.current;
    const t = setTimeout(() => {
      setBusy(true);
      api<{ airports: Airport[] }>(
        "/api/airports",
        jsonRequest({ query }, { signal: controller.signal }),
      )
        .then((r) => {
          if (seq.current === n) {
            setResults(r.airports);
            setError(
              r.airports.length
                ? ""
                : "검색 결과가 없어요. 공항 이름을 직접 입력할 수도 있어요.",
            );
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted && seq.current === n)
            setError(e.message);
        })
        .finally(() => {
          if (seq.current === n) setBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
      if (seq.current === n) seq.current = n + 1;
    };
  }, [query]);
  function choose(a: Airport) {
    onChange(label(a));
    onChoose(a);
    setResults([]);
    setQuery("");
    setBusy(false);
  }
  return (
    <div className="airport-input">
      <label className="field">
        <span>{title}</span>
        <div className="searchbox">
          <Search size={17} />
          <input
            value={value}
            placeholder="ICN · 인천 · Incheon"
            maxLength={300}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls={id}
            aria-activedescendant={
              results.length ? `${id}-${active}` : undefined
            }
            onChange={(e) => {
              onChange(e.target.value);
              setQuery(e.target.value);
              setResults([]);
              setError("");
              setActive(0);
              if (e.target.value.length < 2) setBusy(false);
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
                    results.length,
                );
              }
              if (e.key === "Enter") {
                e.preventDefault();
                choose(results[active]);
              }
            }}
          />
          {busy && <span className="spinner" />}
        </div>
      </label>
      {results.length > 0 && (
        <ul className="suggestions" id={id} role="listbox">
          {results.map((a, i) => (
            <li key={a.icao}>
              <button
                type="button"
                role="option"
                id={`${id}-${i}`}
                aria-selected={active === i}
                onClick={() => choose(a)}
              >
                <Plane size={18} />
                <span>
                  <strong>{label(a)}</strong>
                  <small>
                    {a.icao} · {a.city} · {a.country}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <small className="muted">{error}</small>}
    </div>
  );
}
