"use client";
import { lazy, Suspense, type ComponentType } from "react";
import { LoaderCircle } from "lucide-react";

/** A separate boundary keeps the surrounding navigation visible while a panel loads. */
export function lazyPanel<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
) {
  const Panel = lazy(load);
  return function LazyPanel(props: Props) {
    return (
      <Suspense fallback={<p role="status"><LoaderCircle size={18} className="spinner" /> 불러오는 중…</p>}>
        <Panel {...props} />
      </Suspense>
    );
  };
}
