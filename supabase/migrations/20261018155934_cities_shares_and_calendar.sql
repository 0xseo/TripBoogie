-- Keep city periods and expense allocations in the same authoritative transaction.
alter table public.profiles add column holiday_country text not null default '';
alter table public.profiles add constraint profiles_holiday_country_check check(holiday_country='' or holiday_country in ('AC','AD','AE','AF','AG','AI','AL','AM','AO','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DG','DJ','DK','DM','DO','DZ','EA','EC','EE','EG','EH','ER','ES','ET','EU','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','IC','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TA','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','XK','YE','YT','ZA','ZM','ZW'));
create function tripboogie_private.normalize_cities(p_cities jsonb,p_start date,p_end date)
returns jsonb language plpgsql stable set search_path='' as $$
declare city jsonb; result jsonb:='[]'; city_id uuid; ids uuid[]:='{}'; a date;b date;cc text;tz text;place jsonb;
begin
 if jsonb_typeof(p_cities) is distinct from 'array' or jsonb_array_length(p_cities)>20 then
   perform tripboogie_private.fail(400,'INVALID_REQUEST','여행 도시는 최대 20개까지 선택할 수 있습니다.');end if;
 for city in select value from jsonb_array_elements(p_cities) loop
   city_id:=tripboogie_private.uuid_field(city,'id');
   if city_id=any(ids) then perform tripboogie_private.fail(400,'INVALID_REQUEST','도시 ID가 중복되었습니다.');end if;ids:=array_append(ids,city_id);
   place:=tripboogie_private.normalize_item('place',city);
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
revoke all on function tripboogie_private.normalize_cities(jsonb,date,date) from public,anon,authenticated;

create or replace function tripboogie_private.normalize_expense(p_data jsonb)
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
 ids:='{}';total:=0;
 for person in select value from jsonb_array_elements(p_data->'participants') loop
   id:=tripboogie_private.uuid_field(person,'userId')::text;person_name:=tripboogie_private.text_field(person,'name',200);
   if id=any(ids) then perform tripboogie_private.fail(400,'INVALID_REQUEST','분담자가 중복되었습니다.'); end if;
   ids:=array_append(ids,id);
   if exists(select 1 from jsonb_array_elements(p_data->'participants') x where x ? 'amount') then
     amount:=tripboogie_private.decimal_field(person,'amount'); total:=total+(amount#>>'{}')::numeric;
     people:=people||jsonb_build_array(jsonb_build_object('userId',id,'name',person_name,'amount',amount));
   else people:=people||jsonb_build_array(jsonb_build_object('userId',id,'name',person_name));end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_data->'participants') x where x ? 'amount') and total<>paid then
   perform tripboogie_private.fail(400,'INVALID_REQUEST','분담 금액의 합계가 결제 금액과 같아야 합니다.');end if;
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
        base_currency=tripboogie_private.currency_field(jsonb_build_object('currency',p_payload->'baseCurrency')),
        holiday_country=case when p_payload ? 'holidayCountry' then tripboogie_private.text_field(p_payload,'holidayCountry',2,false) else holiday_country end,version=version+1
        where id=v_uid and version=tripboogie_private.version_field(p_payload);
      if not found then perform tripboogie_private.fail(409,'CONFLICT','프로필이 변경되었습니다. 다시 열어 주세요.');end if;
    end if;
    return (select jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'baseCurrency',p.base_currency,'holidayCountry',coalesce(nullif(p.holiday_country,''),'{"KRW":"KR","JPY":"JP","USD":"US","GBP":"GB","CNY":"CN","TWD":"TW","THB":"TH","VND":"VN","SGD":"SG","HKD":"HK","AUD":"AU","CAD":"CA","CHF":"CH","NZD":"NZ","IDR":"ID","MYR":"MY","PHP":"PH"}'::jsonb->>p.base_currency,''),'version',p.version) from public.profiles p where p.id=v_uid);
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
