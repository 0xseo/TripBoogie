-- Private collaborative travel data. All writes use one database transaction.
-- The public RPC is SECURITY INVOKER; privileged membership/invitation work
-- lives in an unexposed schema and checks auth.uid() inside the transaction.
create schema tripboogie_private;
revoke all on schema tripboogie_private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(name) <= 200),
  email text not null default '' check (length(email) <= 320),
  created_at timestamptz not null default now()
);
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  destination text not null check (length(btrim(destination)) between 1 and 300),
  start_date date not null,
  end_date date not null check (end_date >= start_date and end_date-start_date<=364),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  timezone text not null check (length(timezone) between 1 and 100),
  version bigint not null default 1 check (version >= 1),
  revision bigint not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (trip_id,user_id)
);
create unique index trip_members_one_owner on public.trip_members(trip_id) where role='owner';
create index trip_members_by_user on public.trip_members(user_id,trip_id);
create index trips_by_owner on public.trips(owner_id);
create table public.trip_records (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  kind text not null check (kind in ('plan','place','expense','checklist')),
  data jsonb not null check (jsonb_typeof(data)='object'),
  version bigint not null default 1 check (version >= 1),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index trip_records_by_trip on public.trip_records(trip_id,deleted,updated_at,id);
create index trip_records_plan_place on public.trip_records(trip_id,(data->>'placeId')) where kind='plan' and not deleted;
create index trip_records_by_author on public.trip_records(updated_by);
create table public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  role text not null check (role in ('editor','viewer')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index trip_invites_by_trip on public.trip_invites(trip_id,created_at desc);
create index trip_invites_active on public.trip_invites(trip_id,expires_at) where revoked_at is null;
create index trip_invites_by_author on public.trip_invites(created_by);

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_records enable row level security;
alter table public.trip_invites enable row level security;
revoke all on table public.profiles,public.trips,public.trip_members,public.trip_records,public.trip_invites from public,anon,authenticated;
grant select on table public.profiles,public.trips,public.trip_members,public.trip_records,public.trip_invites to authenticated;

create function tripboogie_private.has_role(p_trip uuid,p_roles text[])
returns boolean language sql stable security definer set search_path=''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.trip_members m
    where m.trip_id=p_trip and m.user_id=(select auth.uid()) and m.role=any(p_roles)
  );
$$;
create policy trips_member_read on public.trips for select to authenticated
using (tripboogie_private.has_role(id,array['owner','editor','viewer']));
create policy members_member_read on public.trip_members for select to authenticated
using (tripboogie_private.has_role(trip_id,array['owner','editor','viewer']));
create policy records_member_read on public.trip_records for select to authenticated
using (not deleted and tripboogie_private.has_role(trip_id,array['owner','editor','viewer']));
create policy invites_owner_read on public.trip_invites for select to authenticated
using (tripboogie_private.has_role(trip_id,array['owner']));
create policy profiles_shared_read on public.profiles for select to authenticated
using (id=(select auth.uid()) or exists (
  select 1 from public.trip_members m where m.user_id=profiles.id
  and tripboogie_private.has_role(m.trip_id,array['owner','editor','viewer'])
));

create function tripboogie_private.fail(p_status integer,p_code text,p_message text)
returns void language plpgsql set search_path=''
as $$ begin raise exception using errcode='PT'||p_status::text,message=p_message,detail=p_code; end; $$;

create function tripboogie_private.text_field(p_data jsonb,p_key text,p_max integer,p_required boolean default true)
returns text language plpgsql immutable set search_path=''
as $$
declare v text;
begin
  if not (p_data ? p_key) and not p_required then return ''; end if;
  if jsonb_typeof(p_data->p_key) is distinct from 'string' then
    perform tripboogie_private.fail(400,'INVALID_REQUEST',p_key||': 문자열을 입력하세요.');
  end if;
  v:=p_data->>p_key;
  if length(v)>p_max or (p_required and btrim(v)='') then
    perform tripboogie_private.fail(400,'INVALID_REQUEST',p_key||': 길이를 확인하세요.');
  end if;
  return btrim(v);
end;
$$;
create function tripboogie_private.date_field(p_data jsonb,p_key text)
returns date language plpgsql immutable set search_path=''
as $$
declare v text; d date;
begin
  v:=tripboogie_private.text_field(p_data,p_key,10);
  if v !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then
    perform tripboogie_private.fail(400,'INVALID_REQUEST',p_key||': YYYY-MM-DD 형식이 필요합니다.');
  end if;
  begin d:=v::date; exception when datetime_field_overflow or invalid_datetime_format then
    perform tripboogie_private.fail(400,'INVALID_REQUEST',p_key||': 날짜가 올바르지 않습니다.');
  end;
  return d;
end;
$$;
create function tripboogie_private.uuid_field(p_data jsonb,p_key text)
returns uuid language plpgsql immutable set search_path=''
as $$
declare v text;
begin
  v:=tripboogie_private.text_field(p_data,p_key,36);
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    perform tripboogie_private.fail(400,'INVALID_REQUEST','올바른 항목 ID가 필요합니다.');
  end if;
  return v::uuid;
end;
$$;
create function tripboogie_private.version_field(p_data jsonb)
returns bigint language plpgsql immutable set search_path=''
as $$
begin
  if jsonb_typeof(p_data->'version') is distinct from 'number'
    or (p_data->>'version') !~ '^[1-9][0-9]{0,15}$'
    or (p_data->>'version')::numeric>9007199254740991 then
    perform tripboogie_private.fail(400,'INVALID_REQUEST','수정할 항목의 버전이 필요합니다.');
  end if;
  return (p_data->>'version')::bigint;
end;
$$;
create function tripboogie_private.currency_field(p_data jsonb)
returns text language plpgsql immutable set search_path=''
as $$
declare v text;
begin
  v:=tripboogie_private.text_field(p_data,'currency',3);
  if v !~ '^[A-Za-z]{3}$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','통화 코드가 올바르지 않습니다.'); end if;
  return upper(v);
end;
$$;
create function tripboogie_private.decimal_field(p_data jsonb,p_key text,p_positive boolean default false)
returns jsonb language plpgsql immutable set search_path=''
as $$
declare v text;
begin
  if jsonb_typeof(p_data->p_key) not in ('string','number') or not (p_data ? p_key) then
    perform tripboogie_private.fail(400,'INVALID_REQUEST',p_key||': 금액을 입력하세요.');
  end if;
  v:=p_data->>p_key;
  if v is null or v !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' or (p_positive and v::numeric<=0) then
    perform tripboogie_private.fail(400,'INVALID_REQUEST',p_key||': 금액 범위를 확인하세요.');
  end if;
  return p_data->p_key;
end;
$$;
create function tripboogie_private.normalize_trip(p_data jsonb)
returns jsonb language plpgsql stable set search_path=''
as $$
declare a date; b date; zone text;
begin
  if jsonb_typeof(p_data) is distinct from 'object' then perform tripboogie_private.fail(400,'INVALID_REQUEST','여행 정보가 필요합니다.'); end if;
  a:=tripboogie_private.date_field(p_data,'startDate'); b:=tripboogie_private.date_field(p_data,'endDate');
  if b<a then perform tripboogie_private.fail(400,'INVALID_REQUEST','종료일은 시작일 이후여야 합니다.'); end if;
  if b-a>364 then perform tripboogie_private.fail(400,'INVALID_REQUEST','한 여행은 최대 365일로 설정해 주세요.'); end if;
  zone:=case when p_data ? 'timezone' then tripboogie_private.text_field(p_data,'timezone',100) else 'Asia/Seoul' end;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then
    perform tripboogie_private.fail(400,'INVALID_REQUEST','올바른 IANA 시간대가 필요합니다.');
  end if;
  return jsonb_build_object('title',tripboogie_private.text_field(p_data,'title',200),
    'destination',tripboogie_private.text_field(p_data,'destination',300),'startDate',a,'endDate',b,
    'currency',tripboogie_private.currency_field(p_data),'timezone',zone);
end;
$$;
create function tripboogie_private.normalize_item(p_kind text,p_data jsonb)
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

create function tripboogie_private.trip_json(p_trip public.trips,p_role text)
returns jsonb language sql stable set search_path=''
as $$ select jsonb_build_object('id',p_trip.id,'title',p_trip.title,'destination',p_trip.destination,
  'startDate',p_trip.start_date,'endDate',p_trip.end_date,'currency',p_trip.currency,'timezone',p_trip.timezone,
  'version',p_trip.version,'revision',p_trip.revision,'role',p_role,
  'memberCount',(select count(*) from public.trip_members m where m.trip_id=p_trip.id),
  'createdAt',p_trip.created_at,'updatedAt',p_trip.updated_at); $$;
create function tripboogie_private.workspace(p_trip uuid)
returns jsonb language plpgsql stable set search_path=''
as $$
declare trip jsonb;
begin
  select tripboogie_private.trip_json(t,m.role) into trip from public.trips t
    join public.trip_members m on m.trip_id=t.id and m.user_id=(select auth.uid()) where t.id=p_trip;
  if trip is null then perform tripboogie_private.fail(404,'NOT_FOUND','여행을 찾을 수 없거나 접근 권한이 없습니다.'); end if;
  return jsonb_build_object('trip',trip,'revision',trip->'revision',
    'records',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'data',r.data,
      'version',r.version,'updatedAt',r.updated_at,'updatedBy',coalesce(r.updated_by::text,'')) order by r.updated_at,r.id)
      from public.trip_records r where r.trip_id=p_trip and not r.deleted),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'role',m.role)
      order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end,m.created_at,m.user_id)
      from public.trip_members m join public.profiles p on p.id=m.user_id where m.trip_id=p_trip),'[]'::jsonb));
end;
$$;
create function tripboogie_private.sync_profile(p_user uuid)
returns void language sql set search_path=''
as $$ insert into public.profiles(id,name,email)
  select id,left(coalesce(nullif(btrim(raw_user_meta_data->>'full_name'),''),nullif(btrim(raw_user_meta_data->>'name'),''),
    nullif(btrim(raw_user_meta_data->>'nickname'),''),nullif(split_part(email,'@',1),''),'여행 친구'),200),coalesce(email,'')
  from auth.users where id=p_user
  on conflict(id) do update set name=excluded.name,email=excluded.email; $$;

create function tripboogie_private.dispatch(p_operation text,p_trip_id uuid,p_payload jsonb)
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
  if octet_length(p_payload::text)>65536 then perform tripboogie_private.fail(413,'TOO_LARGE','요청 크기를 줄여 주세요.'); end if;

  if p_operation='list' then
    return coalesce((select jsonb_agg(tripboogie_private.trip_json(t,m.role) order by t.updated_at desc,t.id)
      from public.trips t join public.trip_members m on m.trip_id=t.id and m.user_id=v_uid),'[]'::jsonb);
  end if;
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
  if p_operation='mutate' then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','열람 권한으로는 수정할 수 없습니다.'); end if;
    v_action:=tripboogie_private.text_field(p_payload,'action',30);
    if v_action='update-trip' then
      v_expected:=tripboogie_private.version_field(p_payload);
      if jsonb_typeof(p_payload->'data') is distinct from 'object' then perform tripboogie_private.fail(400,'INVALID_REQUEST','여행 정보가 필요합니다.'); end if;
      v_data:=tripboogie_private.normalize_trip(jsonb_build_object('title',v_trip.title,'destination',v_trip.destination,
        'startDate',v_trip.start_date,'endDate',v_trip.end_date,'currency',v_trip.currency,'timezone',v_trip.timezone)||(p_payload->'data'));
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

create function public.tripboogie_api(p_operation text,p_trip_id uuid default null,p_payload jsonb default '{}')
returns jsonb language sql volatile security invoker set search_path=''
as $$ select tripboogie_private.dispatch(p_operation,p_trip_id,p_payload); $$;

-- Explicit grants avoid relying on project-specific default privileges.
revoke all on all functions in schema tripboogie_private from public,anon,authenticated;
revoke all on function public.tripboogie_api(text,uuid,jsonb) from public,anon,authenticated;
grant usage on schema tripboogie_private to authenticated;
grant execute on function tripboogie_private.has_role(uuid,text[]) to authenticated;
grant execute on function tripboogie_private.dispatch(text,uuid,jsonb) to authenticated;
grant execute on function public.tripboogie_api(text,uuid,jsonb) to authenticated;
comment on function tripboogie_private.dispatch(text,uuid,jsonb) is
  'Atomic membership, invitation, CAS and capacity boundary; auth.uid checked inside. Private schema must remain outside Data API exposed schemas.';
notify pgrst,'reload schema';
