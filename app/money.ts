// Six decimal places match the database boundary; split rounding is exact.
const scale = BigInt(1000000);
export function units(value: unknown): bigint {
  const s = String(value);
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(s))
    throw new Error("금액은 0 이상, 소수점 6자리 이내로 입력하세요.");
  const [a, b = ""] = s.split(".");
  return BigInt(a) * scale + BigInt(b.padEnd(6, "0"));
}
export function decimal(v: bigint) {
  return (
    `${v / scale}.${String(v % scale).padStart(6, "0")}`.replace(
      /\.?0+$/,
      "",
    ) || "0"
  );
}
export function splitAmount(amount: string, count: number, precision = 6) {
  if (!count) return [];
  const all = units(amount);
  let quantum = BigInt(10) ** BigInt(6 - Math.max(0, Math.min(6, precision)));
  // Preserve explicitly entered sub-minor amounts instead of discarding money.
  if (all % quantum !== BigInt(0)) quantum = BigInt(1);
  const total = all / quantum,
    n = BigInt(count),
    each = total / n,
    rest = total % n;
  return Array.from({ length: count }, (_, i) =>
    decimal((each + (BigInt(i) < rest ? BigInt(1) : BigInt(0))) * quantum),
  );
}
export function currencyDigits(currency: string) {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}
export function convert(amount: string, rate: string, inverse = false) {
  const a = units(amount),
    r = units(rate);
  if (!r) throw new Error("환율은 0보다 커야 합니다.");
  const v = inverse
    ? (a * scale + r / BigInt(2)) / r
    : (a * r + scale / BigInt(2)) / scale;
  return decimal(v);
}

/** Sum recorded counterparts, never revalue past expenses at a live exchange rate. */
export function recordedExpenseTotals(records: { data: Record<string, unknown> }[], fallbackCurrency: string) {
  const sums = new Map<string, bigint>();
  for (const { data } of records) {
    const base = String(data.baseCurrency || data.currency || fallbackCurrency);
    const trip = String(data.tripCurrency || data.currency || fallbackCurrency);
    const values: [string, unknown][] = [[base, data.baseAmount ?? data.amount ?? 0]];
    if (trip !== base) values.push([trip, data.tripAmount ?? data.amount ?? 0]);
    for (const [currency, amount] of values)
      sums.set(currency, (sums.get(currency) || BigInt(0)) + units(amount));
  }
  return [...sums].map(([currency, amount]) => ({ currency, amount: decimal(amount) }));
}
