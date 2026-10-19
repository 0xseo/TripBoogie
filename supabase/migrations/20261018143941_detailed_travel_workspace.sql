-- User-authored trip content remains behind the existing membership/CAS boundary.
alter table public.profiles add column base_currency text not null default 'KRW' check(base_currency ~ '^[A-Z]{3}$');
alter table public.profiles add column version bigint not null default 1;
alter table public.trips add column settings jsonb not null default '{"expenseCategories":[{"id":"food","label":"식비"},{"id":"transport","label":"교통"},{"id":"stay","label":"숙박"},{"id":"shopping","label":"쇼핑"},{"id":"activity","label":"관광·체험"},{"id":"other","label":"기타"}],"checklistCategories":[{"id":"reservation","label":"예약"},{"id":"packing","label":"짐 싸기"},{"id":"prepare","label":"출발 전 준비"}]}'::jsonb check(jsonb_typeof(settings)='object');
alter table public.trip_records add column created_by uuid references auth.users(id) on delete set null;
alter table public.trip_records alter column created_by set default auth.uid();
create index trip_records_created_by_idx on public.trip_records(created_by);
alter table public.trip_records drop constraint trip_records_kind_check;
alter table public.trip_records add constraint trip_records_kind_check check(kind in ('plan','place','expense','checklist','booking'));

create table public.trip_files (
  id uuid primary key default gen_random_uuid(),trip_id uuid not null references public.trips(id) on delete cascade,
  booking_id uuid references public.trip_records(id) on delete set null,
  path text not null unique,name text not null check(length(name) between 1 and 300),mime text not null,
  size bigint not null check(size between 1 and 6291456),status text not null default 'pending' check(status in ('pending','ready','deleting')),
  uploaded_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now()
);
create index trip_files_trip_idx on public.trip_files(trip_id,created_at);
create index trip_files_booking_idx on public.trip_files(booking_id);
create index trip_files_author_idx on public.trip_files(uploaded_by);
alter table public.trip_files enable row level security;
revoke all on public.trip_files from public,anon,authenticated;
grant select on public.trip_files to authenticated;
create policy trip_files_member_read on public.trip_files for select to authenticated
using(tripboogie_private.has_role(trip_id,array['owner','editor','viewer']));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tripboogie-private','tripboogie-private',false,6291456,array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'])
on conflict(id) do nothing;
create policy tripboogie_file_select on storage.objects for select to authenticated using(
  bucket_id='tripboogie-private' and exists(select 1 from public.trip_files f where f.path=storage.objects.name and
    (f.status='ready' or f.uploaded_by=(select auth.uid()) or (f.status='deleting' and tripboogie_private.has_role(f.trip_id,array['owner','editor']))) and tripboogie_private.has_role(f.trip_id,array['owner','editor','viewer'])));
create policy tripboogie_file_insert on storage.objects for insert to authenticated with check(
  bucket_id='tripboogie-private' and exists(select 1 from public.trip_files f where f.path=storage.objects.name and f.status='pending'
    and f.uploaded_by=(select auth.uid()) and tripboogie_private.has_role(f.trip_id,array['owner','editor'])));
create policy tripboogie_file_delete on storage.objects for delete to authenticated using(
  bucket_id='tripboogie-private' and exists(select 1 from public.trip_files f where f.path=storage.objects.name and f.status='deleting'
    and tripboogie_private.has_role(f.trip_id,array['owner','editor'])));

create or replace function tripboogie_private.sync_profile(p_user uuid)
returns void language sql set search_path=''
as $$ insert into public.profiles(id,name,email)
  select id,left(coalesce(nullif(btrim(raw_user_meta_data->>'full_name'),''),nullif(btrim(raw_user_meta_data->>'name'),''),
    nullif(btrim(raw_user_meta_data->>'nickname'),''),nullif(split_part(email,'@',1),''),'여행 친구'),200),coalesce(email,'')
  from auth.users where id=p_user
  on conflict(id) do update set email=excluded.email; $$;

create function tripboogie_private.normalize_categories(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=''
as $$
declare result jsonb:='[]'; item jsonb; label text; id text; ids text[]:='{}';
begin
 if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value)>50 then
   perform tripboogie_private.fail(400,'INVALID_REQUEST','분류는 최대 50개까지 설정하세요.'); end if;
 for item in select value from jsonb_array_elements(p_value) loop
   id:=tripboogie_private.text_field(item,'id',64);label:=tripboogie_private.text_field(item,'label',100);
   if id !~ '^[a-zA-Z0-9_-]+$' or id=any(ids) then perform tripboogie_private.fail(400,'INVALID_REQUEST','분류 ID가 중복되었거나 올바르지 않습니다.'); end if;
   ids:=array_append(ids,id);result:=result||jsonb_build_array(jsonb_build_object('id',id,'label',label));
 end loop;
 return result;
end;
$$;

create function tripboogie_private.normalize_expense(p_data jsonb)
returns jsonb language plpgsql immutable set search_path=''
as $$
declare result jsonb; trip_currency text; base_currency text; paid_currency text; a jsonb; b jsonb; rate jsonb;
  people jsonb:='[]'; payers jsonb:='[]'; person jsonb; id text; person_name text; total numeric:=0; ids text[]:='{}';
  period text; paid numeric; amount jsonb;
begin
 trip_currency:=tripboogie_private.currency_field(jsonb_build_object('currency',p_data->'tripCurrency'));
 base_currency:=tripboogie_private.currency_field(jsonb_build_object('currency',p_data->'baseCurrency'));
 paid_currency:=tripboogie_private.currency_field(jsonb_build_object('currency',p_data->'paidCurrency'));
 if paid_currency not in (trip_currency,base_currency) then perform tripboogie_private.fail(400,'INVALID_REQUEST','결제한 통화를 선택하세요.'); end if;
 a:=tripboogie_private.decimal_field(p_data,'tripAmount');b:=tripboogie_private.decimal_field(p_data,'baseAmount');
 rate:=tripboogie_private.decimal_field(p_data,'exchangeRate',true);
 if trip_currency=base_currency and ((a#>>'{}')::numeric<>(b#>>'{}')::numeric or (rate#>>'{}')::numeric<>1) then
   perform tripboogie_private.fail(400,'INVALID_REQUEST','동일 통화의 금액과 환율을 확인하세요.'); end if;
 paid:=case when paid_currency=trip_currency then (a#>>'{}')::numeric else (b#>>'{}')::numeric end;
 if paid<=0 then perform tripboogie_private.fail(400,'INVALID_REQUEST','결제 금액은 0보다 커야 합니다.'); end if;
 if jsonb_typeof(p_data->'payers') is distinct from 'array' or jsonb_array_length(p_data->'payers') not between 1 and 100
   or jsonb_typeof(p_data->'participants') is distinct from 'array' or jsonb_array_length(p_data->'participants') not between 1 and 100 then
   perform tripboogie_private.fail(400,'INVALID_REQUEST','결제자와 분담자를 선택하세요.'); end if;
 for person in select value from jsonb_array_elements(p_data->'payers') loop
   id:=tripboogie_private.uuid_field(person,'userId')::text;person_name:=tripboogie_private.text_field(person,'name',200);
   if id=any(ids) then perform tripboogie_private.fail(400,'INVALID_REQUEST','결제자가 중복되었습니다.'); end if;
   ids:=array_append(ids,id);amount:=tripboogie_private.decimal_field(person,'amount');total:=total+(amount#>>'{}')::numeric;
   payers:=payers||jsonb_build_array(jsonb_build_object('userId',id,'name',person_name,'amount',amount));
 end loop;
 if total<>paid then perform tripboogie_private.fail(400,'INVALID_REQUEST','결제자별 금액의 합계가 결제 금액과 같아야 합니다.'); end if;
 ids:='{}';
 for person in select value from jsonb_array_elements(p_data->'participants') loop
   id:=tripboogie_private.uuid_field(person,'userId')::text;person_name:=tripboogie_private.text_field(person,'name',200);
   if id=any(ids) then perform tripboogie_private.fail(400,'INVALID_REQUEST','분담자가 중복되었습니다.'); end if;
   ids:=array_append(ids,id);people:=people||jsonb_build_array(jsonb_build_object('userId',id,'name',person_name));
 end loop;
 period:=tripboogie_private.text_field(p_data,'period',10);
 if period not in ('before','day','after') then perform tripboogie_private.fail(400,'INVALID_REQUEST','경비 사용 시점을 선택하세요.'); end if;
 result:=jsonb_build_object('model',2,'title',tripboogie_private.text_field(p_data,'title',300),'category',tripboogie_private.text_field(p_data,'category',100,false),
   'tripCurrency',trip_currency,'baseCurrency',base_currency,'paidCurrency',paid_currency,'tripAmount',a,'baseAmount',b,
   'exchangeRate',rate,'rateDate',tripboogie_private.text_field(p_data,'rateDate',10,false),'period',period,
   'date',tripboogie_private.date_field(p_data,'date'),'payers',payers,'participants',people,'currency',paid_currency,'amount',paid,
   'payer',(payers->0->>'name'),'note',tripboogie_private.text_field(p_data,'note',10000,false));
 if p_data ? 'rateDate' and p_data->>'rateDate'<>'' then perform tripboogie_private.date_field(p_data,'rateDate'); end if;
 return result;
end;
$$;

create function tripboogie_private.normalize_booking(p_data jsonb)
returns jsonb language plpgsql immutable set search_path=''
as $$
declare result jsonb; kind text; a date; b date; t text;
begin
 kind:=tripboogie_private.text_field(p_data,'type',10);
 if kind not in ('hotel','flight','tour') then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약 종류를 선택하세요.'); end if;
 a:=tripboogie_private.date_field(p_data,'startDate');b:=tripboogie_private.date_field(p_data,'endDate');
 if b<a or b-a>364 then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약 기간을 확인하세요.'); end if;
 foreach t in array array['startTime','endTime'] loop
   if coalesce(p_data->>t,'')<>'' and p_data->>t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','시간은 HH:mm 형식이어야 합니다.'); end if;
 end loop;
 result:=jsonb_build_object('type',kind,'title',tripboogie_private.text_field(p_data,'title',300),
   'startDate',a,'endDate',b,'startTime',tripboogie_private.text_field(p_data,'startTime',5,false),'endTime',tripboogie_private.text_field(p_data,'endTime',5,false),
   'reference',tripboogie_private.text_field(p_data,'reference',300,false),'note',tripboogie_private.text_field(p_data,'note',10000,false),
   'flightNumber',tripboogie_private.text_field(p_data,'flightNumber',20,false),'departure',tripboogie_private.text_field(p_data,'departure',300,false),
   'arrival',tripboogie_private.text_field(p_data,'arrival',300,false),'departureZone',tripboogie_private.text_field(p_data,'departureZone',100,false),
   'arrivalZone',tripboogie_private.text_field(p_data,'arrivalZone',100,false),'placeId','');
 if coalesce(p_data->>'placeId','')<>'' then result:=result||jsonb_build_object('placeId',tripboogie_private.uuid_field(p_data,'placeId'));end if;
 return result;
end;
$$;

create function tripboogie_private.checklist_toggle(p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path=''
as $$
declare item public.trip_records%rowtype; v_data jsonb; checks jsonb; desired boolean; uid text:=auth.uid()::text;
begin
 if jsonb_typeof(p_payload->'done') is distinct from 'boolean' then perform tripboogie_private.fail(400,'INVALID_REQUEST','체크 상태가 필요합니다.');end if;
 select * into item from public.trip_records r where r.trip_id=p_trip.id and r.id=tripboogie_private.uuid_field(p_payload,'id') and r.kind='checklist' and not r.deleted;
 if not found then perform tripboogie_private.fail(404,'NOT_FOUND','체크 항목을 찾을 수 없습니다.'); end if;
 desired:=(p_payload->>'done')::boolean;v_data:=item.data;
 if v_data->>'scope'='all' then
   checks:=coalesce(v_data->'checks','{}');
   if desired then checks:=jsonb_set(checks,array[uid],to_jsonb(clock_timestamp()));else checks:=checks-uid;end if;
   v_data:=jsonb_set(v_data,'{checks}',checks);
 else v_data:=jsonb_set(v_data,'{done}',to_jsonb(desired));end if;
 if (select coalesce(sum(octet_length(r.data::text)),0) from public.trip_records r where r.trip_id=p_trip.id and not r.deleted)-octet_length(item.data::text)+octet_length(v_data::text)>2097152 then perform tripboogie_private.fail(409,'CAPACITY','여행 저장 용량 제한에 도달했습니다.');end if;
 if v_data=item.data then return tripboogie_private.workspace(p_trip.id);end if;
 update public.trip_records set data=v_data,version=version+1,updated_at=now(),updated_by=auth.uid() where id=item.id;
 update public.trips set revision=revision+1,updated_at=now() where id=p_trip.id;
 return tripboogie_private.workspace(p_trip.id);
end;
$$;

create function tripboogie_private.file_operation(p_op text,p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path=''
as $$
declare f public.trip_files%rowtype; v_file_id uuid; booking uuid; mime text; name text; size bigint; object_size bigint;
begin
 if p_op='prepare-file' then
   name:=tripboogie_private.text_field(p_payload,'name',300);mime:=tripboogie_private.text_field(p_payload,'mime',150);
   if mime not in ('application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain') then
     perform tripboogie_private.fail(400,'INVALID_REQUEST','PDF·이미지·문서 파일을 선택하세요.');end if;
   size:=tripboogie_private.version_field(jsonb_build_object('version',p_payload->'size'));
   if size>6291456 then perform tripboogie_private.fail(413,'TOO_LARGE','파일은 6 MiB 이하로 올려 주세요.');end if;
   if p_payload ? 'bookingId' and p_payload->>'bookingId'<>'' then
     booking:=tripboogie_private.uuid_field(p_payload,'bookingId');
     if not exists(select 1 from public.trip_records r where r.trip_id=p_trip.id and r.id=booking and r.kind='booking' and not r.deleted) then perform tripboogie_private.fail(404,'NOT_FOUND','예약을 찾을 수 없습니다.');end if;
   end if;
   if (select count(*) from public.trip_files x where x.trip_id=p_trip.id)>=200 or
     (select coalesce(sum(x.size),0) from public.trip_files x where x.trip_id=p_trip.id)+size>104857600 then
     perform tripboogie_private.fail(409,'CAPACITY','여행당 첨부는 200개·100 MiB까지 보관할 수 있습니다.');end if;
   v_file_id:=gen_random_uuid();
   insert into public.trip_files(id,trip_id,booking_id,path,name,mime,size,uploaded_by) values(v_file_id,p_trip.id,booking,p_trip.id::text||'/'||v_file_id::text,name,mime,size,auth.uid()) returning * into f;
 else
   select * into f from public.trip_files x where x.id=tripboogie_private.uuid_field(p_payload,'id') and x.trip_id=p_trip.id for update;
   if not found then perform tripboogie_private.fail(404,'NOT_FOUND','첨부파일을 찾을 수 없습니다.');end if;
   if p_op='finish-file' then
     if f.status='deleting' then perform tripboogie_private.fail(409,'CONFLICT','삭제 중인 파일입니다.');end if;
     select (o.metadata->>'size')::bigint into object_size from storage.objects o where o.bucket_id='tripboogie-private' and o.name=f.path;
     if object_size is null or object_size<>f.size then perform tripboogie_private.fail(409,'CONFLICT','파일 업로드가 완료되지 않았습니다. 업로드를 다시 확인하세요.');end if;
     update public.trip_files set status='ready' where trip_files.id=f.id returning * into f;
   elsif p_op='mark-file-delete' then
     update public.trip_files set status='deleting' where trip_files.id=f.id returning * into f;
   elsif p_op='finish-file-delete' then
     if f.status<>'deleting' or exists(select 1 from storage.objects o where o.bucket_id='tripboogie-private' and o.name=f.path) then
       perform tripboogie_private.fail(409,'CONFLICT','파일 삭제를 완료한 뒤 다시 시도하세요.');end if;
     delete from public.trip_files where trip_files.id=f.id;
   else perform tripboogie_private.fail(400,'INVALID_REQUEST','지원하지 않는 첨부 작업입니다.');end if;
 end if;
 update public.trips set revision=revision+1,updated_at=now() where trips.id=p_trip.id;
 return jsonb_build_object('file',to_jsonb(f),'workspace',tripboogie_private.workspace(p_trip.id));
end;
$$;

revoke all on function tripboogie_private.normalize_categories(jsonb),tripboogie_private.normalize_expense(jsonb),tripboogie_private.normalize_booking(jsonb),tripboogie_private.checklist_toggle(public.trips,jsonb),tripboogie_private.file_operation(text,public.trips,jsonb) from public,anon,authenticated;

alter function tripboogie_private.normalize_item(text,jsonb) rename to normalize_item_legacy;
create function tripboogie_private.normalize_item(p_kind text,p_data jsonb)
returns jsonb language plpgsql immutable set search_path=''
as $$
declare v_result jsonb; v_type text; v_mode text; v_minutes text;
begin
 if p_kind='booking' then return tripboogie_private.normalize_booking(p_data);end if;
 if p_kind='expense' and p_data->>'model'='2' then return tripboogie_private.normalize_expense(p_data);end if;
 v_result:=tripboogie_private.normalize_item_legacy(p_kind,p_data);
 if p_kind='plan' then
   v_type:=coalesce(p_data->>'entryType','plan');
   if v_type not in ('plan','memo') then perform tripboogie_private.fail(400,'INVALID_REQUEST','일정 또는 메모를 선택하세요.');end if;
   if v_type='memo' then v_result:=v_result||jsonb_build_object('placeId','','time','','duration',0);end if;
   v_mode:=coalesce(p_data->>'transportMode','walk');
   if v_mode not in ('walk','drive','bicycle','train','flight','ferry','bus','other') then perform tripboogie_private.fail(400,'INVALID_REQUEST','이동 방식을 확인하세요.');end if;
   v_result:=v_result||jsonb_build_object('entryType',v_type,'transportMode',v_mode);
   if coalesce(p_data->>'travelMinutes','')<>'' then
     v_minutes:=p_data->>'travelMinutes';
     if v_minutes !~ '^[0-9]{1,6}$' or v_minutes::integer>100000 then perform tripboogie_private.fail(400,'INVALID_REQUEST','이동 시간은 0~100000분으로 입력하세요.');end if;
     v_result:=v_result||jsonb_build_object('travelMinutes',v_minutes::integer);
   end if;
   if coalesce(p_data->>'travelFromId','')<>'' then v_result:=v_result||jsonb_build_object('travelFromId',tripboogie_private.uuid_field(p_data,'travelFromId'));end if;
 elsif p_kind='checklist' then
   v_type:=coalesce(p_data->>'scope','once');
   if v_type not in ('once','all') then perform tripboogie_private.fail(400,'INVALID_REQUEST','함께 체크 또는 각자 체크를 선택하세요.');end if;
   v_result:=v_result||jsonb_build_object('scope',v_type,'checks','{}'::jsonb);
 end if;
 return v_result;
end;
$$;
revoke all on function tripboogie_private.normalize_item(text,jsonb),tripboogie_private.normalize_item_legacy(text,jsonb) from public,anon,authenticated;
create or replace function tripboogie_private.trip_json(p_trip public.trips,p_role text)
returns jsonb language sql stable set search_path=''
as $$ select jsonb_build_object('id',p_trip.id,'title',p_trip.title,'destination',p_trip.destination,
  'startDate',p_trip.start_date,'endDate',p_trip.end_date,'currency',p_trip.currency,'timezone',p_trip.timezone,
  'settings',p_trip.settings,'version',p_trip.version,'revision',p_trip.revision,'role',p_role,
  'memberCount',(select count(*) from public.trip_members m where m.trip_id=p_trip.id),
  'createdAt',p_trip.created_at,'updatedAt',p_trip.updated_at); $$;
create or replace function tripboogie_private.workspace(p_trip uuid)
returns jsonb language plpgsql stable set search_path=''
as $$
declare trip jsonb;
begin
  select tripboogie_private.trip_json(t,m.role) into trip from public.trips t
    join public.trip_members m on m.trip_id=t.id and m.user_id=(select auth.uid()) where t.id=p_trip;
  if trip is null then perform tripboogie_private.fail(404,'NOT_FOUND','여행을 찾을 수 없거나 접근 권한이 없습니다.'); end if;
  return jsonb_build_object('trip',trip,'revision',trip->'revision',
    'records',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'data',r.data,
      'createdBy',coalesce(r.created_by::text,''),'createdName',(select p.name from public.profiles p where p.id=r.created_by),'version',r.version,'updatedAt',r.updated_at,'updatedBy',coalesce(r.updated_by::text,'')) order by r.updated_at,r.id)
      from public.trip_records r where r.trip_id=p_trip and not r.deleted),'[]'::jsonb),
    'files',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at,f.id) from public.trip_files f where f.trip_id=p_trip),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'role',m.role)
      order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end,m.created_at,m.user_id)
      from public.trip_members m join public.profiles p on p.id=m.user_id where m.trip_id=p_trip),'[]'::jsonb));
end;
$$;

-- Generated hotel entries have explicit ownership; user edits release management.
create function tripboogie_private.sync_hotel(p_trip public.trips,p_booking public.trip_records)
returns void language plpgsql set search_path=''
as $$
declare v_event text; v_day text; v_time text; v_plan public.trip_records%rowtype; v_result jsonb; v_id uuid;
begin
 foreach v_event in array array['checkin','checkout'] loop
   select * into v_plan from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan'
     and r.data->>'bookingId'=p_booking.id::text and r.data->>'bookingEvent'=v_event order by r.updated_at limit 1;
   if v_plan.id is not null and (v_plan.data->>'bookingManaged' is distinct from 'true' or v_plan.deleted) then continue;end if;
   v_day:=p_booking.data->>case when v_event='checkin' then 'startDate' else 'endDate' end;
   v_time:=p_booking.data->>case when v_event='checkin' then 'startTime' else 'endTime' end;
   if p_booking.deleted or p_booking.data->>'type'<>'hotel' or v_day<p_trip.start_date::text or v_day>p_trip.end_date::text then
     if v_plan.id is not null then update public.trip_records set deleted=true,version=version+1,updated_by=auth.uid(),updated_at=now() where id=v_plan.id;end if;
     continue;
   end if;
   v_id:=coalesce(v_plan.id,gen_random_uuid());
   v_result:=tripboogie_private.dispatch('mutate',p_trip.id,jsonb_strip_nulls(jsonb_build_object('action','upsert','kind','plan','id',v_id,
     'version',case when v_plan.id is null then null else to_jsonb(v_plan.version) end,
     'data',jsonb_build_object('title',(p_booking.data->>'title')||case when v_event='checkin' then ' · 체크인' else ' · 체크아웃' end,
       'date',v_day,'time',v_time,'placeId',p_booking.data->>'placeId','category','숙박','note','','duration',0,'entryType','plan'))));
   update public.trip_records set data=data||jsonb_build_object('bookingId',p_booking.id,'bookingEvent',v_event,'bookingManaged',true) where id=v_id;
 end loop;
end;
$$;
revoke all on function tripboogie_private.sync_hotel(public.trips,public.trip_records) from public,anon,authenticated;
create or replace function tripboogie_private.dispatch(p_operation text,p_trip_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s'
as $$
declare v_uid uuid:=auth.uid(); v_trip public.trips%rowtype; v_record public.trip_records%rowtype;
  v_invite public.trip_invites%rowtype; v_role text; v_data jsonb; v_result jsonb; v_action text; v_kind text;
  v_record_id uuid; v_expected bigint; v_hash text; v_token text; v_next_id uuid; v_n integer; v_old_bytes bigint; v_total_bytes bigint;
begin
  if v_uid is null or not exists(select 1 from auth.users u where u.id=v_uid) then
    perform tripboogie_private.fail(401,'UNAUTHENTICATED','로그인이 필요합니다.');
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then perform tripboogie_private.fail(400,'INVALID_REQUEST','올바른 JSON 객체가 필요합니다.'); end if;
  if octet_length(p_payload::text)>(case when p_operation='import' then 4194304 when p_operation='schedule' then 262144 else 65536 end) then perform tripboogie_private.fail(413,'TOO_LARGE','요청 크기를 줄여 주세요.'); end if;

  if p_operation in ('profile','update-profile') then
    perform tripboogie_private.sync_profile(v_uid);
    if p_operation='update-profile' then
      update public.profiles set name=tripboogie_private.text_field(p_payload,'name',200),
        base_currency=tripboogie_private.currency_field(jsonb_build_object('currency',p_payload->'baseCurrency')),version=version+1
        where id=v_uid and version=tripboogie_private.version_field(p_payload);
      if not found then perform tripboogie_private.fail(409,'CONFLICT','프로필이 변경되었습니다. 다시 열어 주세요.');end if;
    end if;
    return (select jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'baseCurrency',p.base_currency,'version',p.version) from public.profiles p where p.id=v_uid);
  end if;
  if p_operation='map-budget'  then return tripboogie_private.map_budget(); end if;
  if p_operation='list' then
    return coalesce((select jsonb_agg(tripboogie_private.trip_json(t,m.role) order by t.updated_at desc,t.id)
      from public.trips t join public.trip_members m on m.trip_id=t.id and m.user_id=v_uid),'[]'::jsonb);
  end if;
  if p_operation='import' then return tripboogie_private.import_trip(p_payload); end if;
  if p_operation in ('create','join') then
    -- Always take the per-user lock before the v_trip lock; caps stay correct
    -- when the same account creates/joins different trips concurrently.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,0));
  end if;
  if p_operation='create' then
    if (select count(*) from public.trip_members m where m.user_id=v_uid)>=100 then perform tripboogie_private.fail(409,'CAPACITY','계정당 여행은 최대 100개입니다.'); end if;
    v_data:=tripboogie_private.normalize_trip(p_payload->'data');
    perform tripboogie_private.sync_profile(v_uid);
    insert into public.trips(owner_id,title,destination,start_date,end_date,currency,timezone)
      values(v_uid,v_data->>'title',v_data->>'destination',(v_data->>'startDate')::date,(v_data->>'endDate')::date,v_data->>'currency',v_data->>'timezone') returning id into v_next_id;
    insert into public.trip_members(trip_id,user_id,role) values(v_next_id,v_uid,'owner');
    return tripboogie_private.workspace(v_next_id);
  end if;

  if p_operation in ('preview-invite','join') then
    v_token:=tripboogie_private.text_field(p_payload,'token',64);
    if v_token !~ '^[0-9a-f]{64}$' then perform tripboogie_private.fail(404,'INVITE_UNAVAILABLE','초대 링크를 확인하세요.'); end if;
    v_hash:=encode(sha256(convert_to(v_token,'UTF8')),'hex');
    select i.trip_id into p_trip_id from public.trip_invites i where i.token_hash=v_hash;
    select * into v_trip from public.trips t where t.id=p_trip_id for update;
    select * into v_invite from public.trip_invites i where i.token_hash=v_hash and i.revoked_at is null and i.expires_at>clock_timestamp();
    if v_invite.id is null or v_trip.id is null then
      perform tripboogie_private.fail(case when p_operation='join' then 409 else 404 end,'INVITE_UNAVAILABLE','초대가 만료되었거나 취소되었습니다.');
    end if;
    if p_operation='preview-invite' then return jsonb_build_object('tripTitle',v_trip.title,'destination',v_trip.destination,'role',v_invite.role,'expiresAt',v_invite.expires_at); end if;
    if not exists(select 1 from public.trip_members m where m.trip_id=v_trip.id and m.user_id=v_uid) then
      if (select count(*) from public.trip_members m where m.trip_id=v_trip.id)>=100 or (select count(*) from public.trip_members m where m.user_id=v_uid)>=100 then
        perform tripboogie_private.fail(409,'CAPACITY','여행 또는 멤버 수 제한에 도달했습니다.');
      end if;
      perform tripboogie_private.sync_profile(v_uid);
      insert into public.trip_members(trip_id,user_id,role) values(v_trip.id,v_uid,v_invite.role);
      update public.trips set revision=revision+1,updated_at=now() where id=v_trip.id;
    end if;
    return tripboogie_private.workspace(v_trip.id);
  end if;

  if p_operation in ('workspace','list-invites') then
    select * into v_trip from public.trips t where t.id=p_trip_id and exists(select 1 from public.trip_members auth where auth.trip_id=t.id and auth.user_id=v_uid) for share;
  else
    select * into v_trip from public.trips t where t.id=p_trip_id and exists(select 1 from public.trip_members auth where auth.trip_id=t.id and auth.user_id=v_uid) for update;
  end if;
  select m.role into v_role from public.trip_members m where m.trip_id=p_trip_id and m.user_id=v_uid;
  if v_trip.id is null or v_role is null then perform tripboogie_private.fail(404,'NOT_FOUND','여행을 찾을 수 없거나 접근 권한이 없습니다.'); end if;
  if p_operation='workspace' then return tripboogie_private.workspace(v_trip.id); end if;
  if p_operation='checklist-toggle' then return tripboogie_private.checklist_toggle(v_trip,p_payload);end if;
  if p_operation in ('prepare-file','finish-file','mark-file-delete','finish-file-delete') then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','첨부파일은 편집자만 변경할 수 있습니다.');end if;
    return tripboogie_private.file_operation(p_operation,v_trip,p_payload);
  end if;
  if p_operation in ('save-plan','save-booking') then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','열람 권한으로는 수정할 수 없습니다.');end if;
    v_data:=p_payload->'data';
    if p_payload ? 'place' then
      v_next_id:=gen_random_uuid();
      v_result:=tripboogie_private.dispatch('mutate',v_trip.id,jsonb_build_object('action','upsert','id',v_next_id,'kind','place','data',p_payload->'place'));
      v_data:=v_data||jsonb_build_object('placeId',v_next_id);
    end if;
    return tripboogie_private.dispatch('mutate',v_trip.id,(p_payload-'place')||jsonb_build_object('action','upsert','kind',case when p_operation='save-plan' then 'plan' else 'booking' end,'data',v_data));
  end if;
  if p_operation='update-settings' then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','열람 권한으로는 수정할 수 없습니다.');end if;
    if v_trip.revision<>tripboogie_private.version_field(jsonb_build_object('version',p_payload->'revision')) then perform tripboogie_private.fail(409,'CONFLICT','여행이 변경되었습니다. 다시 열어 주세요.');end if;
    v_data:=v_trip.settings;
    if p_payload ? 'expenseCategories' then v_data:=jsonb_set(v_data,'{expenseCategories}',tripboogie_private.normalize_categories(p_payload->'expenseCategories'));end if;
    if p_payload ? 'checklistCategories' then v_data:=jsonb_set(v_data,'{checklistCategories}',tripboogie_private.normalize_categories(p_payload->'checklistCategories'));end if;
    if p_payload ? 'location' then v_data:=jsonb_set(v_data,'{location}',tripboogie_private.normalize_item('place',p_payload->'location'));end if;
    if exists(select 1 from public.trip_records r where r.trip_id=v_trip.id and not r.deleted and r.kind in ('expense','checklist')
      and exists(select 1 from jsonb_array_elements(v_trip.settings->case when r.kind='expense' then 'expenseCategories' else 'checklistCategories' end) c where c->>'id'=r.data->>'category')
      and not exists(select 1 from jsonb_array_elements(v_data->case when r.kind='expense' then 'expenseCategories' else 'checklistCategories' end) c where c->>'id'=r.data->>'category')) then
      perform tripboogie_private.fail(409,'CONFLICT','사용 중인 분류는 이름을 바꾸거나 항목의 분류를 변경한 뒤 삭제하세요.');end if;
    update public.trips set settings=v_data,revision=revision+1,updated_at=now() where id=v_trip.id;
    return tripboogie_private.workspace(v_trip.id);
  end if;
  if p_operation='schedule' then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','열람 권한으로는 수정할 수 없습니다.'); end if;
    return tripboogie_private.edit_schedule(v_trip,p_payload);
  end if;
  if p_operation='add-place' then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','열람 권한으로는 수정할 수 없습니다.'); end if;
    if not p_payload ? 'date' then perform tripboogie_private.fail(400,'INVALID_REQUEST','장소는 일정에 추가해 주세요.');end if;
    v_next_id:=gen_random_uuid();
    v_result:=tripboogie_private.dispatch('mutate',v_trip.id,jsonb_build_object('action','upsert','id',v_next_id,'kind','place','data',p_payload->'place'));
    if p_payload ? 'date' then
      v_result:=tripboogie_private.dispatch('mutate',v_trip.id,jsonb_build_object('action','upsert','kind','plan','data',jsonb_build_object(
        'title',p_payload->'place'->>'name','date',p_payload->>'date','placeId',v_next_id,'time','','note','','category','','duration',0)));
    end if;
    return v_result;
  end if;
  if p_operation='mutate' then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','열람 권한으로는 수정할 수 없습니다.'); end if;
    v_action:=tripboogie_private.text_field(p_payload,'action',30);
    if v_action='update-trip' then
      v_expected:=tripboogie_private.version_field(p_payload);
      if jsonb_typeof(p_payload->'data') is distinct from 'object' then perform tripboogie_private.fail(400,'INVALID_REQUEST','여행 정보가 필요합니다.'); end if;
      v_data:=tripboogie_private.normalize_trip(jsonb_build_object('title',v_trip.title,'destination',v_trip.destination,
        'startDate',v_trip.start_date,'endDate',v_trip.end_date,'currency',v_trip.currency,'timezone',v_trip.timezone)||(p_payload->'data'));
      if p_payload->'data'->'shiftDates'='true'::jsonb then
        if tripboogie_private.version_field(jsonb_build_object('version',p_payload->'revision'))<>v_trip.revision then
          perform tripboogie_private.fail(409,'CONFLICT','일정이 변경되었습니다. 최신 내용을 확인하세요.');
        end if;
        if exists(select 1 from public.trip_records r where r.trip_id=v_trip.id and r.kind='plan' and not r.deleted
          and (r.data->>'date')::date-v_trip.start_date>(v_data->>'endDate')::date-(v_data->>'startDate')::date) then
          perform tripboogie_private.fail(409,'CONFLICT','새 여행 기간보다 긴 일정이 있습니다. 먼저 일정을 옮겨 주세요.');
        end if;
        update public.trip_records r set data=jsonb_set(r.data,'{date}',to_jsonb(((r.data->>'date')::date+((v_data->>'startDate')::date-v_trip.start_date))::text))||jsonb_build_object('bookingManaged',false),
          version=r.version+1,updated_at=now(),updated_by=v_uid where r.trip_id=v_trip.id and r.kind='plan' and not r.deleted;
      end if;
      if v_expected<>v_trip.version or exists(select 1 from public.trip_records r where r.trip_id=v_trip.id and r.kind='plan' and not r.deleted
        and ((r.data->>'date')<(v_data->>'startDate') or (r.data->>'date')>(v_data->>'endDate'))) then
        perform tripboogie_private.fail(409,'CONFLICT','여행이 변경되었거나 새 기간 밖에 일정이 있습니다. 새로고침 후 확인하세요.');
      end if;
      update public.trips set title=v_data->>'title',destination=v_data->>'destination',start_date=(v_data->>'startDate')::date,
        end_date=(v_data->>'endDate')::date,currency=v_data->>'currency',timezone=v_data->>'timezone',version=version+1,revision=revision+1,updated_at=now() where id=v_trip.id;
      return tripboogie_private.workspace(v_trip.id);
    end if;
    if v_action not in ('upsert','delete') then perform tripboogie_private.fail(400,'INVALID_REQUEST','지원하지 않는 작업입니다.'); end if;
    if p_payload ? 'id' then v_record_id:=tripboogie_private.uuid_field(p_payload,'id');
    elsif v_action='upsert' then v_record_id:=gen_random_uuid();
    else perform tripboogie_private.fail(400,'INVALID_REQUEST','항목 ID가 필요합니다.'); end if;
    select * into v_record from public.trip_records r where r.id=v_record_id and r.trip_id=v_trip.id;
    if p_payload ? 'kind' then v_kind:=tripboogie_private.text_field(p_payload,'kind',20); else v_kind:=v_record.kind; end if;
    if v_kind is null and v_action='delete' then perform tripboogie_private.fail(409,'CONFLICT','항목이 이미 변경되었거나 삭제되었습니다.'); end if;
    if v_kind not in ('plan','place','expense','checklist','booking') then perform tripboogie_private.fail(400,'INVALID_REQUEST','지원하지 않는 항목 종류입니다.'); end if;
    v_expected:=null;
    if p_payload ? 'version' or v_action='delete' then v_expected:=tripboogie_private.version_field(p_payload); end if;
    if (v_expected is not null and (v_record.id is null or v_record.deleted or v_record.version<>v_expected or v_record.kind<>v_kind))
      or (v_expected is null and v_record.id is not null) then
      perform tripboogie_private.fail(409,'CONFLICT','항목이 변경되었거나 삭제되었습니다. 새로고침 후 다시 시도하세요.');
    end if;
    if v_action='delete' then
      if v_kind='place' and exists(select 1 from public.trip_records r where r.trip_id=v_trip.id and r.kind in ('plan','booking') and not r.deleted and r.data->>'placeId'=v_record_id::text) then
        perform tripboogie_private.fail(409,'CONFLICT','이 장소를 연결한 일정이 있습니다. 연결을 먼저 해제하세요.');
      end if;
      update public.trip_records set deleted=true,version=version+1,updated_at=now(),updated_by=v_uid where id=v_record_id;
    else
      v_data:=tripboogie_private.normalize_item(v_kind,p_payload->'data');
      if v_kind='checklist' then
        v_data:=v_data||jsonb_build_object('checks',coalesce(v_record.data->'checks','{}'::jsonb));
        if v_data->>'scope'='all' then v_data:=v_data||jsonb_build_object('done',false);end if;
      end if;
      if v_kind='expense' and v_data->>'model'='2' and v_data->>'period'='day' and (v_data->>'date'<v_trip.start_date::text or v_data->>'date'>v_trip.end_date::text) then perform tripboogie_private.fail(400,'INVALID_REQUEST','DAY 경비는 여행 기간 안에서 선택하세요.');end if;
      if v_kind='booking' and v_data->>'placeId'<>'' and not exists(select 1 from public.trip_records r where r.trip_id=v_trip.id and r.kind='place' and not r.deleted and r.id=(v_data->>'placeId')::uuid) then
        perform tripboogie_private.fail(409,'CONFLICT','예약에 연결한 장소가 없습니다.');end if;
      if v_kind='plan' then
        if v_record.data ? 'bookingId' then v_data:=v_data||jsonb_build_object('bookingId',v_record.data->>'bookingId','bookingEvent',v_record.data->>'bookingEvent','bookingManaged',false);end if;
        if not v_data ? 'position' then
          if v_record.id is not null and v_record.data->>'date'=v_data->>'date' then v_data:=v_data||jsonb_build_object('position',(v_record.data->>'position')::integer);
          else
            select coalesce(max((r.data->>'position')::integer),0)+1 into v_n from public.trip_records r where r.trip_id=v_trip.id and r.kind='plan' and not r.deleted and r.data->>'date'=v_data->>'date';
            v_data:=v_data||jsonb_build_object('position',v_n);
          end if;
        end if;
        if (v_data->>'date')<v_trip.start_date::text or (v_data->>'date')>v_trip.end_date::text then perform tripboogie_private.fail(400,'INVALID_REQUEST','일정 날짜는 여행 기간 안에 있어야 합니다.'); end if;
        if v_data->>'placeId'<>'' and not exists(select 1 from public.trip_records r where r.trip_id=v_trip.id and r.id=(v_data->>'placeId')::uuid and r.kind='place' and not r.deleted) then
          perform tripboogie_private.fail(409,'CONFLICT','연결할 장소가 없거나 삭제되었습니다.');
        end if;
      end if;
      select coalesce(sum(octet_length(r.data::text)),0) into v_total_bytes from public.trip_records r where r.trip_id=v_trip.id and not r.deleted;
      v_old_bytes:=case when v_record.id is not null then octet_length(v_record.data::text) else 0 end;
      if v_total_bytes-v_old_bytes+octet_length(v_data::text)>2097152 then perform tripboogie_private.fail(409,'CAPACITY','여행 데이터는 최대 2 MiB까지 저장할 수 있습니다.'); end if;
      if v_expected is null then
        if (select count(*) from public.trip_records r where r.trip_id=v_trip.id and not r.deleted)>=5000
          or (select count(*) from public.trip_records r where r.trip_id=v_trip.id)>=20000 then
          perform tripboogie_private.fail(409,'CAPACITY','여행 항목 수 제한에 도달했습니다.');
        end if;
        insert into public.trip_records(id,trip_id,kind,data,updated_by) values(v_record_id,v_trip.id,v_kind,v_data,v_uid) on conflict(id) do nothing;
        get diagnostics v_n=row_count;
        if v_n=0 then perform tripboogie_private.fail(409,'CONFLICT','이미 사용된 항목 ID입니다.'); end if;
      else
        update public.trip_records set data=v_data,version=version+1,updated_at=now(),updated_by=v_uid where id=v_record_id;
      end if;
    end if;
    if v_kind='booking' then
      select * into v_record from public.trip_records r where r.id=v_record_id;
      perform tripboogie_private.sync_hotel(v_trip,v_record);
      if (select coalesce(sum(octet_length(r.data::text)),0) from public.trip_records r where r.trip_id=v_trip.id and not r.deleted)>2097152 then perform tripboogie_private.fail(409,'CAPACITY','여행 저장 용량 제한에 도달했습니다.');end if;
    end if;
    update public.trips set revision=revision+1,updated_at=now() where id=v_trip.id;
    return tripboogie_private.workspace(v_trip.id);
  end if;

  if v_role<>'owner' then perform tripboogie_private.fail(403,'FORBIDDEN','여행 소유자만 관리할 수 있습니다.'); end if;
  case p_operation
  when 'delete-trip' then
    v_expected:=tripboogie_private.version_field(jsonb_build_object('version',p_payload->'revision'));
    if v_expected<>v_trip.revision then perform tripboogie_private.fail(409,'CONFLICT','여행이 변경되었습니다. 최신 내용을 확인한 뒤 삭제하세요.'); end if;
    if exists(select 1 from public.trip_files f where f.trip_id=v_trip.id) then perform tripboogie_private.fail(409,'CONFLICT','자료함의 파일을 먼저 삭제해 주세요.');end if;
    delete from public.trips where id=v_trip.id;
    return jsonb_build_object('ok',true);
  when 'list-invites' then
    return coalesce((select jsonb_agg(row_to_json(i)) from (
      select id,trip_invites.role,expires_at as "expiresAt",revoked_at as "revokedAt",created_at as "createdAt" from public.trip_invites
      where trip_id=v_trip.id order by (revoked_at is null) desc,created_at desc,id limit 100) i),'[]'::jsonb);
  when 'create-invite' then
    v_role:=tripboogie_private.text_field(p_payload,'role',10);
    if v_role not in ('editor','viewer') then perform tripboogie_private.fail(400,'INVALID_REQUEST','초대 권한을 확인하세요.'); end if;
    v_token:=tripboogie_private.text_field(p_payload,'token',64);
    if v_token !~ '^[0-9a-f]{64}$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','초대 토큰 형식을 확인하세요.'); end if;
    if (select count(*) from public.trip_invites i where i.trip_id=v_trip.id and i.revoked_at is null and i.expires_at>clock_timestamp())>=20
      or (select count(*) from public.trip_invites i where i.trip_id=v_trip.id)>=1000 then
      perform tripboogie_private.fail(409,'CAPACITY','활성 초대는 20개, 누적 초대는 1000개까지 만들 수 있습니다.');
    end if;
    v_hash:=encode(sha256(convert_to(v_token,'UTF8')),'hex');
    insert into public.trip_invites(trip_id,token_hash,role,expires_at,created_by) values(v_trip.id,v_hash,v_role,now()+interval '7 days',v_uid)
      returning * into v_invite;
    return jsonb_build_object('id',v_invite.id,'expiresAt',v_invite.expires_at);
  when 'revoke-invite' then
    v_next_id:=tripboogie_private.uuid_field(p_payload,'id');
    update public.trip_invites set revoked_at=coalesce(revoked_at,now()) where id=v_next_id and trip_id=v_trip.id;
    get diagnostics v_n=row_count;
    if v_n=0 then perform tripboogie_private.fail(404,'NOT_FOUND','초대를 찾을 수 없습니다.'); end if;
    return jsonb_build_object('ok',true);
  when 'remove-member' then
    v_next_id:=tripboogie_private.uuid_field(p_payload,'userId');
    if v_next_id=v_uid then perform tripboogie_private.fail(400,'INVALID_REQUEST','소유자는 자신의 멤버십을 제거할 수 없습니다.'); end if;
    delete from public.trip_members m where m.trip_id=v_trip.id and m.user_id=v_next_id and m.role<>'owner';
    get diagnostics v_n=row_count;
    if v_n=0 then perform tripboogie_private.fail(404,'NOT_FOUND','멤버를 찾을 수 없습니다.'); end if;
    update public.trips set revision=revision+1,updated_at=now() where id=v_trip.id;
    return tripboogie_private.workspace(v_trip.id);
  else perform tripboogie_private.fail(400,'INVALID_REQUEST','지원하지 않는 작업입니다.');
  end case;
end;
$$;




create or replace function tripboogie_private.import_trip(p_payload jsonb)
returns jsonb language plpgsql set search_path=''
as $$
declare uid uuid:=auth.uid(); key uuid; fingerprint text; receipt tripboogie_private.import_receipts%rowtype;
  result jsonb; new_trip_id uuid; ids jsonb; row jsonb; v_import_data jsonb; kind text; old_id uuid; new_id uuid;
  record_count integer; distinct_count integer; total_bytes bigint:=0; start_date text; end_date text;
begin
  key:=tripboogie_private.uuid_field(p_payload,'key');
  fingerprint:=encode(sha256(convert_to((p_payload-'key')::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,0));
  select * into receipt from tripboogie_private.import_receipts r where r.user_id=uid and r.idempotency_key=key;
  if found then
    if receipt.digest<>fingerprint then perform tripboogie_private.fail(409,'CONFLICT','같은 가져오기 요청의 내용이 변경되었습니다.'); end if;
    if receipt.trip_id is null then perform tripboogie_private.fail(409,'CONFLICT','이미 가져온 뒤 삭제한 여행입니다. 새 백업 가져오기를 시작하세요.'); end if;
    return tripboogie_private.workspace(receipt.trip_id);
  end if;
  if jsonb_typeof(p_payload->'records') is distinct from 'array' then perform tripboogie_private.fail(400,'INVALID_REQUEST','백업 항목 목록이 필요합니다.'); end if;
  record_count:=jsonb_array_length(p_payload->'records');
  if record_count>5000 then perform tripboogie_private.fail(413,'TOO_LARGE','백업은 최대 5000개 항목을 담을 수 있습니다.'); end if;
  select coalesce(jsonb_object_agg(tripboogie_private.uuid_field(value,'id')::text,gen_random_uuid()::text),'{}'),
    count(distinct tripboogie_private.uuid_field(value,'id')) into ids,distinct_count from jsonb_array_elements(p_payload->'records');
  if distinct_count<>record_count then perform tripboogie_private.fail(400,'INVALID_REQUEST','백업 항목 ID가 중복됩니다.'); end if;
  result:=tripboogie_private.dispatch('create',null,jsonb_build_object('data',p_payload->'trip'));
  new_trip_id:=(result->'trip'->>'id')::uuid;
  start_date:=result->'trip'->>'startDate'; end_date:=result->'trip'->>'endDate';
  -- Places first, so every plan reference is checked against the imported copy.
  for row in select value from jsonb_array_elements(p_payload->'records') order by case value->>'kind' when 'place' then 0 when 'booking' then 1 else 2 end loop
    kind:=tripboogie_private.text_field(row,'kind',20);
    old_id:=tripboogie_private.uuid_field(row,'id'); new_id:=(ids->>old_id::text)::uuid;
    v_import_data:=tripboogie_private.normalize_item(kind,row->'data');
    if kind in ('plan','booking') then
      if kind='plan' and (v_import_data->>'date'<start_date or v_import_data->>'date'>end_date) then perform tripboogie_private.fail(400,'INVALID_REQUEST','여행 기간 밖의 일정이 있습니다.'); end if;
      if v_import_data->>'placeId'<>'' then
        v_import_data:=jsonb_set(v_import_data,'{placeId}',coalesce(ids->(v_import_data->>'placeId'),'null'));
        if v_import_data->>'placeId' is null or not exists(select 1 from public.trip_records r where r.trip_id=new_trip_id and r.id=(v_import_data->>'placeId')::uuid and r.kind='place') then
          perform tripboogie_private.fail(400,'INVALID_REQUEST','백업 일정에 없는 장소가 연결되어 있습니다.');
        end if;
      end if;
    end if;
    if kind='plan' then
      v_import_data:=v_import_data-'travelFromId';
      if coalesce(row->'data'->>'bookingId','')<>'' and exists(select 1 from public.trip_records r where r.trip_id=new_trip_id and r.kind='booking' and r.id=(ids->>(row->'data'->>'bookingId'))::uuid) then
        if coalesce(row->'data'->>'bookingEvent','') not in ('checkin','checkout') then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약 일정 유형을 확인하세요.');end if;
        v_import_data:=v_import_data||jsonb_build_object('bookingId',ids->>(row->'data'->>'bookingId'),'bookingEvent',row->'data'->>'bookingEvent','bookingManaged',row->'data'->'bookingManaged'='true'::jsonb);
      end if;
    end if;
    total_bytes:=total_bytes+octet_length(v_import_data::text);
    if total_bytes>2097152 then perform tripboogie_private.fail(413,'TOO_LARGE','여행 데이터는 최대 2 MiB입니다.'); end if;
    insert into public.trip_records(id,trip_id,kind,data,updated_by) values(new_id,new_trip_id,kind,v_import_data,uid);
  end loop;
  if p_payload->'trip' ? 'settings' then
    result:=tripboogie_private.dispatch('update-settings',new_trip_id,(p_payload->'trip'->'settings')||jsonb_build_object('revision',(tripboogie_private.workspace(new_trip_id)->>'revision')::bigint));
  end if;
  with ranked as (select r.id,row_number() over(partition by r.data->>'date' order by coalesce((r.data->>'position')::integer,2147483647),r.data->>'time',r.id)::integer pos
    from public.trip_records r where r.trip_id=new_trip_id and r.kind='plan')
  update public.trip_records r set data=jsonb_set(r.data,'{position}',to_jsonb(a.pos)),version=r.version+1,updated_at=now(),updated_by=auth.uid() from ranked a where r.id=a.id and r.data->'position' is distinct from to_jsonb(a.pos);
  insert into tripboogie_private.import_receipts(user_id,idempotency_key,digest,trip_id) values(uid,key,fingerprint,new_trip_id);
  return tripboogie_private.workspace(new_trip_id);
end;
$$;
revoke all on function tripboogie_private.import_trip(jsonb) from public,anon,authenticated;
create or replace function tripboogie_private.edit_schedule(p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path=''
as $$
declare op text; source_date date; target_date date; ids uuid[]; n integer; matches integer;
  item record; next_position integer; bytes bigint;
begin
  if tripboogie_private.version_field(jsonb_build_object('version',p_payload->'revision'))<>p_trip.revision then
    perform tripboogie_private.fail(409,'CONFLICT','일정이 변경되었습니다. 최신 내용을 확인한 뒤 다시 편집하세요.');
  end if;
  op:=tripboogie_private.text_field(p_payload,'operation',30);
  source_date:=tripboogie_private.date_field(p_payload,'sourceDate');
  target_date:=case when p_payload ? 'targetDate' then tripboogie_private.date_field(p_payload,'targetDate') else source_date end;
  if source_date<p_trip.start_date or source_date>p_trip.end_date or target_date<p_trip.start_date or target_date>p_trip.end_date then
    perform tripboogie_private.fail(400,'INVALID_REQUEST','여행 기간 안의 날짜를 선택하세요.');
  end if;
  if op='swap-days' then
    if source_date=target_date then perform tripboogie_private.fail(400,'INVALID_REQUEST','서로 다른 날짜를 선택하세요.'); end if;
    update public.trip_records r set data=jsonb_set(r.data,'{date}',to_jsonb(case when r.data->>'date'=source_date::text then target_date::text else source_date::text end))||jsonb_build_object('bookingManaged',false),
      version=r.version+1,updated_at=now(),updated_by=auth.uid()
      where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and r.data->>'date' in (source_date::text,target_date::text);
  else
    if op not in ('reorder','move','copy','delete') then perform tripboogie_private.fail(400,'INVALID_REQUEST','지원하지 않는 일정 편집입니다.'); end if;
    if jsonb_typeof(p_payload->'ids') is distinct from 'array' then perform tripboogie_private.fail(400,'INVALID_REQUEST','선택한 일정 목록이 필요합니다.'); end if;
    n:=jsonb_array_length(p_payload->'ids');
    if n<1 or n>5000 then perform tripboogie_private.fail(400,'INVALID_REQUEST','1~5000개의 일정을 선택하세요.'); end if;
    select array_agg(tripboogie_private.uuid_field(jsonb_build_object('id',value),'id') order by ord) into ids
      from jsonb_array_elements(p_payload->'ids') with ordinality a(value,ord);
    if (select count(distinct id) from unnest(ids) id)<>n then perform tripboogie_private.fail(400,'INVALID_REQUEST','일정이 중복 선택되었습니다.'); end if;
    select count(*) into matches from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and r.id=any(ids) and r.data->>'date'=source_date::text;
    if matches<>n then perform tripboogie_private.fail(409,'CONFLICT','선택한 일정이 변경되었거나 삭제되었습니다.'); end if;
    if op='reorder' then
      if (select count(*) from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and r.data->>'date'=source_date::text)<>n then
        perform tripboogie_private.fail(409,'CONFLICT','하루의 모든 일정을 순서대로 보내 주세요.');
      end if;
      update public.trip_records r set data=jsonb_set(r.data,'{position}',to_jsonb(a.ord::integer)),version=r.version+1,updated_at=now(),updated_by=auth.uid()
        from unnest(ids) with ordinality a(id,ord) where r.id=a.id and r.trip_id=p_trip.id;
    elsif op='delete' then
      update public.trip_records r set deleted=true,version=r.version+1,updated_at=now(),updated_by=auth.uid() where r.trip_id=p_trip.id and r.id=any(ids);
    else
      if op='move' and source_date=target_date then perform tripboogie_private.fail(400,'INVALID_REQUEST','다른 날짜로 이동하세요.'); end if;
      select coalesce(max((r.data->>'position')::integer),0) into next_position from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and r.data->>'date'=target_date::text;
      if op='copy' then
        select coalesce(sum(octet_length(r.data::text)),0) into bytes from public.trip_records r where r.trip_id=p_trip.id and not r.deleted;
        if (select count(*) from public.trip_records r where r.trip_id=p_trip.id and not r.deleted)+n>5000 or
          (select count(*) from public.trip_records r where r.trip_id=p_trip.id)+n>20000 or bytes+
          (select sum(octet_length(r.data::text)+32) from public.trip_records r where r.trip_id=p_trip.id and r.id=any(ids))>2097152 then
          perform tripboogie_private.fail(409,'CAPACITY','여행 항목 수 또는 저장 용량 제한에 도달했습니다.');
        end if;
      end if;
      for item in select r.*,a.ord from unnest(ids) with ordinality a(id,ord) join public.trip_records r on r.id=a.id and r.trip_id=p_trip.id order by a.ord loop
        if op='copy' then
          insert into public.trip_records(trip_id,kind,data,updated_by) values(p_trip.id,'plan',(item.data-'travelFromId'-'travelMinutes'-'bookingId'-'bookingEvent'-'bookingManaged')||jsonb_build_object('date',target_date,'position',next_position+item.ord::integer),auth.uid());
        else
          update public.trip_records set data=(item.data-'travelFromId'-'travelMinutes')||jsonb_build_object('bookingManaged',false)||jsonb_build_object('date',target_date,'position',next_position+item.ord::integer),version=version+1,updated_at=now(),updated_by=auth.uid() where id=item.id;
        end if;
      end loop;
    end if;
  end if;
  -- Compact once at the owning boundary; repeated moves cannot grow positions without limit.
  with ranked as (select r.id,row_number() over(partition by r.data->>'date' order by (r.data->>'position')::integer,r.id)::integer pos
    from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted)
  update public.trip_records r set data=jsonb_set(r.data,'{position}',to_jsonb(a.pos)),version=r.version+1,updated_at=now(),updated_by=auth.uid() from ranked a where r.id=a.id and r.data->'position' is distinct from to_jsonb(a.pos);
  if (select coalesce(sum(octet_length(r.data::text)),0) from public.trip_records r where r.trip_id=p_trip.id and not r.deleted)>2097152 then
    perform tripboogie_private.fail(409,'CAPACITY','여행 저장 용량 제한에 도달했습니다.');
  end if;
  update public.trips set revision=revision+1,updated_at=now() where id=p_trip.id;
  return tripboogie_private.workspace(p_trip.id);
end;
$$;
revoke all on function tripboogie_private.edit_schedule(public.trips,jsonb) from public,anon,authenticated;

revoke all on function tripboogie_private.normalize_categories(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
