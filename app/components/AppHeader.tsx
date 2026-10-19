"use client";
import {Pencil} from "lucide-react";
import type {Trip} from "../types";
import type {TripTab} from "../navigation";
import {dateLabel} from "./ui";
import TabMascot,{headerMascot} from "./TabMascot";
export default function AppHeader({trip,tab,guestSettings=false,disabled=false,onHome,onTrip}:{trip:Trip|null;tab:TripTab|"home";guestSettings?:boolean;disabled?:boolean;onHome:()=>void;onTrip:()=>void}) {
  if (guestSettings) return null;
  const mascot=headerMascot(tab);
  return <header className="app-header" data-page={tab}>
    {trip?<button type="button" className="trip-header-link" onClick={onTrip}><strong>{trip.title}</strong><span>{trip.destination} · {dateLabel(trip.startDate)} – {dateLabel(trip.endDate)}<Pencil size={12} aria-hidden="true"/></span></button>:<button type="button" className="app-header-brand" onClick={onHome} disabled={disabled} aria-label="트립부기 · 여행 노트 홈"><TabMascot kind={mascot} className="header-logo"/><strong>트립부기</strong></button>}
    {trip&&<div className="app-header-actions"><TabMascot kind={mascot} className="header-mascot"/></div>}
  </header>;
}
