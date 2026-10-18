// One-way, fail-closed import of an owned D1 backup. Never deletes the source.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { projectRef, querySql } from './supabase-management.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
try {
  const file=resolve(root,process.argv[2]??'');
  if (!relative(resolve(root,'.sites-runtime/backups'),file).match(/^[^.][\s\S]*\.json$/)) throw new Error('프로젝트의 비공개 백업 파일을 선택하세요.');
  const source=await readFile(file,'utf8');
  const snapshot=JSON.parse(source);
  const tables=['users','trips','trip_members','trip_records','trip_invites'];
  if (!tables.every((name)=>Array.isArray(snapshot.tables?.[name]))) throw new Error('백업 형식이 올바르지 않습니다.');
  const encoded=JSON.stringify(snapshot);
  let tag;
  do { tag=`legacy_${randomUUID().replaceAll('-','')}`; } while(encoded.includes(`$${tag}$`));
  const query=`begin;
do $import$
declare payload jsonb:=$${tag}$${encoded}$${tag}$::jsonb; r record; owner uuid;
begin
  if exists(select 1 from jsonb_array_elements(payload->'tables'->'users') u
    where not exists(select 1 from auth.users a where a.id=(u->>'id')::uuid)) then
    raise exception 'Legacy user is absent from the selected Supabase Auth project; import stopped';
  end if;
  if exists(select 1 from public.trips t join jsonb_array_elements(payload->'tables'->'trips') j on t.id=(j->>'id')::uuid) then
    raise exception 'Some destination trip IDs already exist; inspect prior import before retrying';
  end if;
  insert into public.profiles(id,name,email,created_at)
    select id,name,coalesce(email,''),created_at from jsonb_to_recordset(payload->'tables'->'users')
      as u(id uuid,name text,email text,created_at timestamptz) on conflict(id) do nothing;
  for r in select * from jsonb_to_recordset(payload->'tables'->'trips') as t(id uuid,title text,destination text,
    start_date date,end_date date,currency text,timezone text,version bigint,revision bigint,created_at timestamptz,updated_at timestamptz) loop
    if (select count(*) from jsonb_array_elements(payload->'tables'->'trip_members') m where m->>'trip_id'=r.id::text and m->>'role'='owner')<>1 then
      raise exception 'Legacy trip does not have exactly one owner';
    end if;
    select (m->>'user_id')::uuid into owner from jsonb_array_elements(payload->'tables'->'trip_members') m where m->>'trip_id'=r.id::text and m->>'role'='owner';
    insert into public.trips(id,owner_id,title,destination,start_date,end_date,currency,timezone,version,revision,created_at,updated_at)
      values(r.id,owner,r.title,r.destination,r.start_date,r.end_date,r.currency,r.timezone,r.version,r.revision,r.created_at,r.updated_at);
  end loop;
  insert into public.trip_members(trip_id,user_id,role,created_at)
    select trip_id,user_id,role,created_at from jsonb_to_recordset(payload->'tables'->'trip_members') as m(trip_id uuid,user_id uuid,role text,created_at timestamptz);
  insert into public.trip_records(id,trip_id,kind,data,version,deleted,updated_at,updated_by)
    select id,trip_id,kind,tripboogie_private.normalize_item(kind,data_json::jsonb),version,deleted<>0,updated_at,updated_by
    from jsonb_to_recordset(payload->'tables'->'trip_records') as r(id uuid,trip_id uuid,kind text,data_json text,version bigint,deleted integer,updated_at timestamptz,updated_by uuid);
  insert into public.trip_invites(id,trip_id,token_hash,role,expires_at,revoked_at,created_at,created_by)
    select id,trip_id,token_hash,role,expires_at,revoked_at,created_at,created_by from jsonb_to_recordset(payload->'tables'->'trip_invites')
      as i(id uuid,trip_id uuid,token_hash text,role text,expires_at timestamptz,revoked_at timestamptz,created_at timestamptz,created_by uuid);
  if exists(select 1 from public.trip_records p join public.trips t on t.id=p.trip_id where p.kind='plan' and not p.deleted and (
    (p.data->>'date')<t.start_date::text or (p.data->>'date')>t.end_date::text or
    (p.data->>'placeId'<>'' and not exists(select 1 from public.trip_records place where place.id=(p.data->>'placeId')::uuid and place.trip_id=t.id and place.kind='place' and not place.deleted)))) then
    raise exception 'Legacy plan date/place integrity failed';
  end if;
end;
$import$;
select (select count(*) from public.profiles) as profiles,(select count(*) from public.trips) as trips,
  (select count(*) from public.trip_members) as trip_members,(select count(*) from public.trip_records) as trip_records,
  (select count(*) from public.trip_invites) as trip_invites;
commit;`;
  const result=await querySql(query);
  const receipt={projectRef,sourceSha256:createHash('sha256').update(source).digest('hex'),importedAt:new Date().toISOString(),sourceCounts:Object.fromEntries(tables.map((name)=>[name,snapshot.tables[name].length])),destinationCounts:result};
  await writeFile(resolve(dirname(file),'supabase-import-receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(receipt,null,2));
} catch(error) {
  console.error(error instanceof Error?error.message:'데이터 이전 결과를 확인하지 못했습니다.');
  process.exitCode=1;
}
