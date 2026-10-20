import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {querySql} from './supabase-management.mjs';
const apply=process.argv.includes('--apply');
const airports=JSON.parse(await readFile(new URL('../app/data/airports.json',import.meta.url),'utf8'));
const byCode=new Map(),byName=new Map();
const normalize=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/international|airport|국제|공항/g,'').replace(/[^\p{L}\p{N}]/gu,'');
for(const airport of airports){
 for(const code of [airport.icao,airport.iata].filter(Boolean))if(!byCode.has(code))byCode.set(code,airport);
 for(const label of [airport.name,...airport.aliases]){const key=normalize(label);const rows=byName.get(key)||[];if(!rows.includes(airport))rows.push(airport);byName.set(key,rows);}
}
function resolve(saved,label){
 const code=String(label||'').match(/\(([A-Z0-9]{3,8})\)/)?.[1]||String(label||'').trim().toUpperCase();
 const exact=byName.get(normalize(saved?.name||label));
 const airport=byCode.get(saved?.icao)||byCode.get(saved?.iata)||byCode.get(code)||(exact?.length===1?exact[0]:null);
 if(!airport)return null;
 return {icao:airport.icao,iata:airport.iata,name:airport.aliases[0]||airport.name,timezone:saved?.timezone||airport.timezone,lat:airport.lat,lng:airport.lng};
}
const flights=await querySql("select id,trip_id,version,data from public.trip_records where kind='booking' and not deleted and data->>'type'='flight' order by trip_id,id",{readOnly:true});
const repairs=flights.map(f=>({flight:f,airports:Object.fromEntries(['departure','arrival'].flatMap(side=>{const airport=resolve(f.data[side+'Airport'],f.data[side]);return airport?[[side+'Airport',airport]]:[];}))}));
const summary={flights:flights.length,resolvedAirports:repairs.reduce((n,r)=>n+Object.keys(r.airports).length,0),applied:0,events:0};
if(!apply){console.log(JSON.stringify({...summary,mode:'dry-run'}));process.exit(0);}
const directory=new URL('../.sites-runtime/backups/flight-events-'+new Date().toISOString().replaceAll(':','-')+'/',import.meta.url);await mkdir(directory,{recursive:true});
const linked=await querySql("select p.* from public.trip_records p where p.kind='plan' and exists(select 1 from public.trip_records b where b.trip_id=p.trip_id and b.kind='booking' and not b.deleted and b.data->>'type'='flight' and p.data->>'bookingId'=b.id::text)",{readOnly:true});
await writeFile(new URL('before.json',directory),JSON.stringify({flights,linked},null,2),{mode:0o600});
for(const repair of repairs){
 const result=await querySql('select tripboogie_private.repair_existing_flight($1::uuid,$2::bigint,$3::jsonb) as result',{parameters:[repair.flight.id,repair.flight.version,JSON.stringify(repair.airports)]});
 if(result[0]?.result.events!==2)throw Error('Flight repair did not produce exactly two events');
 summary.applied++;summary.events+=result[0].result.events;
}
const checks=await querySql("select count(*) as events,count(*) filter(where p.data->>'time'='') as missing_times,count(*) filter(where place.data->>'lat' is null or place.data->>'lng' is null) as unlocated from public.trip_records p join public.trip_records b on b.trip_id=p.trip_id and b.id::text=p.data->>'bookingId' and b.kind='booking' and not b.deleted and b.data->>'type'='flight' left join public.trip_records place on place.trip_id=p.trip_id and place.id::text=p.data->>'placeId' and place.kind='place' and not place.deleted where p.kind='plan' and not p.deleted and p.data->>'bookingEvent' in ('departure','arrival')",{readOnly:true});
if(Number(checks[0].events)!==flights.length*2)throw Error('Flight event count mismatch');
await writeFile(new URL('result.json',directory),JSON.stringify({summary,checks,checkedAt:new Date().toISOString()},null,2),{mode:0o600});
console.log(JSON.stringify({...summary,checks}));
