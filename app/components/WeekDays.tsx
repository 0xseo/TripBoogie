"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { weekDates, shortDate } from "../calendar";
export default function WeekDays({days,date,onChange}:{days:string[];date:string;onChange:(value:string)=>void}) {
 const week=weekDates(date),start=days[0],end=days.at(-1);
 function move(direction:number){const anchor=new Date(`${week[0]}T12:00:00Z`);anchor.setUTCDate(anchor.getUTCDate()+direction*7);const next=weekDates(anchor.toISOString().slice(0,10)).find(d=>d>=start&&!!end&&d<=end);if(next)onChange(next);}
 return <nav className="week-calendar" aria-label="일정 날짜"><div className="week-weekdays" aria-hidden="true">{["일","월","화","수","목","금","토"].map(d=><span key={d}>{d}</span>)}</div><div className="week-selector"><button type="button" className="icon" aria-label="이전 주" disabled={!start||week[0]<=start} onClick={()=>move(-1)}><ChevronLeft size={19}/></button><div className="week-days">{week.map(d=>{const i=days.indexOf(d);return <button type="button" key={d} disabled={i<0} aria-current={d===date?"date":undefined} aria-label={i<0?shortDate(d):`Day ${i+1} · ${shortDate(d)}`} onClick={()=>onChange(d)}><strong>{i<0?"—":`Day ${i+1}`}</strong><span>{shortDate(d).split(" ")[0]}</span></button>;})}</div><button type="button" className="icon" aria-label="다음 주" disabled={!end||week[6]>=end} onClick={()=>move(1)}><ChevronRight size={19}/></button></div></nav>;
}
