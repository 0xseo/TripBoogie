"use client";
import {useEffect, useRef, useState, type ReactNode, type CSSProperties} from "react";
import {mapHeightBounds, mapHeightScale} from "../map-height";
import {isNativeApp} from "../runtime";

export default function ResizableMap({scale = 1, onChange, onError, children}: {
  scale?: number;
  onChange?: (scale: number) => Promise<void>;
  onError: (message: string) => void;
  children: ReactNode;
}) {
  const [bounds, setBounds] = useState<ReturnType<typeof mapHeightBounds> | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const drag = useRef<{pointer: number; y: number; height: number} | null>(null);
  const saving = useRef(false), queued = useRef<number | null>(null), alive = useRef(true);
  const callbacks = useRef({onChange, onError});
  useEffect(() => {callbacks.current = {onChange, onError};}, [onChange, onError]);
  useEffect(() => {
    alive.current = true;
    const update = () => setBounds(mapHeightBounds(window.innerHeight, isNativeApp() || window.matchMedia("(max-width:960px)").matches));
    update();
    window.addEventListener("resize", update);
    return () => {alive.current = false; queued.current = null; window.removeEventListener("resize", update);};
  }, []);
  const value = draft ?? mapHeightScale(scale);
  const height = bounds ? Math.max(bounds.min, Math.min(bounds.max, bounds.base * value)) : undefined;
  async function persist(next: number) {
    setDraft(next);
    queued.current = next;
    if (saving.current) return;
    saving.current = true;
    while (alive.current && queued.current !== null) {
      const pending = queued.current;
      queued.current = null;
      try {await callbacks.current.onChange?.(pending);}
      catch (e) {if (alive.current) callbacks.current.onError((e as Error).message);}
    }
    saving.current = false;
    if (alive.current) setDraft(null);
  }
  function resize(pixels: number) {
    if (!bounds) return value;
    const next = mapHeightScale(Math.max(bounds.min, Math.min(bounds.max, pixels)) / bounds.base);
    setDraft(next);
    return next;
  }
  return <aside className="daily-map resizable-map" style={{"--map-height-scale": value, ...(height === undefined ? {} : {"--map-height": `${height}px`})} as CSSProperties}>
    {children}
    <button type="button" className="map-resize-handle" data-no-pull-refresh="true" role="slider" aria-label="지도 높이 조절" aria-orientation="vertical" aria-valuemin={bounds?.min ?? 230} aria-valuemax={bounds?.max ?? 345} aria-valuenow={Math.round(height ?? 230)} aria-valuetext={`${Math.round(height ?? 230)}픽셀`} aria-disabled={bounds?.min === bounds?.max}
      onPointerDown={e=>{if(e.button!==0 || !bounds || bounds.min===bounds.max)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={pointer:e.pointerId,y:e.clientY,height:height!};}}
      onPointerMove={e=>{const start=drag.current;if(start?.pointer===e.pointerId)resize(start.height+e.clientY-start.y);}}
      onPointerUp={e=>{const start=drag.current;if(start?.pointer!==e.pointerId)return;const next=resize(start.height+e.clientY-start.y);drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);void persist(next);}}
      onPointerCancel={()=>{drag.current=null;if(!saving.current)setDraft(null);}}
      onLostPointerCapture={()=>{if(drag.current){drag.current=null;if(!saving.current)setDraft(null);}}}
      onKeyDown={e=>{if(!bounds)return;const target=e.key==="Home"?bounds.min:e.key==="End"?bounds.max:e.key==="ArrowDown"?height!+20:e.key==="ArrowUp"?height!-20:null;if(target===null)return;e.preventDefault();void persist(resize(target));}}
      onDoubleClick={()=>void persist(1)}><span/></button>
  </aside>;
}
