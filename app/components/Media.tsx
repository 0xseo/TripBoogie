"use client";
import { useEffect, useState, useRef } from "react";
import { apiFetch as api, jsonRequest } from "../client-api";
import { mediaImage, type PlaceDetails, type TravelImage } from "../media";
import type { TravelCity } from "../types";
import { Dialog } from "./ui";
type Location = { name: string; lat: number; lng: number; providerId?: string };
const requests = new Map<string, Promise<PlaceDetails>>();
export function loadDetails(place: Location, kind: "city" | "place", refresh = false): Promise<PlaceDetails> {
  const body = { name: place.name, lat:place.lat, lng:place.lng, providerId:place.providerId, kind };
  const key = JSON.stringify(body);
  if (refresh) requests.delete(key);
  let request = requests.get(key);
  if (!request) {
    request = api<PlaceDetails>("/api/maps/details", jsonRequest(body)).catch((e) => { requests.delete(key); throw e; });
    if (requests.size >= 128) requests.delete(requests.keys().next().value!);
    requests.set(key, request);
    request.then(result=>{if(!result.photos.length)requests.delete(key);}).catch(()=>{});
  }
  return request;
}
export function ImageCredit({image}:{image:TravelImage}) {
 return <small className="image-credit"><a href={image.sourceUrl} target="_blank" rel="noreferrer">사진: {image.author || "Wikimedia Commons"}</a><span> · </span><a href={image.licenseUrl} target="_blank" rel="noreferrer">{image.license}</a></small>;
}
export function Photo({image,alt,className}:{image:TravelImage;alt:string;className?:string}) {
 // eslint-disable-next-line @next/next/no-img-element
 return <img className={className} src={image.url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.hidden=true;}} />;
}
export function CityCover({city}:{city?:TravelCity}) {
 const [automatic,setAutomatic]=useState<TravelImage|null>(null);
 const name=city?.name, lat=city?.lat, lng=city?.lng, providerId=city?.providerId, saved=city?.image, disabled=city?.imageDisabled;
 useEffect(()=>{let live=true;if(name&&lat!==undefined&&lng!==undefined&&!saved&&!disabled)void loadDetails({name,lat,lng,providerId},"city").then(r=>{if(live)setAutomatic(r.photos[0]??null);}).catch(()=>{});return()=>{live=false;};},[name,lat,lng,providerId,saved,disabled]);
 const image=mediaImage(disabled?null:saved||automatic);
 return image?<div className="city-cover-media"><Photo image={image} alt={`${name} 풍경`} className="city-cover-photo"/><ImageCredit image={image}/></div>:null;
}
export function ImagePicker({place,onChoose,onClose}:{place:Location;onChoose:(image:TravelImage|null)=>void;onClose:()=>void}) {
 const [query,setQuery]=useState(place.name),[photos,setPhotos]=useState<TravelImage[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState("");
 const {name,lat,lng,providerId}=place;
 useEffect(()=>{let active=true;void loadDetails({name,lat,lng,providerId},"city").then(r=>{if(active)setPhotos(r.photos);}).catch(()=>{if(active)setError("자동 사진을 찾지 못했어요. 검색어로 다시 찾아보세요.");}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[name,lat,lng,providerId]);
 async function search(){setBusy(true);setError("");try{const r=await api<PlaceDetails>("/api/maps/details",jsonRequest({name,lat,lng,kind:"city",query}));setPhotos(r.photos);if(!r.photos.length)setError("사진을 찾지 못했어요. 도시의 영문명이나 명소 이름도 입력해 보세요.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <Dialog title={`${name} 대표 이미지`} onClose={onClose} wide><div className="stack"><div className="searchbox"><input aria-label="도시 사진 검색어" value={query} maxLength={200} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void search();}}}/><button type="button" disabled={busy||!query.trim()} onClick={()=>void search()}>사진 검색</button></div>{busy&&<p className="muted">공개 사진을 찾는 중이에요…</p>}{error&&<p role="status" className="info">{error}</p>}<div className="image-gallery">{photos.map(image=><figure key={image.url}><button type="button" aria-label={`${image.title} 선택`} onClick={()=>onChoose(image)}><Photo image={image} alt={image.title}/><span>이 사진 선택</span></button><ImageCredit image={image}/></figure>)}</div><button className="secondary" type="button" onClick={()=>onChoose(null)}>대표 이미지 사용 안 함</button></div></Dialog>;
}
export function PlaceMedia({place,compact=false}:{place:Record<string,unknown>;compact?:boolean}) {
 const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const node=ref.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:"180px"});observer.observe(node);return()=>observer.disconnect();},[]);
 const [details,setDetails]=useState<PlaceDetails|null>(null),[photoOpen,setPhotoOpen]=useState(false);
 const name=String(place.name??""),lat=Number(place.lat),lng=Number(place.lng),providerId=typeof place.providerId==="string"?place.providerId:undefined;
 useEffect(()=>{if(!visible)return;let active=true;void loadDetails({name,lat,lng,providerId},"place").then(r=>{if(active)setDetails(r);}).catch(()=>{});return()=>{active=false;};},[name,lat,lng,providerId,visible]);
 const image=mediaImage(place.image)||mediaImage(details?.photos[0]);
 return <div ref={ref} className={`place-media ${compact?"compact":""}`}>{image&&(compact?<><button type="button" className="place-thumbnail" aria-label={`${name} 사진·저작자 정보`} onClick={()=>setPhotoOpen(true)}><Photo image={image} alt={`${name} 사진`}/><span aria-hidden="true">ⓘ</span></button>{photoOpen&&<Dialog title={`${name} 사진`} onClose={()=>setPhotoOpen(false)}><figure className="place-photo-view"><Photo image={image} alt={`${name} 사진`}/><ImageCredit image={image}/></figure></Dialog>}</>:<figure><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`} target="_blank" rel="noreferrer"><Photo image={image} alt={`${name} 사진`}/></a><ImageCredit image={image}/></figure>)}</div>;
}
