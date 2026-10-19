"use client";
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import Dialog from "./Dialog";
export default function ChoiceField({label,value,options,onChange,disabled=false}:{label:string;value:string;options:{id:string;label:string}[];onChange:(v:string)=>void;disabled?:boolean}) {
 const [open,setOpen]=useState(false);
 return <><button type="button" className="choice-field" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(true)}><span>{options.find(o=>o.id===value)?.label||value||"선택"}</span><ChevronDown size={17}/></button>{open&&<Dialog title={label} onClose={()=>setOpen(false)}><div className="choice-options">{options.map(o=><button type="button" key={o.id} aria-pressed={value===o.id} onClick={()=>{onChange(o.id);setOpen(false);}}><span>{o.label}</span>{value===o.id&&<Check size={18}/>}</button>)}</div></Dialog>}</>;
}
