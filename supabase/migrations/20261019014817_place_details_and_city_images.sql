-- Add optional public media to the existing authoritative JSON normalizers.
-- Existing rows are untouched. Media remains subject to member permissions/CAS.
create function tripboogie_private.normalize_image(p_image jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare u text;s text;l text;
begin
 if p_image is null or p_image='null'::jsonb then return 'null'::jsonb;end if;
 if jsonb_typeof(p_image) is distinct from 'object' then perform tripboogie_private.fail(400,'INVALID_REQUEST','사진 정보를 확인하세요.');end if;
 u:=tripboogie_private.text_field(p_image,'url',2048);
 s:=tripboogie_private.text_field(p_image,'sourceUrl',2048);
 l:=tripboogie_private.text_field(p_image,'licenseUrl',2048);
 if u !~ '^https://(upload|thumb)[.]wikimedia[.]org/wikipedia/commons/[^[:space:]]+$'
 or s !~ '^https://commons[.]wikimedia[.]org/wiki/File:[^[:space:]]+$'
 or l !~ '^https://(creativecommons[.]org|commons[.]wikimedia[.]org|www[.]gnu[.]org)/[^[:space:]]*$' then
   perform tripboogie_private.fail(400,'INVALID_REQUEST','공개 사진의 URL·출처·이용 조건을 확인하세요.');end if;
 return jsonb_build_object('url',u,'sourceUrl',s,'licenseUrl',l,
 'title',tripboogie_private.text_field(p_image,'title',2048,false),
 'author',tripboogie_private.text_field(p_image,'author',2048,false),
 'license',tripboogie_private.text_field(p_image,'license',2048));
end;$$;
create function tripboogie_private.normalize_place_details(p_details jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare source text;checked text;
begin
 if jsonb_typeof(p_details) is distinct from 'object' then perform tripboogie_private.fail(400,'INVALID_REQUEST','장소 상세정보를 확인하세요.');end if;
 source:=tripboogie_private.text_field(p_details,'sourceUrl',2048,false);
 checked:=tripboogie_private.text_field(p_details,'checkedAt',64,false);
 if source<>'' and source !~ '^https://www[.]openstreetmap[.]org/(node|way|relation)/[0-9]+$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','장소 정보 출처를 확인하세요.');end if;
 if checked<>'' and checked !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' then perform tripboogie_private.fail(400,'INVALID_REQUEST','장소 정보 확인 시각을 확인하세요.');end if;
 -- Store only selected media, not a duplicate gallery on every itinerary stop.
 return jsonb_build_object('openingHours',tripboogie_private.text_field(p_details,'openingHours',1000,false),'sourceUrl',source,'checkedAt',checked,'photos','[]'::jsonb);
end;$$;
revoke all on function tripboogie_private.normalize_image(jsonb),tripboogie_private.normalize_place_details(jsonb) from public,anon,authenticated;

create or replace function tripboogie_private.normalize_item(p_kind text,p_data jsonb)
returns jsonb language plpgsql stable set search_path=''
as $$
declare v_result jsonb; v_type text; v_mode text; v_minutes text;
begin
 if p_kind='booking' then return tripboogie_private.normalize_booking(p_data);end if;
 if p_kind='expense' and p_data->>'model'='2' then return tripboogie_private.normalize_expense(p_data);end if;
 v_result:=tripboogie_private.normalize_item_legacy(p_kind,p_data);
 if p_kind='place' then
   if p_data ? 'providerId' then
     v_type:=tripboogie_private.text_field(p_data,'providerId',2048);
     if (length(v_type)<10 or v_type !~ '^[a-f0-9]+$') then perform tripboogie_private.fail(400,'INVALID_REQUEST','장소 식별자를 확인하세요.');end if;
     v_result:=v_result||jsonb_build_object('providerId',v_type);
   end if;
   if p_data ? 'image' then v_result:=v_result||jsonb_build_object('image',tripboogie_private.normalize_image(p_data->'image'));end if;
   if p_data ? 'details' then v_result:=v_result||jsonb_build_object('details',tripboogie_private.normalize_place_details(p_data->'details'));end if;
 elsif p_kind='plan' then
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
