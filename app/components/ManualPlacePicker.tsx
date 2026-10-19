"use client";
import {useState} from "react";
import MapPanel from "../MapPanel";
import type {MapPlace} from "../server/maps";
import {Dialog,Field} from "./ui";
import styles from "./ManualPlacePicker.module.css";

export default function ManualPlacePicker({initial,center,onChoose,onClose}:{
 initial?:MapPlace;center?:{lat:number;lng:number};onChoose:(p:MapPlace)=>void;onClose:()=>void;
}) {
 const [point,setPoint]=useState<MapPlace|null>(initial??null),[name,setName]=useState(initial?.name??"");
 return <Dialog fullScreen title="지도에서 위치 선택" onClose={onClose}>
  <div className={styles.shell}>
   <div className={styles.map}>
    <MapPanel interactive center={center} points={point?[{...point,name:name.trim()||"선택한 위치",id:"manual",planId:"manual",number:0}]:[]}
     onClick={(lat,lng)=>setPoint({lat,lng,name,address:`${lat.toFixed(5)}, ${lng.toFixed(5)}`})} label="직접 위치 선택 지도"/>
    {!point&&<p className={styles.hint}>원하는 위치를 눌러북</p>}
    {point&&<div className={styles.details}><Field label="장소 이름"><input aria-label="직접 선택한 장소 이름" placeholder="이름" value={name} maxLength={300} onChange={e=>setName(e.target.value)}/></Field><small>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</small></div>}
   </div>
   <div className={styles.footer}>
    <button type="button" className="primary" disabled={!point||!name.trim()} onClick={()=>{if(point&&name.trim())onChoose({...point,name:name.trim()});}}>이 위치로 정해북</button>
   </div>
  </div>
 </Dialog>;
}
