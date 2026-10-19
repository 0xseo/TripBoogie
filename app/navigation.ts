export const preparationTabs = [
  { id: "checklist", label: "체크리스트" },
  { id: "expenses", label: "경비" },
  { id: "bookings", label: "예약" },
  { id: "categories", label: "분류 설정" },
] as const;
export type PreparationTab = typeof preparationTabs[number]["id"];
export type TripTab = "plan" | "files" | PreparationTab | "tools" | "settings";
export type MobileSection = "plan" | "prepare" | "home" | "tools" | "settings";
export function isPreparationTab(tab: TripTab): tab is PreparationTab {
  return preparationTabs.some(t => t.id === tab);
}
export function mobileSection(tab: TripTab): MobileSection {
  return isPreparationTab(tab)||tab==="files" ? "prepare" : tab;
}
export function sectionDestination(section: MobileSection, lastPreparation: PreparationTab, reselected=false): TripTab | null {
  return section === "home" ? null : section === "prepare" ? reselected ? "checklist" : lastPreparation : section;
}
