import type { CurrentUser } from "../types";
import type { PlaceDetails, TravelImage } from "../media";
import { mediaImage } from "../media";
import { boundedJson } from "./http";
import { ApiError, readJson } from "./validation";
import { distanceMeters } from "../route-graph";
type Deps = { key: string; resolveUser: (r: Request) => Promise<CurrentUser | null>; budget: (r: Request) => Promise<unknown>; fetch?: typeof fetch };
const cache = new Map<string, { expires: number; value: PlaceDetails }>();
const plain = (v: unknown, max = 400) => typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").slice(0,max) : "";
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function createPlaceDetailsHandler(deps: Deps) {
 return async (request: Request) => {
  const headers = { "Cache-Control":"private, no-store", Vary:"Authorization" };
  try {
   const input = await readJson(request);
   if (!await deps.resolveUser(request)) throw new ApiError(401,"로그인이 필요합니다.");
   if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 300 || typeof input.lat !== "number" || typeof input.lng !== "number" || !Number.isFinite(input.lat) || !Number.isFinite(input.lng) || Math.abs(input.lat)>90 || Math.abs(input.lng)>180 || !["city","place"].includes(String(input.kind))) throw new ApiError(400,"장소 정보를 확인하세요.");
   if (input.providerId !== undefined && (typeof input.providerId !== "string" || !/^[a-f0-9]{10,2048}$/.test(input.providerId))) throw new ApiError(400,"장소 식별자를 확인하세요.");
   if (input.query !== undefined && (typeof input.query !== "string" || !input.query.trim() || input.query.length > 200)) throw new ApiError(400,"사진 검색어를 확인하세요.");
   const key = JSON.stringify([input.kind,input.name,input.lat,input.lng,input.providerId,input.query]);
   const now = Date.now();
   for (const [k,v] of cache) if(v.expires<now) cache.delete(k);
   const cached = cache.get(key); if(cached) return Response.json(cached.value,{headers});
   const totalDeadline=AbortSignal.timeout(24000);
   const get = async (base: string, params: Record<string,string>) => {
    const url = new URL(base);url.search = new URLSearchParams(params).toString();
    await deps.budget(request);
    const response = await (deps.fetch ?? fetch)(url,{redirect:"error",signal:AbortSignal.any([request.signal,totalDeadline,AbortSignal.timeout(7000)]),headers:{"User-Agent":"TripBoogie/0.1 (https://tripboogie.0xseo94.com)",Accept:"application/json"}});
    if(!response.ok) throw new Error("Provider unavailable");
    return obj(await boundedJson(response));
   };
   const commons = async (params: Record<string,string>): Promise<TravelImage[]> => {
    const root = await get("https://commons.wikimedia.org/w/api.php",{action:"query",format:"json",formatversion:"2",prop:"imageinfo",iiprop:"url|extmetadata",iiurlwidth:"960",...params});
    const pages = obj(root.query).pages;
    if(!Array.isArray(pages)) return [];
    return pages.flatMap((raw) => {
     const page=obj(raw);const info=Array.isArray(page.imageinfo)?obj(page.imageinfo[0]):{};const meta=obj(info.extmetadata);
     const license=plain(obj(meta.LicenseShortName).value,100);
     if(!/CC[- ]?(BY|0)|public domain|^PD|GFDL/i.test(license)) return [];
     let licenseUrl=String(obj(meta.LicenseUrl).value || "https://commons.wikimedia.org/wiki/Commons:Licensing");
     if(licenseUrl.startsWith("//")) licenseUrl="https:"+licenseUrl;licenseUrl=licenseUrl.replace(/^http:/,"https:");
     const image=mediaImage({url:info.thumburl || info.url,sourceUrl:info.descriptionurl,title:plain(page.title,300).replace(/^File:/,""),author:plain(obj(meta.Artist).value),license,licenseUrl});
     return image?[image]:[];
    }).slice(0,8);
   };
   if(input.query) {
    const photos=await commons({generator:"search",gsrnamespace:"6",gsrsearch:`${input.query} filetype:bitmap`,gsrlimit:"8"});
    return Response.json({photos,openingHours:"",sourceUrl:"",checkedAt:new Date().toISOString()},{headers});
   }
   let id = input.providerId as string | undefined;
   if(input.kind!=="city" && !id && deps.key) {
    const search=await get("https://api.geoapify.com/v1/geocode/search",{text:input.name,lang:"en",limit:"5",...(input.kind==="city"?{type:"city"}:{}),bias:`proximity:${input.lng},${input.lat}`,apiKey:deps.key});
    const match=Array.isArray(search.features)?search.features.map((v)=>obj(obj(v).properties)).find((p)=>typeof p.lat==="number"&&typeof p.lon==="number"&&distanceMeters({lat:input.lat as number,lng:input.lng as number},{lat:p.lat as number,lng:p.lon as number})<(input.kind==="city"?20000:200)):undefined;
    if(match && typeof match.place_id === "string") id=match.place_id;
   }
   let properties:Record<string,unknown>={};
   if(input.kind!=="city" && id && deps.key) {
    const detail=await get("https://api.geoapify.com/v2/place-details",{id,features:"details",apiKey:deps.key});
    const feature=Array.isArray(detail.features)?detail.features.find((v)=>obj(obj(v).properties).feature_type==="details"):undefined;
    properties=obj(obj(feature).properties);
   }
   const raw=obj(obj(properties.datasource).raw), wiki=obj(properties.wiki_and_media);
   const openingHours=plain(properties.opening_hours || raw.opening_hours,1000);
   const osmType={n:"node",w:"way",r:"relation"}[String(raw.osm_type) as "n"|"w"|"r"];
   const sourceUrl=osmType && /^[0-9]+$/.test(String(raw.osm_id))?`https://www.openstreetmap.org/${osmType}/${raw.osm_id}`:"";
   let photos:TravelImage[]=[];
   let wikidata=wiki.wikidata || raw.wikidata;
   if(!wikidata && (properties.name || input.kind==="city")) {
    const country=String(properties.country_code??"").toUpperCase();
    const name=String(properties.name||input.name);
    const lang=/[가-힣]/.test(name)?"ko":country==="JP"?"ja":country==="KR"?"ko":/[\u4e00-\u9fff]/.test(name)?"zh":"en";
    try {
     const article=await get(`https://${lang}.wikipedia.org/w/api.php`,{action:"query",format:"json",formatversion:"2",titles:name,redirects:"1",prop:"coordinates|pageprops",coprimary:"primary"});
     const pages=obj(article.query).pages;
     const page=Array.isArray(pages)?obj(pages[0]):{};
     const c=Array.isArray(page.coordinates)?obj(page.coordinates[0]):{};
     if(typeof c.lat==="number"&&typeof c.lon==="number"&&distanceMeters({lat:input.lat as number,lng:input.lng as number},{lat:c.lat,lng:c.lon})<(input.kind==="city"?25000:500)) wikidata=obj(page.pageprops).wikibase_item;
    }catch { }
   }
   if(typeof wikidata === "string" && /^Q[1-9][0-9]*$/.test(wikidata)) {
    try {
     const entity=await get("https://www.wikidata.org/w/api.php",{action:"wbgetentities",format:"json",ids:wikidata,props:"claims"});
     const claims=obj(obj(obj(entity.entities)[wikidata]).claims).P18;
     const titles=Array.isArray(claims)?claims.map((v)=>obj(obj(obj(v).mainsnak).datavalue).value).filter((v):v is string=>typeof v==="string").slice(0,8):[];
     if(titles.length) photos=await commons({titles:titles.map((v)=>"File:"+v).join("|")});
    }catch { /* Optional image failure does not discard verified opening hours. */ }
   }
   // City surroundings are suitable as city covers; unverified nearby photos are
   // never labelled as a specific POI's own photo.
   if(!photos.length && input.kind === "city") {
    try { photos=await commons({generator:"geosearch",ggscoord:`${input.lat}|${input.lng}`,ggsradius:"10000",ggsnamespace:"6",ggslimit:"8"}); }catch { }
   }
   const value:PlaceDetails={photos,openingHours,sourceUrl,checkedAt:new Date().toISOString()};
   if(cache.size>=128) cache.delete(cache.keys().next().value!);
   cache.set(key,{value,expires:now+(photos.length?86400000:300000)});
   return Response.json(value,{headers});
  }catch(error) {
   return Response.json({error:error instanceof ApiError?error.message:"장소 상세정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."},{status:error instanceof ApiError?error.status:503,headers});
  }
 };
}
