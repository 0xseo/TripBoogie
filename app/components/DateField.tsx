"use client";
import {useState} from "react";
import {CalendarDays} from "lucide-react";
import {DayPicker} from "react-day-picker";
import {ko} from "react-day-picker/locale";
import {Dialog,dateLabel,iso,localDate} from "./ui";
export default function DateField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){const [open,setOpen]=useState(false);return <><button type="button" className="date-trigger" aria-label={`${label} ${value}`} onClick={()=>setOpen(true)}><CalendarDays size={16}/>{value?dateLabel(value):label}</button>{open&&<Dialog title={label} onClose={()=>setOpen(false)}><div className="single-date-calendar"><DayPicker mode="single" locale={ko} weekStartsOn={0} defaultMonth={value?localDate(value):undefined} selected={value?localDate(value):undefined} onSelect={date=>{if(date){onChange(iso(date));setOpen(false);}}}/></div></Dialog>}</>;}
