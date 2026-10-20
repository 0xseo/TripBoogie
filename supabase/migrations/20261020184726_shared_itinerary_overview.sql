-- Independent presentation snapshots. Existing plans/bookings are never updated.
create table public.trip_overview_days (
  trip_id uuid not null references public.trips(id) on delete cascade,
  date date not null,
  text text not null default '' check (length(text)<=10000),
  source_ids uuid[] not null default '{}' check (cardinality(source_ids)<=5000),
  version bigint not null default 1 check (version>=1),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key(trip_id,date)
);
create index trip_overview_by_author on public.trip_overview_days(updated_by);
alter table public.trip_overview_days enable row level security;
revoke all on public.trip_overview_days from public,anon,authenticated;
grant select on public.trip_overview_days to authenticated;
create policy overview_member_read on public.trip_overview_days for select to authenticated
using (tripboogie_private.has_role(trip_id,array['owner','editor','viewer']));

create function tripboogie_private.normalize_overview(p_trip uuid,p_row jsonb,p_ids jsonb default null)
returns jsonb language plpgsql stable set search_path='' as $$
declare day date; body text; ids uuid[]:='{}'; item jsonb; source_id uuid;
begin
  if jsonb_typeof(p_row) is distinct from 'object' then perform tripboogie_private.fail(400,'INVALID_REQUEST','요약표의 날짜와 내용을 확인하세요.');end if;
  day:=tripboogie_private.date_field(p_row,'date');
  if jsonb_typeof(p_row->'text') is distinct from 'string' or length(p_row->>'text')>10000 then perform tripboogie_private.fail(400,'INVALID_REQUEST','하루의 요약은 10000자까지 입력하세요.');end if;
  body:=p_row->>'text'; -- Preserve intentional whitespace and line breaks.
  if jsonb_typeof(p_row->'sourceIds') is distinct from 'array' or jsonb_array_length(p_row->'sourceIds')>5000 then perform tripboogie_private.fail(400,'INVALID_REQUEST','불러온 일정 목록을 확인하세요.');end if;
  for item in select value from jsonb_array_elements(p_row->'sourceIds') loop
    source_id:=tripboogie_private.uuid_field(jsonb_build_object('id',item),'id');
    if p_ids is not null then
      if not p_ids ? source_id::text then continue;end if;
      source_id:=(p_ids->>source_id::text)::uuid;
    end if;
    -- Deleted source plans are valid snapshots; foreign-trip references are not.
    if not exists(select 1 from public.trip_records r where r.trip_id=p_trip and r.id=source_id and r.kind='plan') then perform tripboogie_private.fail(400,'INVALID_REQUEST','같은 여행의 일정만 불러올 수 있습니다.');end if;
    if not source_id=any(ids) then ids:=array_append(ids,source_id);end if;
  end loop;
  return jsonb_build_object('date',day,'text',body,'sourceIds',to_jsonb(ids));
end;$$;

create function tripboogie_private.check_overview_capacity(p_trip uuid)
returns void language plpgsql stable set search_path='' as $$
begin
  if (select count(*)>730 or coalesce(sum(octet_length(text)+cardinality(source_ids)*36),0)>2097152 from public.trip_overview_days where trip_id=p_trip) then
    perform tripboogie_private.fail(413,'TOO_LARGE','요약표는 730일, 총 2 MiB까지 저장할 수 있습니다.');
  end if;
end;$$;

create function tripboogie_private.save_overview(p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; normalized jsonb; day date; seen date[]:='{}'; expected bigint; current public.trip_overview_days%rowtype; ids uuid[]; changed boolean:=false;
begin
  if not tripboogie_private.has_role(p_trip.id,array['owner','editor']) then perform tripboogie_private.fail(403,'FORBIDDEN','요약표는 편집자만 변경할 수 있습니다.');end if;
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 730 then perform tripboogie_private.fail(400,'INVALID_REQUEST','저장할 날짜를 확인하세요.');end if;
  -- dispatch already holds the trip lock, shared with membership/deletion changes.
  for item in select value from jsonb_array_elements(p_payload->'rows') loop
    normalized:=tripboogie_private.normalize_overview(p_trip.id,item);day:=(normalized->>'date')::date;
    if day=any(seen) then perform tripboogie_private.fail(400,'INVALID_REQUEST','같은 날짜가 중복되었습니다.');end if;seen:=array_append(seen,day);
    if jsonb_typeof(item->'version') is distinct from 'number' or (item->>'version') !~ '^(0|[1-9][0-9]{0,15})$' or (item->>'version')::numeric>9007199254740991 then perform tripboogie_private.fail(400,'INVALID_REQUEST','요약표의 버전을 확인하세요.');end if;
    expected:=(item->>'version')::bigint;
    select * into current from public.trip_overview_days d where d.trip_id=p_trip.id and d.date=day;
    if not(day between p_trip.start_date and p_trip.end_date) and current.trip_id is null and not exists(select 1 from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and r.data->>'date'=day::text) then perform tripboogie_private.fail(400,'INVALID_REQUEST','여행 일정에 포함된 날짜를 선택하세요.');end if;
    select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(normalized->'sourceIds');
    -- Safe retry after a lost response; identical content cannot overwrite edits.
    if current.trip_id is not null and current.text=normalized->>'text' and current.source_ids=ids then continue;end if;
    if coalesce(current.version,0)<>expected then perform tripboogie_private.fail(409,'OVERVIEW_CONFLICT','동행이 이 날짜의 요약표를 먼저 수정했어요. 내 입력은 유지하고 최신 내용을 확인해 주세요.');end if;
    insert into public.trip_overview_days(trip_id,date,text,source_ids,updated_by)
      values(p_trip.id,day,normalized->>'text',ids,auth.uid())
      on conflict(trip_id,date) do update set text=excluded.text,source_ids=excluded.source_ids,version=trip_overview_days.version+1,updated_at=now(),updated_by=auth.uid();
    changed:=true;
  end loop;
  perform tripboogie_private.check_overview_capacity(p_trip.id);
  if changed then update public.trips set revision=revision+1,updated_at=now() where id=p_trip.id;end if;
  return tripboogie_private.workspace(p_trip.id);
end;$$;

create function tripboogie_private.import_overview(p_trip uuid,p_rows jsonb,p_ids jsonb)
returns void language plpgsql set search_path='' as $$
declare item jsonb; normalized jsonb; seen date[]:='{}'; day date; ids uuid[];
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>730 then perform tripboogie_private.fail(400,'INVALID_REQUEST','백업의 요약표를 확인하세요.');end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    normalized:=tripboogie_private.normalize_overview(p_trip,item,p_ids);day:=(normalized->>'date')::date;
    if day=any(seen) then perform tripboogie_private.fail(400,'INVALID_REQUEST','백업에 같은 날짜가 중복되었습니다.');end if;seen:=array_append(seen,day);
    select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(normalized->'sourceIds');
    insert into public.trip_overview_days(trip_id,date,text,source_ids,updated_by) values(p_trip,day,normalized->>'text',ids,auth.uid());
  end loop;
  perform tripboogie_private.check_overview_capacity(p_trip);
end;$$;

revoke all on function tripboogie_private.normalize_overview(uuid,jsonb,jsonb),tripboogie_private.check_overview_capacity(uuid),tripboogie_private.save_overview(public.trips,jsonb),tripboogie_private.import_overview(uuid,jsonb,jsonb) from public,anon,authenticated;

do $migration$
declare source text;needle text;replacement text;
begin
  source:=pg_get_functiondef('tripboogie_private.workspace(uuid)'::regprocedure);
  needle:='''files'',coalesce(';
  replacement:=$new$'overview',coalesce((select jsonb_agg(jsonb_build_object('date',d.date,'text',d.text,'sourceIds',to_jsonb(d.source_ids),'version',d.version,'updatedAt',d.updated_at,'updatedBy',coalesce(d.updated_by::text,'')) order by d.date) from public.trip_overview_days d where d.trip_id=p_trip),'[]'::jsonb),
    'files',coalesce($new$;
  if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected overview workspace boundary';end if;execute replace(source,needle,replacement);

  source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
  needle:='when p_operation in (''schedule'',''reorder-checklist'') then 262144';replacement:='when p_operation in (''schedule'',''reorder-checklist'',''save-overview'') then 262144';
  if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected overview request limit';end if;source:=replace(source,needle,replacement);
  needle:='if p_operation=''workspace'' then return tripboogie_private.workspace(v_trip.id); end if;';
  replacement:=needle||E'\n'||'  if p_operation=''save-overview'' then return tripboogie_private.save_overview(v_trip,p_payload);end if;';
  if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected overview authorization boundary';end if;execute replace(source,needle,replacement);

  source:=pg_get_functiondef('tripboogie_private.import_trip(jsonb)'::regprocedure);
  needle:='return tripboogie_private.workspace(new_trip_id);';
  replacement:='if p_payload ? ''overview'' then perform tripboogie_private.import_overview(new_trip_id,p_payload->''overview'',ids);end if;'||E'\n'||needle;
  if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected overview backup boundary';end if;execute replace(source,needle,replacement);
end;$migration$;
