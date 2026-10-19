"use client";
import { FileText, CalendarDays, Wallet, ListChecks, Hotel, SlidersHorizontal, Compass, Settings, House, PackageCheck } from "lucide-react";
import { mobileSection, preparationTabs, type MobileSection, type TripTab } from "../navigation";
export const tripNavigation = [
  { id: "plan", label: "일정", icon: CalendarDays },
  { id: "expenses", label: "경비", icon: Wallet },
  { id: "checklist", label: "체크리스트", icon: ListChecks },
  { id: "bookings", label: "예약", icon: Hotel },
  { id: "files", label: "자료함", icon: FileText },
  { id: "categories", label: "분류 설정", icon: SlidersHorizontal },
  { id: "tools", label: "여행 도구", icon: Compass },
  { id: "settings", label: "설정", icon: Settings },
] as const;
const mobileItems = [
  { id: "plan", label: "일정", icon: CalendarDays },
  { id: "prepare", label: "준비", icon: PackageCheck },
  { id: "home", label: "홈", icon: House },
  { id: "tools", label: "여행도구", icon: Compass },
  { id: "settings", label: "설정", icon: Settings },
] as const;
export function MobileTripNav({ tab, disabled, onSelect }: { tab: TripTab | "home"; disabled: boolean; onSelect: (section: MobileSection) => void }) {
  return <nav className="mobile-trip-nav" aria-label="모바일 여행 메뉴">{mobileItems.map(item => <button type="button" key={item.id} aria-current={(tab === "home" ? "home" : mobileSection(tab)) === item.id ? "page" : undefined} disabled={disabled} onClick={() => onSelect(item.id)}><item.icon size={23} strokeWidth={(tab === "home" ? "home" : mobileSection(tab)) === item.id ? 2.4 : 1.7}/><span>{item.label}</span></button>)}</nav>;
}
export function PreparationTabs({ tab, disabled, onSelect }: { tab: TripTab; disabled: boolean; onSelect: (tab: TripTab) => void }) {
  if (mobileSection(tab) !== "prepare") return null;
  return <nav className="preparation-tabs" aria-label="준비 메뉴">{preparationTabs.map(item => <button type="button" key={item.id} aria-current={(tab===item.id||(tab==="files"&&item.id==="bookings")) ? "page" : undefined} disabled={disabled} onClick={() => onSelect(item.id)}>{item.label}</button>)}</nav>;
}

export function WorkspaceTabs({tab,disabled,onSelect}:{tab:TripTab;disabled:boolean;onSelect:(tab:TripTab)=>void}){return <nav className="workspace-tabs" aria-label="여행 메뉴">{tripNavigation.filter(t=>t.id!=="settings").map(t=><button type="button" className={tab===t.id?"active":""} disabled={disabled} onClick={()=>onSelect(t.id)} key={t.id}><t.icon size={19}/>{t.label}</button>)}</nav>;}
