import type { ItemRecord } from "./types";
export function comparePlans(a:ItemRecord,b:ItemRecord) {
  const x=typeof a.data.position==="number"?a.data.position:Number.MAX_SAFE_INTEGER;
  const y=typeof b.data.position==="number"?b.data.position:Number.MAX_SAFE_INTEGER;
  return x-y||String(a.data.time??"").localeCompare(String(b.data.time??""))||a.id.localeCompare(b.id);
}
export function placePoint(place?:ItemRecord) {
  if(!place||place.data.lat===null||place.data.lng===null||place.data.lat===""||place.data.lng===""||place.data.lat===undefined||place.data.lng===undefined)return null;
  const lat=Number(place.data.lat),lng=Number(place.data.lng);
  return Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lng)&&Math.abs(lng)<=180?{lat,lng}:null;
}
// The APK establishes a first-place anchor, not its distance algorithm.
// Use an explicit straight-line ordering and preserve unlocated plans in place.
export function distanceOrder(plans:ItemRecord[],places:ItemRecord[]) {
  const lookup=new Map(places.map(p=>[p.id,p]));
  const located=plans.filter(p=>placePoint(lookup.get(String(p.data.placeId))));
  if(located.length<2)throw new Error("좌표가 있는 장소를 연결한 일정이 두 개 이상 필요합니다.");
  const origin=placePoint(lookup.get(String(located[0].data.placeId)))!;
  const radians=Math.PI/180;
  const distance=(plan:ItemRecord)=>{
    const p=placePoint(lookup.get(String(plan.data.placeId)))!;
    const a=Math.sin((p.lat-origin.lat)*radians/2)**2+Math.cos(origin.lat*radians)*Math.cos(p.lat*radians)*Math.sin((p.lng-origin.lng)*radians/2)**2;
    return 2*Math.asin(Math.min(1,Math.sqrt(a)));
  };
  const ordered=[located[0],...located.slice(1).sort((a,b)=>distance(a)-distance(b)||comparePlans(a,b))];
  let cursor=0;return plans.map(p=>placePoint(lookup.get(String(p.data.placeId)))?ordered[cursor++].id:p.id);
}

export function previousPlanPlace(records: ItemRecord[], date: string, editingId?: string) {
  const ordered = records.filter(r=>r.kind==="plan"&&r.data.date===date&&r.data.entryType!=="memo").sort(comparePlans);
  const index = editingId ? ordered.findIndex(r=>r.id===editingId) : -1;
  const previous = ordered[index >= 0 ? index - 1 : ordered.length - 1];
  if (!previous) return undefined;
  const place = records.find(r=>r.kind==="place"&&r.id===previous.data.placeId);
  const point = placePoint(place);
  return place && point ? {...point,name:String(previous.data.title||place.data.name)} : undefined;
}
