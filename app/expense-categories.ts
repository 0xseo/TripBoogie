import type { Category, TripSettings } from "./types";
export const defaultExpenseCategories: Category[] = [
  { id: "flight", label: "항공" },
  { id: "stay", label: "숙소" },
  { id: "transport", label: "교통" },
  { id: "food", label: "식비" },
  { id: "activity", label: "관광" },
];
export function expenseCategories(settings: TripSettings) {
  const saved = settings.expenseCategories || [];
  return [
    ...saved,
    ...defaultExpenseCategories.filter(
      (c) => !saved.some((s) => s.id === c.id),
    ),
  ];
}
export function bookingExpenseCategory(type: unknown) {
  return type === "flight"
    ? "flight"
    : type === "hotel"
      ? "stay"
      : type === "tour"
        ? "activity"
        : "transport";
}
