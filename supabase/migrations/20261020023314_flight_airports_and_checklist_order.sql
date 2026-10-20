-- Airport coordinates use the same bounded numeric validation as ordinary places.
alter function tripboogie_private.normalize_booking(jsonb) rename to normalize_booking_without_airport_points;
create function tripboogie_private.normalize_booking(p_data jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb; field text; point jsonb;
begin
 result:=tripboogie_private.normalize_booking_without_airport_points(p_data);
 foreach field in array array['departureAirport','arrivalAirport'] loop
   if result ? field and (p_data->field ? 'lat' or p_data->field ? 'lng') then
     point:=tripboogie_private.normalize_item('place',jsonb_build_object('name',result->field->>'name','lat',p_data->field->'lat','lng',p_data->field->'lng'));
     result:=jsonb_set(result,array[field],result->field||jsonb_build_object('lat',point->'lat','lng',point->'lng'));
   end if;
 end loop;
 return result;
end;$$;

create function tripboogie_private.flight_airport_place(p_trip public.trips,p_airport jsonb,p_label text)
returns uuid language plpgsql set search_path='' as $$
declare place public.trip_records%rowtype; key text; candidate jsonb; result_id uuid;
begin
 key:=coalesce(nullif(p_airport->>'icao',''),nullif(p_airport->>'iata',''),nullif(p_label,''),'공항');
 select * into place from public.trip_records r where r.trip_id=p_trip.id and r.kind='place' and not r.deleted and r.data->>'airportKey'=key order by r.id limit 1;
 candidate:=tripboogie_private.normalize_item('place',jsonb_build_object(
   'name',coalesce(nullif(p_airport->>'name',''),nullif(p_label,''),'공항'),'category','공항',
   'lat',case when p_airport->>'lat' is not null then p_airport->'lat' else place.data->'lat' end,
   'lng',case when p_airport->>'lng' is not null then p_airport->'lng' else place.data->'lng' end))||jsonb_build_object('airportKey',key);
 if place.id is null then
   insert into public.trip_records(trip_id,kind,data,updated_by) values(p_trip.id,'place',candidate,auth.uid()) returning id into result_id;
 else
   result_id:=place.id;
   if candidate is distinct from place.data then update public.trip_records set data=candidate,version=version+1,updated_at=now(),updated_by=auth.uid() where id=place.id;end if;
 end if;
 return result_id;
end;$$;
create index trip_records_airport_key on public.trip_records(trip_id,(data->>'airportKey')) where kind='place' and not deleted;

-- Flights always own two visible events, including dates outside the trip's base range.
create function tripboogie_private.sync_flight_events(p_trip public.trips,p_booking public.trip_records)
returns void language plpgsql set search_path='' as $$
declare event text; field text; day text; clock text; suffix text; code text; airport jsonb; plan public.trip_records%rowtype; candidate jsonb; location_id uuid; position integer;
begin
 if p_booking.deleted or p_booking.data->>'type'<>'flight' then
   update public.trip_records set deleted=true,version=version+1,updated_at=now(),updated_by=auth.uid()
     where trip_id=p_trip.id and kind='plan' and not deleted and data->>'bookingId'=p_booking.id::text and data->>'bookingEvent' in ('departure','arrival');
   return;
 end if;
 foreach event in array array['departure','arrival'] loop
   field:=case when event='departure' then 'departureAirport' else 'arrivalAirport' end;
   airport:=p_booking.data->field;
   day:=p_booking.data->>case when event='departure' then 'startDate' else 'endDate' end;
   clock:=coalesce(p_booking.data->>case when event='departure' then 'startTime' else 'endTime' end,'');
   suffix:=case when event='departure' then '출발' else '도착' end;
   code:=coalesce(nullif(airport->>'iata',''),nullif(airport->>'icao',''),nullif(p_booking.data->>event,''),'항공');
   location_id:=tripboogie_private.flight_airport_place(p_trip,airport,coalesce(nullif(p_booking.data->>event,''),suffix||' 공항'));
   select * into plan from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and r.data->>'bookingId'=p_booking.id::text and r.data->>'bookingEvent'=event order by r.deleted,r.updated_at,r.id limit 1;
   if plan.id is not null and plan.data->>'date'=day then position:=coalesce((plan.data->>'position')::integer,0);
   else select coalesce(max((r.data->>'position')::integer),0)+1 into position from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and r.data->>'date'=day;end if;
   candidate:=tripboogie_private.normalize_item('plan',jsonb_build_object(
     'title',case when plan.data->>'bookingManaged'='false' then plan.data->>'title' else left(code,260)||' · '||suffix end,
     'date',day,'time',clock,'placeId',location_id,'position',position,'entryType','plan','category','항공',
     'duration',0,'note',coalesce(p_booking.data->>'note','')))||jsonb_build_object('bookingId',p_booking.id,'bookingEvent',event,'bookingManaged',true,'bookingHidden',false);
   if plan.id is null then
     insert into public.trip_records(trip_id,kind,data,updated_by) values(p_trip.id,'plan',candidate,auth.uid());
   elsif plan.deleted or candidate is distinct from plan.data then
     update public.trip_records set data=candidate,deleted=false,version=version+1,updated_at=now(),updated_by=auth.uid() where id=plan.id;
   end if;
 end loop;
 if (select count(*) from public.trip_records r where r.trip_id=p_trip.id and not r.deleted)>5000 or (select count(*) from public.trip_records r where r.trip_id=p_trip.id)>20000 or
    (select coalesce(sum(octet_length(r.data::text)),0) from public.trip_records r where r.trip_id=p_trip.id and not r.deleted)>2097152 then
   perform tripboogie_private.fail(409,'CAPACITY','여행 항목 수 또는 저장 용량 제한에 도달했습니다.');end if;
end;$$;
alter function tripboogie_private.sync_hotel(public.trips,public.trip_records) rename to sync_other_booking_events;
create function tripboogie_private.sync_hotel(p_trip public.trips,p_booking public.trip_records)
returns void language plpgsql set search_path='' as $$
begin
 perform tripboogie_private.sync_flight_events(p_trip,p_booking);
 if p_booking.data->>'type'<>'flight' then perform tripboogie_private.sync_other_booking_events(p_trip,p_booking);end if;
end;$$;

-- Only the administrator can call this private, version-checked legacy repair helper.
create function tripboogie_private.repair_existing_flight(p_id uuid,p_version bigint,p_airports jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare booking public.trip_records%rowtype; trip public.trips%rowtype; candidate jsonb; previous_uid text:=coalesce(current_setting('request.jwt.claim.sub',true),'');
begin
 select t.* into trip from public.trips t join public.trip_records r on r.trip_id=t.id where r.id=p_id and r.kind='booking' and not r.deleted and r.data->>'type'='flight' for update of t;
 if trip.id is null then perform tripboogie_private.fail(404,'NOT_FOUND','항공 예약을 찾을 수 없습니다.');end if;
 select * into booking from public.trip_records where id=p_id for update;
 if booking.version<>p_version then perform tripboogie_private.fail(409,'CONFLICT','항공 예약이 변경되었습니다.');end if;
 perform set_config('request.jwt.claim.sub',trip.owner_id::text,true);
 p_airports:=jsonb_strip_nulls(jsonb_build_object('departureAirport',p_airports->'departureAirport','arrivalAirport',p_airports->'arrivalAirport'));
 candidate:=booking.data||tripboogie_private.normalize_booking(booking.data||p_airports);
 if candidate is distinct from booking.data then
   update public.trip_records set data=candidate,version=version+1,updated_at=now(),updated_by=trip.owner_id where id=booking.id returning * into booking;
 end if;
 perform tripboogie_private.sync_hotel(trip,booking);
 update public.trips set revision=revision+1,updated_at=now() where id=trip.id;
 perform set_config('request.jwt.claim.sub',previous_uid,true);
 return jsonb_build_object('events',(select count(*) from public.trip_records r where r.trip_id=trip.id and r.kind='plan' and not r.deleted and r.data->>'bookingId'=booking.id::text));
end;$$;

-- Assign stable initial positions; completion maps and task content stay intact.
with ranked as (select id,row_number() over(partition by trip_id,data->>'category' order by updated_at,id)-1 as position from public.trip_records where kind='checklist' and not deleted)
update public.trip_records r set data=r.data||jsonb_build_object('position',ranked.position),version=r.version+1 from ranked where r.id=ranked.id and not r.data ? 'position';

create function tripboogie_private.reorder_checklist(p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare ids uuid[]; category text; total integer;
begin
 if p_trip.revision<>tripboogie_private.version_field(jsonb_build_object('version',p_payload->'revision')) then perform tripboogie_private.fail(409,'CONFLICT','체크리스트가 변경되었습니다. 다시 확인하세요.');end if;
 category:=tripboogie_private.text_field(p_payload,'category',100,false);
 if jsonb_typeof(p_payload->'ids') is distinct from 'array' or jsonb_array_length(p_payload->'ids')>5000 then perform tripboogie_private.fail(400,'INVALID_REQUEST','항목 순서를 확인하세요.');end if;
 select array_agg(tripboogie_private.uuid_field(jsonb_build_object('id',value),'id')) into ids from jsonb_array_elements(p_payload->'ids');
 select count(*) into total from public.trip_records r where r.trip_id=p_trip.id and r.kind='checklist' and not r.deleted and coalesce(r.data->>'category','')=category;
 if coalesce(cardinality(ids),0)<>total or (select count(distinct id) from unnest(ids) id)<>total or exists(select 1 from unnest(ids) id where not exists(select 1 from public.trip_records r where r.id=id and r.trip_id=p_trip.id and r.kind='checklist' and not r.deleted and coalesce(r.data->>'category','')=category)) then
   perform tripboogie_private.fail(409,'CONFLICT','같은 분류의 모든 항목을 순서대로 보내 주세요.');end if;
 update public.trip_records r set data=jsonb_set(r.data,'{position}',to_jsonb(a.position-1)),version=r.version+1,updated_at=now(),updated_by=auth.uid() from unnest(ids) with ordinality a(id,position) where r.id=a.id;
 update public.trips set revision=revision+1,updated_at=now() where id=p_trip.id;
 return tripboogie_private.workspace(p_trip.id);
end;$$;

revoke all on function tripboogie_private.normalize_booking(jsonb),tripboogie_private.normalize_booking_without_airport_points(jsonb),tripboogie_private.flight_airport_place(public.trips,jsonb,text),tripboogie_private.sync_flight_events(public.trips,public.trip_records),tripboogie_private.sync_hotel(public.trips,public.trip_records),tripboogie_private.sync_other_booking_events(public.trips,public.trip_records),tripboogie_private.repair_existing_flight(uuid,bigint,jsonb),tripboogie_private.reorder_checklist(public.trips,jsonb) from public,anon,authenticated;

do $migration$
declare source text; needle text; replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
 needle:='  if p_operation=''schedule'' then';
 replacement:=$patch$
  if p_operation='reorder-checklist' then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','열람 권한으로는 수정할 수 없습니다.');end if;
    return tripboogie_private.reorder_checklist(v_trip,p_payload);
  end if;
$patch$||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected checklist authorization boundary';end if;
 source:=replace(source,needle,replacement);
 needle:='        v_data:=v_data||jsonb_build_object(''checks'',coalesce(v_record.data->''checks'',''{}''::jsonb));';
 replacement:=needle||$patch$
        if v_record.id is not null and v_record.data->>'category'=v_data->>'category' and v_record.data ? 'position' then
          v_data:=v_data||jsonb_build_object('position',v_record.data->'position');
        else
          select coalesce(max((r.data->>'position')::integer),-1)+1 into v_n from public.trip_records r where r.trip_id=v_trip.id and r.kind='checklist' and not r.deleted and r.data->>'category'=v_data->>'category';
          v_data:=v_data||jsonb_build_object('position',v_n);
        end if;
$patch$;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected checklist position boundary';end if;
 source:=replace(source,needle,replacement);
 needle:='      v_data:=tripboogie_private.normalize_item(v_kind,p_payload->''data'');';
 replacement:=$patch$
      if v_kind='booking' and v_record.id is not null then
        foreach v_token in array array['departureAirport','arrivalAirport'] loop
          if p_payload->'data'->v_token->>'icao'=v_record.data->v_token->>'icao' then
            p_payload:=jsonb_set(p_payload,array['data',v_token],(v_record.data->v_token)||(p_payload->'data'->v_token));
          end if;
        end loop;
      end if;
$patch$||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected airport preservation boundary';end if;
 source:=replace(source,needle,replacement);
 source:=replace(source,'when p_operation=''schedule'' then 262144','when p_operation in (''schedule'',''reorder-checklist'') then 262144');
 execute source;
 -- Invalidate callers that may still have the renamed normalizer cached by OID.
 execute pg_get_functiondef('tripboogie_private.normalize_item(text,jsonb)'::regprocedure);
end;$migration$;
