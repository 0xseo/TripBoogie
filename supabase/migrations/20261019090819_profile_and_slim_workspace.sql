-- Account preferences remain private; only trip members receive small avatar previews.
alter table public.profiles add column avatar text not null default '';
alter table public.profiles add column theme text not null default 'system' check(theme in ('system','light','dark'));
alter table public.profiles add constraint profiles_avatar_check check(avatar='' or (length(avatar)<=16384 and avatar ~ '^data:image/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$'));
-- Social photos are display-only metadata. Only known provider image hosts are accepted.
create or replace function tripboogie_private.profile_avatar(p_profile public.profiles)
returns text language plpgsql stable set search_path='' as $$
declare candidate text;
begin
 if p_profile.avatar<>'' then return p_profile.avatar;end if;
 select coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture','') into candidate from auth.users u where u.id=p_profile.id;
 candidate:=regexp_replace(candidate,'^http:','https:');
 if length(candidate)<=2048 and candidate ~ '^https://([a-zA-Z0-9-]+[.])*(googleusercontent[.]com|kakaocdn[.]net)/[^[:space:]]+$' then return candidate;end if;
 return '';
end;$$;
revoke all on function tripboogie_private.profile_avatar(public.profiles) from public,anon,authenticated;
create or replace function tripboogie_private.booking_categories(p_settings jsonb)
returns jsonb language sql immutable set search_path='' as $$ select coalesce(p_settings->'bookingCategories','[{"id":"hotel","label":"숙소","kind":"hotel"},{"id":"flight","label":"항공","kind":"flight"},{"id":"tour","label":"투어·티켓","kind":"tour"},{"id":"other","label":"기타","kind":"other"}]'::jsonb); $$;
create or replace function tripboogie_private.normalize_booking_categories(p_value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:='[]'; c jsonb; normalized jsonb;
begin
 normalized:=tripboogie_private.normalize_categories(p_value);
 if jsonb_array_length(normalized)=0 then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약 분류를 하나 이상 남겨 주세요.');end if;
 for c in select value from jsonb_array_elements(p_value) loop
   if coalesce(c->>'kind','other') not in ('hotel','flight','tour','other') then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약 분류 형식을 확인하세요.');end if;
   result:=result||jsonb_build_array(jsonb_build_object('id',c->>'id','label',btrim(c->>'label'),'kind',coalesce(c->>'kind','other')));
 end loop;
 return result;
end;$$;
revoke all on function tripboogie_private.booking_categories(jsonb),tripboogie_private.normalize_booking_categories(jsonb) from public,anon,authenticated;
create or replace function tripboogie_private.normalize_booking(p_data jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;kind text;a date;b date;t text;airport jsonb;amount jsonb:='null';currency text:='';role text;
begin
 kind:=tripboogie_private.text_field(p_data,'type',10);
 if kind not in ('hotel','flight','tour','other') then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약 종류를 선택하세요.');end if;
 a:=tripboogie_private.date_field(p_data,'startDate');b:=tripboogie_private.date_field(p_data,'endDate');
 if abs(b-a)>364 or (kind<>'flight' and b<a) then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약 기간을 확인하세요.');end if;
 foreach t in array array['startTime','endTime'] loop
   if coalesce(p_data->>t,'')<>'' and p_data->>t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','시간은 HH:mm 형식이어야 합니다.');end if;
 end loop;
 role:=coalesce(nullif(p_data->>'flightRole',''),'outbound');
 if role not in ('outbound','inbound','transfer') then perform tripboogie_private.fail(400,'INVALID_REQUEST','항공권의 이동 종류를 선택하세요.');end if;
 if coalesce(p_data->>'moneyAmount','')<>'' then
   amount:=to_jsonb((tripboogie_private.decimal_field(p_data,'moneyAmount')#>>'{}')::numeric::text);currency:=tripboogie_private.currency_field(jsonb_build_object('currency',p_data->'moneyCurrency'));
 end if;
 result:=jsonb_build_object('type',kind,'category',coalesce(nullif(tripboogie_private.text_field(p_data,'category',100,false),''),kind),'title',tripboogie_private.text_field(p_data,'title',300),'startDate',a,'endDate',b,
 'startTime',tripboogie_private.text_field(p_data,'startTime',5,false),'endTime',tripboogie_private.text_field(p_data,'endTime',5,false),
 'reference',tripboogie_private.text_field(p_data,'reference',300,false),'platform',tripboogie_private.text_field(p_data,'platform',200,false),'note',tripboogie_private.text_field(p_data,'note',10000,false),
 'flightNumber',tripboogie_private.text_field(p_data,'flightNumber',20,false),'flightRole',role,'departure',tripboogie_private.text_field(p_data,'departure',300,false),'arrival',tripboogie_private.text_field(p_data,'arrival',300,false),
 'departureZone',tripboogie_private.text_field(p_data,'departureZone',100,false),'arrivalZone',tripboogie_private.text_field(p_data,'arrivalZone',100,false),'placeId','','moneyAmount',amount,'moneyCurrency',currency);
 foreach t in array array['departureAirport','arrivalAirport'] loop
   if p_data ? t and p_data->t<>'null'::jsonb then
     airport:=p_data->t;
     if jsonb_typeof(airport)<>'object' or coalesce(airport->>'icao','') !~ '^[A-Z0-9]{3,8}$' or coalesce(airport->>'iata','') !~ '^([A-Z0-9]{3})?$' or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=airport->>'timezone') then perform tripboogie_private.fail(400,'INVALID_REQUEST','공항·시간대 정보를 확인하세요.');end if;
     result:=result||jsonb_build_object(t,jsonb_build_object('icao',airport->>'icao','iata',airport->>'iata','name',tripboogie_private.text_field(airport,'name',300),'timezone',airport->>'timezone'));
     result:=jsonb_set(result,array[case when t='departureAirport' then 'departureZone' else 'arrivalZone' end],airport->'timezone');
   end if;
 end loop;
 if kind='flight' and coalesce(result->>'startTime','')<>'' and coalesce(result->>'endTime','')<>'' and exists(select 1 from pg_catalog.pg_timezone_names z where z.name=result->>'departureZone') and exists(select 1 from pg_catalog.pg_timezone_names z where z.name=result->>'arrivalZone') then
   if ((b::text||' '||(result->>'endTime'))::timestamp at time zone (result->>'arrivalZone'))<((a::text||' '||(result->>'startTime'))::timestamp at time zone (result->>'departureZone')) then perform tripboogie_private.fail(400,'INVALID_REQUEST','공항 현지 날짜·시간을 확인하세요. 도착 시각이 출발보다 빠릅니다.');end if;
 elsif b<a then perform tripboogie_private.fail(400,'INVALID_REQUEST','날짜 변경선을 지나는 항공편은 두 공항과 현지 시각을 입력하세요.');end if;
 if coalesce(p_data->>'placeId','')<>'' then result:=result||jsonb_build_object('placeId',tripboogie_private.uuid_field(p_data,'placeId'));end if;
 return result;
end;
$$;
create or replace function tripboogie_private.normalize_cities(p_cities jsonb,p_start date,p_end date)
returns jsonb language plpgsql stable set search_path='' as $$
declare city jsonb; result jsonb:='[]'; city_id uuid; ids uuid[]:='{}'; a date;b date;cc text;tz text;place jsonb;
begin
 if jsonb_typeof(p_cities) is distinct from 'array' or jsonb_array_length(p_cities)>20 then
   perform tripboogie_private.fail(400,'INVALID_REQUEST','여행 도시는 최대 20개까지 선택할 수 있습니다.');end if;
 for city in select value from jsonb_array_elements(p_cities) loop
   city_id:=tripboogie_private.uuid_field(city,'id');
   if city_id=any(ids) then perform tripboogie_private.fail(400,'INVALID_REQUEST','도시 ID가 중복되었습니다.');end if;ids:=array_append(ids,city_id);
   place:=tripboogie_private.normalize_item('place',city);
   if city ? 'imageDisabled' and jsonb_typeof(city->'imageDisabled')<>'boolean' then perform tripboogie_private.fail(400,'INVALID_REQUEST','도시 사진 설정을 확인하세요.');end if;
   place:=place||jsonb_build_object('imageDisabled',coalesce((city->>'imageDisabled')::boolean,false));
   cc:=tripboogie_private.text_field(city,'countryCode',2);tz:=tripboogie_private.text_field(city,'timezone',100);
   if cc not in ('AC','AD','AE','AF','AG','AI','AL','AM','AO','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DG','DJ','DK','DM','DO','DZ','EA','EC','EE','EG','EH','ER','ES','ET','EU','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','IC','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TA','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','XK','YE','YT','ZA','ZM','ZW') or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=tz) then
     perform tripboogie_private.fail(400,'INVALID_REQUEST','도시의 국가·시간대를 확인하세요.');end if;
   a:=tripboogie_private.date_field(city,'startDate');b:=tripboogie_private.date_field(city,'endDate');
   if a<p_start or b>p_end or b<a then perform tripboogie_private.fail(400,'INVALID_REQUEST','도시 방문 기간은 여행 기간 안에서 선택하세요.');end if;
   result:=result||jsonb_build_array(place||jsonb_build_object('id',city_id,'countryCode',cc,'timezone',tz,
      'currency',tripboogie_private.currency_field(city),'startDate',a,'endDate',b));
 end loop;
 return result;
end;
$$;
-- Count unique nights spent in saved flights, including date-line crossings.
-- Airport-local instants are compared in the departure zone; malformed legacy rows stay unknown.
create or replace function tripboogie_private.flight_nights(p_trip public.trips)
returns integer language plpgsql stable set search_path='' as $$
declare item jsonb;a date;b date;d date;nights date[]:='{}';
begin
 for item in select r.data from public.trip_records r where r.trip_id=p_trip.id and r.kind='booking' and not r.deleted and r.data->>'type'='flight' loop
  begin
   a:=(item->>'startDate')::date;b:=(item->>'endDate')::date;
   if item->>'startTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and item->>'endTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and exists(select 1 from pg_catalog.pg_timezone_names where name=item->>'departureZone') and exists(select 1 from pg_catalog.pg_timezone_names where name=item->>'arrivalZone') then
     b:=(((b::text||' '||(item->>'endTime'))::timestamp at time zone (item->>'arrivalZone')) at time zone (item->>'departureZone'))::date;
   end if;
   if b>a and b-a<=3 then
    for d in select generate_series(greatest(a,p_trip.start_date)::timestamp,least(b-1,p_trip.end_date-1)::timestamp,interval '1 day')::date loop
      if not d=any(nights) then nights:=array_append(nights,d);end if;
    end loop;
   end if;
  exception when invalid_datetime_format or datetime_field_overflow then null;
  end;
 end loop;
 return cardinality(nights);
end;$$;
revoke all on function tripboogie_private.flight_nights(public.trips) from public,anon,authenticated;
create or replace function tripboogie_private.trip_json(p_trip public.trips,p_role text)
returns jsonb language sql stable set search_path=''
as $$ select jsonb_build_object('id',p_trip.id,'title',p_trip.title,'destination',p_trip.destination,
  'startDate',p_trip.start_date,'endDate',p_trip.end_date,'currency',p_trip.currency,'timezone',p_trip.timezone,
  'settings',p_trip.settings,'version',p_trip.version,'revision',p_trip.revision,'role',p_role,
  'flightNights',tripboogie_private.flight_nights(p_trip),'memberPreview',coalesce((select jsonb_agg(jsonb_build_object('id',preview.id,'name',preview.name,'avatar',preview.avatar)) from
    (select p.id,p.name,tripboogie_private.profile_avatar(p) as avatar from public.trip_members m join public.profiles p on p.id=m.user_id where m.trip_id=p_trip.id order by case m.role when 'owner' then 0 else 1 end,m.created_at,m.user_id limit 3) preview),'[]'::jsonb),
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
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'avatar',tripboogie_private.profile_avatar(p),'role',m.role)
      order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end,m.created_at,m.user_id)
      from public.trip_members m join public.profiles p on p.id=m.user_id where m.trip_id=p_trip),'[]'::jsonb));
end;
$$;
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
      if p_payload ? 'searchLanguage' and coalesce(p_payload->>'searchLanguage','') not in ('','ko','en','ja','zh','fr','de','es','it','th','vi','pt','ru','id','ar','tr') then perform tripboogie_private.fail(400,'INVALID_REQUEST','검색 언어를 확인하세요.');end if;
      if p_payload ? 'theme' and coalesce(p_payload->>'theme','') not in ('system','light','dark') then perform tripboogie_private.fail(400,'INVALID_REQUEST','테마를 확인하세요.');end if;
      if p_payload ? 'avatar' and (jsonb_typeof(p_payload->'avatar')<>'string' or length(p_payload->>'avatar')>16384 or (p_payload->>'avatar'<>'' and p_payload->>'avatar' !~ '^data:image/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$')) then perform tripboogie_private.fail(400,'INVALID_REQUEST','프로필 사진을 확인하세요.');end if;
      update public.profiles set theme=case when p_payload ? 'theme' then p_payload->>'theme' else theme end,
        avatar=case when p_payload ? 'avatar' then p_payload->>'avatar' else avatar end,name=tripboogie_private.text_field(p_payload,'name',200),
        base_currency=tripboogie_private.currency_field(jsonb_build_object('currency',p_payload->'baseCurrency')),
        search_language=case when p_payload ? 'searchLanguage' then tripboogie_private.text_field(p_payload,'searchLanguage',2,false) else search_language end,
        holiday_country=case when p_payload ? 'holidayCountry' then tripboogie_private.text_field(p_payload,'holidayCountry',2,false) else holiday_country end,version=version+1
        where id=v_uid and version=tripboogie_private.version_field(p_payload);
      if not found then perform tripboogie_private.fail(409,'CONFLICT','프로필이 변경되었습니다. 다시 열어 주세요.');end if;
    end if;
    return (select jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'avatar',tripboogie_private.profile_avatar(p),'theme',p.theme,'baseCurrency',p.base_currency,'searchLanguage',p.search_language,'holidayCountry',coalesce(nullif(p.holiday_country,''),'{"KRW":"KR","JPY":"JP","USD":"US","GBP":"GB","CNY":"CN","TWD":"TW","THB":"TH","VND":"VN","SGD":"SG","HKD":"HK","AUD":"AU","CAD":"CA","CHF":"CH","NZD":"NZ","IDR":"ID","MYR":"MY","PHP":"PH"}'::jsonb->>p.base_currency,''),'version',p.version) from public.profiles p where p.id=v_uid);
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
    if p_payload->'data' ? 'cities' then
      update public.trips set settings=jsonb_set(settings,'{cities}',tripboogie_private.normalize_cities(p_payload->'data'->'cities',(v_data->>'startDate')::date,(v_data->>'endDate')::date)) where id=v_next_id;
    end if;
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
    if p_operation='save-booking' then return tripboogie_private.save_booking_payment(v_trip,p_payload);end if;
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
    if p_payload ? 'bookingCategories' then
      v_data:=jsonb_set(v_data,'{bookingCategories}',tripboogie_private.normalize_booking_categories(p_payload->'bookingCategories'));
      if exists(select 1 from public.trip_records r where r.trip_id=v_trip.id and r.kind='booking' and not r.deleted and not exists(select 1 from jsonb_array_elements(v_data->'bookingCategories') c where c->>'id'=coalesce(nullif(r.data->>'category',''),r.data->>'type') and c->>'kind'=r.data->>'type')) then
        perform tripboogie_private.fail(409,'CONFLICT','사용 중인 예약 분류는 삭제하거나 형식을 바꿀 수 없어요.');end if;
    end if;
    if p_payload ? 'expenseCategories' then v_data:=jsonb_set(v_data,'{expenseCategories}',tripboogie_private.normalize_categories(p_payload->'expenseCategories'));end if;
    if p_payload ? 'checklistCategories' then v_data:=jsonb_set(v_data,'{checklistCategories}',tripboogie_private.normalize_categories(p_payload->'checklistCategories'));end if;
    if p_payload ? 'cities' then v_data:=jsonb_set(v_data,'{cities}',tripboogie_private.normalize_cities(p_payload->'cities',v_trip.start_date,v_trip.end_date));end if;
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
      if p_payload->'data'->'shiftDates'='true'::jsonb and (v_data->>'startDate')::date<>v_trip.start_date then
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
      if p_payload->'data' ? 'cities' and v_trip.revision<>tripboogie_private.version_field(jsonb_build_object('version',p_payload->'revision')) then perform tripboogie_private.fail(409,'CONFLICT','여행 도시가 변경되었습니다. 다시 열어 주세요.');end if;
      v_result:=tripboogie_private.normalize_cities(coalesce(p_payload->'data'->'cities',v_trip.settings->'cities','[]'::jsonb),(v_data->>'startDate')::date,(v_data->>'endDate')::date);
      update public.trips set settings=jsonb_set(settings,'{cities}',v_result),title=v_data->>'title',destination=v_data->>'destination',start_date=(v_data->>'startDate')::date,
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
      if v_kind='booking' then
        if not exists(select 1 from jsonb_array_elements(tripboogie_private.booking_categories(v_trip.settings)) c where c->>'id'=v_data->>'category' and c->>'kind'=v_data->>'type') then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약 분류를 확인하세요.');end if;
        if v_data->>'type'='hotel' and (v_data->>'startDate'<v_trip.start_date::text or v_data->>'endDate'>v_trip.end_date::text) then perform tripboogie_private.fail(400,'INVALID_REQUEST','숙소 이용일은 여행 기간 안에서 선택하세요.');end if;
        if coalesce(v_record.data->>'expenseId','')<>'' then
          v_data:=v_data||jsonb_build_object('expenseId',v_record.data->>'expenseId','isPaid',coalesce(v_record.data->'isPaid','false'::jsonb),'moneyAmount',v_record.data->'moneyAmount','moneyCurrency',v_record.data->'moneyCurrency');
        else v_data:=v_data||jsonb_build_object('expenseId','','isPaid',false);end if;
      end if;
      if v_kind='expense' and coalesce(v_record.data->>'bookingId','')<>'' and exists(select 1 from public.trip_records b where b.trip_id=v_trip.id and b.kind='booking' and not b.deleted and b.id::text=v_record.data->>'bookingId' and b.data->>'expenseId'=v_record_id::text) then
        if v_data->>'model' is distinct from '2' then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약 연결 경비는 결제 통화·환율 형식으로 유지해야 합니다.');end if;
        v_data:=v_data||jsonb_build_object('bookingId',v_record.data->>'bookingId');
      end if;
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
    if v_kind='expense' and coalesce(v_record.data->>'bookingId','')<>'' then
      if v_action='delete' then
        update public.trip_records b set data=(b.data-'expenseId')||jsonb_build_object('isPaid',false),version=b.version+1,updated_at=now(),updated_by=v_uid
          where b.trip_id=v_trip.id and b.kind='booking' and not b.deleted and b.id::text=v_record.data->>'bookingId' and b.data->>'expenseId'=v_record_id::text;
      elsif v_data->>'model'='2' then
        update public.trip_records b set data=b.data||jsonb_build_object('moneyCurrency',v_data->>'paidCurrency','moneyAmount',case when v_data->>'paidCurrency'=v_data->>'tripCurrency' then v_data->'tripAmount' else v_data->'baseAmount' end,'isPaid',true),version=b.version+1,updated_at=now(),updated_by=v_uid
          where b.trip_id=v_trip.id and b.kind='booking' and not b.deleted and b.id::text=v_record.data->>'bookingId' and b.data->>'expenseId'=v_record_id::text;
      end if;
    end if;
    if v_kind='booking' and v_action='delete' then
      update public.trip_records e set data=e.data-'bookingId',version=e.version+1,updated_at=now(),updated_by=v_uid where e.trip_id=v_trip.id and e.kind='expense' and not e.deleted and e.data->>'bookingId'=v_record_id::text;
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
