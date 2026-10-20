-- Store route estimates separately from ordinary plan edits, so delayed routing
-- responses cannot overwrite a newer title, memo, place or manual travel time.
create function tripboogie_private.save_travel_time(p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare plan public.trip_records%rowtype; source public.trip_records%rowtype; origin public.trip_records%rowtype; destination public.trip_records%rowtype; mode text; key text; minutes integer; expected jsonb; candidate jsonb;
begin
 select * into plan from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and r.id=tripboogie_private.uuid_field(p_payload,'id') for update;
 if plan.id is null then return tripboogie_private.workspace(p_trip.id);end if;
 if plan.version<>tripboogie_private.version_field(p_payload) then return tripboogie_private.workspace(p_trip.id);end if;
 select * into source from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and r.id=tripboogie_private.uuid_field(p_payload,'fromId') and r.data->>'date'=plan.data->>'date' and r.id<>plan.id;
 select * into origin from public.trip_records r where r.trip_id=p_trip.id and r.kind='place' and not r.deleted and r.id::text=source.data->>'placeId';
 select * into destination from public.trip_records r where r.trip_id=p_trip.id and r.kind='place' and not r.deleted and r.id::text=plan.data->>'placeId';
 mode:=tripboogie_private.text_field(p_payload,'mode',20);key:=tripboogie_private.text_field(p_payload,'key',400);
 if source.id is null or plan.data->>'entryType'='memo' or source.data->>'entryType'='memo' or mode not in ('walk','drive','bicycle') or coalesce(plan.data->>'transportMode','walk')<>mode or origin.data->>'lat' is null or origin.data->>'lng' is null or destination.data->>'lat' is null or destination.data->>'lng' is null then return tripboogie_private.workspace(p_trip.id);end if;
 expected:=jsonb_build_array(mode,source.id,plan.id,origin.data->'lat',origin.data->'lng',destination.data->'lat',destination.data->'lng');
 begin if key::jsonb is distinct from expected then return tripboogie_private.workspace(p_trip.id);end if;
 exception when invalid_text_representation then perform tripboogie_private.fail(400,'INVALID_REQUEST','이동 구간을 확인하세요.');end;
 if plan.data ? 'travelMinutes' and plan.data->>'travelFromId'=source.id::text and coalesce(plan.data->>'travelTimeSource','manual')<>'estimate' then return tripboogie_private.workspace(p_trip.id);end if;
 candidate:=tripboogie_private.normalize_item('plan',plan.data||jsonb_build_object('travelMinutes',p_payload->'minutes','travelFromId',source.id,'travelTimeSource','estimate','travelEstimateKey',key));
 if not candidate ? 'travelMinutes' then perform tripboogie_private.fail(400,'INVALID_REQUEST','이동 시간을 확인하세요.');end if;
 minutes:=(candidate->>'travelMinutes')::integer;
 candidate:=plan.data||jsonb_build_object('travelMinutes',minutes,'travelFromId',source.id,'travelTimeSource','estimate','travelEstimateKey',key);
 if candidate is distinct from plan.data then
   if (select coalesce(sum(octet_length(r.data::text)),0) from public.trip_records r where r.trip_id=p_trip.id and not r.deleted)-octet_length(plan.data::text)+octet_length(candidate::text)>2097152 then perform tripboogie_private.fail(409,'CAPACITY','여행 데이터는 최대 2 MiB까지 저장할 수 있습니다.');end if;
   update public.trip_records set data=candidate,version=version+1,updated_at=now(),updated_by=auth.uid() where id=plan.id;
   update public.trips set revision=revision+1,updated_at=now() where id=p_trip.id;
 end if;
 return tripboogie_private.workspace(p_trip.id);
end;$$;
revoke all on function tripboogie_private.save_travel_time(public.trips,jsonb) from public,anon,authenticated;

do $migration$
declare source text; needle text; replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.normalize_item(text,jsonb)'::regprocedure);
 needle:='   if coalesce(p_data->>''travelFromId'','''')<>'''' then v_result:=v_result||jsonb_build_object(''travelFromId'',tripboogie_private.uuid_field(p_data,''travelFromId''));end if;';
 replacement:=needle||$patch$
   if coalesce(p_data->>'travelTimeSource','')<>'' then
     if p_data->>'travelTimeSource' not in ('manual','estimate') then perform tripboogie_private.fail(400,'INVALID_REQUEST','이동 시간 유형을 확인하세요.');end if;
     if v_result ? 'travelMinutes' and v_result ? 'travelFromId' then
       v_result:=v_result||jsonb_build_object('travelTimeSource',p_data->>'travelTimeSource');
       if p_data->>'travelTimeSource'='estimate' then v_result:=v_result||jsonb_build_object('travelEstimateKey',tripboogie_private.text_field(p_data,'travelEstimateKey',400));end if;
     end if;
   end if;
$patch$;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected travel normalizer boundary';end if;
 execute replace(source,needle,replacement);
 source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
 needle:='  if p_operation=''schedule'' then';
 replacement:=$patch$
  if p_operation='save-travel-time' then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','열람 권한으로는 수정할 수 없습니다.');end if;
    return tripboogie_private.save_travel_time(v_trip,p_payload);
  end if;
$patch$||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected travel authorization boundary';end if;
 execute replace(source,needle,replacement);
 -- Reservation synchronization must preserve a schedule's saved transport data.
 source:=pg_get_functiondef('tripboogie_private.sync_booking_event(public.trips,public.trip_records,text,text,text,text,text,text)'::regprocedure);
 needle:='tripboogie_private.normalize_item(''plan'',jsonb_build_object(';
 replacement:='tripboogie_private.normalize_item(''plan'',coalesce(plan.data,''{}''::jsonb)||jsonb_build_object(';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected route preservation boundary';end if;
 execute replace(source,needle,replacement);
end;$migration$;
