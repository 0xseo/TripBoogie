"use client";
import { useEffect, useState, useRef } from "react";
import { apiFetch as api, jsonRequest } from "../client-api";
import { mediaImage, type PlaceDetails, type TravelImage } from "../media";
import { Dialog } from "./ui";
type Location = { name: string; lat: number; lng: number; providerId?: string };
const requests = new Map<string, Promise<PlaceDetails>>();
function loadDetails(place: Location): Promise<PlaceDetails> {
  const body = { name: place.name, lat:place.lat, lng:place.lng, providerId:place.providerId, kind: "place" };
  const key = JSON.stringify(body);
  let request = requests.get(key);
  if (!request) {
    request = api<PlaceDetails>("/api/maps/details", jsonRequest(body)).catch((e) => { requests.delete(key); throw e; });
    if (requests.size >= 128) requests.delete(requests.keys().next().value!);
    requests.set(key, request);
    request.then(result=>{if(!result.photos.length)requests.delete(key);}).catch(()=>{});
  }
  return request;
}
function ImageCredit({image}:{image:TravelImage}) {
 return <small className="image-credit"><a href={image.sourceUrl} target="_blank" rel="noreferrer">사진: {image.author || "Wikimedia Commons"}</a><span> · </span><a href={image.licenseUrl} target="_blank" rel="noreferrer">{image.license}</a></small>;
}
function Photo({image,alt}:{image:TravelImage;alt:string}) {
 // eslint-disable-next-line @next/next/no-img-element
 return <img src={image.url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={(e)=>{e.currentTarget.hidden=true;}} />;
}
export function PlaceMedia({place,compact=false}:{place:Record<string,unknown>;compact?:boolean}) {
 const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{const node=ref.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:"180px"});observer.observe(node);return()=>observer.disconnect();},[]);
 const [details,setDetails]=useState<PlaceDetails|null>(null),[photoOpen,setPhotoOpen]=useState(false);
 const name=String(place.name??""),lat=Number(place.lat),lng=Number(place.lng),providerId=typeof place.providerId==="string"?place.providerId:undefined;
 useEffect(()=>{if(!visible)return;let active=true;void loadDetails({name,lat,lng,providerId}).then(r=>{if(active)setDetails(r);}).catch(()=>{});return()=>{active=false;};},[name,lat,lng,providerId,visible]);
 const image=mediaImage(place.image)||mediaImage(details?.photos[0]);
 return <div ref={ref} className={`place-media ${compact?"compact":""}`}>{image&&(compact?<><button type="button" className="place-thumbnail" aria-label={`${name} 사진·저작자 정보`} onClick={()=>setPhotoOpen(true)}><Photo image={image} alt={`${name} 사진`}/><span aria-hidden="true">ⓘ</span></button>{photoOpen&&<Dialog title={`${name} 사진`} onClose={()=>setPhotoOpen(false)}><figure className="place-photo-view"><Photo image={image} alt={`${name} 사진`}/><ImageCredit image={image}/></figure></Dialog>}</>:<figure><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`} target="_blank" rel="noreferrer"><Photo image={image} alt={`${name} 사진`}/></a><ImageCredit image={image}/></figure>)}</div>;
}
