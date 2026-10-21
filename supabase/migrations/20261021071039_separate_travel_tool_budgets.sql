-- External providers have independent quotas. Keep the existing map budget
-- unchanged; weather/holidays/exchange rates must not spend its tokens.
create function tripboogie_private.tool_budget(p_service text)
returns jsonb language plpgsql set search_path='' as $$
declare uid uuid:=auth.uid(); instant timestamptz; global_key text; user_key text;
  global_row tripboogie_private.map_rate_limits%rowtype;
  user_row tripboogie_private.map_rate_limits%rowtype;
  label text;
begin
  if uid is null then perform tripboogie_private.fail(401,'UNAUTHENTICATED','로그인이 필요합니다.');end if;
  label:=case p_service when 'rate' then '환율' when 'weather' then '날씨' when 'holidays' then '공휴일' end;
  if label is null then perform tripboogie_private.fail(400,'INVALID_REQUEST','요청할 여행 정보를 확인하세요.');end if;
  global_key:='tool:'||p_service||':global';user_key:='tool:'||p_service||':'||uid::text;
  -- Always lock provider then account. No external network call holds a lock.
  insert into tripboogie_private.map_rate_limits(scope,window_at,requests) values(global_key,'2000-01-01',0) on conflict do nothing;
  select * into global_row from tripboogie_private.map_rate_limits where scope=global_key for update;
  instant:=clock_timestamp();
  if instant-global_row.window_at>=interval '1 second' then global_row.window_at:=instant;global_row.requests:=0;end if;
  if global_row.requests>=4 then perform tripboogie_private.fail(429,'RATE_LIMITED',label||' 조회 요청이 많아요. 잠시 후 다시 시도해 주세요.');end if;
  insert into tripboogie_private.map_rate_limits(scope,window_at,requests) values(user_key,instant,0) on conflict do nothing;
  select * into user_row from tripboogie_private.map_rate_limits where scope=user_key for update;
  if instant-user_row.window_at>=interval '1 minute' then user_row.window_at:=instant;user_row.requests:=0;end if;
  if user_row.requests>=30 then perform tripboogie_private.fail(429,'RATE_LIMITED',label||' 조회는 계정당 분당 30회까지 사용할 수 있어요. 잠시 후 다시 시도해 주세요.');end if;
  update tripboogie_private.map_rate_limits set window_at=global_row.window_at,requests=global_row.requests+1 where scope=global_key;
  update tripboogie_private.map_rate_limits set window_at=user_row.window_at,requests=user_row.requests+1 where scope=user_key;
  return jsonb_build_object('ok',true);
end;$$;
revoke all on function tripboogie_private.tool_budget(text) from public,anon,authenticated;

do $migration$
declare source text;needle text;replacement text;
begin
  source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
  needle:='if p_operation=''map-budget''  then return tripboogie_private.map_budget(); end if;';
  replacement:=needle||E'\n'||'  if p_operation=''tool-budget'' then return tripboogie_private.tool_budget(p_payload->>''service'');end if;';
  if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected travel tool authorization boundary';end if;
  execute replace(source,needle,replacement);
end;$migration$;
