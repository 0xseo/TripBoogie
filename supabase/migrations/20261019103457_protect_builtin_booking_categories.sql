-- Restore missing built-in choices at the read boundary without rewriting saved trips.
create or replace function tripboogie_private.booking_categories(p_settings jsonb)
returns jsonb language sql immutable set search_path='' as $$
 with defaults as (select '[{"id":"hotel","label":"숙소","kind":"hotel"},{"id":"flight","label":"항공","kind":"flight"},{"id":"tour","label":"투어·티켓","kind":"tour"},{"id":"other","label":"기타","kind":"other"}]'::jsonb as items),
 base as (select coalesce(p_settings->'bookingCategories',defaults.items) as items from defaults)
 select base.items||coalesce((select jsonb_agg(c.value order by c.position) from defaults,jsonb_array_elements(defaults.items) with ordinality as c(value,position)
  where c.value->>'id' in ('hotel','flight','tour') and not exists(select 1 from jsonb_array_elements(base.items) old where old->>'id'=c.value->>'id')),'[]'::jsonb) from base;
$$;
revoke all on function tripboogie_private.booking_categories(jsonb) from public,anon,authenticated;

-- Existing canonical values can be reused; imported legacy names are initialized once.
create or replace function tripboogie_private.checked_booking_categories(p_previous jsonb,p_value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare prior jsonb; proposed jsonb; id text; before_category jsonb; after_category jsonb;
begin
 if p_value is not distinct from p_previous->'bookingCategories' then return p_value;end if;
 proposed:=tripboogie_private.normalize_booking_categories(p_value);
 prior:=tripboogie_private.booking_categories(p_previous);
 foreach id in array array['hotel','flight','tour'] loop
  select c into before_category from jsonb_array_elements(prior) c where c->>'id'=id;
  select c into after_category from jsonb_array_elements(proposed) c where c->>'id'=id;
  if after_category is null or before_category->>'label' is distinct from after_category->>'label' or before_category->>'kind' is distinct from after_category->>'kind' then
   perform tripboogie_private.fail(400,'INVALID_REQUEST','숙소·항공·투어티켓 기본 분류는 순서만 바꿀 수 있어요.');
  end if;
 end loop;
 return proposed;
end;$$;
revoke all on function tripboogie_private.checked_booking_categories(jsonb,jsonb) from public,anon,authenticated;

-- Pinned producer edits fail closed on unexpected function definitions.
do $migration$
declare source text; needle text; replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
 needle:='tripboogie_private.normalize_booking_categories(p_payload->''bookingCategories'')';
 replacement:='tripboogie_private.checked_booking_categories(v_trip.settings,p_payload->''bookingCategories'')';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected dispatch category boundary';end if;
 execute replace(source,needle,replacement);
 source:=pg_get_functiondef('tripboogie_private.import_trip(jsonb)'::regprocedure);
 needle:='new_trip_id:=(result->''trip''->>''id'')::uuid;';
 replacement:=needle||$init$
  if p_payload->'trip'->'settings' ? 'bookingCategories' then
   update public.trips set settings=jsonb_set(settings,'{bookingCategories}',tripboogie_private.normalize_booking_categories(p_payload->'trip'->'settings'->'bookingCategories')) where id=new_trip_id;
  end if;$init$;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected import initialization boundary';end if;
 execute replace(source,needle,replacement);
end;$migration$;
