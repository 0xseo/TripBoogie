"use client";
import {useEffect,useRef,useSyncExternalStore,type ReactNode} from "react";
import {revealFocusedInput} from "./KeyboardFocus";
import {createPortal} from "react-dom";
import {X,ArrowLeft} from "lucide-react";
const dialogs:HTMLDialogElement[]=[];
let originalOverflow="";
const subscribe=()=>()=>{};
export default function Dialog({title,children,onClose,wide=false,fullScreen=false,mobilePage=false,onBack,hideTitle=false}:{title:string;onBack?:()=>void;hideTitle?:boolean;children:ReactNode;onClose:()=>void;wide?:boolean;fullScreen?:boolean;mobilePage?:boolean}) {
 const mounted=useSyncExternalStore(subscribe,()=>true,()=>false);
 const ref=useRef<HTMLDialogElement>(null),outside=useRef(false);
 useEffect(()=>{
  if(!mounted)return;
  const d=ref.current;if(!d)return;
  if(!dialogs.length){originalOverflow=document.body.style.overflow;document.body.style.overflow="hidden";}
  dialogs.push(d);d.showModal();
  const viewport=window.visualViewport;
  const fit=()=>{d.style.setProperty("--dialog-vh",`${viewport?.height||window.innerHeight}px`);d.style.setProperty("--dialog-top",`${viewport?.offsetTop||0}px`);};
  const focus=()=>{requestAnimationFrame(()=>{if(dialogs.at(-1)!==d)return;revealFocusedInput(d);});};
  const resize=()=>{fit();focus();};fit();window.addEventListener("resize",resize);viewport?.addEventListener("resize",resize);viewport?.addEventListener("scroll",resize);d.addEventListener("focusin",focus);
  return()=>{window.removeEventListener("resize",resize);viewport?.removeEventListener("resize",resize);viewport?.removeEventListener("scroll",resize);d.removeEventListener("focusin",focus);const index=dialogs.indexOf(d);if(index>=0)dialogs.splice(index,1);d.close();if(!dialogs.length)document.body.style.overflow=originalOverflow;};
 },[mounted]);
 if(!mounted)return null;
 return createPortal(<dialog ref={ref} aria-label={title} className={`dialog ${wide?"wide":""} ${fullScreen?"full-screen-dialog":""} ${mobilePage?"mobile-page-dialog":""}`} onCancel={e=>{e.preventDefault();e.stopPropagation();if(dialogs.at(-1)===ref.current)onClose();}} onPointerDown={e=>{e.stopPropagation();outside.current=e.target===e.currentTarget;}} onClick={e=>{e.stopPropagation();if(outside.current&&e.target===e.currentTarget&&dialogs.at(-1)===ref.current)onClose();outside.current=false;}}><div className="dialog-inner"><header>{onBack&&<button type="button" className="icon" aria-label="입력 화면으로 돌아가기" onClick={onBack}><ArrowLeft/></button>}{!hideTitle&&<h2>{title}</h2>}<button type="button" className="icon" aria-label="닫기" onClick={onClose}><X/></button></header>{children}</div></dialog>,document.body);
}
