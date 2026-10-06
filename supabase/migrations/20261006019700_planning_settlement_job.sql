begin;
-- Process payments whose future financial date has now arrived. Only the
-- backend scheduler may invoke this cross-user routine.
create function api.job_provision_settlements() returns jsonb language plpgsql security definer set search_path = '' as $$
declare space record; processed integer:=0; failed integer:=0; begin
  for space in select id from finance.financial_spaces where archived_at is null and exists(select 1 from finance.reserves where financial_space_id=finance.financial_spaces.id and reserve_type='provision' and status in('active','achieved')) order by id loop
    begin
      perform pg_advisory_xact_lock(hashtextextended(space.id::text,0));
      perform private.sync_provisions(space.id); processed:=processed+1;
    exception when check_violation then
      failed:=failed+1;
      insert into finance.audit_logs(financial_space_id,action,entity_type,entity_id,after_data) values(space.id,'job_requires_review','financial_space',space.id,jsonb_build_object('job','provision_settlements','error',sqlerrm));
    end;
  end loop;
  return jsonb_build_object('spaces_processed',processed,'requires_review',failed);
end;
$$;
do $$ declare definition text; begin
  definition:=pg_get_functiondef('api.close_month(uuid,date,boolean,jsonb)'::regprocedure);
  definition:=replace(definition,'photo := private.save_month_snapshot(p_space,p_month,''Fechamento mensal'');','perform private.sync_provisions(p_space);
  photo := private.save_month_snapshot(p_space,p_month,''Fechamento mensal'');');
  execute definition;
end $$;
revoke all on function api.job_provision_settlements() from public,anon,authenticated;
grant execute on function api.job_provision_settlements() to service_role;
commit;
