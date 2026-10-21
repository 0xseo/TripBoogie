-- Documents are loaded separately from the travel workspace. Writes use the
-- existing authenticated dispatcher and per-document element stamps.
create table public.trip_brain_documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  kind text not null check(kind in ('sheet','board')),
  title text not null check(length(title) between 1 and 100),
  entities jsonb not null default '{}' check(jsonb_typeof(entities)='object' and octet_length(entities::text)<=4194304),
  preview jsonb not null default '{}' check(jsonb_typeof(preview)='object' and octet_length(preview::text)<=32768),
  revision bigint not null default 1,
  meta_version bigint not null default 1,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index brain_documents_by_trip on public.trip_brain_documents(trip_id,updated_at desc);
create index brain_documents_by_author on public.trip_brain_documents(updated_by);
create table public.trip_brain_changes (
  document_id uuid not null references public.trip_brain_documents(id) on delete cascade,
  mutation_id uuid not null,
  revision bigint not null,
  digest text not null,
  entities jsonb not null,
  primary key(document_id,mutation_id),
  unique(document_id,revision)
);
alter table public.trip_brain_documents enable row level security;
alter table public.trip_brain_changes enable row level security;
revoke all on public.trip_brain_documents,public.trip_brain_changes from public,anon,authenticated;
grant select on public.trip_brain_documents,public.trip_brain_changes to authenticated;
create policy brain_document_member_read on public.trip_brain_documents for select to authenticated using(tripboogie_private.has_role(trip_id,array['owner','editor','viewer']));
create policy brain_change_member_read on public.trip_brain_changes for select to authenticated using(exists(select 1 from public.trip_brain_documents d where d.id=document_id));

create function tripboogie_private.brain_summary(d public.trip_brain_documents)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',d.id,'tripId',d.trip_id,'kind',d.kind,'title',d.title,'revision',d.revision,'metaVersion',d.meta_version,'deletedAt',d.deleted_at,'updatedAt',d.updated_at,'preview',d.preview)
$$;
create function tripboogie_private.brain_delta(d public.trip_brain_documents, since bigint default 0)
returns jsonb language plpgsql stable set search_path='' as $$
declare changes jsonb; earliest bigint; reset boolean;
begin
 select min(revision) into earliest from public.trip_brain_changes where document_id=d.id;
 reset:=since=0 or since>d.revision or (since<d.revision and (earliest is null or since<earliest-1));
 if reset then changes:=d.entities;
 else
   select coalesce(jsonb_object_agg(key,value),'{}') into changes from (
     select distinct on(e.key) e.key,e.value from public.trip_brain_changes c cross join lateral jsonb_each(c.entities) e
     where c.document_id=d.id and c.revision>since order by e.key,c.revision desc
   ) latest;
 end if;
 return tripboogie_private.brain_summary(d)||jsonb_build_object('entities',changes,'reset',reset);
end;$$;

create function tripboogie_private.validate_brain_value(kind text,k text,v jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare item jsonb; point jsonb; n text; lim integer;
begin
 if length(k)>120 then perform tripboogie_private.fail(400,'INVALID_REQUEST','항목 주소를 확인하세요.');end if;
 if kind='sheet' then
   if k !~ '^(sheet:(rows|cols)|cell:[a-zA-Z0-9_-]{1,40}:[a-zA-Z0-9_-]{1,40}|(colwidth|rowheight):[a-zA-Z0-9_-]{1,40})$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','표 항목을 확인하세요.');end if;
   if k in ('sheet:rows','sheet:cols') then
     if v='null'::jsonb then return;end if;
     lim:=case when k='sheet:rows' then 20000 else 1000 end;
     if jsonb_typeof(v) is distinct from 'array' then perform tripboogie_private.fail(400,'INVALID_REQUEST','행과 열 목록이 필요합니다.');end if;
     if jsonb_array_length(v) not between 1 and lim then perform tripboogie_private.fail(413,'TOO_LARGE','행 또는 열의 저장 한도에 도달했어요.');end if;
     for item in select value from jsonb_array_elements(v) loop
       if jsonb_typeof(item)<>'string' or (item#>>'{}') !~ '^[a-zA-Z0-9_-]{1,40}$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','행과 열 ID를 확인하세요.');end if;
     end loop;
     if (select count(distinct value) from jsonb_array_elements(v))<>jsonb_array_length(v) then perform tripboogie_private.fail(400,'INVALID_REQUEST','행과 열 ID가 중복됩니다.');end if;
   elsif v='null'::jsonb then return;
   elsif k like 'cell:%' then
     if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'text') is distinct from 'string' or length(v->>'text')>5000 or v-array['text','color','background','bold','align']<>'{}'::jsonb then perform tripboogie_private.fail(400,'INVALID_REQUEST','셀은 5000자까지 입력하세요.');end if;
     foreach n in array array['color','background'] loop
       if v ? n and (jsonb_typeof(v->n)<>'string' or v->>n !~ '^#[0-9a-fA-F]{6}$') then perform tripboogie_private.fail(400,'INVALID_REQUEST','셀 색상을 확인하세요.');end if;
     end loop;
     if (v ? 'bold' and jsonb_typeof(v->'bold')<>'boolean') or (v ? 'align' and v->>'align' not in ('left','center','right')) then perform tripboogie_private.fail(400,'INVALID_REQUEST','셀 서식을 확인하세요.');end if;
   else
     if jsonb_typeof(v) is distinct from 'number' then perform tripboogie_private.fail(400,'INVALID_REQUEST','행과 열 크기를 확인하세요.');end if;
     if v::text::numeric not between 24 and 500 then perform tripboogie_private.fail(400,'INVALID_REQUEST','크기는 24~500 사이로 설정하세요.');end if;
   end if;
 elsif kind='board' then
   if k !~ '^shape:[0-9a-f-]{36}$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','그림 항목을 확인하세요.');end if;
   if v='null'::jsonb then return;end if;
   if jsonb_typeof(v) is distinct from 'object' or coalesce(v->>'type','') not in ('pen','eraser','line','arrow','rect','ellipse','text') or v-array['type','x','y','x2','y2','points','targets','origins','text','color','width','fontSize','order']<>'{}'::jsonb then perform tripboogie_private.fail(400,'INVALID_REQUEST','그림 도구를 확인하세요.');end if;
   foreach n in array array['x','y','width'] loop
     if jsonb_typeof(v->n) is distinct from 'number' then perform tripboogie_private.fail(400,'INVALID_REQUEST','그림 좌표를 확인하세요.');end if;
   end loop;
   foreach n in array array['x','y','x2','y2','width','fontSize'] loop
     if v ? n then
       if jsonb_typeof(v->n) is distinct from 'number' then perform tripboogie_private.fail(400,'INVALID_REQUEST','그림 좌표를 확인하세요.');end if;
       if abs((v->>n)::numeric)>10000000 then perform tripboogie_private.fail(400,'INVALID_REQUEST','그림 영역을 벗어났어요.');end if;
     end if;
   end loop;
   if (v->>'width')::numeric not between 1 and 80 or (v ? 'fontSize' and (v->>'fontSize')::numeric not between 12 and 96) or coalesce(v->>'color','') !~ '^#[0-9a-fA-F]{6}$' or jsonb_typeof(v->'order') is distinct from 'string' or length(v->>'order')>80 then perform tripboogie_private.fail(400,'INVALID_REQUEST','그림 색상과 크기를 확인하세요.');end if;
   if v->>'type' in ('pen','eraser') then
     if jsonb_typeof(v->'points') is distinct from 'array' then perform tripboogie_private.fail(400,'INVALID_REQUEST','그림 점 목록이 필요합니다.');end if;
     if jsonb_array_length(v->'points') not between 1 and 4096 then perform tripboogie_private.fail(413,'TOO_LARGE','한 획의 길이가 너무 길어요. 나누어 그려 주세요.');end if;
     for point in select value from jsonb_array_elements(v->'points') loop
       if jsonb_typeof(point)<>'array' or jsonb_array_length(point)<>2 then perform tripboogie_private.fail(400,'INVALID_REQUEST','그림 점을 확인하세요.');end if;
       for item in select value from jsonb_array_elements(point) loop
         if jsonb_typeof(item)<>'number' then perform tripboogie_private.fail(400,'INVALID_REQUEST','그림 좌표가 필요합니다.');end if;
         if abs(item::text::numeric)>10000000 then perform tripboogie_private.fail(400,'INVALID_REQUEST','그림 영역을 벗어났어요.');end if;
       end loop;
     end loop;
   end if;
   if v->>'type' in ('line','arrow','rect','ellipse') and (not v ? 'x2' or not v ? 'y2') then perform tripboogie_private.fail(400,'INVALID_REQUEST','도형의 끝 좌표가 필요합니다.');end if;
   if v->>'type'='text' and (jsonb_typeof(v->'text') is distinct from 'string' or length(v->>'text')>2000) then perform tripboogie_private.fail(400,'INVALID_REQUEST','글씨는 2000자까지 입력하세요.');end if;
   if v ? 'origins' then
     if jsonb_typeof(v->'origins') is distinct from 'object' then perform tripboogie_private.fail(400,'INVALID_REQUEST','지우개 기준 좌표를 확인하세요.');end if;
     if (select count(*) from jsonb_object_keys(v->'origins'))>5000 then perform tripboogie_private.fail(413,'TOO_LARGE','지우개 대상이 너무 많아요.');end if;
     for point in select value from jsonb_each(v->'origins') loop
       if jsonb_typeof(point) is distinct from 'array' then perform tripboogie_private.fail(400,'INVALID_REQUEST','지우개 기준 좌표를 확인하세요.');end if;
       if jsonb_array_length(point)<>4 then perform tripboogie_private.fail(400,'INVALID_REQUEST','지우개 기준 좌표를 확인하세요.');end if;
       for item in select value from jsonb_array_elements(point) loop
         if jsonb_typeof(item) is distinct from 'number' then perform tripboogie_private.fail(400,'INVALID_REQUEST','지우개 좌표가 필요합니다.');end if;
         if abs(item::text::numeric)>10000000 then perform tripboogie_private.fail(400,'INVALID_REQUEST','지우개 영역을 벗어났어요.');end if;
       end loop;
     end loop;
   end if;
   if v ? 'targets' then
     if jsonb_typeof(v->'targets') is distinct from 'array' then perform tripboogie_private.fail(400,'INVALID_REQUEST','지우개 대상을 확인하세요.');end if;
     if jsonb_array_length(v->'targets')>5000 then perform tripboogie_private.fail(413,'TOO_LARGE','한 번에 지울 수 있는 그림 수를 초과했어요.');end if;
     for item in select value from jsonb_array_elements(v->'targets') loop
       if jsonb_typeof(item)<>'string' or item#>>'{}' !~ '^shape:[0-9a-f-]{36}$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','지우개 대상을 확인하세요.');end if;
     end loop;
   end if;
 else perform tripboogie_private.fail(400,'INVALID_REQUEST','문서 종류를 확인하세요.');end if;
end;$$;

create function tripboogie_private.validate_brain_preview(kind text,preview jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare e record;
begin
 if jsonb_typeof(preview) is distinct from 'object' or octet_length(preview::text)>32768 then perform tripboogie_private.fail(400,'INVALID_REQUEST','미리보기 크기를 확인하세요.');end if;
 if (select count(*) from jsonb_object_keys(preview))>40 then perform tripboogie_private.fail(400,'INVALID_REQUEST','미리보기 항목이 너무 많아요.');end if;
 for e in select key,value from jsonb_each(preview) loop
   if kind='sheet' then
     if e.key !~ '^[0-4]:[0-3]$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','표 미리보기 주소를 확인하세요.');end if;
     perform tripboogie_private.validate_brain_value(kind,'cell:r0:c0',e.value);
   else perform tripboogie_private.validate_brain_value(kind,e.key,e.value);end if;
 end loop;
end;$$;
revoke all on function tripboogie_private.validate_brain_preview(text,jsonb) from public,anon,authenticated;

create function tripboogie_private.brain_operation(op text,p_trip uuid,p jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare d public.trip_brain_documents%rowtype; item jsonb; k text; stamp uuid; expected text; next_entities jsonb; delta jsonb:='{}'; seen text[]:='{}'; since bigint:=0; fingerprint text; previous public.trip_brain_changes%rowtype; kind text; v_title text;
begin
 -- A shared trip lock coordinates with membership removal/trip deletion while
 -- distinct documents can be written concurrently.
 perform 1 from public.trips where id=p_trip for share;
 if not found or not tripboogie_private.has_role(p_trip,array['owner','editor','viewer']) then perform tripboogie_private.fail(404,'NOT_FOUND','여행을 확인할 수 없습니다.');end if;
 if op='brain-list' then
   return coalesce((select jsonb_agg(tripboogie_private.brain_summary(x) order by x.updated_at desc,x.id) from public.trip_brain_documents x where x.trip_id=p_trip),'[]'::jsonb);
 end if;
 if p ? 'since' then
   if jsonb_typeof(p->'since') is distinct from 'number' or p->>'since' !~ '^[0-9]{1,15}$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','문서 버전을 확인하세요.');end if;
   since:=(p->>'since')::bigint;
 end if;
 if op='brain-create' then
   if not tripboogie_private.has_role(p_trip,array['owner','editor']) then perform tripboogie_private.fail(403,'FORBIDDEN','편집자만 문서를 만들 수 있어요.');end if;
   -- Serialize document creation only, not every stroke in a trip.
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('brain:'||p_trip::text,0));
   stamp:=tripboogie_private.uuid_field(p,'documentId');
   kind:=tripboogie_private.text_field(p,'kind',10);v_title:=tripboogie_private.text_field(p,'title',100);
   if kind not in ('sheet','board') then perform tripboogie_private.fail(400,'INVALID_REQUEST','문서 종류를 확인하세요.');end if;
   select * into d from public.trip_brain_documents where id=stamp;
   if found then
     if d.trip_id<>p_trip or d.kind<>kind then perform tripboogie_private.fail(409,'CONFLICT','문서 ID가 이미 사용 중입니다.');end if;
     return tripboogie_private.brain_delta(d);
   end if;
   if (select count(*) from public.trip_brain_documents where trip_id=p_trip)>=30 then perform tripboogie_private.fail(413,'TOO_LARGE','휴지통을 포함해 여행당 문서는 최대 30개입니다.');end if;
   insert into public.trip_brain_documents(id,trip_id,kind,title,updated_by) values(stamp,p_trip,kind,v_title,auth.uid()) returning * into d;
   return tripboogie_private.brain_delta(d);
 end if;
 if op='brain-read' then
   select * into d from public.trip_brain_documents where id=tripboogie_private.uuid_field(p,'documentId') and trip_id=p_trip;
 else
   select * into d from public.trip_brain_documents where id=tripboogie_private.uuid_field(p,'documentId') and trip_id=p_trip for update;
 end if;
 if not found then perform tripboogie_private.fail(404,'NOT_FOUND','문서가 없거나 접근할 수 없어요.');end if;
 if op='brain-read' then return tripboogie_private.brain_delta(d,since);end if;
 if not tripboogie_private.has_role(p_trip,array['owner','editor']) then perform tripboogie_private.fail(403,'FORBIDDEN','열람자는 문서를 변경할 수 없어요.');end if;
 if op='brain-meta' then
   if d.meta_version<>tripboogie_private.version_field(p) then perform tripboogie_private.fail(409,'CONFLICT','문서 정보가 변경됐어요. 다시 확인해 주세요.');end if;
   if coalesce(p->>'action','') not in ('rename','delete','restore','purge') then perform tripboogie_private.fail(400,'INVALID_REQUEST','문서 작업을 확인하세요.');end if;
   if p->>'action'='purge' then
     if d.deleted_at is null then perform tripboogie_private.fail(409,'CONFLICT','휴지통에 있는 문서만 영구 삭제할 수 있어요.');end if;
     delete from public.trip_brain_documents where id=d.id;return jsonb_build_object('ok',true);
   end if;
   if p->>'action'='rename' then v_title:=tripboogie_private.text_field(p,'title',100);else v_title:=d.title;end if;
   update public.trip_brain_documents set title=v_title,deleted_at=case when p->>'action'='delete' then now() when p->>'action'='restore' then null else deleted_at end,meta_version=meta_version+1,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=d.id returning * into d;
   return tripboogie_private.brain_delta(d);
 end if;
 if op<>'brain-patch' then perform tripboogie_private.fail(400,'INVALID_REQUEST','문서 작업을 확인하세요.');end if;
 if d.deleted_at is not null then perform tripboogie_private.fail(409,'DOCUMENT_DELETED','휴지통으로 이동한 문서예요. 복원 후 편집해 주세요.');end if;
 stamp:=tripboogie_private.uuid_field(p,'mutationId');fingerprint:=encode(sha256(convert_to((p-array['since','preview'])::text,'UTF8')),'hex');
 select * into previous from public.trip_brain_changes where document_id=d.id and mutation_id=stamp;
 if found then
   if previous.digest<>fingerprint then perform tripboogie_private.fail(409,'CONFLICT','같은 저장 요청의 내용이 달라졌어요.');end if;
   return tripboogie_private.brain_delta(d,since);
 end if;
 if jsonb_typeof(p->'changes') is distinct from 'array' then perform tripboogie_private.fail(400,'INVALID_REQUEST','변경 목록이 필요합니다.');end if;
 if jsonb_array_length(p->'changes') not between 1 and 1000 then perform tripboogie_private.fail(413,'TOO_LARGE','한 번에 1000개 항목까지 변경할 수 있어요.');end if;
 next_entities:=d.entities;
 for item in select value from jsonb_array_elements(p->'changes') loop
   k:=tripboogie_private.text_field(item,'key',120);
   if k=any(seen) or not item ? 'value' or not item ? 'expected' then perform tripboogie_private.fail(400,'INVALID_REQUEST','변경 항목이 중복되거나 누락됐어요.');end if;seen:=array_append(seen,k);
   if item->'expected'<>'null'::jsonb then perform tripboogie_private.uuid_field(jsonb_build_object('id',item->'expected'),'id');end if;
   expected:=item->>'expected';
   if (d.entities->k->>'stamp') is distinct from expected then perform tripboogie_private.fail(409,'BRAIN_CONFLICT','동행이 같은 항목을 변경했어요. 내 변경은 임시 보관됩니다.');end if;
   perform tripboogie_private.validate_brain_value(d.kind,k,item->'value');
   if p->'protect'='true'::jsonb and k in ('sheet:rows','sheet:cols') and exists(
     select 1 from jsonb_each(d.entities) cell where cell.key like 'cell:%' and cell.value->'value'<>'null'::jsonb
       and coalesce((cell.value->>'revision')::bigint,0)>coalesce((d.entities->k->>'revision')::bigint,0)
       and not (case when jsonb_typeof(item->'value')='array' then item->'value' else
         (select jsonb_agg((case when k='sheet:rows' then 'r' else 'c' end)||i::text) from generate_series(0,case when k='sheet:rows' then 99 else 25 end) i) end)
         ? split_part(cell.key,':',case when k='sheet:rows' then 2 else 3 end)
   ) then perform tripboogie_private.fail(409,'BRAIN_CONFLICT','동행이 편집한 셀을 숨기는 행·열 변경은 되돌릴 수 없어요.');end if;
   delta:=delta||jsonb_build_object(k,jsonb_build_object('value',item->'value','stamp',stamp,'revision',d.revision+1));
 end loop;
 next_entities:=next_entities||delta;
 if d.kind='board' and (select count(*) from jsonb_each(next_entities) e where e.value->'value'<>'null'::jsonb)>5000 then perform tripboogie_private.fail(413,'TOO_LARGE','그림판은 5000개 요소까지 저장할 수 있어요.');end if;
 if octet_length(next_entities::text)>4194304 or (select count(*) from jsonb_object_keys(next_entities))>30000 then perform tripboogie_private.fail(413,'TOO_LARGE','문서의 저장 한도에 도달했어요. 새 문서로 나누어 주세요.');end if;
 if (select coalesce(sum(octet_length(entities::text)),0) from public.trip_brain_documents where trip_id=p_trip and id<>d.id)+octet_length(next_entities::text)>16777216 then perform tripboogie_private.fail(413,'TOO_LARGE','여행의 브레인스토밍 저장 한도에 도달했어요.');end if;
 if p ? 'preview' and (jsonb_typeof(p->'preview') is distinct from 'object' or octet_length((p->'preview')::text)>32768) then perform tripboogie_private.fail(400,'INVALID_REQUEST','미리보기 크기를 확인하세요.');end if;
 if p ? 'preview' then perform tripboogie_private.validate_brain_preview(d.kind,p->'preview');end if;
 update public.trip_brain_documents set entities=next_entities,preview=coalesce(p->'preview',preview),revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=d.id returning * into d;
 insert into public.trip_brain_changes(document_id,mutation_id,revision,digest,entities) values(d.id,stamp,d.revision,fingerprint,delta);
 -- Bound catch-up history. Older clients get a complete document on reconnect.
 delete from public.trip_brain_changes where document_id=d.id and revision in (
   select revision from (select revision,row_number() over(order by revision desc) n,sum(octet_length(entities::text)) over(order by revision desc) bytes from public.trip_brain_changes where document_id=d.id) log where n>512 or bytes>8388608
 );
 return tripboogie_private.brain_delta(d,since);
end;$$;
revoke all on function tripboogie_private.brain_summary(public.trip_brain_documents),tripboogie_private.brain_delta(public.trip_brain_documents,bigint),tripboogie_private.validate_brain_value(text,text,jsonb),tripboogie_private.brain_operation(text,uuid,jsonb) from public,anon,authenticated;

do $migration$
declare source text;needle text;replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
 needle:='when p_operation=''import'' then 4194304';replacement:='when p_operation=''import'' then 20971520 when p_operation=''brain-patch'' then 1048576';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected brainstorm request boundary';end if;source:=replace(source,needle,replacement);
 needle:='if p_operation=''list'' then'||E'\n    return coalesce';replacement:='if p_operation like ''brain-%'' then return tripboogie_private.brain_operation(p_operation,p_trip_id,p_payload);end if;'||E'\n'||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected brainstorm dispatch boundary';end if;execute replace(source,needle,replacement);
end;$migration$;

-- Database-origin broadcasts only carry invalidation, never user content.
-- Browser peers cannot publish authoritative document changes.
create function tripboogie_private.brain_notify()
returns trigger language plpgsql set search_path='' as $$
begin
 if pg_catalog.to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
   perform realtime.send(jsonb_build_object('documentId',coalesce(new.id,old.id)),'changed','brain:'||coalesce(new.trip_id,old.trip_id)::text,true);
 end if;
 return null;
end;$$;
revoke all on function tripboogie_private.brain_notify() from public,anon,authenticated;
create trigger brain_document_notify after insert or update or delete on public.trip_brain_documents for each row execute function tripboogie_private.brain_notify();

do $realtime$
begin
 if to_regclass('realtime.messages') is not null then
   execute $policy$create policy brain_receive on realtime.messages for select to authenticated using (
     (select realtime.topic()) ~ '^brain:[0-9a-f-]{36}$' and extension in ('broadcast','presence') and
     tripboogie_private.has_role((substring((select realtime.topic()) from 7))::uuid,array['owner','editor','viewer'])
   )$policy$;
   execute $policy$create policy brain_presence on realtime.messages for insert to authenticated with check (
     (select realtime.topic()) ~ '^brain:[0-9a-f-]{36}$' and extension='presence' and
     tripboogie_private.has_role((substring((select realtime.topic()) from 7))::uuid,array['owner','editor','viewer'])
   )$policy$;
 end if;
end;$realtime$;

create function tripboogie_private.import_brain_documents(p_trip uuid,documents jsonb)
returns void language plpgsql set search_path='' as $$
declare doc jsonb; e record; body jsonb; kind text; v_title text; total_bytes bigint:=0;
begin
 if jsonb_typeof(documents) is distinct from 'array' then perform tripboogie_private.fail(400,'INVALID_REQUEST','브레인스토밍 문서 목록을 확인하세요.');end if;
 if jsonb_array_length(documents)>30 then perform tripboogie_private.fail(413,'TOO_LARGE','문서는 최대 30개까지 가져올 수 있어요.');end if;
 for doc in select value from jsonb_array_elements(documents) loop
   kind:=tripboogie_private.text_field(doc,'kind',10);v_title:=tripboogie_private.text_field(doc,'title',100);
   if kind not in ('sheet','board') or jsonb_typeof(doc->'entities') is distinct from 'object' then perform tripboogie_private.fail(400,'INVALID_REQUEST','문서 내용을 확인하세요.');end if;
   body:='{}';
   for e in select key,value from jsonb_each(doc->'entities') loop
     if not e.value ? 'value' then perform tripboogie_private.fail(400,'INVALID_REQUEST','문서 항목의 값이 필요합니다.');end if;
     perform tripboogie_private.validate_brain_value(kind,e.key,e.value->'value');
     body:=body||jsonb_build_object(e.key,jsonb_build_object('value',e.value->'value','stamp',gen_random_uuid(),'revision',1));
   end loop;
   if octet_length(body::text)>4194304 or (select count(*) from jsonb_object_keys(body))>30000 then perform tripboogie_private.fail(413,'TOO_LARGE','문서의 저장 한도를 초과했어요.');end if;
   if kind='board' and (select count(*) from jsonb_each(body) stored where stored.value->'value'<>'null'::jsonb)>5000 then perform tripboogie_private.fail(413,'TOO_LARGE','그림판 요소가 너무 많아요.');end if;
   total_bytes:=total_bytes+octet_length(body::text);
   if total_bytes>16777216 then perform tripboogie_private.fail(413,'TOO_LARGE','브레인스토밍 백업은 16 MiB까지 가져올 수 있어요.');end if;
   if doc ? 'preview' and (jsonb_typeof(doc->'preview') is distinct from 'object' or octet_length((doc->'preview')::text)>32768) then perform tripboogie_private.fail(400,'INVALID_REQUEST','미리보기를 확인하세요.');end if;
   if doc ? 'preview' then perform tripboogie_private.validate_brain_preview(kind,doc->'preview');end if;
   insert into public.trip_brain_documents(trip_id,kind,title,entities,preview,deleted_at,updated_by)
    values(p_trip,kind,v_title,body,coalesce(doc->'preview','{}'),case when doc->>'deletedAt' is not null then now() else null end,auth.uid());
 end loop;
end;$$;
revoke all on function tripboogie_private.import_brain_documents(uuid,jsonb) from public,anon,authenticated;

do $backup$
declare source text;needle text;replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.brain_operation(text,uuid,jsonb)'::regprocedure);
 needle:='if op=''brain-list'' then';replacement:=$new$if op='brain-export' then
 return coalesce((select jsonb_agg(tripboogie_private.brain_summary(x)||jsonb_build_object('entities',x.entities) order by x.id) from public.trip_brain_documents x where x.trip_id=p_trip),'[]'::jsonb);
 end if;
 if op='brain-patch' then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('brain-quota:'||p_trip::text,0));end if;
 $new$||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected brainstorm export boundary';end if;execute replace(source,needle,replacement);
 source:=pg_get_functiondef('tripboogie_private.import_trip(jsonb)'::regprocedure);
 needle:='return tripboogie_private.workspace(new_trip_id);';
 replacement:='if p_payload ? ''brainstorm'' then perform tripboogie_private.import_brain_documents(new_trip_id,p_payload->''brainstorm'');end if;'||E'\n'||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected brainstorm import boundary';end if;execute replace(source,needle,replacement);
end;$backup$;
