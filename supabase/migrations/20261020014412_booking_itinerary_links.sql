-- Keep the existing private entry point so every booking write shares one transaction.
create or replace function tripboogie_private.sync_hotel(p_trip public.trips,p_booking public.trip_records)
returns void language plpgsql set search_path='' as $$
declare
 event text; day text; clock text; suffix text; enabled boolean; managed boolean;
 plan public.trip_records%rowtype; candidate jsonb; result jsonb; plan_id uuid;
 previous_guard text:=coalesce(current_setting('tripboogie.sync_booking',true),'');
begin
 perform set_config('tripboogie.sync_booking','true',true);
 foreach event in array array['checkin','checkout','departure','arrival','tour'] loop
   select * into plan from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan'
     and r.data->>'bookingId'=p_booking.id::text and r.data->>'bookingEvent'=event order by r.updated_at,r.id limit 1;
   -- Explicitly deleted events stay deleted. Events hidden by dates/type can return.
   if plan.id is not null and plan.deleted and plan.data->>'bookingHidden' is distinct from 'true' then continue;end if;
   enabled:=not p_booking.deleted and case p_booking.data->>'type'
     when 'hotel' then event in ('checkin','checkout') when 'flight' then event in ('departure','arrival') when 'tour' then event='tour' else false end;
   day:=p_booking.data->>case when event in ('checkout','arrival') then 'endDate' else 'startDate' end;
   clock:=coalesce(p_booking.data->>case when event in ('checkout','arrival') then 'endTime' else 'startTime' end,'');
   managed:=plan.id is null or plan.data->>'bookingManaged'='true';
   if not enabled or day<p_trip.start_date::text or day>p_trip.end_date::text then
     if plan.id is not null and not plan.deleted then
       if managed then
         update public.trip_records set deleted=true,data=data||jsonb_build_object('bookingHidden',true),version=version+1,updated_by=auth.uid(),updated_at=now() where id=plan.id;
       else
         update public.trip_records set data=data-'bookingId'-'bookingEvent'-'bookingManaged'-'bookingHidden',version=version+1,updated_by=auth.uid(),updated_at=now() where id=plan.id;
       end if;
     end if;
     continue;
   end if;
   suffix:=case event when 'checkin' then ' · 체크인' when 'checkout' then ' · 체크아웃' when 'departure' then ' · 출발' when 'arrival' then ' · 도착' else '' end;
   candidate:=coalesce(plan.data,'{}'::jsonb)||jsonb_build_object(
     'title',case when managed then left(p_booking.data->>'title',300-length(suffix))||suffix else plan.data->>'title' end,
     'date',day,'time',clock,'placeId',case when p_booking.data->>'type'='flight' then '' else coalesce(p_booking.data->>'placeId','') end,
     'category',case p_booking.data->>'type' when 'hotel' then '숙박' when 'flight' then '항공' else '투어' end,
     'note',case when managed then coalesce(p_booking.data->>'note','') else coalesce(plan.data->>'note','') end,
     'duration',coalesce(plan.data->'duration','0'::jsonb),'entryType','plan',
     'bookingId',p_booking.id,'bookingEvent',event,'bookingManaged',managed,'bookingHidden',false);
   if plan.id is not null and not plan.deleted and candidate=plan.data then continue;end if;
   plan_id:=coalesce(plan.id,gen_random_uuid());
   if plan.deleted then update public.trip_records set deleted=false where id=plan.id;end if;
   result:=tripboogie_private.dispatch('mutate',p_trip.id,jsonb_strip_nulls(jsonb_build_object('action','upsert','kind','plan','id',plan_id,
     'version',case when plan.id is null then null else to_jsonb(plan.version) end,'data',candidate)));
   update public.trip_records set data=data||jsonb_build_object('bookingId',p_booking.id,'bookingEvent',event,'bookingManaged',managed,'bookingHidden',false) where id=plan_id;
 end loop;
 perform set_config('tripboogie.sync_booking',previous_guard,true);
end;$$;

-- A linked event owns the reservation's matching date/time. Keep custom event titles.
create or replace function tripboogie_private.sync_plan_booking(p_trip public.trips,p_before public.trip_records,p_plan public.trip_records)
returns void language plpgsql set search_path='' as $$
declare booking public.trip_records%rowtype; v_data jsonb; event text; delta integer;
begin
 if current_setting('tripboogie.sync_booking',true)='true' or p_plan.deleted or coalesce(p_plan.data->>'bookingId','')='' then return;end if;
 select * into booking from public.trip_records b where b.trip_id=p_trip.id and b.kind='booking' and not b.deleted and b.id::text=p_plan.data->>'bookingId' for update;
 if booking.id is null then return;end if;
 event:=p_plan.data->>'bookingEvent';v_data:=booking.data;
 if p_before.data->>'date' is distinct from p_plan.data->>'date' then
   if event='tour' then
     delta:=(p_plan.data->>'date')::date-(v_data->>'startDate')::date;
     v_data:=v_data||jsonb_build_object('endDate',((v_data->>'endDate')::date+delta)::text);
   end if;
   v_data:=v_data||jsonb_build_object(case when event in ('checkout','arrival') then 'endDate' else 'startDate' end,p_plan.data->>'date');
 end if;
 if p_before.data->>'time' is distinct from p_plan.data->>'time' then
   v_data:=v_data||jsonb_build_object(case when event in ('checkout','arrival') then 'endTime' else 'startTime' end,coalesce(p_plan.data->>'time',''));
 end if;
 if booking.data->>'type'<>'flight' and p_before.data->>'placeId' is distinct from p_plan.data->>'placeId' then v_data:=v_data||jsonb_build_object('placeId',p_plan.data->>'placeId');end if;
 if v_data=booking.data then return;end if;
 -- Preserve payment links and run the same timezone/date validation as booking edits.
 v_data:=v_data||tripboogie_private.normalize_booking(v_data);
 update public.trip_records set data=v_data,version=version+1,updated_at=now(),updated_by=auth.uid() where id=booking.id returning * into booking;
 perform tripboogie_private.sync_hotel(p_trip,booking);
end;$$;
revoke all on function tripboogie_private.sync_hotel(public.trips,public.trip_records),tripboogie_private.sync_plan_booking(public.trips,public.trip_records,public.trip_records) from public,anon,authenticated;

do $migration$
declare source text; needle text; replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
 needle:='    if v_kind=''booking'' then'||chr(10)||'      select * into v_record from public.trip_records r where r.id=v_record_id;';
 replacement:=$sync$
    if v_kind='plan' and v_action='upsert' then
      perform tripboogie_private.sync_plan_booking(v_trip,v_record,(select r from public.trip_records r where r.id=v_record_id));
    end if;
$sync$||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected booking synchronization boundary';end if;
 execute replace(source,needle,replacement);
end;$migration$;

-- Batch moves and day swaps update both reservation endpoints before validation.
alter function tripboogie_private.edit_schedule(public.trips,jsonb) rename to edit_schedule_unlinked;
create function tripboogie_private.edit_schedule(p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare before_rows jsonb; old_plan jsonb; plan public.trip_records%rowtype; booking public.trip_records%rowtype; v_data jsonb; event text; delta integer; result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into before_rows from public.trip_records r where r.trip_id=p_trip.id and r.kind='plan' and not r.deleted and coalesce(r.data->>'bookingId','')<>'';
 result:=tripboogie_private.edit_schedule_unlinked(p_trip,p_payload);
 if p_payload->>'operation' not in ('move','swap-days') then return result;end if;
 for booking in select b.* from public.trip_records b where b.trip_id=p_trip.id and b.kind='booking' and not b.deleted and exists(select 1 from jsonb_array_elements(before_rows) p where p->'data'->>'bookingId'=b.id::text) loop
   v_data:=booking.data;
   for old_plan in select p from jsonb_array_elements(before_rows) p where p->'data'->>'bookingId'=booking.id::text loop
     select * into plan from public.trip_records r where r.id=(old_plan->>'id')::uuid and not r.deleted;
     if plan.id is null or old_plan->'data'->>'date' is not distinct from plan.data->>'date' then continue;end if;
     event:=plan.data->>'bookingEvent';
     if event='tour' then
       delta:=(plan.data->>'date')::date-(v_data->>'startDate')::date;
       v_data:=v_data||jsonb_build_object('endDate',((v_data->>'endDate')::date+delta)::text);
     end if;
     v_data:=v_data||jsonb_build_object(case when event in ('checkout','arrival') then 'endDate' else 'startDate' end,plan.data->>'date');
   end loop;
   if v_data=booking.data then continue;end if;
   v_data:=v_data||tripboogie_private.normalize_booking(v_data);
   update public.trip_records set data=v_data,version=version+1,updated_at=now(),updated_by=auth.uid() where id=booking.id returning * into booking;
   perform tripboogie_private.sync_hotel(p_trip,booking);
 end loop;
 return tripboogie_private.workspace(p_trip.id);
end;$$;
revoke all on function tripboogie_private.edit_schedule(public.trips,jsonb) from public,anon,authenticated;
