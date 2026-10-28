begin;
alter table finance.space_settings add column version integer not null default 1;
create function api.planning_settings(p_space uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
  return (select to_jsonb(s) from finance.space_settings s where financial_space_id=p_space)||jsonb_build_object('categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'version',version,'benefit_financial_account_id',benefit_financial_account_id) order by name) from finance.categories where financial_space_id=p_space and kind='expense' and archived_at is null and deleted_at is null),'[]'));
end;
$$;
create function api.update_planning_settings(p_space uuid,p_version integer,p_safety_cents bigint,p_cycle_day integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings finance.space_settings; result jsonb; begin
  perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into settings from finance.space_settings where financial_space_id=p_space for update;
  if settings.version is distinct from p_version then raise exception 'Planning settings changed; reload before editing' using errcode='40001'; end if;
  if p_safety_cents is null or p_safety_cents not between 0 and 9007199254740991 or p_cycle_day is null or p_cycle_day not between 1 and 31 then raise exception 'Invalid safety reserve or cycle day' using errcode='23514'; end if;
  update finance.space_settings set minimum_safety_reserve_cents=p_safety_cents,fallback_cycle_day=p_cycle_day,version=version+1 where financial_space_id=p_space returning to_jsonb(space_settings) into result;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'planning_settings_changed','financial_space',p_space,to_jsonb(settings),result);
  return result;
end;
$$;
create function api.set_category_benefit(p_space uuid,p_category uuid,p_version integer,p_benefit uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare category finance.categories; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into category from finance.categories where id=p_category and financial_space_id=p_space and archived_at is null and deleted_at is null for update;
  if not found or category.kind<>'expense' then raise exception 'Active expense category required' using errcode='23514'; end if;
  if category.version is distinct from p_version then raise exception 'Category changed; reload before editing' using errcode='40001'; end if;
  if p_benefit is not null and not exists(select 1 from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id where f.id=p_benefit and f.financial_space_id=p_space and f.archived_at is null and f.deleted_at is null and a.liquidity='benefit') then raise exception 'Active benefit account in the same space required' using errcode='23514'; end if;
  update finance.categories set benefit_financial_account_id=p_benefit,version=version+1,updated_at=now() where id=p_category;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'benefit_category_changed','category',p_category,to_jsonb(category),jsonb_build_object('benefit',p_benefit));
  return p_category;
end;
$$;
revoke all on function api.planning_settings(uuid),api.update_planning_settings(uuid,integer,bigint,integer),api.set_category_benefit(uuid,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function api.planning_settings(uuid),api.update_planning_settings(uuid,integer,bigint,integer),api.set_category_benefit(uuid,uuid,integer,uuid) to authenticated;
commit;
