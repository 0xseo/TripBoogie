alter table public.profiles add column map_height_scale numeric not null default 1 check(map_height_scale between 1 and 1.5);

-- Keep account ownership, withdrawal and optimistic version checks in the existing dispatcher.
do $migration$
declare source text; needle text; replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
 needle:='      update public.profiles set theme=';
 replacement:=$profile$
      if p_payload ? 'mapHeightScale' then
        if jsonb_typeof(p_payload->'mapHeightScale') is distinct from 'number' then
          perform tripboogie_private.fail(400,'INVALID_REQUEST','지도 높이를 확인하세요.');
        end if;
        if (p_payload->>'mapHeightScale')::numeric not between 1 and 1.5 then
          perform tripboogie_private.fail(400,'INVALID_REQUEST','지도 높이를 확인하세요.');
        end if;
      end if;
      update public.profiles set map_height_scale=case when p_payload ? 'mapHeightScale' then (p_payload->>'mapHeightScale')::numeric else map_height_scale end,theme=
$profile$;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected profile update boundary';end if;
 source:=replace(source,needle,replacement);
 needle:='''withdrawnAt'',p.withdrawn_at';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected profile presentation boundary';end if;
 source:=replace(source,needle,'''mapHeightScale'',p.map_height_scale,'||needle);
 execute source;
end;$migration$;
