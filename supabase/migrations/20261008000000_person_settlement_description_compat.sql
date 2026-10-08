begin;
do $$
declare definition text;
begin
 if to_regprocedure('api.settle_person(uuid,uuid,uuid,text,bigint,date,uuid,text)') is null then
  select pg_get_functiondef('api.settle_person(uuid,uuid,uuid,text,bigint,date,uuid)'::regprocedure) into definition;
  definition:=replace(definition,'p_client_uuid uuid DEFAULT NULL::uuid)','p_client_uuid uuid, p_description text)');
  definition:=replace(definition,'''description'',''Acerto com '' || person.nickname','''description'',coalesce(nullif(trim(p_description),''''),''Acerto com '' || person.nickname)');
  execute definition;
 end if;
end;
$$;
revoke all on function api.settle_person(uuid,uuid,uuid,text,bigint,date,uuid,text) from public,anon,authenticated;
grant execute on function api.settle_person(uuid,uuid,uuid,text,bigint,date,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
