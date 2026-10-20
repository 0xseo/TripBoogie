"use client";
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import Dialog from "./Dialog";
type Options={title?:string;confirmLabel?:string;intent?:"default"|"danger"};
type Request={message:string;options:Options;resolve:(answer:boolean)=>void};
type Confirmation={confirm:(message:string,options?:Options)=>Promise<boolean>;cancel:()=>void};
const Context=createContext<Confirmation|null>(null);
export function ConfirmationProvider({children}:{children:ReactNode}){
 const pending=useRef<Request|null>(null),[request,setRequest]=useState<Request|null>(null);
 const finish=useCallback((answer:boolean)=>{const owned=pending.current;pending.current=null;setRequest(null);owned?.resolve(answer);},[]);
 const cancel=useCallback(()=>finish(false),[finish]);
 const confirm=useCallback((message:string,options:Options={})=>new Promise<boolean>(resolve=>{pending.current?.resolve(false);const next={message,options,resolve};pending.current=next;setRequest(next);}),[]);
 useEffect(()=>()=>{pending.current?.resolve(false);pending.current=null;},[]);
 const value=useMemo(()=>({confirm,cancel}),[confirm,cancel]);
 return <Context.Provider value={value}>{children}{request&&<Dialog title={request.options.title||"삭제 확인"} onClose={cancel}><p className="confirm-message">{request.message}</p><div className="confirm-actions"><button type="button" className="secondary" autoFocus onClick={cancel}>취소</button><button type="button" className={request.options.intent==="default"?"primary":"confirm-delete"} onClick={()=>finish(true)}>{request.options.confirmLabel||"삭제"}</button></div></Dialog>}</Context.Provider>;
}
export function useConfirm(){const value=useContext(Context);if(!value)throw new Error("ConfirmationProvider is required");return value.confirm;}
export function useCancelConfirmation(){const value=useContext(Context);if(!value)throw new Error("ConfirmationProvider is required");return value.cancel;}
