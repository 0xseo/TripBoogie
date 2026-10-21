"use client";
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Spinner from "./Spinner";

const locks = new WeakMap<HTMLElement, { count: number; previous: boolean }>();
const subscribe = () => () => {};

export default function LoadingOverlay({ label, request = false }: { label: string; request?: boolean }) {
  // A modal is in the browser's top layer. Place its loader inside that layer.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const root = mounted ? Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).at(-1) ?? document.body : null;
  useEffect(() => {
    if (!root) return;
    const surface = root === document.body ? document.querySelector("main") : root.querySelector<HTMLElement>(".dialog-inner");
    if (!surface) return;
    const lock = locks.get(surface) ?? { count: 0, previous: surface.inert };
    lock.count++; locks.set(surface, lock); surface.inert = true;
    return () => {
      if (--lock.count === 0) { surface.inert = lock.previous; locks.delete(surface); }
    };
  }, [root]);
  return root ? createPortal(<div className={`refresh-overlay ${request ? "request-loading-overlay" : ""}`} role="status" aria-live="polite" aria-label={label}>
    <Spinner size={40} className="refresh-spinner" />
  </div>, root) : null;
}
