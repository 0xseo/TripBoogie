-- File metadata stays on the existing protected table and workspace RPC.
alter table public.trip_files add column if not exists tags text[] not null default '{}' check(cardinality(tags)<=50);
alter table public.trip_files add column if not exists version bigint not null default 1 check(version>0);
create or replace function tripboogie_private.file_tags(p_settings jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(p_settings->'fileTags',(select jsonb_agg(jsonb_build_object('id',c.value->>'id','label',c.value->>'label') order by c.position) from jsonb_array_elements(tripboogie_private.booking_categories(p_settings)) with ordinality c(value,position)),'[]'::jsonb);
$$;
create or replace function tripboogie_private.normalize_file_tags(p_value jsonb,p_settings jsonb)
returns text[] language plpgsql immutable set search_path='' as $$
declare result text[]:='{}'; item jsonb; id text; catalog jsonb:=tripboogie_private.file_tags(p_settings);
begin
 if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value)>50 then perform tripboogie_private.fail(400,'INVALID_REQUEST','태그는 최대 50개까지 골라북.');end if;
 for item in select value from jsonb_array_elements(p_value) loop
   if jsonb_typeof(item)<>'string' then perform tripboogie_private.fail(400,'INVALID_REQUEST','태그를 확인해북.');end if;
   id:=item#>>'{}';
   if not exists(select 1 from jsonb_array_elements(catalog) c where c->>'id'=id) then perform tripboogie_private.fail(400,'INVALID_REQUEST','분류 설정에서 태그를 먼저 추가해북.');end if;
   if not(id=any(result)) then result:=array_append(result,id);end if;
 end loop;
 return result;
end;$$;
-- Existing reservation attachments gain their booking-category tag without changing content.
update public.trip_files f set tags=array[coalesce(nullif(r.data->>'category',''),r.data->>'type')]
 from public.trip_records r where r.id=f.booking_id and r.trip_id=f.trip_id and r.kind='booking' and not r.deleted and cardinality(f.tags)=0;

create or replace function tripboogie_private.file_operation(p_op text,p_trip public.trips,p_payload jsonb)
returns jsonb language plpgsql set search_path=''
as $$
declare f public.trip_files%rowtype; v_file_id uuid; booking uuid; mime text; name text; size bigint; object_size bigint; v_tags text[]; catalog jsonb; reservation_data jsonb; tag_id text; tag_label text;
begin
 if p_op='prepare-file' then
   name:=tripboogie_private.text_field(p_payload,'name',300);mime:=tripboogie_private.text_field(p_payload,'mime',150);
   if mime not in ('application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain') then
     perform tripboogie_private.fail(400,'INVALID_REQUEST','PDF·이미지·문서 파일을 선택하세요.');end if;
   size:=tripboogie_private.version_field(jsonb_build_object('version',p_payload->'size'));
   if size>6291456 then perform tripboogie_private.fail(413,'TOO_LARGE','파일은 6 MiB 이하로 올려 주세요.');end if;
   if p_payload ? 'bookingId' and p_payload->>'bookingId'<>'' then
     booking:=tripboogie_private.uuid_field(p_payload,'bookingId');
     if not exists(select 1 from public.trip_records r where r.trip_id=p_trip.id and r.id=booking and r.kind='booking' and not r.deleted) then perform tripboogie_private.fail(404,'NOT_FOUND','예약을 찾을 수 없습니다.');end if;
   end if;
   catalog:=tripboogie_private.file_tags(p_trip.settings);
   if booking is not null then
     select r.data into reservation_data from public.trip_records r where r.id=booking and r.trip_id=p_trip.id and r.kind='booking' and not r.deleted;
     tag_id:=coalesce(nullif(reservation_data->>'category',''),reservation_data->>'type');
     if not exists(select 1 from jsonb_array_elements(catalog) c where c->>'id'=tag_id) then
       select c->>'label' into tag_label from jsonb_array_elements(tripboogie_private.booking_categories(p_trip.settings)) c where c->>'id'=tag_id;
       catalog:=tripboogie_private.normalize_categories(catalog||jsonb_build_array(jsonb_build_object('id',tag_id,'label',coalesce(tag_label,'예약'))));
       update public.trips set settings=jsonb_set(settings,'{fileTags}',catalog) where id=p_trip.id;
     end if;
   end if;
   v_tags:=tripboogie_private.normalize_file_tags(coalesce(p_payload->'tags','[]'::jsonb),jsonb_build_object('fileTags',catalog));
   if booking is not null and not(tag_id=any(v_tags)) then v_tags:=array_append(v_tags,tag_id);end if;
   if (select count(*) from public.trip_files x where x.trip_id=p_trip.id)>=200 or
     (select coalesce(sum(x.size),0) from public.trip_files x where x.trip_id=p_trip.id)+size>104857600 then
     perform tripboogie_private.fail(409,'CAPACITY','여행당 첨부는 200개·100 MiB까지 보관할 수 있습니다.');end if;
   v_file_id:=gen_random_uuid();
   insert into public.trip_files(id,trip_id,booking_id,path,name,mime,size,uploaded_by,tags) values(v_file_id,p_trip.id,booking,p_trip.id::text||'/'||v_file_id::text,name,mime,size,auth.uid(),v_tags) returning * into f;
 else
   select * into f from public.trip_files x where x.id=tripboogie_private.uuid_field(p_payload,'id') and x.trip_id=p_trip.id for update;
   if not found then perform tripboogie_private.fail(404,'NOT_FOUND','첨부파일을 찾을 수 없습니다.');end if;
   if p_op='set-file-tags' then
     if f.status='deleting' then perform tripboogie_private.fail(409,'CONFLICT','삭제 중인 파일입니다.');end if;
     if f.version<>tripboogie_private.version_field(p_payload) then perform tripboogie_private.fail(409,'CONFLICT','자료가 변경됐어북. 다시 열어북.');end if;
     v_tags:=tripboogie_private.normalize_file_tags(p_payload->'tags',p_trip.settings);
     if f.tags=v_tags then return jsonb_build_object('file',to_jsonb(f),'workspace',tripboogie_private.workspace(p_trip.id));end if;
     update public.trip_files set tags=v_tags,version=trip_files.version+1 where trip_files.id=f.id returning * into f;
   elsif p_op='finish-file' then
     if f.status='deleting' then perform tripboogie_private.fail(409,'CONFLICT','삭제 중인 파일입니다.');end if;
     select (o.metadata->>'size')::bigint into object_size from storage.objects o where o.bucket_id='tripboogie-private' and o.name=f.path;
     if object_size is null or object_size<>f.size then perform tripboogie_private.fail(409,'CONFLICT','파일 업로드가 완료되지 않았습니다. 업로드를 다시 확인하세요.');end if;
     update public.trip_files set status='ready' where trip_files.id=f.id returning * into f;
   elsif p_op='mark-file-delete' then
     update public.trip_files set status='deleting' where trip_files.id=f.id returning * into f;
   elsif p_op='finish-file-delete' then
     if f.status<>'deleting' or exists(select 1 from storage.objects o where o.bucket_id='tripboogie-private' and o.name=f.path) then
       perform tripboogie_private.fail(409,'CONFLICT','파일 삭제를 완료한 뒤 다시 시도하세요.');end if;
     delete from public.trip_files where trip_files.id=f.id;
   else perform tripboogie_private.fail(400,'INVALID_REQUEST','지원하지 않는 첨부 작업입니다.');end if;
 end if;
 update public.trips set revision=revision+1,updated_at=now() where trips.id=p_trip.id;
 return jsonb_build_object('file',to_jsonb(f),'workspace',tripboogie_private.workspace(p_trip.id));
end;
$$;

revoke all on function tripboogie_private.file_tags(jsonb),tripboogie_private.normalize_file_tags(jsonb,jsonb),tripboogie_private.file_operation(text,public.trips,jsonb) from public,anon,authenticated;
-- Extend the canonical authorization/settings producers, preserving account guards.
do $migration$
declare source text; needle text; replacement text;
begin
 source:=pg_get_functiondef('tripboogie_private.dispatch(text,uuid,jsonb)'::regprocedure);
 needle:='(''prepare-file'',''finish-file'',''mark-file-delete'',''finish-file-delete'')';
 replacement:='(''prepare-file'',''finish-file'',''mark-file-delete'',''finish-file-delete'',''set-file-tags'')';
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected file authorization boundary';end if;
 source:=replace(source,needle,replacement);
 needle:='    if p_payload ? ''expenseCategories'' then';
 replacement:=$tags$
    if p_payload ? 'fileTags' then
      v_data:=jsonb_set(v_data,'{fileTags}',tripboogie_private.normalize_categories(p_payload->'fileTags'));
      if exists(select 1 from public.trip_files f,unnest(f.tags) tag where f.trip_id=v_trip.id and not exists(select 1 from jsonb_array_elements(v_data->'fileTags') c where c->>'id'=tag)) then
        perform tripboogie_private.fail(409,'CONFLICT','사용 중인 태그는 이름을 바꾸거나 자료에서 먼저 해제해북.');end if;
    end if;
$tags$||needle;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected tag settings boundary';end if;
 execute replace(source,needle,replacement);
 source:=pg_get_functiondef('tripboogie_private.import_trip(jsonb)'::regprocedure);
 needle:='new_trip_id:=(result->''trip''->>''id'')::uuid;';
 replacement:=needle||$tags$
  if p_payload->'trip'->'settings' ? 'fileTags' then
    update public.trips set settings=jsonb_set(settings,'{fileTags}',tripboogie_private.normalize_categories(p_payload->'trip'->'settings'->'fileTags')) where id=new_trip_id;
  end if;
$tags$;
 if (length(source)-length(replace(source,needle,'')))/length(needle)<>1 then raise exception 'Unexpected tag import boundary';end if;
 execute replace(source,needle,replacement);
end;$migration$;
