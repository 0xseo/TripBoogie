"use client";
import {useEffect,useState} from "react";
import {createPortal} from "react-dom";
import {Check} from "lucide-react";
export default function Toast({message}:{message:string}){
 const [target,setTarget]=useState<HTMLElement|null>(null);
 useEffect(()=>{const update=()=>setTarget(Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(-1)||document.body);update();const observer=new MutationObserver(update);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["open"]});return()=>observer.disconnect();},[]);
 return target?createPortal(<div className="toast" role="status"><Check size={19}/>{message}</div>,target):null;
}
