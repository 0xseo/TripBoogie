"use client";
import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { Dialog } from "./ui";
function Wheel({value,count,label,onChange}:{value:string;count:number;label:string;onChange:(v:string)=>void}) {
 const ref=useRef<HTMLDivElement>(null),initial=useRef(value);
 useEffect(()=>{const root=ref.current;if(!root)return;let initialized=false;const frame=requestAnimationFrame(()=>{root.scrollTo({top:Number(initial.current)*44,behavior:"instant"});initialized=true;});const changed=()=>{if(initialized)onChange(String(Math.max(0,Math.min(count-1,Math.round(root.scrollTop/44)))).padStart(2,"0"));};root.addEventListener("scroll",changed);return()=>{cancelAnimationFrame(frame);root.removeEventListener("scroll",changed);};},[count,onChange]);
 return <div className="time-wheel-wrap"><small>{label}</small><div className="time-wheel" ref={ref} role="listbox" aria-label={label}>{Array.from({length:count},(_,i)=>String(i).padStart(2,"0")).map(v=><button key={v} type="button" role="option" aria-selected={v===value} onClick={()=>{onChange(v);ref.current?.scrollTo({top:Number(v)*44,behavior:"instant"});}}>{v}</button>)}</div></div>;
}
export default function TimeField({value,onChange,disabled=false,label="시간",showLabel=false}:{value:string;onChange:(v:string)=>void;disabled?:boolean;label?:string;showLabel?:boolean}) {
 const [open,setOpen]=useState(false),[hour,setHour]=useState("09"),[minute,setMinute]=useState("00");
 return <><button type="button" className={`time-trigger ${value?"has-time":""}`} aria-label={`${label}${value?` ${value}`:" 추가"}`} disabled={disabled} onClick={()=>{setHour(value.slice(0,2)||"09");setMinute(value.slice(3,5)||"00");setOpen(true);}}><Clock size={16}/>{showLabel&&<span>{label}</span>}{value&&<span>{value}</span>}</button>{open&&<Dialog title={label} onClose={()=>setOpen(false)}><div className="time-picker"><Wheel value={hour} count={24} label="시" onChange={setHour}/><span>:</span><Wheel value={minute} count={60} label="분" onChange={setMinute}/></div><div className="filter-actions"><button className="secondary" type="button" onClick={()=>{onChange("");setOpen(false);}}>시간 지우기</button><button className="primary" type="button" onClick={()=>{onChange(`${hour}:${minute}`);setOpen(false);}}>적용</button></div></Dialog>}</>;
}
