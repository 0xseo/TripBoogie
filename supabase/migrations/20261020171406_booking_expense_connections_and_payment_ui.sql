-- Booking and expense connections remain inside the existing trip lock and membership checks.
create function tripboogie_private.expense_categories(p_value jsonb,p_strict boolean default false)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:=tripboogie_private.normalize_categories(p_value); item jsonb;
 defaults constant jsonb:='[{"id":"flight","label":"항공"},{"id":"stay","label":"숙소"},{"id":"transport","label":"교통"},{"id":"food","label":"식비"},{"id":"activity","label":"관광"}]';
begin
 for item in select value from jsonb_array_elements(defaults) loop
  if not exists(select 1 from jsonb_array_elements(result) c where c->>'id'=item->>'id') then
   if p_strict then perform tripboogie_private.fail(400,'INVALID_REQUEST','항공·숙소·교통·식비·관광 기본 경비 분류는 삭제할 수 없습니다.');end if;
   result:=result||jsonb_build_array(item);
  end if;
 end loop;
 return result;
end;$$;
revoke all on function tripboogie_private.expense_categories(jsonb,boolean) from public,anon,authenticated;

alter function tripboogie_private.normalize_booking(jsonb) rename to normalize_booking_without_single_seat;
create function tripboogie_private.normalize_booking(p_data jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:=tripboogie_private.normalize_booking_without_single_seat(p_data); seat text;
begin
 if result->>'type'='flight' then
  if p_data ? 'flightSeat' then seat:=tripboogie_private.text_field(p_data,'flightSeat',300,false);
  else select coalesce(string_agg(e->>'seat',', '),'') into seat from jsonb_array_elements(coalesce(result->'flightExtras','[]')) e where coalesce(e->>'seat','')<>'';end if;
  result:=result||jsonb_build_object('flightSeat',seat);
 end if;return result;
end;$$;
revoke all on function tripboogie_private.normalize_booking(jsonb),tripboogie_private.normalize_booking_without_single_seat(jsonb) from public,anon,authenticated;

create function tripboogie_private.save_expense(p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare expense public.trip_records%rowtype; booking public.trip_records%rowtype; eid uuid; bid uuid; old_bid text; requested text; v_data jsonb; w jsonb; amount numeric;
begin
 if not exists(select 1 from public.trip_members m where m.trip_id=p_trip.id and m.user_id=auth.uid() and m.role in ('owner','editor')) then perform tripboogie_private.fail(403,'FORBIDDEN','여행을 편집할 권한이 없습니다.');end if;
 if p_payload ? 'id' then
  eid:=tripboogie_private.uuid_field(p_payload,'id');
  select * into expense from public.trip_records r where r.id=eid and r.trip_id=p_trip.id and r.kind='expense' and not r.deleted for update;
 else eid:=gen_random_uuid();end if;
 if expense.id is not null and expense.version<>tripboogie_private.version_field(p_payload) then perform tripboogie_private.fail(409,'CONFLICT','경비가 변경되었습니다. 다시 열어 주세요.');end if;
 old_bid:=coalesce(expense.data->>'bookingId','');requested:=coalesce(p_payload->'data'->>'bookingId',old_bid);
 v_data:=tripboogie_private.normalize_expense(p_payload->'data');
 if requested<>'' then
  bid:=tripboogie_private.uuid_field(jsonb_build_object('id',requested),'id');
  select * into booking from public.trip_records r where r.id=bid and r.trip_id=p_trip.id and r.kind='booking' and not r.deleted for update;
  if not found then perform tripboogie_private.fail(404,'NOT_FOUND','연결할 예약을 찾을 수 없습니다.');end if;
  if coalesce(booking.data->>'expenseId','') not in ('',eid::text) then perform tripboogie_private.fail(409,'CONFLICT','이미 경비에 연결된 예약입니다. 연결된 경비를 수정하세요.');end if;
  if p_payload->'data' ? 'bookingVersion' and p_payload->'data'->'bookingVersion'<>'null'::jsonb and booking.version<>tripboogie_private.version_field(jsonb_build_object('version',p_payload->'data'->'bookingVersion')) then perform tripboogie_private.fail(409,'CONFLICT','예약이 변경되었습니다. 다시 선택하세요.');end if;
  if v_data->>'model' is distinct from '2' then perform tripboogie_private.fail(400,'INVALID_REQUEST','예약 연결 경비의 결제 통화를 확인하세요.');end if;
 end if;
 -- Remove an old connection before canonical mutation so it cannot reattach it.
 if old_bid<>'' and old_bid is distinct from requested then
  update public.trip_records b set data=(b.data-'expenseId')||jsonb_build_object('isPaid',false),version=b.version+1,updated_at=now(),updated_by=auth.uid()
   where b.trip_id=p_trip.id and b.kind='booking' and not b.deleted and b.id::text=old_bid and b.data->>'expenseId'=eid::text;
  update public.trip_records set data=trip_records.data-'bookingId' where id=eid;
 end if;
 w:=tripboogie_private.dispatch('mutate',p_trip.id,jsonb_strip_nulls(jsonb_build_object('action','upsert','kind','expense','id',eid,'version',p_payload->'version','data',v_data)));
 if bid is not null then
  amount:=case when v_data->>'paidCurrency'=v_data->>'tripCurrency' then (v_data->>'tripAmount')::numeric else (v_data->>'baseAmount')::numeric end;
  update public.trip_records set data=trip_records.data||jsonb_build_object('bookingId',bid) where id=eid;
  update public.trip_records set data=trip_records.data||jsonb_build_object('expenseId',eid,'isPaid',true,'moneyCurrency',v_data->>'paidCurrency','moneyAmount',amount::text),version=version+1,updated_at=now(),updated_by=auth.uid() where id=bid;
 end if;
 if (select coalesce(sum(octet_length(r.data::text)),0) from public.trip_records r where r.trip_id=p_trip.id and not r.deleted)>2097152 then perform tripboogie_private.fail(409,'CAPACITY','여행 데이터는 최대 2 MiB까지 저장할 수 있습니다.');end if;
 return tripboogie_private.workspace(p_trip.id);
end;$$;
revoke all on function tripboogie_private.save_expense(public.trips,jsonb) from public,anon,authenticated;

do $migration$
declare source text;needle text;replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
 needle:='if p_operation in (''save-plan'',''save-booking'') then';
 replacement:='if p_operation in (''save-plan'',''save-booking'',''save-expense'') then'||E'\n'||'    if p_operation=''save-expense'' then return tripboogie_private.save_expense(v_trip,p_payload);end if;';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected expense authorization boundary';end if;source:=replace(source,needle,replacement);
 needle:='tripboogie_private.normalize_categories(p_payload->''expenseCategories'')';replacement:='tripboogie_private.expense_categories(p_payload->''expenseCategories'',true)';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected expense category boundary';end if;source:=replace(source,needle,replacement);
 needle:='    insert into public.trip_members(trip_id,user_id,role) values(v_next_id,v_uid,''owner'');';
 replacement:=$new$    update public.trips set settings=jsonb_set(settings,'{expenseCategories}',tripboogie_private.expense_categories('[]')) where id=v_next_id;
$new$||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected new trip category boundary';end if;execute replace(source,needle,replacement);
 source:=pg_get_functiondef('tripboogie_private.import_trip(jsonb)'::regprocedure);needle:='return tripboogie_private.workspace(new_trip_id);';
 replacement:=$new$update public.trips set settings=jsonb_set(settings,'{expenseCategories}',tripboogie_private.expense_categories(settings->'expenseCategories')) where id=new_trip_id;
 return tripboogie_private.workspace(new_trip_id);$new$;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected imported category boundary';end if;execute replace(source,needle,replacement);
end;$migration$;
update public.trips set settings=jsonb_set(settings,'{expenseCategories}',tripboogie_private.expense_categories(settings->'expenseCategories'));

-- Upgrade the former default labels without changing custom category names or money.
update public.trips t set settings=jsonb_set(t.settings,'{expenseCategories}',(select jsonb_agg(case when c->>'id'='stay' and c->>'label'='숙박' then c||'{"label":"숙소"}'::jsonb when c->>'id'='activity' and c->>'label'='관광·체험' then c||'{"label":"관광"}'::jsonb else c end order by position) from jsonb_array_elements(t.settings->'expenseCategories') with ordinality x(c,position)));
