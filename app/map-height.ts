export function mapHeightBounds(viewportHeight: number, compact: boolean) {
  const base = compact ? 230 : 390;
  const cap = Math.floor(viewportHeight * (compact ? .5 : 2 / 3));
  return {base, min: Math.min(base, cap), max: Math.min(base * 1.5, cap)};
}
export function mapHeightScale(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.min(1.5, value)) : 1;
}
