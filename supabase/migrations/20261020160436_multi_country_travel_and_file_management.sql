-- Extend the existing trip lock, membership and version checks. No public function grants.
create function tripboogie_private.destination_settings(p_cities jsonb,p_countries jsonb,p_currency text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare countries jsonb:='[]'; currencies jsonb:='[]'; item jsonb; code text; currency text;
 -- Current tender mapping pinned to Unicode CLDR 48 supplemental/currencyData.json.
 mapping constant jsonb:='{"AC": ["SHP"], "AD": ["EUR"], "AE": ["AED"], "AF": ["AFN"], "AG": ["XCD"], "AI": ["XCD"], "AL": ["ALL"], "AM": ["AMD"], "AO": ["AOA"], "AR": ["ARS"], "AS": ["USD"], "AT": ["EUR"], "AU": ["AUD"], "AW": ["AWG"], "AX": ["EUR"], "AZ": ["AZN"], "BA": ["BAM"], "BB": ["BBD"], "BD": ["BDT"], "BE": ["EUR"], "BF": ["XOF"], "BG": ["EUR"], "BH": ["BHD"], "BI": ["BIF"], "BJ": ["XOF"], "BL": ["EUR"], "BM": ["BMD"], "BN": ["BND"], "BO": ["BOB"], "BQ": ["USD"], "BR": ["BRL"], "BS": ["BSD"], "BT": ["BTN", "INR"], "BV": ["NOK"], "BW": ["BWP"], "BY": ["BYN"], "BZ": ["BZD"], "CA": ["CAD"], "CC": ["AUD"], "CD": ["CDF"], "CF": ["XAF"], "CG": ["XAF"], "CH": ["CHF"], "CI": ["XOF"], "CK": ["NZD"], "CL": ["CLP"], "CM": ["XAF"], "CN": ["CNY"], "CO": ["COP"], "CR": ["CRC"], "CU": ["CUP"], "CV": ["CVE"], "CW": ["XCG"], "CX": ["AUD"], "CY": ["EUR"], "CZ": ["CZK"], "DE": ["EUR"], "DG": ["USD"], "DJ": ["DJF"], "DK": ["DKK"], "DM": ["XCD"], "DO": ["DOP"], "DZ": ["DZD"], "EA": ["EUR"], "EC": ["USD"], "EE": ["EUR"], "EG": ["EGP"], "EH": ["MAD"], "ER": ["ERN"], "ES": ["EUR"], "ET": ["ETB"], "EU": ["EUR"], "FI": ["EUR"], "FJ": ["FJD"], "FK": ["FKP"], "FM": ["USD"], "FO": ["DKK"], "FR": ["EUR"], "GA": ["XAF"], "GB": ["GBP"], "GD": ["XCD"], "GE": ["GEL"], "GF": ["EUR"], "GG": ["GBP"], "GH": ["GHS"], "GI": ["GIP"], "GL": ["DKK"], "GM": ["GMD"], "GN": ["GNF"], "GP": ["EUR"], "GQ": ["XAF"], "GR": ["EUR"], "GS": ["GBP"], "GT": ["GTQ"], "GU": ["USD"], "GW": ["XOF"], "GY": ["GYD"], "HK": ["HKD"], "HM": ["AUD"], "HN": ["HNL"], "HR": ["EUR"], "HT": ["HTG", "USD"], "HU": ["HUF"], "IC": ["EUR"], "ID": ["IDR"], "IE": ["EUR"], "IL": ["ILS"], "IM": ["GBP"], "IN": ["INR"], "IO": ["USD"], "IQ": ["IQD"], "IR": ["IRR"], "IS": ["ISK"], "IT": ["EUR"], "JE": ["GBP"], "JM": ["JMD"], "JO": ["JOD"], "JP": ["JPY"], "KE": ["KES"], "KG": ["KGS"], "KH": ["KHR"], "KI": ["AUD"], "KM": ["KMF"], "KN": ["XCD"], "KP": ["KPW"], "KR": ["KRW"], "KW": ["KWD"], "KY": ["KYD"], "KZ": ["KZT"], "LA": ["LAK"], "LB": ["LBP"], "LC": ["XCD"], "LI": ["CHF"], "LK": ["LKR"], "LR": ["LRD"], "LS": ["ZAR", "LSL"], "LT": ["EUR"], "LU": ["EUR"], "LV": ["EUR"], "LY": ["LYD"], "MA": ["MAD"], "MC": ["EUR"], "MD": ["MDL"], "ME": ["EUR"], "MF": ["EUR"], "MG": ["MGA"], "MH": ["USD"], "MK": ["MKD"], "ML": ["XOF"], "MM": ["MMK"], "MN": ["MNT"], "MO": ["MOP"], "MP": ["USD"], "MQ": ["EUR"], "MR": ["MRU"], "MS": ["XCD"], "MT": ["EUR"], "MU": ["MUR"], "MV": ["MVR"], "MW": ["MWK"], "MX": ["MXN"], "MY": ["MYR"], "MZ": ["MZN"], "NA": ["NAD", "ZAR"], "NC": ["XPF"], "NE": ["XOF"], "NF": ["AUD"], "NG": ["NGN"], "NI": ["NIO"], "NL": ["EUR"], "NO": ["NOK"], "NP": ["NPR"], "NR": ["AUD"], "NU": ["NZD"], "NZ": ["NZD"], "OM": ["OMR"], "PA": ["PAB", "USD"], "PE": ["PEN"], "PF": ["XPF"], "PG": ["PGK"], "PH": ["PHP"], "PK": ["PKR"], "PL": ["PLN"], "PM": ["EUR"], "PN": ["NZD"], "PR": ["USD"], "PS": ["ILS", "JOD"], "PT": ["EUR"], "PW": ["USD"], "PY": ["PYG"], "QA": ["QAR"], "RE": ["EUR"], "RO": ["RON"], "RS": ["RSD"], "RU": ["RUB"], "RW": ["RWF"], "SA": ["SAR"], "SB": ["SBD"], "SC": ["SCR"], "SD": ["SDG"], "SE": ["SEK"], "SG": ["SGD"], "SH": ["SHP"], "SI": ["EUR"], "SJ": ["NOK"], "SK": ["EUR"], "SL": ["SLE"], "SM": ["EUR"], "SN": ["XOF"], "SO": ["SOS"], "SR": ["SRD"], "SS": ["SSP"], "ST": ["STN"], "SV": ["USD"], "SX": ["XCG"], "SY": ["SYP"], "SZ": ["SZL"], "TA": ["GBP"], "TC": ["USD"], "TD": ["XAF"], "TF": ["EUR"], "TG": ["XOF"], "TH": ["THB"], "TJ": ["TJS"], "TK": ["NZD"], "TL": ["USD"], "TM": ["TMT"], "TN": ["TND"], "TO": ["TOP"], "TR": ["TRY"], "TT": ["TTD"], "TV": ["AUD"], "TW": ["TWD"], "TZ": ["TZS"], "UA": ["UAH"], "UG": ["UGX"], "UM": ["USD"], "US": ["USD"], "UY": ["UYU"], "UZ": ["UZS"], "VA": ["EUR"], "VC": ["XCD"], "VE": ["VES"], "VG": ["USD"], "VI": ["USD"], "VN": ["VND"], "VU": ["VUV"], "WF": ["XPF"], "WS": ["WST"], "XK": ["EUR"], "YE": ["YER"], "YT": ["EUR"], "ZA": ["ZAR"], "ZM": ["ZMW"], "ZW": ["ZWG", "USD"]}'::jsonb;
begin
 if jsonb_typeof(p_countries) is distinct from 'array' or jsonb_array_length(p_countries)>50 then perform tripboogie_private.fail(400,'INVALID_REQUEST','방문 국가는 최대 50개까지 선택하세요.');end if;
 for item in select value from jsonb_array_elements(p_countries||coalesce((select jsonb_agg(c->'countryCode') from jsonb_array_elements(coalesce(p_cities,'[]')) c),'[]')) loop
   if jsonb_typeof(item)<>'string' then perform tripboogie_private.fail(400,'INVALID_REQUEST','국가를 확인하세요.');end if;
   code:=item#>>'{}';if code not in ('AC','AD','AE','AF','AG','AI','AL','AM','AO','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DG','DJ','DK','DM','DO','DZ','EA','EC','EE','EG','EH','ER','ES','ET','EU','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','IC','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TA','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','XK','YE','YT','ZA','ZM','ZW') then perform tripboogie_private.fail(400,'INVALID_REQUEST','국가를 확인하세요.');end if;
   if not countries @> jsonb_build_array(code) then if jsonb_array_length(countries)>=50 then perform tripboogie_private.fail(400,'INVALID_REQUEST','방문 국가는 최대 50개까지 선택하세요.');end if;countries:=countries||jsonb_build_array(code);end if;
 end loop;
 for currency in select coalesce(nullif(c->>'currency',''),mapping->(c->>'countryCode')->>0) from jsonb_array_elements(coalesce(p_cities,'[]')) c
   union all select m.value from jsonb_array_elements(countries) c cross join lateral jsonb_array_elements_text(mapping->(c#>>'{}')) m(value) loop
   if currency is not null and not currencies @> jsonb_build_array(currency) then currencies:=currencies||jsonb_build_array(currency);end if;
 end loop;
 if currencies='[]' then currencies:=jsonb_build_array(p_currency);end if;
 return jsonb_build_object('countries',countries,'currencies',currencies);
end;$$;
revoke all on function tripboogie_private.destination_settings(jsonb,jsonb,text) from public,anon,authenticated;

alter function tripboogie_private.normalize_cities(jsonb,date,date) rename to normalize_cities_without_transit;
create function tripboogie_private.normalize_cities(p_cities jsonb,p_start date,p_end date)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:=tripboogie_private.normalize_cities_without_transit(p_cities,p_start,p_end); city jsonb; normalized jsonb; output jsonb:='[]';
begin
 for normalized in select value from jsonb_array_elements(result) loop
  select value into city from jsonb_array_elements(p_cities) where value->>'id'=normalized->>'id';
  if city ? 'transit' and jsonb_typeof(city->'transit')<>'boolean' then perform tripboogie_private.fail(400,'INVALID_REQUEST','환승 여부를 확인하세요.');end if;
  output:=output||jsonb_build_array(normalized||jsonb_build_object('transit',coalesce((city->>'transit')::boolean,false)));
 end loop;return output;
end;$$;
revoke all on function tripboogie_private.normalize_cities(jsonb,date,date),tripboogie_private.normalize_cities_without_transit(jsonb,date,date) from public,anon,authenticated;

alter function tripboogie_private.file_operation(text,public.trips,jsonb) rename to file_operation_single;
create function tripboogie_private.file_operation(p_op text,p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; v_ids uuid[]:='{}'; v_id uuid; f public.trip_files%rowtype; v_tags text[];
begin
 if p_op not in ('set-files-tags','mark-files-delete','finish-files-delete') then return tripboogie_private.file_operation_single(p_op,p_trip,p_payload);end if;
 if jsonb_typeof(p_payload->'files') is distinct from 'array' or jsonb_array_length(p_payload->'files') not between 1 and 200 then perform tripboogie_private.fail(400,'INVALID_REQUEST','파일을 1~200개 선택하세요.');end if;
 if p_op='set-files-tags' then v_tags:=tripboogie_private.normalize_file_tags(p_payload->'tags',p_trip.settings);end if;
 for item in select value from jsonb_array_elements(p_payload->'files') loop
  v_id:=tripboogie_private.uuid_field(item,'id');if v_id=any(v_ids) then perform tripboogie_private.fail(400,'INVALID_REQUEST','파일이 중복되었습니다.');end if;v_ids:=array_append(v_ids,v_id);
  select * into f from public.trip_files r where r.id=v_id and r.trip_id=p_trip.id for update;
  if not found then perform tripboogie_private.fail(404,'NOT_FOUND','파일을 찾을 수 없습니다.');end if;
  if f.version<>tripboogie_private.version_field(item) then perform tripboogie_private.fail(409,'CONFLICT','파일이 변경되었습니다. 다시 선택하세요.');end if;
  if p_op='set-files-tags' and f.status='deleting' then perform tripboogie_private.fail(409,'CONFLICT','삭제 중인 파일의 태그는 변경할 수 없습니다.');end if;
  if p_op='finish-files-delete' and (f.status<>'deleting' or exists(select 1 from storage.objects o where o.bucket_id='tripboogie-private' and o.name=f.path)) then perform tripboogie_private.fail(409,'CONFLICT','파일 삭제가 끝나지 않았습니다. 다시 시도하세요.');end if;
 end loop;
 if p_op='set-files-tags' then update public.trip_files r set tags=v_tags,version=r.version+1 where r.id=any(v_ids) and r.tags is distinct from v_tags;
 elsif p_op='mark-files-delete' then update public.trip_files r set status='deleting' where r.id=any(v_ids);
 else delete from public.trip_files r where r.id=any(v_ids);end if;
 update public.trips set revision=revision+1,updated_at=now() where trips.id=p_trip.id;
 return jsonb_build_object('file','null'::jsonb,'workspace',tripboogie_private.workspace(p_trip.id));
end;$$;
revoke all on function tripboogie_private.file_operation(text,public.trips,jsonb),tripboogie_private.file_operation_single(text,public.trips,jsonb) from public,anon,authenticated;

create or replace function tripboogie_private.file_tags(p_settings jsonb)
returns jsonb language sql immutable set search_path='' as $$
 with defaults as (select jsonb_agg(jsonb_build_object('id',c->>'id','label',c->>'label')) as items from jsonb_array_elements(tripboogie_private.booking_categories(p_settings)) c),
 base as (select coalesce(p_settings->'fileTags',defaults.items,'[]') as items from defaults)
 select base.items||coalesce((select jsonb_agg(c) from defaults,jsonb_array_elements(defaults.items) c where c->>'id' in ('hotel','flight','tour') and not exists(select 1 from jsonb_array_elements(base.items) b where b->>'id'=c->>'id')),'[]') from base;
$$;
create function tripboogie_private.checked_file_tags(p_value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:=tripboogie_private.normalize_categories(p_value); id text;
begin
 foreach id in array array['hotel','flight','tour'] loop
  if not exists(select 1 from jsonb_array_elements(result) c where c->>'id'=id) then perform tripboogie_private.fail(400,'INVALID_REQUEST','숙소·항공·투어티켓 기본 자료 태그는 삭제할 수 없습니다.');end if;
 end loop;return result;
end;$$;
revoke all on function tripboogie_private.file_tags(jsonb),tripboogie_private.checked_file_tags(jsonb) from public,anon,authenticated;

alter function tripboogie_private.normalize_booking(jsonb) rename to normalize_booking_without_flight_extras;
create function tripboogie_private.normalize_booking(p_data jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:=tripboogie_private.normalize_booking_without_flight_extras(p_data); item jsonb; extras jsonb:='[]'; n numeric; kg numeric; extra_id uuid; ids uuid[]:='{}';
begin
 if result->>'type'='flight' then
  if jsonb_typeof(coalesce(p_data->'flightExtras','[]')) is distinct from 'array' or jsonb_array_length(coalesce(p_data->'flightExtras','[]'))>50 then perform tripboogie_private.fail(400,'INVALID_REQUEST','좌석·수하물 정보는 최대 50개까지 입력하세요.');end if;
  for item in select value from jsonb_array_elements(coalesce(p_data->'flightExtras','[]')) loop
   extra_id:=tripboogie_private.uuid_field(item,'id');if extra_id=any(ids) then perform tripboogie_private.fail(400,'INVALID_REQUEST','좌석·수하물 정보가 중복되었습니다.');end if;ids:=array_append(ids,extra_id);
   n:=null;kg:=null;
   if coalesce(item->>'baggageCount','')<>'' then if item->>'baggageCount' !~ '^\d{1,2}$' or (item->>'baggageCount')::numeric>20 then perform tripboogie_private.fail(400,'INVALID_REQUEST','수하물 개수는 0~20개로 입력하세요.');end if;n:=(item->>'baggageCount')::numeric;end if;
   if coalesce(item->>'baggageKg','')<>'' then kg:=(tripboogie_private.decimal_field(item,'baggageKg')#>>'{}')::numeric;if kg>200 then perform tripboogie_private.fail(400,'INVALID_REQUEST','수하물 무게는 200kg 이하로 입력하세요.');end if;end if;
   extras:=extras||jsonb_build_array(jsonb_build_object('id',extra_id,'seat',tripboogie_private.text_field(item,'seat',30,false),'baggageCount',n,'baggageKg',kg));
  end loop;result:=result||jsonb_build_object('flightExtras',extras);
 end if;return result;
end;$$;
revoke all on function tripboogie_private.normalize_booking(jsonb),tripboogie_private.normalize_booking_without_flight_extras(jsonb) from public,anon,authenticated;

alter function tripboogie_private.normalize_expense(jsonb) rename to normalize_expense_without_country;
create function tripboogie_private.normalize_expense(p_data jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:=tripboogie_private.normalize_expense_without_country(p_data); code text:=coalesce(p_data->>'countryCode','');
begin
 if code<>'' then perform tripboogie_private.destination_settings('[]',jsonb_build_array(code),result->>'baseCurrency');end if;
 return result||jsonb_build_object('countryCode',code);
end;$$;
revoke all on function tripboogie_private.normalize_expense(jsonb),tripboogie_private.normalize_expense_without_country(jsonb) from public,anon,authenticated;

alter function tripboogie_private.normalize_item(text,jsonb) rename to normalize_item_without_city_metadata;
create function tripboogie_private.normalize_item(p_kind text,p_data jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:=tripboogie_private.normalize_item_without_city_metadata(p_kind,p_data); code text; zone text;
begin
 if p_kind='place' then
  if p_data ? 'cityName' then result:=result||jsonb_build_object('cityName',tripboogie_private.text_field(p_data,'cityName',300,false));end if;
  if coalesce(p_data->>'countryCode','')<>'' then code:=p_data->>'countryCode';perform tripboogie_private.destination_settings('[]',jsonb_build_array(code),'KRW');result:=result||jsonb_build_object('countryCode',code);end if;
  if coalesce(p_data->>'timezone','')<>'' then zone:=p_data->>'timezone';if not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=zone) then perform tripboogie_private.fail(400,'INVALID_REQUEST','시간대를 확인하세요.');end if;result:=result||jsonb_build_object('timezone',zone);end if;
  if coalesce(p_data->>'currency','')<>'' then result:=result||jsonb_build_object('currency',tripboogie_private.currency_field(p_data));end if;
 end if;return result;
end;$$;
revoke all on function tripboogie_private.normalize_item(text,jsonb),tripboogie_private.normalize_item_without_city_metadata(text,jsonb) from public,anon,authenticated;

-- Adapt only unique canonical producer boundaries; unexpected upstream changes fail closed.
do $migration$
declare source text; needle text; replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
 needle:='(''prepare-file'',''finish-file'',''mark-file-delete'',''finish-file-delete'',''set-file-tags'')';
 replacement:='(''prepare-file'',''finish-file'',''mark-file-delete'',''finish-file-delete'',''set-file-tags'',''set-files-tags'',''mark-files-delete'',''finish-files-delete'')';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected batch file authorization boundary';end if;source:=replace(source,needle,replacement);
 needle:='tripboogie_private.normalize_categories(p_payload->''fileTags'')';replacement:='tripboogie_private.checked_file_tags(p_payload->''fileTags'')';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected file tag guard boundary';end if;source:=replace(source,needle,replacement);
 needle:='    insert into public.trip_members(trip_id,user_id,role) values(v_next_id,v_uid,''owner'');';
 replacement:=$new$    update public.trips set settings=settings||tripboogie_private.destination_settings(settings->'cities',coalesce(p_payload->'data'->'countries','[]'),currency)||jsonb_build_object('fileTags',tripboogie_private.file_tags(settings)) where id=v_next_id;
$new$||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected destination create boundary';end if;source:=replace(source,needle,replacement);
 needle:='    update public.trips set settings=v_data,revision=revision+1,updated_at=now() where id=v_trip.id;';
 replacement:=$new$    v_data:=v_data||tripboogie_private.destination_settings(v_data->'cities',coalesce(p_payload->'countries',v_data->'countries','[]'),v_trip.currency);
$new$||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected destination settings boundary';end if;source:=replace(source,needle,replacement);
 needle:='settings=jsonb_set(settings,''{cities}'',v_result),title=';
 replacement:='settings=jsonb_set(settings,''{cities}'',v_result)||tripboogie_private.destination_settings(v_result,coalesce(p_payload->''data''->''countries'',settings->''countries'',''[]''),v_data->>''currency''),title=';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected destination edit boundary';end if;source:=replace(source,needle,replacement);
 execute source;
 source:=pg_get_functiondef('tripboogie_private.import_trip(jsonb)'::regprocedure);
 needle:='return tripboogie_private.workspace(new_trip_id);';
 replacement:=$new$update public.trips set settings=settings||tripboogie_private.destination_settings(settings->'cities',coalesce(p_payload->'trip'->'settings'->'countries','[]'),currency)||jsonb_build_object('fileTags',tripboogie_private.file_tags(settings)) where id=new_trip_id;
 return tripboogie_private.workspace(new_trip_id);$new$;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected destination import boundary';end if;execute replace(source,needle,replacement);
end;$migration$;

-- New derived keys do not rewrite amounts or historical exchange counterparts.
update public.trips set settings=settings||tripboogie_private.destination_settings(settings->'cities',coalesce(settings->'countries','[]'),currency);
update public.trips set settings=jsonb_set(settings,'{fileTags}',tripboogie_private.file_tags(settings));
