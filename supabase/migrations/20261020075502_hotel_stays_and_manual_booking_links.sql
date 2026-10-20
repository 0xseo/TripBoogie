-- Linked schedules keep their own title, place, duration and time. Dates and notes
-- are shared with the reservation. All helpers run behind the locked dispatcher.
create or replace function tripboogie_private.normalize_booking(p_data jsonb)
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
 if result->>'type'='hotel' then result:=result||jsonb_build_object('roomName',tripboogie_private.text_field(p_data,'roomName',200,false));end if;
 return result;
end;$$;

create function tripboogie_private.bind_plan_booking(p_trip public.trips,p_before public.trip_records,p_data jsonb,p_raw jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare booking public.trip_records%rowtype; link text; event text; overrides jsonb; field text; result jsonb:=p_data;
begin
 link:=case when p_raw ? 'bookingId' then coalesce(p_raw->>'bookingId','') else coalesce(p_before.data->>'bookingId','') end;
 if link='' then return result;end if;
 if p_data->>'entryType'='memo' then perform tripboogie_private.fail(400,'INVALID_REQUEST','메모에는 예약을 연결할 수 없습니다.');end if;
 select * into booking from public.trip_records r where r.id=tripboogie_private.uuid_field(jsonb_build_object('id',link),'id') and r.trip_id=p_trip.id and r.kind='booking' and not r.deleted;
 if booking.id is null then perform tripboogie_private.fail(400,'INVALID_REQUEST','같은 여행의 예약을 선택해 주세요.');end if;
 if p_before.data->>'bookingId'=link then
   event:=coalesce(p_before.data->>'bookingEvent','manual');
   overrides:=coalesce(p_before.data->'bookingOverrides',case when p_before.data->>'bookingManaged'='false' then '["title"]'::jsonb else '[]'::jsonb end);
   foreach field in array array['title','placeId','duration','category'] loop
     if p_before.data->field is distinct from p_data->field and not overrides ? field then overrides:=overrides||to_jsonb(field);end if;
   end loop;
 else event:='manual';overrides:='["title","placeId","duration","category"]'::jsonb;end if;
 result:=result||jsonb_build_object('bookingId',link,'bookingEvent',event,'bookingManaged',event<>'manual' and jsonb_array_length(overrides)=0,'bookingOverrides',overrides,
   'bookingDate',case when p_before.data->>'bookingId'=link then coalesce(p_before.data->>'bookingDate',booking.data->>'startDate') else booking.data->>'startDate' end,'bookingHidden',false);
 if not p_raw ? 'note' then result:=jsonb_set(result,'{note}',to_jsonb(coalesce(booking.data->>'note','')));end if;
 if p_before.id is null and not p_raw ? 'time' then result:=jsonb_set(result,'{time}',to_jsonb(coalesce(booking.data->>'startTime','')));end if;
 return result;
end;$$;

create function tripboogie_private.sync_booking_event(p_trip public.trips,p_booking public.trip_records,p_event text,p_day text,p_time text,p_place text,p_title text,p_category text)
returns void language plpgsql set search_path='' as $$
declare plan public.trip_records%rowtype; candidate jsonb; overrides jsonb; position integer;
begin
 select * into plan from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and r.data->>'bookingId'=p_booking.id::text and r.data->>'bookingEvent'=p_event
   and (p_event<>'stay' or coalesce(r.data->>'bookingDate',r.data->>'date')=p_day) order by r.deleted,r.updated_at,r.id limit 1;
 overrides:=coalesce(plan.data->'bookingOverrides',case when plan.data->>'bookingManaged'='false' then '["title"]'::jsonb else '[]'::jsonb end);
 if plan.id is not null and plan.data->>'date'=p_day then position:=coalesce((plan.data->>'position')::integer,0);
 else select coalesce(max((r.data->>'position')::integer),0)+1 into position from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and r.data->>'date'=p_day;end if;
 candidate:=tripboogie_private.normalize_item('plan',jsonb_build_object(
   'title',case when overrides ? 'title' then plan.data->>'title' else left(p_title,300) end,
   'date',p_day,'time',case when plan.id is null then p_time else coalesce(plan.data->>'time','') end,
   'placeId',case when overrides ? 'placeId' then plan.data->>'placeId' else p_place end,'position',position,'entryType','plan',
   'category',case when overrides ? 'category' then plan.data->>'category' else p_category end,
   'duration',coalesce(plan.data->'duration','0'::jsonb),'note',coalesce(p_booking.data->>'note','')))||
   jsonb_build_object('bookingId',p_booking.id,'bookingEvent',p_event,'bookingDate',p_day,'bookingManaged',jsonb_array_length(overrides)=0,'bookingOverrides',overrides,'bookingHidden',false);
 if plan.id is null then insert into public.trip_records(trip_id,kind,data,updated_by) values(p_trip.id,'plan',candidate,auth.uid());
 elsif plan.deleted or candidate is distinct from plan.data then update public.trip_records set data=candidate,deleted=false,version=version+1,updated_at=now(),updated_by=auth.uid() where id=plan.id;end if;
end;$$;

create or replace function tripboogie_private.sync_hotel(p_trip public.trips,p_booking public.trip_records)
returns void language plpgsql set search_path='' as $$
declare plan public.trip_records%rowtype; event text; day date; field text; airport jsonb; location_id text; suffix text; code text; valid boolean; overrides jsonb; candidate jsonb; delta integer;
begin
 -- Retire obsolete automatic events; retain edited schedules as manual links.
 for plan in select r.* from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and r.data->>'bookingId'=p_booking.id::text loop
   event:=plan.data->>'bookingEvent';
   valid:=not p_booking.deleted and (event='manual' or case p_booking.data->>'type'
     when 'flight' then event in ('departure','arrival') when 'tour' then event='tour'
     when 'hotel' then event='checkin' or event='checkout' and p_booking.data->>'startDate'<>p_booking.data->>'endDate' or event='stay' and coalesce(plan.data->>'bookingDate',plan.data->>'date')>p_booking.data->>'startDate' and coalesce(plan.data->>'bookingDate',plan.data->>'date')<p_booking.data->>'endDate'
     else false end);
   if valid then continue;end if;
   overrides:=coalesce(plan.data->'bookingOverrides',case when plan.data->>'bookingManaged'='false' then '["title"]'::jsonb else '[]'::jsonb end);
   if event='manual' or jsonb_array_length(overrides)>0 then
     candidate:=case when p_booking.deleted then plan.data-'bookingId'-'bookingEvent'-'bookingManaged'-'bookingHidden'-'bookingDate'-'bookingOverrides'
       else plan.data||jsonb_build_object('bookingEvent','manual','bookingDate',p_booking.data->>'startDate','bookingManaged',false) end;
     update public.trip_records set data=candidate,version=version+1,updated_at=now(),updated_by=auth.uid() where id=plan.id;
   else update public.trip_records set deleted=true,version=version+1,updated_at=now(),updated_by=auth.uid() where id=plan.id;end if;
 end loop;
 if p_booking.deleted then return;end if;
 if p_booking.data->>'type'='flight' then
   foreach event in array array['departure','arrival'] loop
     field:=case when event='departure' then 'departureAirport' else 'arrivalAirport' end;airport:=p_booking.data->field;
     suffix:=case when event='departure' then '출발' else '도착' end;
     code:=coalesce(nullif(airport->>'iata',''),nullif(airport->>'icao',''),nullif(p_booking.data->>event,''),'항공');
     location_id:=tripboogie_private.flight_airport_place(p_trip,airport,coalesce(nullif(p_booking.data->>event,''),suffix||' 공항'))::text;
     perform tripboogie_private.sync_booking_event(p_trip,p_booking,event,p_booking.data->>case when event='departure' then 'startDate' else 'endDate' end,
       coalesce(p_booking.data->>case when event='departure' then 'startTime' else 'endTime' end,''),location_id,left(code,260)||' · '||suffix,'항공');
   end loop;
 elsif p_booking.data->>'type'='hotel' then
   day:=(p_booking.data->>'startDate')::date;
   while day<=(p_booking.data->>'endDate')::date loop
     event:=case when day::text=p_booking.data->>'startDate' then 'checkin' when day::text=p_booking.data->>'endDate' then 'checkout' else 'stay' end;
     suffix:=case event when 'checkin' then ' · 체크인' when 'checkout' then ' · 체크아웃' else '' end;
     perform tripboogie_private.sync_booking_event(p_trip,p_booking,event,day::text,
       case event when 'checkin' then coalesce(p_booking.data->>'startTime','') when 'checkout' then coalesce(p_booking.data->>'endTime','') else '' end,
       coalesce(p_booking.data->>'placeId',''),left(p_booking.data->>'title',280)||suffix,'숙박');
     day:=day+1;
   end loop;
 elsif p_booking.data->>'type'='tour' then
   perform tripboogie_private.sync_booking_event(p_trip,p_booking,'tour',p_booking.data->>'startDate',coalesce(p_booking.data->>'startTime',''),coalesce(p_booking.data->>'placeId',''),p_booking.data->>'title','투어');
 end if;
 -- Manually linked schedules follow reservation date shifts and share its note.
 for plan in select r.* from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and r.data->>'bookingId'=p_booking.id::text loop
   candidate:=plan.data||jsonb_build_object('note',coalesce(p_booking.data->>'note',''));
   if plan.data->>'bookingEvent'='manual' then
     delta:=(p_booking.data->>'startDate')::date-coalesce(plan.data->>'bookingDate',p_booking.data->>'startDate')::date;
     candidate:=candidate||jsonb_build_object('date',((plan.data->>'date')::date+delta)::text,'bookingDate',p_booking.data->>'startDate');
   end if;
   if candidate is distinct from plan.data then update public.trip_records set data=candidate,version=version+1,updated_at=now(),updated_by=auth.uid() where id=plan.id;end if;
 end loop;
 if (select count(*) from public.trip_records r where r.trip_id=p_trip.id and not r.deleted)>5000 or (select count(*) from public.trip_records r where r.trip_id=p_trip.id)>20000 or
    (select coalesce(sum(octet_length(r.data::text)),0) from public.trip_records r where r.trip_id=p_trip.id and not r.deleted)>2097152 then
   perform tripboogie_private.fail(409,'CAPACITY','여행 항목 수 또는 저장 용량 제한에 도달했습니다.');end if;
end;$$;

-- Keep daily hotel identities when the entire reservation moves by the same delta.
create function tripboogie_private.shift_booking_anchors(p_trip public.trips,p_booking public.trip_records,p_data jsonb)
returns void language plpgsql set search_path='' as $$
declare delta integer;
begin
 delta:=(p_data->>'startDate')::date-(p_booking.data->>'startDate')::date;
 if p_booking.data->>'type'='hotel' and delta<>0 and (p_data->>'endDate')::date-(p_booking.data->>'endDate')::date=delta then
   update public.trip_records set data=jsonb_set(data,'{bookingDate}',to_jsonb((coalesce(data->>'bookingDate',data->>'date')::date+delta)::text))
     where trip_id=p_trip.id and kind='plan' and data->>'bookingId'=p_booking.id::text and data->>'bookingEvent'='stay';
 end if;
end;$$;

create or replace function tripboogie_private.sync_plan_booking(p_trip public.trips,p_before public.trip_records,p_plan public.trip_records)
returns void language plpgsql set search_path='' as $$
declare booking public.trip_records%rowtype; v_data jsonb; event text; delta integer; old_day text;
begin
 if current_setting('tripboogie.sync_booking',true)='true' or p_plan.deleted or coalesce(p_plan.data->>'bookingId','')='' then return;end if;
 select * into booking from public.trip_records b where b.trip_id=p_trip.id and b.kind='booking' and not b.deleted and b.id::text=p_plan.data->>'bookingId' for update;
 if booking.id is null then return;end if;
 event:=p_plan.data->>'bookingEvent';v_data:=booking.data;
 old_day:=case when p_before.data->>'bookingId'=booking.id::text then p_before.data->>'date' else booking.data->>'startDate' end;
 if old_day is distinct from p_plan.data->>'date' then
   if event in ('tour','manual','stay') then
     delta:=(p_plan.data->>'date')::date-old_day::date;
     v_data:=v_data||jsonb_build_object('startDate',((v_data->>'startDate')::date+delta)::text,'endDate',((v_data->>'endDate')::date+delta)::text);
   else v_data:=v_data||jsonb_build_object(case when event in ('checkout','arrival') then 'endDate' else 'startDate' end,p_plan.data->>'date');end if;
 end if;
 if p_plan.data->>'note' is distinct from booking.data->>'note' then v_data:=v_data||jsonb_build_object('note',coalesce(p_plan.data->>'note',''));end if;
 if v_data=booking.data then return;end if;
 v_data:=v_data||tripboogie_private.normalize_booking(v_data);
 if v_data->>'type'='hotel' and (v_data->>'startDate'<p_trip.start_date::text or v_data->>'endDate'>p_trip.end_date::text) then perform tripboogie_private.fail(400,'INVALID_REQUEST','숙소 이용일은 여행 기간 안에서 선택하세요.');end if;
 perform tripboogie_private.shift_booking_anchors(p_trip,booking,v_data);
 if event='manual' then update public.trip_records set data=jsonb_set(data,'{bookingDate}',v_data->'startDate') where id=p_plan.id;end if;
 update public.trip_records set data=v_data,version=version+1,updated_at=now(),updated_by=auth.uid() where id=booking.id returning * into booking;
 perform tripboogie_private.sync_hotel(p_trip,booking);
end;$$;

create or replace function tripboogie_private.edit_schedule(p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare before_rows jsonb; old_plan jsonb; plan public.trip_records%rowtype; booking public.trip_records%rowtype; v_data jsonb; event text; delta integer; range_delta integer; endpoint boolean; result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into before_rows from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and coalesce(r.data->>'bookingId','')<>'';
 result:=tripboogie_private.edit_schedule_unlinked(p_trip,p_payload);
 if p_payload->>'operation' not in ('move','swap-days') then return result;end if;
 for booking in select b.* from public.trip_records b where b.trip_id=p_trip.id and b.kind='booking' and not b.deleted and exists(select 1 from jsonb_array_elements(before_rows) p where p->'data'->>'bookingId'=b.id::text) loop
   v_data:=booking.data;range_delta:=null;endpoint:=false;
   for old_plan in select p from jsonb_array_elements(before_rows) p where p->'data'->>'bookingId'=booking.id::text loop
     select * into plan from public.trip_records r where r.id=(old_plan->>'id')::uuid and not r.deleted;
     if plan.id is null or old_plan->'data'->>'date' is not distinct from plan.data->>'date' then continue;end if;
     event:=plan.data->>'bookingEvent';delta:=(plan.data->>'date')::date-(old_plan->'data'->>'date')::date;
     if event in ('tour','manual','stay') then range_delta:=coalesce(range_delta,delta);
     else endpoint:=true;v_data:=v_data||jsonb_build_object(case when event in ('checkout','arrival') then 'endDate' else 'startDate' end,plan.data->>'date');end if;
   end loop;
   if not endpoint and range_delta is not null then v_data:=v_data||jsonb_build_object('startDate',((booking.data->>'startDate')::date+range_delta)::text,'endDate',((booking.data->>'endDate')::date+range_delta)::text);end if;
   if v_data=booking.data then continue;end if;
   v_data:=v_data||tripboogie_private.normalize_booking(v_data);
   if v_data->>'type'='hotel' and (v_data->>'startDate'<p_trip.start_date::text or v_data->>'endDate'>p_trip.end_date::text) then perform tripboogie_private.fail(400,'INVALID_REQUEST','숙소 이용일은 여행 기간 안에서 선택하세요.');end if;
   perform tripboogie_private.shift_booking_anchors(p_trip,booking,v_data);
   update public.trip_records r set data=jsonb_set(r.data,'{bookingDate}',v_data->'startDate') where r.trip_id=p_trip.id and r.kind='plan' and r.data->>'bookingId'=booking.id::text and r.data->>'bookingEvent'='manual' and exists(select 1 from jsonb_array_elements(before_rows) p where p->>'id'=r.id::text and p->'data'->>'date' is distinct from r.data->>'date');
   update public.trip_records set data=v_data,version=version+1,updated_at=now(),updated_by=auth.uid() where id=booking.id returning * into booking;
   perform tripboogie_private.sync_hotel(p_trip,booking);
 end loop;
 return tripboogie_private.workspace(p_trip.id);
end;$$;

revoke all on function tripboogie_private.bind_plan_booking(public.trips,public.trip_records,jsonb,jsonb),tripboogie_private.sync_booking_event(public.trips,public.trip_records,text,text,text,text,text,text),tripboogie_private.shift_booking_anchors(public.trips,public.trip_records,jsonb),tripboogie_private.normalize_booking(jsonb),tripboogie_private.sync_hotel(public.trips,public.trip_records),tripboogie_private.sync_plan_booking(public.trips,public.trip_records,public.trip_records),tripboogie_private.edit_schedule(public.trips,jsonb) from public,anon,authenticated;

do $migration$
declare source text; needle text; replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
 needle:='        if v_record.data ? ''bookingId'' then v_data:=v_data||jsonb_build_object(''bookingId'',v_record.data->>''bookingId'',''bookingEvent'',v_record.data->>''bookingEvent'',''bookingManaged'',false);end if;';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected itinerary binding boundary';end if;
 source:=replace(source,needle,'        v_data:=tripboogie_private.bind_plan_booking(v_trip,v_record,v_data,p_payload->''data'');');
 source:=replace(source,'if (v_data->>''date'')<v_trip.start_date::text or (v_data->>''date'')>v_trip.end_date::text then','if ((v_data->>''date'')<v_trip.start_date::text or (v_data->>''date'')>v_trip.end_date::text) and not exists(select 1 from public.trip_records b where b.trip_id=v_trip.id and b.kind=''booking'' and not b.deleted and b.id::text=v_data->>''bookingId'' and b.data->>''type''=''flight'') then');
 -- Booking date edits must reanchor daily stay records before generating events.
 needle:='    if v_kind=''booking'' then'||chr(10)||'      select * into v_record from public.trip_records r where r.id=v_record_id;';
 replacement:='    if v_kind=''booking'' and v_action=''upsert'' and v_record.id is not null then perform tripboogie_private.shift_booking_anchors(v_trip,v_record,v_data);end if;'||chr(10)||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected booking date boundary';end if;
 source:=replace(source,needle,replacement);
 needle:='  if p_operation=''schedule'' then';
 replacement:=$patch$
  if p_operation='ensure-hotel-plan' then
    if v_role='viewer' then perform tripboogie_private.fail(403,'FORBIDDEN','열람 권한으로는 수정할 수 없습니다.');end if;
    select * into v_record from public.trip_records r where r.trip_id=v_trip.id and r.id=tripboogie_private.uuid_field(p_payload,'bookingId') and r.kind='booking' and not r.deleted and r.data->>'type'='hotel';
    if v_record.id is null or coalesce(p_payload->>'date','')<v_record.data->>'startDate' or coalesce(p_payload->>'date','')>v_record.data->>'endDate' then perform tripboogie_private.fail(400,'INVALID_REQUEST','이날은 예약된 숙소가 없어요.');end if;
    perform tripboogie_private.sync_hotel(v_trip,v_record);
    update public.trips set revision=revision+1,updated_at=now() where id=v_trip.id;
    return tripboogie_private.workspace(v_trip.id);
  end if;
$patch$||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected hotel authorization boundary';end if;
 execute replace(source,needle,replacement);
 source:=pg_get_functiondef('tripboogie_private.import_trip(jsonb)'::regprocedure);
 source:=replace(source,'if kind=''plan'' and (v_import_data->>''date''<start_date or v_import_data->>''date''>end_date) then','if kind=''plan'' and (v_import_data->>''date''<start_date or v_import_data->>''date''>end_date) and not exists(select 1 from public.trip_records b where b.trip_id=new_trip_id and b.kind=''booking'' and b.id::text=ids->>(row->''data''->>''bookingId'') and b.data->>''type''=''flight'') then');
 source:=replace(source,'not in (''checkin'',''checkout'')','not in (''checkin'',''checkout'',''departure'',''arrival'',''tour'',''stay'',''manual'')');
 needle:='''bookingManaged'',row->''data''->''bookingManaged''=''true''::jsonb)';
 replacement:='''bookingManaged'',row->''data''->''bookingManaged''=''true''::jsonb,''bookingDate'',tripboogie_private.date_field(jsonb_build_object(''date'',coalesce(row->''data''->''bookingDate'',row->''data''->''date'')),''date''),''bookingOverrides'',case when jsonb_typeof(row->''data''->''bookingOverrides'')=''array'' and jsonb_array_length(row->''data''->''bookingOverrides'')<=4 then row->''data''->''bookingOverrides'' else ''[]''::jsonb end)';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected import binding boundary';end if;
 source:=replace(source,needle,replacement);
 needle:='  return tripboogie_private.workspace(new_trip_id);';
 replacement:='  perform tripboogie_private.sync_hotel(t,b) from public.trips t,public.trip_records b where t.id=new_trip_id and b.trip_id=t.id and b.kind=''booking'' and not b.deleted;'||chr(10)||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected import sync boundary';end if;
 execute replace(source,needle,replacement);
end;$migration$;

-- Fill every existing hotel's stay, using the same transaction and capacity checks.
do $backfill$
declare trip public.trips%rowtype; booking public.trip_records%rowtype; previous_uid text:=coalesce(current_setting('request.jwt.claim.sub',true),'');
begin
 for trip in select t.* from public.trips t where exists(select 1 from public.trip_records r where r.trip_id=t.id and r.kind='booking' and not r.deleted and r.data->>'type'='hotel') for update loop
   perform set_config('request.jwt.claim.sub',trip.owner_id::text,true);
   for booking in select r.* from public.trip_records r where r.trip_id=trip.id and r.kind='booking' and not r.deleted and r.data->>'type'='hotel' loop perform tripboogie_private.sync_hotel(trip,booking);end loop;
   update public.trips set revision=revision+1,updated_at=now() where id=trip.id;
 end loop;
 perform set_config('request.jwt.claim.sub',previous_uid,true);
end;$backfill$;
