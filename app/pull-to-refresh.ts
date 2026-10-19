export const pullRefreshThreshold = 54;

// Claim the first downward move before Safari turns it into viewport scrolling.
export function bindPullRefresh(surface: HTMLElement, options: {
  canStart: (target: EventTarget | null) => boolean;
  isAtTop: () => boolean;
  onPull: (distance: number) => void;
  onRefresh: () => void;
}) {
  let x = 0, y = 0, distance = 0, tracking = false, locked = false;
  const cancel = () => {
    tracking = false;
    locked = false;
    distance = 0;
    options.onPull(0);
  };
  const start = (event: TouchEvent) => {
    tracking = false;
    if (event.touches.length !== 1 || !options.isAtTop() || !options.canStart(event.target)) return;
    x = event.touches[0].clientX;
    y = event.touches[0].clientY;
    distance = 0;
    locked = false;
    tracking = true;
  };
  const move = (event: TouchEvent) => {
    if (!tracking) return;
    if (event.touches.length !== 1 || (!locked && !options.isAtTop())) { cancel(); return; }
    const dx = event.touches[0].clientX - x, dy = event.touches[0].clientY - y;
    if (dy <= 0 || (!locked && Math.abs(dx) > 6 && Math.abs(dx) > dy)) { cancel(); return; }
    if (!locked && dy <= Math.abs(dx)) return;
    locked = true;
    if (event.cancelable) event.preventDefault();
    distance = Math.min(96, dy * 0.6);
    options.onPull(distance);
  };
  const end = (event: TouchEvent) => {
    if (!tracking) return;
    tracking = false;
    if (event.touches.length === 0 && distance >= pullRefreshThreshold) options.onRefresh();
    else cancel();
  };
  surface.addEventListener("touchstart", start, { passive: true, capture: true });
  surface.addEventListener("touchmove", move, { passive: false, capture: true });
  surface.addEventListener("touchend", end, true);
  surface.addEventListener("touchcancel", cancel, true);
  return () => {
    surface.removeEventListener("touchstart", start, { capture: true });
    surface.removeEventListener("touchmove", move, { capture: true });
    surface.removeEventListener("touchend", end, { capture: true });
    surface.removeEventListener("touchcancel", cancel, { capture: true });
  };
}
