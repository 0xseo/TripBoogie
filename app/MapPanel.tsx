"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, MapPin, Map as MapIcon } from "lucide-react";
import type { ItemRecord } from "./types";
import styles from "./MapPanel.module.css";

type Point = { id: string; lat: number; lng: number; name: string; index: number };
type MapInstance = {
  fitBounds: (b: unknown, p?: number) => void;
  setCenter: (p: { lat: number; lng: number }) => void;
  setZoom: (n: number) => void;
};
type MarkerInstance = { map: MapInstance | null };
type GoogleMaps = {
  Map: new (el: HTMLElement, o: Record<string, unknown>) => MapInstance;
  LatLngBounds: new () => { extend: (p: { lat: number; lng: number }) => void };
  marker: { AdvancedMarkerElement: new (o: Record<string, unknown>) => MarkerInstance };
  event: { clearInstanceListeners: (map: MapInstance) => void };
};
declare global {
  interface Window {
    google?: { maps: GoogleMaps };
    __tripboogieMapReady?: () => void;
  }
}
let mapLoading: Promise<GoogleMaps> | null = null;
function loadMap(key: string): Promise<GoogleMaps> {
  if (window.google?.maps?.marker) return Promise.resolve(window.google.maps);
  return (mapLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        mapLoading = null;
        reject(new Error("지도 연결 시간이 초과됐어요."));
      }
    }, 20000);
    window.__tripboogieMapReady = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (window.google) resolve(window.google.maps);
      else reject(new Error("지도를 읽지 못했어요."));
    };
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, loading: "async", callback: "__tripboogieMapReady", libraries: "marker", v: "quarterly", language: "ko", auth_referrer_policy: "origin" })}`;
    script.async = true;
    script.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      mapLoading = null;
      reject(new Error("인터넷 연결을 확인해 주세요."));
    };
    document.head.appendChild(script);
  }));
}
function coordinate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}
export function googleMapUrl(place: { name?: string; lat?: number; lng?: number }) {
  const query =
    typeof place.lat === "number" && typeof place.lng === "number"
      ? `${place.lat},${place.lng}`
      : (place.name ?? "");
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query })}`;
}
export default function MapPanel({
  places,
  selectedPlaceId,
}: {
  places: ItemRecord[];
  selectedPlaceId?: string;
}) {
  const node = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [config, setConfig] = useState<{ browserKey: string; mapId: string } | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const serialized = JSON.stringify(
    places.map((p) => ({
      id: p.id,
      name: p.data.name ?? p.data.title,
      lat: p.data.lat,
      lng: p.data.lng,
    })),
  );
  const points = useMemo(() => {
    const rows = JSON.parse(serialized) as {
      id: string;
      name?: unknown;
      lat?: unknown;
      lng?: unknown;
    }[];
    return rows.flatMap((p, i) => {
      const lat = coordinate(p.lat),
        lng = coordinate(p.lng);
      return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? [
            {
              id: p.id,
              lat,
              lng,
              name: typeof p.name === "string" ? p.name : "저장한 장소",
              index: i + 1,
            },
          ]
        : [];
    });
  }, [serialized]);
  useEffect(() => {
    let active = true;
    fetch("/api/map-config")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((raw) => {
        if (
          typeof raw !== "object" ||
          !raw ||
          !("browserKey" in raw) ||
          !("mapId" in raw) ||
          typeof raw.browserKey !== "string" ||
          typeof raw.mapId !== "string"
        )
          throw new Error("Invalid map settings");
        if (active) setConfig({ browserKey: raw.browserKey, mapId: raw.mapId });
      })
      .catch(() => active && setError("지도 연결을 확인하지 못했어요."));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!config?.browserKey || !node.current) return;
    let active = true;
    let maps: GoogleMaps | undefined;
    const markers: MarkerInstance[] = [];
    loadMap(config.browserKey)
      .then((g) => {
        if (!active || !node.current) return;
        maps = g;
        const center = points[0] ?? { lat: 37.5665, lng: 126.978 };
        const map = new g.Map(node.current, {
          center,
          zoom: 12,
          mapId: config.mapId || "DEMO_MAP_ID",
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative",
        });
        mapRef.current = map;
        const bounds = new g.LatLngBounds();
        for (const p of points) {
          const badge = document.createElement("span");
          badge.textContent = String(p.index);
          badge.style.cssText =
            "display:grid;place-items:center;width:29px;height:29px;border-radius:50%;background:#176348;color:white;font:700 12px system-ui;border:3px solid white;box-shadow:0 2px 7px #0003";
          markers.push(
            new g.marker.AdvancedMarkerElement({ map, position: p, title: p.name, content: badge }),
          );
          bounds.extend(p);
        }
        if (points.length > 1) map.fitBounds(bounds, 45);
        setReady(true);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
      markers.forEach((m) => {
        m.map = null;
      });
      if (mapRef.current && maps) maps.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
    };
  }, [config, points]);
  useEffect(() => {
    const p = points.find((p) => p.id === selectedPlaceId);
    if (p && mapRef.current) {
      mapRef.current.setCenter(p);
      mapRef.current.setZoom(15);
    }
  }, [selectedPlaceId, points]);
  const first = points.find((p) => p.id === selectedPlaceId) ?? points[0];
  return (
    <section className={styles.panel} aria-label="여행 장소 지도">
      <div className={styles.header}>
        <span>
          <MapIcon size={16} />
          우리 여행 지도
        </span>
        <span>{points.length}곳</span>
      </div>
      {config?.browserKey ? (
        <div className={styles.canvas} ref={node} aria-label="Google 지도" />
      ) : (
        <div className={styles.fallback}>
          <div className={styles.pin}>
            <MapPin size={28} />
          </div>
          <h3>다음 목적지는 어디인가요?</h3>
          <p>저장한 장소를 Google 지도에서 확인하세요.</p>
          <a
            href={googleMapUrl(
              first ?? {
                name: typeof places[0]?.data.name === "string" ? places[0].data.name : "여행 장소",
              },
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google 지도 열기
            <ExternalLink size={14} />
          </a>
          <div className={styles.pointList}>
            {points.slice(0, 4).map((p) => (
              <div key={p.id}>
                <span>{p.index}</span>
                <b>{p.name}</b>
              </div>
            ))}
          </div>
          {points.length === 0 && <small>장소를 추가하면 여행 동선을 정리할 수 있어요.</small>}
        </div>
      )}
      {error && (
        <p role="status" className={styles.status}>
          {error}{" "}
          <a href={googleMapUrl(first ?? {})} target="_blank" rel="noopener noreferrer">
            Google 지도에서 보기
          </a>
        </p>
      )}
      {config?.browserKey && !ready && !error && (
        <p className={styles.status}>지도를 불러오고 있어요.</p>
      )}
    </section>
  );
}
