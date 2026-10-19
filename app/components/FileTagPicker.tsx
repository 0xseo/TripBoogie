"use client";
import {useState} from "react";
import {Check,LoaderCircle} from "lucide-react";
import type {Category} from "../types";
import {Dialog} from "./ui";
export default function FileTagPicker({title,tags,selected,onSave,onClose}:{title:string;tags:Category[];selected:string[];onSave:(ids:string[])=>Promise<void>;onClose:()=>void}){
 const [picked,setPicked]=useState(selected),[busy,setBusy]=useState(false),[error,setError]=useState("");
 return <Dialog title={title} onClose={onClose}><form className="stack" onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");try{await onSave(picked);onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><div className="file-tag-choices">{tags.map(tag=><button type="button" key={tag.id} disabled={busy} aria-pressed={picked.includes(tag.id)} onClick={()=>setPicked(picked.includes(tag.id)?picked.filter(id=>id!==tag.id):[...picked,tag.id])}><span>{tag.label}</span><span className="file-tag-check">{picked.includes(tag.id)&&<Check size={15}/>}</span></button>)}</div>{!tags.length&&<p className="muted">분류 설정에서 태그를 추가해북</p>}<button type="button" className="text-button" disabled={busy||!picked.length} onClick={()=>setPicked([])}>전체 해제</button>{error&&<p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?<LoaderCircle size={20} className="spinner"/>:"적용"}</button></form></Dialog>;
}
