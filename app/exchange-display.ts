const amountFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const valueFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

/** Display only. Expense conversion always keeps the provider's original rate. */
export function formatExchangeRate(from: string, to: string, rate: number) {
  if (!Number.isFinite(rate) || rate <= 0) return "—";
  const amount = rate < 1 ? 10 ** Math.ceil(-Math.log10(rate)) : 1;
  const value = amount * rate;
  if (!Number.isFinite(amount) || !Number.isFinite(value)) return "—";
  return `${amountFormat.format(amount)} ${from} ≈ ${valueFormat.format(value)} ${to}`;
}
