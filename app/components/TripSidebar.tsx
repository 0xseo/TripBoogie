"use client";
import Image from "next/image";
import {Compass,Settings} from "lucide-react";
import type {ReactNode} from "react";
import TabMascot,{sidebarMascot} from "./TabMascot";
import type {Trip} from "../types";
import type {TripTab} from "../navigation";
import {tripNavigation} from "./TripNavigation";
export default function TripSidebar({selectedTrip,activeTab,home,settings,onHome,onTab,install}:{selectedTrip:Trip|null;activeTab:TripTab|null;home:boolean;settings:boolean;onHome:()=>void;onTab:(tab:TripTab)=>void;install?:ReactNode}){
 return <aside className="sidebar">
  <div className="sidebar-navigation">
  <button type="button" className="brand" onClick={onHome}><Image unoptimized src="/icon-192.png?v=20261019b" width={47} height={47} alt="거북이 부기"/><span>트립부기</span></button>
  <button type="button" className={`side-link ${home?"active":""}`} aria-current={home?"page":undefined} onClick={onHome}><Compass size={21}/>나의 여행</button>
  <button type="button" className={`side-link ${settings?"active":""}`} aria-current={settings?"page":undefined} onClick={()=>onTab("settings")}><Settings size={21}/>설정</button>
  {selectedTrip&&<><div className="side-divider"/><div className="sidebar-trip">{selectedTrip.title}</div>{tripNavigation.filter(t=>t.id!=="settings").map(t=><button type="button" key={t.id} className={`side-link ${activeTab===t.id?"active":""}`} aria-current={activeTab===t.id?"page":undefined} onClick={()=>onTab(t.id)}><t.icon size={21}/>{t.label}</button>)}</>}
  </div><div className="sidebar-footer"><TabMascot kind={sidebarMascot(home||settings?"home":activeTab||"home")} className="sidebar-mascot"/><div className="app-install">{install}</div></div>
 </aside>;
}
