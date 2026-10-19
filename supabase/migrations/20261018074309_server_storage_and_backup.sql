-- Server-only backup import. A retry cannot create a second trip or resurrect a deleted one.
create table tripboogie_private.import_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  digest text not null,
  trip_id uuid references public.trips(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(user_id,idempotency_key)
);
create index import_receipts_trip_idx on tripboogie_private.import_receipts(trip_id);
alter table tripboogie_private.import_receipts enable row level security;
revoke all on tripboogie_private.import_receipts from public,anon,authenticated;

create or replace function tripboogie_private.normalize_item(p_kind text,p_data jsonb)
returns jsonb language plpgsql immutable set search_path=''
as $$
declare result jsonb; category text; v text; duration integer; lat numeric; lng numeric; person jsonb; people jsonb:='[]';
begin
  if jsonb_typeof(p_data) is distinct from 'object' then perform tripboogie_private.fail(400,'INVALID_REQUEST','항목 정보가 필요합니다.'); end if;
  category:=tripboogie_private.text_field(p_data,'category',100,false);
  case p_kind
  when 'plan' then
    v:=tripboogie_private.text_field(p_data,'time',5,false);
    if v<>'' and v !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','시간은 HH:mm 형식이어야 합니다.'); end if;
    duration:=0;
    if p_data ? 'duration' and p_data->>'duration'<>'' then
      if jsonb_typeof(p_data->'duration') not in ('number','string') or (p_data->>'duration') !~ '^[0-9]{1,4}$' then
        perform tripboogie_private.fail(400,'INVALID_REQUEST','소요 시간은 분 단위 숫자여야 합니다.');
      end if;
      duration:=(p_data->>'duration')::integer;
      if duration>1440 then perform tripboogie_private.fail(400,'INVALID_REQUEST','소요 시간은 0~1440분이어야 합니다.'); end if;
    elsif p_data ? 'duration' and jsonb_typeof(p_data->'duration')='null' then
      perform tripboogie_private.fail(400,'INVALID_REQUEST','소요 시간이 올바르지 않습니다.');
    end if;
    result:=jsonb_build_object('title',tripboogie_private.text_field(p_data,'title',300),
      'date',tripboogie_private.date_field(p_data,'date'),'time',v,'category',category,'duration',duration,
      'note',tripboogie_private.text_field(p_data,'note',10000,false),'placeId','');
    if p_data ? 'placeId' and p_data->>'placeId'<>'' then result:=result||jsonb_build_object('placeId',tripboogie_private.uuid_field(p_data,'placeId')); end if;
    if p_data ? 'position' then
      if jsonb_typeof(p_data->'position')<>'number' or (p_data->>'position') !~ '^[0-9]{1,9}$' then
        perform tripboogie_private.fail(400,'INVALID_REQUEST','일정 순서가 올바르지 않습니다.');
      end if;
      result:=result||jsonb_build_object('position',(p_data->>'position')::integer);
    end if;
  when 'place' then
    foreach v in array array['lat','lng'] loop
      if p_data ? v and p_data->>v is not null and p_data->>v<>'' then
        if jsonb_typeof(p_data->v) not in ('number','string') or (p_data->>v) !~ '^-?[0-9]{1,3}(\.[0-9]{1,15})?$' then
          perform tripboogie_private.fail(400,'INVALID_REQUEST','좌표는 숫자로 입력하세요.');
        end if;
      end if;
    end loop;
    lat:=nullif(p_data->>'lat','')::numeric; lng:=nullif(p_data->>'lng','')::numeric;
    if (lat is null)<>(lng is null) or abs(lat)>90 or abs(lng)>180 then perform tripboogie_private.fail(400,'INVALID_REQUEST','위도와 경도를 함께 올바르게 입력하세요.'); end if;
    result:=jsonb_build_object('name',tripboogie_private.text_field(p_data,'name',300),
      'address',tripboogie_private.text_field(p_data,'address',1000,false),'lat',lat,'lng',lng,'category',category,
      'note',tripboogie_private.text_field(p_data,'note',10000,false));
  when 'expense' then
    if jsonb_typeof(p_data->'participants') is distinct from 'array' then perform tripboogie_private.fail(400,'INVALID_REQUEST','분담자 목록이 필요합니다.'); end if;
    if jsonb_array_length(p_data->'participants')>100 then perform tripboogie_private.fail(400,'INVALID_REQUEST','분담자는 최대 100명입니다.'); end if;
    for person in select value from jsonb_array_elements(p_data->'participants') loop
      v:=tripboogie_private.text_field(jsonb_build_object('person',person),'person',200);
      if not people @> jsonb_build_array(v) then people:=people||jsonb_build_array(v); end if;
    end loop;
    result:=jsonb_build_object('title',tripboogie_private.text_field(p_data,'title',300),
      'amount',tripboogie_private.decimal_field(p_data,'amount'),'currency',tripboogie_private.currency_field(p_data),
      'category',category,'payer',tripboogie_private.text_field(p_data,'payer',200),'participants',people,
      'date',tripboogie_private.date_field(p_data,'date'));
    if p_data ? 'exchangeRate' and p_data->>'exchangeRate'<>'' then result:=result||jsonb_build_object('exchangeRate',tripboogie_private.decimal_field(p_data,'exchangeRate',true)); end if;
  when 'checklist' then
    if jsonb_typeof(p_data->'done') is distinct from 'boolean' then perform tripboogie_private.fail(400,'INVALID_REQUEST','체크 상태가 필요합니다.'); end if;
    result:=jsonb_build_object('title',tripboogie_private.text_field(p_data,'title',500),'done',p_data->'done','category',category);
  else perform tripboogie_private.fail(400,'INVALID_REQUEST','지원하지 않는 항목 종류입니다.');
  end case;
  return result;
end;
$$;


with ranked as (select r.id,row_number() over(partition by r.trip_id,r.data->>'date' order by r.data->>'time',r.id)::integer pos
  from public.trip_records r where r.kind='plan' and not r.deleted), changed as (
  update public.trip_records r set data=jsonb_set(r.data,'{position}',to_jsonb(a.pos)),version=version+1,updated_at=now()
  from ranked a where r.id=a.id and not r.data ? 'position' returning r.trip_id)
update public.trips set revision=revision+1,updated_at=now() where id in (select trip_id from changed);

-- The trip row is locked by dispatch before this helper. One revision protects
-- the entire ordered selection, including its destination day and capacity.
create function tripboogie_private.edit_schedule(p_trip public.trips,p_payload jsonb)
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
    update public.trip_records r set data=jsonb_set(r.data,'{date}',to_jsonb(case when r.data->>'date'=source_date::text then target_date::text else source_date::text end)),
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
          insert into public.trip_records(trip_id,kind,data,updated_by) values(p_trip.id,'plan',item.data||jsonb_build_object('date',target_date,'position',next_position+item.ord::integer),auth.uid());
        else
          update public.trip_records set data=item.data||jsonb_build_object('date',target_date,'position',next_position+item.ord::integer),version=version+1,updated_at=now(),updated_by=auth.uid() where id=item.id;
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
  for row in select value from jsonb_array_elements(p_payload->'records') order by case value->>'kind' when 'place' then 0 else 1 end loop
    kind:=tripboogie_private.text_field(row,'kind',20);
    old_id:=tripboogie_private.uuid_field(row,'id'); new_id:=(ids->>old_id::text)::uuid;
    v_import_data:=tripboogie_private.normalize_item(kind,row->'data');
    if kind='plan' then
      if v_import_data->>'date'<start_date or v_import_data->>'date'>end_date then perform tripboogie_private.fail(400,'INVALID_REQUEST','여행 기간 밖의 일정이 있습니다.'); end if;
      if v_import_data->>'placeId'<>'' then
        v_import_data:=jsonb_set(v_import_data,'{placeId}',coalesce(ids->(v_import_data->>'placeId'),'null'));
        if v_import_data->>'placeId' is null or not exists(select 1 from public.trip_records r where r.trip_id=new_trip_id and r.id=(v_import_data->>'placeId')::uuid and r.kind='place') then
          perform tripboogie_private.fail(400,'INVALID_REQUEST','백업 일정에 없는 장소가 연결되어 있습니다.');
        end if;
      end if;
    end if;
    total_bytes:=total_bytes+octet_length(v_import_data::text);
    if total_bytes>2097152 then perform tripboogie_private.fail(413,'TOO_LARGE','여행 데이터는 최대 2 MiB입니다.'); end if;
    insert into public.trip_records(id,trip_id,kind,data,updated_by) values(new_id,new_trip_id,kind,v_import_data,uid);
  end loop;
  with ranked as (select r.id,row_number() over(partition by r.data->>'date' order by coalesce((r.data->>'position')::integer,2147483647),r.data->>'time',r.id)::integer pos
    from public.trip_records r where r.trip_id=new_trip_id and r.kind='plan')
  update public.trip_records r set data=jsonb_set(r.data,'{position}',to_jsonb(a.pos)),version=r.version+1,updated_at=now(),updated_by=auth.uid() from ranked a where r.id=a.id and r.data->'position' is distinct from to_jsonb(a.pos);
  insert into tripboogie_private.import_receipts(user_id,idempotency_key,digest,trip_id) values(uid,key,fingerprint,new_trip_id);
  return tripboogie_private.workspace(new_trip_id);
end;
$$;
revoke all on function tripboogie_private.import_trip(jsonb) from public,anon,authenticated;
-- Shared rate gate across Vercel instances: at most four new provider requests
-- per second and thirty per minute per account. No addresses/coordinates stored.
create table tripboogie_private.map_rate_limits(scope text primary key,window_at timestamptz not null,requests integer not null);
alter table tripboogie_private.map_rate_limits enable row level security;
revoke all on tripboogie_private.map_rate_limits from public,anon,authenticated;
create function tripboogie_private.map_budget()
returns jsonb language plpgsql set search_path=''
as $$
declare row tripboogie_private.map_rate_limits%rowtype; instant timestamptz:=clock_timestamp(); uid text:=auth.uid()::text;
begin
  insert into tripboogie_private.map_rate_limits(scope,window_at,requests) values('global','2000-01-01',0) on conflict do nothing;
  select * into row from tripboogie_private.map_rate_limits where scope='global' for update;
  if instant-row.window_at<interval '250 milliseconds' then perform tripboogie_private.fail(429,'RATE_LIMITED','지도 요청이 많습니다. 잠시 후 다시 시도하세요.'); end if;
  insert into tripboogie_private.map_rate_limits(scope,window_at,requests) values(uid,instant,0) on conflict do nothing;
  select * into row from tripboogie_private.map_rate_limits where scope=uid for update;
  if instant-row.window_at>=interval '1 minute' then row.requests:=0; row.window_at:=instant; end if;
  if row.requests>=30 then perform tripboogie_private.fail(429,'RATE_LIMITED','지도 검색과 경로는 계정당 분당 30회까지 사용할 수 있습니다.'); end if;
  update tripboogie_private.map_rate_limits set window_at=row.window_at,requests=row.requests+1 where scope=uid;
  update tripboogie_private.map_rate_limits set window_at=instant where scope='global';
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function tripboogie_private.map_budget() from public,anon,authenticated;
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

  if p_operation='map-budget' then return tripboogie_private.map_budget(); end if;
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
  if p_operation='schedule' then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','열람 권한으로는 수정할 수 없습니다.'); end if;
    return tripboogie_private.edit_schedule(v_trip,p_payload);
  end if;
  if p_operation='add-place' then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','열람 권한으로는 수정할 수 없습니다.'); end if;
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
        update public.trip_records r set data=jsonb_set(r.data,'{date}',to_jsonb(((r.data->>'date')::date+((v_data->>'startDate')::date-v_trip.start_date))::text)),
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
    if v_kind not in ('plan','place','expense','checklist') then perform tripboogie_private.fail(400,'INVALID_REQUEST','지원하지 않는 항목 종류입니다.'); end if;
    v_expected:=null;
    if p_payload ? 'version' or v_action='delete' then v_expected:=tripboogie_private.version_field(p_payload); end if;
    if (v_expected is not null and (v_record.id is null or v_record.deleted or v_record.version<>v_expected or v_record.kind<>v_kind))
      or (v_expected is null and v_record.id is not null) then
      perform tripboogie_private.fail(409,'CONFLICT','항목이 변경되었거나 삭제되었습니다. 새로고침 후 다시 시도하세요.');
    end if;
    if v_action='delete' then
      if v_kind='place' and exists(select 1 from public.trip_records r where r.trip_id=v_trip.id and r.kind='plan' and not r.deleted and r.data->>'placeId'=v_record_id::text) then
        perform tripboogie_private.fail(409,'CONFLICT','이 장소를 연결한 일정이 있습니다. 연결을 먼저 해제하세요.');
      end if;
      update public.trip_records set deleted=true,version=version+1,updated_at=now(),updated_by=v_uid where id=v_record_id;
    else
      v_data:=tripboogie_private.normalize_item(v_kind,p_payload->'data');
      if v_kind='plan' then
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
    update public.trips set revision=revision+1,updated_at=now() where id=v_trip.id;
    return tripboogie_private.workspace(v_trip.id);
  end if;

  if v_role<>'owner' then perform tripboogie_private.fail(403,'FORBIDDEN','여행 소유자만 관리할 수 있습니다.'); end if;
  case p_operation
  when 'delete-trip' then
    v_expected:=tripboogie_private.version_field(jsonb_build_object('version',p_payload->'revision'));
    if v_expected<>v_trip.revision then perform tripboogie_private.fail(409,'CONFLICT','여행이 변경되었습니다. 최신 내용을 확인한 뒤 삭제하세요.'); end if;
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




notify pgrst,'reload schema';
