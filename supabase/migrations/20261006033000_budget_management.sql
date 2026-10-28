begin;
create function api.budget_management_summary(p_space uuid,p_month date) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
  if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 then raise exception 'Month must begin on day one' using errcode='23514'; end if;
  return jsonb_build_object('month',p_month,'budgets',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('category_name',c.name) order by c.name,b.effective_from_month) from finance.budgets b left join finance.categories c on c.id=b.category_id where b.financial_space_id=p_space),'[]'),'summary',api.budget_month_summary(p_space,p_month),'overrides',coalesce((select jsonb_agg(to_jsonb(o)) from finance.budget_month_overrides o where financial_space_id=p_space),'[]'));
end;
$$;
create function api.manage_budget(p_space uuid,p_budget uuid,p_version integer,p_action text,p_month date,p_amount_cents bigint default null,p_essential boolean default null) returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.budgets; result uuid;
begin
  perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into previous from finance.budgets where financial_space_id=p_space and id=p_budget for update;
  if not found then raise exception 'Budget not found' using errcode='P0002'; end if;
  if previous.version is distinct from p_version then raise exception 'Budget changed; reload before editing' using errcode='40001'; end if;
  if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 or p_month<previous.effective_from_month or previous.effective_until_month is not null and p_month>previous.effective_until_month then raise exception 'Month outside budget interval' using errcode='23514'; end if;
  if exists(select 1 from finance.period_closings where financial_space_id=p_space and reopened_at is null and month<=coalesce(previous.effective_until_month,month) and (p_action='month' and month=p_month or p_action='following' and month>=p_month or p_action='end' and month>p_month)) then raise exception 'Reopen affected closed months before changing the budget plan' using errcode='23514'; end if;
  if p_action in('month','following') and (p_amount_cents is null or p_amount_cents not between 0 and 9007199254740991) then raise exception 'Invalid budget amount' using errcode='23514'; end if;
  if p_action='month' then
    result:=api.set_budget_month_amount(p_space,p_budget,p_month,p_amount_cents);
    update finance.budgets set version=version+1,updated_at=now() where id=p_budget;
  elsif p_action='following' then
    if p_month=previous.effective_from_month then update finance.budgets set amount_cents=p_amount_cents,is_essential_override=p_essential,version=version+1,updated_at=now() where id=p_budget; result:=p_budget;
    else
      update finance.budgets set effective_until_month=(p_month-interval '1 month')::date,version=version+1,updated_at=now() where id=p_budget;
      insert into finance.budgets(financial_space_id,budget_type,category_id,amount_cents,effective_from_month,effective_until_month,is_essential_override,created_by) values(p_space,previous.budget_type,previous.category_id,p_amount_cents,p_month,previous.effective_until_month,p_essential,auth.uid()) returning id into result;
      update finance.budget_month_overrides set budget_id=result,updated_at=now() where budget_id=p_budget and month>=p_month;
    end if;
  elsif p_action='end' then update finance.budgets set effective_until_month=p_month,version=version+1,updated_at=now() where id=p_budget; result:=p_budget;
  else raise exception 'Invalid budget action' using errcode='23514'; end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'budget_plan_changed','budget',p_budget,to_jsonb(previous),jsonb_build_object('action',p_action,'month',p_month,'amount_cents',p_amount_cents,'essential',p_essential,'result_id',result));
  return result;
end;
$$;
revoke all on function api.budget_management_summary(uuid,date),api.manage_budget(uuid,uuid,integer,text,date,bigint,boolean) from public,anon,authenticated;
grant execute on function api.budget_management_summary(uuid,date),api.manage_budget(uuid,uuid,integer,text,date,bigint,boolean) to authenticated;
commit;
