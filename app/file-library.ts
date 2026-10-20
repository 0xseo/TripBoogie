import type {Category,TripFile,TripSettings} from "./types";
import {bookingCategories} from "./booking-categories";
const fileNameOrder=new Intl.Collator("ko",{numeric:true,sensitivity:"base"});
const uploadedDate=new Intl.DateTimeFormat("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit"});
export type FileSort="newest"|"oldest"|"name"|"size";
export const fileSortOptions=[{id:"newest",label:"최신순"},{id:"oldest",label:"오래된순"},{id:"name",label:"이름순"},{id:"size",label:"크기순"}];
export function fileTagCategories(settings:TripSettings):Category[]{const defaults=bookingCategories(settings).map(({id,label})=>({id,label})),base=settings.fileTags??defaults;return [...base,...defaults.filter(t=>["hotel","flight","tour"].includes(t.id)&&!base.some(b=>b.id===t.id))];}
export function visibleFiles(files:TripFile[],sort:FileSort,tags:string[],query=""){
 const normalized=query.trim().normalize("NFKC").toLocaleLowerCase();
 const filtered=files.filter(file=>(!tags.length||tags.some(tag=>(file.tags??[]).includes(tag)))&&file.name.normalize("NFKC").toLocaleLowerCase().includes(normalized));
 const stamp=(file:TripFile)=>Date.parse(file.created_at)||0;
 return filtered.sort((a,b)=>{
  const order=sort==="name"?fileNameOrder.compare(a.name,b.name):sort==="size"?b.size-a.size:sort==="oldest"?stamp(a)-stamp(b):stamp(b)-stamp(a);
  return order||a.id.localeCompare(b.id);
 });
}
export function fileUploadedDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?"":uploadedDate.format(date);}
