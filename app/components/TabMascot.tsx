"use client";
import Image from "next/image";
import type { MobileSection, TripTab } from "../navigation";
import {mobileSection} from "../navigation";
import styles from "./TabMascot.module.css";
export type Mascot = MobileSection;
export function sidebarMascot(tab: TripTab | "home"): Mascot {
  if (tab === "home" || tab === "settings") return "home";
  if (tab === "plan" || tab === "expenses") return "plan";
  if (tab === "categories" || tab === "tools") return "tools";
  return "prepare";
}
export function headerMascot(tab: TripTab | "home"): Mascot {
  return tab === "home" ? "home" : mobileSection(tab);
}
const art = {plan:"itinerary",prepare:"prepare",home:"home",tools:"tools",settings:"settings"} as const;
export default function TabMascot({kind,className=""}:{kind:Mascot;className?:string}) {
  return <span className={`${styles.frame} ${className}`} data-mascot={kind} aria-hidden="true"><span className={styles.artwork}>{(Object.entries(art) as [Mascot,string][]).map(([id,file])=><Image key={id} className={styles[id]} data-active={kind===id} sizes="(max-width:960px) 128px, 384px" src={`/mascots/${file}.png`} alt="" width={300} height={300} draggable={false} loading="eager" decoding="sync" onLoad={event=>{void event.currentTarget.decode().catch(()=>{});}}/>)}</span></span>;
}
