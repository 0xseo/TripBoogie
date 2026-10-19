-- Logical withdrawal retains travel content and blocks stale sessions.
alter table public.profiles add column if not exists withdrawn_at timestamptz;
create or replace function tripboogie_private.has_role(p_trip uuid,p_roles text[])
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.withdrawn_at is null)
 and exists(select 1 from public.trip_members m where m.trip_id=p_trip and m.user_id=(select auth.uid()) and m.role=any(p_roles));
$$;
revoke all on function tripboogie_private.has_role(uuid,text[]) from public,anon;
grant execute on function tripboogie_private.has_role(uuid,text[]) to authenticated;
-- The existing RPC dispatcher remains the owner of authorization.
do $migration$
declare source text; needle text; replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
 needle:='  if p_operation in (''profile'',''update-profile'') then';
 replacement:=$guard$
  if p_operation in ('withdraw-account','restore-account') then
    if p_payload->>'confirmation' is distinct from (case when p_operation='withdraw-account' then '탈퇴' else '복구' end) then
      perform tripboogie_private.fail(400,'INVALID_REQUEST','확인 문구를 입력하세요.');end if;
    perform tripboogie_private.sync_profile(v_uid);
    update public.profiles set withdrawn_at=case when p_operation='withdraw-account' then coalesce(withdrawn_at,clock_timestamp()) else null end,version=version+1 where id=v_uid;
    return jsonb_build_object('ok',true);
  end if;
  if exists(select 1 from public.profiles p where p.id=v_uid and p.withdrawn_at is not null) and p_operation<>'profile' then
    if p_operation='list' then return '[]'::jsonb;end if;
    perform tripboogie_private.fail(403,'ACCOUNT_WITHDRAWN','탈퇴한 계정입니다. 설정에서 복구해 주세요.');
  end if;
$guard$||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected account authorization boundary';end if;
 source:=replace(source,needle,replacement);
 needle:='''version'',p.version';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected profile presentation boundary';end if;
 source:=replace(source,needle,'''withdrawnAt'',p.withdrawn_at,''version'',p.version');
 execute source;
end;$migration$;
