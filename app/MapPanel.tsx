"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as MapInstance, Marker, GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { Point, Leg } from "./route-graph";
import "maplibre-gl/dist/maplibre-gl.css";

export default function MapPanel({
  points,
  center,
  legs = [],
  selected,
  onSelect,
  onClick,
  label = "일정 지도",
  focusSelected = false,
  interactive = false,
}: {
  points: Point[];
  center?: { lat: number; lng: number };
  legs?: Leg[];
  selected?: string;
  onSelect?: (id: string) => void;
  onClick?: (lat: number, lng: number) => void;
  label?: string;
  focusSelected?: boolean;
  interactive?: boolean;
}) {
  const node = useRef<HTMLDivElement>(null),
    map = useRef<MapInstance | null>(null),
    markers = useRef<Marker[]>([]),
    callbacks = useRef({ onClick, onSelect });
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    callbacks.current = { onClick, onSelect };
  }, [onClick, onSelect]);
  useEffect(() => {
    let active = true;
    let observer: ResizeObserver | undefined;
    import("maplibre-gl")
      .then((lib) => {
        if (!active || !node.current) return;
        lib.setWorkerUrl(
          new URL(
            "maplibre-gl/dist/maplibre-gl-worker.mjs",
            import.meta.url,
          ).toString(),
        );
        const m = new lib.Map({
          container: node.current,
          style: "https://tiles.openfreemap.org/styles/liberty",
          center: [126.978, 37.5665],
          zoom: 9,
          cooperativeGestures: !interactive,
          attributionControl:{customAttribution:""},
        });
        map.current = m;
        m.addControl(new lib.NavigationControl(), "top-right");
        m.on("load", () => {
          if (active) setReady(true);
        });
        m.on("error", () => {
          if (active)
            setError("지도 일부를 불러오지 못했어요. 연결을 확인해 주세요.");
        });
        m.on("click", (e) =>
          callbacks.current.onClick?.(e.lngLat.lat, e.lngLat.lng),
        );
        observer = new ResizeObserver(() => m.resize());
        observer.observe(node.current);
      })
      .catch(() => {
        if (active) setError("이 브라우저에서 지도를 표시할 수 없어요.");
      });
    return () => {
      active = false;
      observer?.disconnect();
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, [interactive]);
  const geometryKey = JSON.stringify([points, legs.map(l=>[l.from.lat,l.from.lng,l.to.lat,l.to.lng])]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    let active = true;
    import("maplibre-gl").then((lib) => {
      if (!active) return;
      markers.current.forEach((x) => x.remove());
      markers.current = points.map((p) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "map-pin";
        el.dataset.planId = p.planId;
        const number = document.createElement("span");
        number.className = "marker-number";
        number.textContent = p.number ? String(p.number) : "●";
        el.appendChild(number);
        el.title = p.name;
        el.setAttribute("aria-label", p.name);
        el.onclick = (e) => {
          e.stopPropagation();
          callbacks.current.onSelect?.(p.planId);
        };
        return new lib.Marker({ element: el })
          .setLngLat([p.lng, p.lat])
          .addTo(m);
      });
      const data: FeatureCollection = {
        type: "FeatureCollection",
        features: legs.map((leg) => ({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [leg.from.lng, leg.from.lat],
              [leg.to.lng, leg.to.lat],
            ],
          },
        })),
      };
      if (m.getSource("daily-path"))
        (m.getSource("daily-path") as GeoJSONSource).setData(data);
      else {
        m.addSource("daily-path", { type: "geojson", data });
        m.addLayer({
          id: "daily-path",
          type: "line",
          source: "daily-path",
          paint: {
            "line-color": "#167c65",
            "line-width": 3,
            "line-dasharray": [2, 1.4],
          },
        });
      }
    });
    return () => {
      active = false;
    };
    // Stable geometry avoids rebuilding markers while selecting or editing unrelated records.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryKey, ready]);
  useEffect(() => {
    if (!ready) return;
    // Marker creation is asynchronous; apply selection after it resolves as well.
    let active=true;
    void import("maplibre-gl").then(()=>{
      if(!active)return;
      markers.current.forEach(marker=>{const el=marker.getElement();el.dataset.selected=String(el.dataset.planId===selected);});
      const point=points.find(p=>p.planId===selected);
      if(focusSelected&&point)map.current?.easeTo({center:[point.lng,point.lat],zoom:15.5,padding:{top:20,right:20,bottom:210,left:20},duration:350});
    });
    return()=>{active=false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selected,ready,focusSelected,geometryKey]);
  const pointKey = JSON.stringify([
    points.map((p) => [p.lat, p.lng]),
    center?.lat,
    center?.lng,
  ]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || (focusSelected && points.some(p=>p.planId===selected))) return;
    if (!points.length) {
      if (center) m.flyTo({ center: [center.lng, center.lat], zoom: 11 });
      return;
    }
    if (points.length === 1)
      m.flyTo({ center: [points[0].lng, points[0].lat], zoom: 14 });
    else
      m.fitBounds(
        [
          [
            Math.min(...points.map((p) => p.lng)),
            Math.min(...points.map((p) => p.lat)),
          ],
          [
            Math.max(...points.map((p) => p.lng)),
            Math.max(...points.map((p) => p.lat)),
          ],
        ],
        { padding: 55, maxZoom: 14, duration: 400 },
      );
    // Only new coordinates reset the camera, never a title or selection edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointKey, ready, focusSelected]);
  return (
    <div className="map-frame" aria-label={label}>
      <div className="map-canvas" ref={node} />
      {!points.length && (
        <div className="map-caption">
          일정에 장소를 추가하면 여기에 표시돼요
        </div>
      )}
      {error && (
        <div className="map-warning" role="status">
          {error}
        </div>
      )}
    </div>
  );
}
