alter table public.profiles add column search_language text not null default '' check (search_language in ('','ko','en','ja','zh','fr','de','es','it','th','vi','pt','ru','id','ar','tr'));
-- Reservation fields and payment links are owned by the same trip transaction.
create or replace function tripboogie_private.normalize_booking(p_data jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;kind text;a date;b date;t text;airport jsonb;amount jsonb:='null';currency text:='';role text;
begin
 kind:=tripboogie_private.text_field(p_data,'type',10);
 if kind not in ('hotel','flight','tour') then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약 종류를 선택하세요.');end if;
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
 result:=jsonb_build_object('type',kind,'title',tripboogie_private.text_field(p_data,'title',300),'startDate',a,'endDate',b,
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

create function tripboogie_private.save_booking_payment(p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare booking public.trip_records%rowtype;expense public.trip_records%rowtype;bid uuid;eid uuid;v_data jsonb;w jsonb;d jsonb;paid boolean;v uuid;request jsonb;paid_amount numeric;
begin
 if p_payload ? 'id' then bid:=tripboogie_private.uuid_field(p_payload,'id');select * into booking from public.trip_records r where r.id=bid and r.trip_id=p_trip.id and r.kind='booking' and not r.deleted;else bid:=gen_random_uuid();end if;
 v_data:=p_payload->'data';if v_data ? 'isPaid' and jsonb_typeof(v_data->'isPaid')<>'boolean' then perform tripboogie_private.fail(400,'INVALID_REQUEST','결제 완료 여부를 확인하세요.');end if;
 paid:=coalesce((v_data->>'isPaid')::boolean,(booking.data->>'isPaid')::boolean,false);
 if coalesce(booking.data->>'expenseId','')<>'' then select * into expense from public.trip_records r where r.trip_id=p_trip.id and r.kind='expense' and not r.deleted and r.id::text=booking.data->>'expenseId' and r.data->>'bookingId'=bid::text;end if;
 if p_payload ? 'place' then
   v:=gen_random_uuid();w:=tripboogie_private.dispatch('mutate',p_trip.id,jsonb_build_object('action','upsert','id',v,'kind','place','data',p_payload->'place'));v_data:=v_data||jsonb_build_object('placeId',v);
 end if;
 request:=jsonb_strip_nulls(jsonb_build_object('action','upsert','id',bid,'kind','booking','data',v_data,'version',p_payload->'version'));
 w:=tripboogie_private.dispatch('mutate',p_trip.id,request);
 if paid then
   if not (p_payload ? 'expense') then
     if expense.id is null then perform tripboogie_private.fail(400,'INVALID_REQUEST','결제 경비를 확인한 뒤 함께 저장하세요.');end if;
     d:=expense.data;
   else
     if jsonb_typeof(p_payload->'expense')<>'object' or jsonb_typeof(p_payload->'expense'->'data')<>'object' then perform tripboogie_private.fail(400,'INVALID_REQUEST','연결할 경비 정보가 필요합니다.');end if;
     d:=tripboogie_private.normalize_expense(p_payload->'expense'->'data');
   end if;
   paid_amount:=case when d->>'paidCurrency'=d->>'tripCurrency' then (d->>'tripAmount')::numeric else (d->>'baseAmount')::numeric end;
   if v_data->>'moneyCurrency' is distinct from d->>'paidCurrency' or coalesce(nullif(v_data->>'moneyAmount','')::numeric,0)<>paid_amount then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약의 결제 금액과 연결 경비를 함께 확인하세요.');end if;
   if p_payload ? 'expense' then
     eid:=coalesce(expense.id,gen_random_uuid());
     if expense.id is not null and (tripboogie_private.uuid_field(p_payload->'expense','id')<>expense.id or tripboogie_private.version_field(p_payload->'expense')<>expense.version) then perform tripboogie_private.fail(409,'CONFLICT','연결 경비가 변경되었습니다. 다시 열어 주세요.');end if;
     w:=tripboogie_private.dispatch('mutate',p_trip.id,jsonb_strip_nulls(jsonb_build_object('action','upsert','id',eid,'kind','expense','data',d,'version',case when expense.id is not null then to_jsonb(expense.version) else null end)));
     update public.trip_records set data=trip_records.data||jsonb_build_object('bookingId',bid) where id=eid;
   else eid:=expense.id;end if;
   update public.trip_records set data=trip_records.data||jsonb_build_object('expenseId',eid,'isPaid',true,'moneyCurrency',d->>'paidCurrency','moneyAmount',paid_amount::text),version=version+1,updated_by=auth.uid(),updated_at=now() where id=bid;
 else
   if expense.id is not null then
     if p_payload->'expense' is distinct from 'null'::jsonb or tripboogie_private.version_field(jsonb_build_object('version',p_payload->'expenseVersion'))<>expense.version then perform tripboogie_private.fail(409,'CONFLICT','결제 해제 시 연결 경비 삭제를 확인하세요.');end if;
     w:=tripboogie_private.dispatch('mutate',p_trip.id,jsonb_build_object('action','delete','kind','expense','id',expense.id,'version',expense.version));
   end if;
   update public.trip_records set data=(trip_records.data-'expenseId')||jsonb_build_object('isPaid',false,'moneyAmount',tripboogie_private.normalize_booking(v_data)->'moneyAmount','moneyCurrency',tripboogie_private.normalize_booking(v_data)->'moneyCurrency') where id=bid;
 end if;
 if (select coalesce(sum(octet_length(r.data::text)),0) from public.trip_records r where r.trip_id=p_trip.id and not r.deleted)>2097152 then perform tripboogie_private.fail(409,'CAPACITY','여행 데이터는 최대 2 MiB까지 저장할 수 있습니다.');end if;
 return tripboogie_private.workspace(p_trip.id);
end;
$$;
revoke all on function tripboogie_private.save_booking_payment(public.trips,jsonb) from public,anon,authenticated;

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
      update public.profiles set name=tripboogie_private.text_field(p_payload,'name',200),
        base_currency=tripboogie_private.currency_field(jsonb_build_object('currency',p_payload->'baseCurrency')),
        search_language=case when p_payload ? 'searchLanguage' then tripboogie_private.text_field(p_payload,'searchLanguage',2,false) else search_language end,
        holiday_country=case when p_payload ? 'holidayCountry' then tripboogie_private.text_field(p_payload,'holidayCountry',2,false) else holiday_country end,version=version+1
        where id=v_uid and version=tripboogie_private.version_field(p_payload);
      if not found then perform tripboogie_private.fail(409,'CONFLICT','프로필이 변경되었습니다. 다시 열어 주세요.');end if;
    end if;
    return (select jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'baseCurrency',p.base_currency,'searchLanguage',p.search_language,'holidayCountry',coalesce(nullif(p.holiday_country,''),'{"KRW":"KR","JPY":"JP","USD":"US","GBP":"GB","CNY":"CN","TWD":"TW","THB":"TH","VND":"VN","SGD":"SG","HKD":"HK","AUD":"AU","CAD":"CA","CHF":"CH","NZD":"NZ","IDR":"ID","MYR":"MY","PHP":"PH"}'::jsonb->>p.base_currency,''),'version',p.version) from public.profiles p where p.id=v_uid);
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
  for row in select value from jsonb_array_elements(p_payload->'records') where value->>'kind'='booking' loop
    if coalesce(row->'data'->>'expenseId','')<>'' and ids ? (row->'data'->>'expenseId') and exists(select 1 from jsonb_array_elements(p_payload->'records') e where e->>'id'=row->'data'->>'expenseId' and e->>'kind'='expense' and e->'data'->>'bookingId'=row->>'id') then
      update public.trip_records set data=trip_records.data||jsonb_build_object('bookingId',ids->>(row->>'id')) where id=(ids->>(row->'data'->>'expenseId'))::uuid;
      update public.trip_records set data=trip_records.data||jsonb_build_object('expenseId',ids->>(row->'data'->>'expenseId'),'isPaid',true,'moneyCurrency',e.data->>'paidCurrency','moneyAmount',case when e.data->>'paidCurrency'=e.data->>'tripCurrency' then e.data->'tripAmount' else e.data->'baseAmount' end) from public.trip_records e where trip_records.id=(ids->>(row->>'id'))::uuid and e.id=(ids->>(row->'data'->>'expenseId'))::uuid;
    end if;
  end loop;
  if (select coalesce(sum(octet_length(r.data::text)),0) from public.trip_records r where r.trip_id=new_trip_id and not r.deleted)>2097152 then perform tripboogie_private.fail(413,'TOO_LARGE','여행 데이터는 최대 2 MiB입니다.');end if;
  return tripboogie_private.workspace(new_trip_id);
end;
$$;

alter function tripboogie_private.normalize_item(text,jsonb) stable;
