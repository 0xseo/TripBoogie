import {countryCodes,countryCurrencies} from "../countries";
import {boundedJson} from "./http";
import type {MapPlace} from "./maps";
export function cityQuery(query:string,language:string){
 const raw=query.trim(),names=[...new Set([language,"ko","en"])].map(locale=>new Intl.DisplayNames([locale],{type:"region"}));
 const prefixes=countryCodes.flatMap(code=>names.map(display=>({code,name:display.of(code)||code}))).sort((a,b)=>b.name.length-a.name.length);
 const country=prefixes.find(({name})=>raw.toLocaleLowerCase().startsWith(name.toLocaleLowerCase()+" "));
 return {query:country?raw.slice(country.name.length).trim():raw,countryCode:country?.code};
}
export async function searchCities(query:string,language:string,countryCode:string|undefined,fetcher:typeof fetch,signal:AbortSignal):Promise<MapPlace[]>{
 const parsed=cityQuery(query,language),url=new URL("https://geocoding-api.open-meteo.com/v1/search");
 url.search=new URLSearchParams({name:parsed.query,language,count:"8",...(countryCode||parsed.countryCode?{countryCode:countryCode||parsed.countryCode!}:{})}).toString();
 const r=await fetcher(url,{redirect:"manual",cache:"no-store",signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});if(!r.ok)return [];
 const raw=await boundedJson(r,262144) as {results?:unknown[]};
 return (Array.isArray(raw.results)?raw.results:[]).flatMap(value=>{
  if(!value||typeof value!=="object")return [];const p=value as Record<string,unknown>;
  if(typeof p.name!=="string"||typeof p.country_code!=="string"||!/^[A-Z]{2}$/.test(p.country_code)||typeof p.timezone!=="string"||!String(p.feature_code||"").startsWith("PPL")||typeof p.latitude!=="number"||!Number.isFinite(p.latitude)||Math.abs(p.latitude)>90||typeof p.longitude!=="number"||!Number.isFinite(p.longitude)||Math.abs(p.longitude)>180)return [];
  return [{name:p.name,address:[p.country,p.admin1,p.name].filter((s,i,a)=>typeof s==="string"&&a.indexOf(s)===i).join(" · "),lat:p.latitude,lng:p.longitude,countryCode:p.country_code,timezone:p.timezone,currency:countryCurrencies[p.country_code]}];
 });
}
