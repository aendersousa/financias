begin;
create function private.validate_budget() returns trigger language plpgsql security definer set search_path = '' as $$
declare category finance.categories; essential boolean; begin
  perform pg_advisory_xact_lock(hashtextextended(new.financial_space_id::text,0));
  if new.budget_type = 'consumption' then
    select * into category from finance.categories where id = new.category_id and financial_space_id = new.financial_space_id;
    if not found or category.kind <> 'expense' or category.archived_at is not null or category.deleted_at is not null or category.system_role = 'financial_charges' then
      raise exception 'Budget requires an active consumption category' using errcode = '23514';
    end if;
  end if;
  if exists(select 1 from finance.budgets b where b.financial_space_id = new.financial_space_id and b.id <> new.id
    and b.budget_type = new.budget_type and b.category_id is not distinct from new.category_id
    and daterange(b.effective_from_month,(b.effective_until_month + interval '1 month')::date,'[)') && daterange(new.effective_from_month,(new.effective_until_month + interval '1 month')::date,'[)')) then
    raise exception 'Budget intervals overlap for the same category' using errcode = '23514';
  end if;
  essential := coalesce(new.is_essential_override,category.is_essential,false);
  if new.budget_type = 'consumption' and essential and exists(
    with recursive relatives(id,parent_id) as (
      select c.id,c.parent_id from finance.categories c where c.id = new.category_id
      union all select c.id,c.parent_id from finance.categories c join relatives r on c.id = r.parent_id
    ), descendants(id) as (
      select new.category_id union all select c.id from finance.categories c join descendants d on c.parent_id = d.id
    )
    select 1 from finance.budgets b join finance.categories c on c.id = b.category_id
    where b.financial_space_id = new.financial_space_id and b.id <> new.id and b.budget_type = 'consumption'
      and coalesce(b.is_essential_override,c.is_essential) and (b.category_id in(select id from relatives) or b.category_id in(select id from descendants))
      and daterange(b.effective_from_month,(b.effective_until_month + interval '1 month')::date,'[)') && daterange(new.effective_from_month,(new.effective_until_month + interval '1 month')::date,'[)')
  ) then raise exception 'Essential budgets cannot cover overlapping categories' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger budget_valid before insert or update on finance.budgets for each row execute function private.validate_budget();
create function api.create_budget(p_space uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; begin
  perform private.require_writer(p_space);
  insert into finance.budgets(financial_space_id,budget_type,category_id,amount_cents,effective_from_month,effective_until_month,is_essential_override,created_by)
    values(p_space,coalesce(p_payload->>'budget_type','consumption'),(p_payload->>'category_id')::uuid,(p_payload->>'amount_cents')::bigint,(p_payload->>'effective_from_month')::date,
      (p_payload->>'effective_until_month')::date,(p_payload->>'is_essential_override')::boolean,auth.uid()) returning id into result;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','budget',result,p_payload);
  return result;
end;
$$;
create function api.set_budget_month_amount(p_space uuid,p_budget uuid,p_month date,p_amount_cents bigint) returns uuid language plpgsql security definer set search_path = '' as $$
declare budget finance.budgets; result uuid; previous jsonb; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into budget from finance.budgets where financial_space_id = p_space and id = p_budget for update;
  if not found then raise exception 'Budget not found' using errcode = 'P0002'; end if;
  if p_month < budget.effective_from_month or p_month > budget.effective_until_month then raise exception 'Month outside budget interval' using errcode = '23514'; end if;
  if exists(select 1 from finance.period_closings where financial_space_id = p_space and month = p_month and reopened_at is null) then
    raise exception 'Financial period is closed' using errcode = '23514';
  end if;
  select to_jsonb(o) into previous from finance.budget_month_overrides o where budget_id = p_budget and month = p_month;
  insert into finance.budget_month_overrides(financial_space_id,budget_id,month,amount_cents,created_by) values(p_space,p_budget,p_month,p_amount_cents,auth.uid())
    on conflict(budget_id,month) do update set amount_cents = excluded.amount_cents,updated_at = now() returning id into result;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'updated','budget_month_override',result,previous,jsonb_build_object('amount_cents',p_amount_cents,'month',p_month));
  return result;
end;
$$;
create function api.budget_month_summary(p_space uuid,p_month date) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode = '42501'; end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Month must begin on day one' using errcode = '23514'; end if;
  with recursive active as (
    select b.*,coalesce(o.amount_cents,b.amount_cents) as effective_amount from finance.budgets b left join finance.budget_month_overrides o on o.budget_id = b.id and o.month = p_month
    where b.financial_space_id = p_space and b.budget_type = 'consumption' and b.effective_from_month <= p_month and (b.effective_until_month is null or b.effective_until_month >= p_month)
  ), coverage(budget_id,category_id) as (
    select id,category_id from active union all select r.budget_id,c.id from finance.categories c join coverage r on c.parent_id = r.category_id where c.deleted_at is null
  ), consumed as (
    select r.budget_id,sum(e.amount_cents) as amount from coverage r join finance.categories c on c.id = r.category_id
    join finance.posted_ledger_entries e on e.ledger_account_id = c.ledger_account_id and e.financial_space_id = p_space
    where e.effective_competence_month = p_month and e.original_competence_month is null and e.reserve_id is null group by r.budget_id
  ), predicted as (
    select r.budget_id,sum(greatest(0,case when s.certainty = 'estimated' then greatest(s.due_amount_cents,coalesce(history.amount,s.due_amount_cents)) else s.due_amount_cents end - s.paid_cents)) as amount
    from coverage r join finance.commitments c on c.category_id = r.category_id join finance.commitment_settlements s on s.id = c.id
    left join lateral (
      select round(avg(h.actual_amount))::bigint as amount from (
        select past.paid_cents as actual_amount from finance.commitment_settlements past join finance.commitments pc on pc.id = past.id
        where c.recurrence_rule_id is not null and pc.recurrence_rule_id = c.recurrence_rule_id and pc.period_key < c.period_key and past.settlement_status = 'settled'
        order by pc.period_key desc limit 3
      ) h
    ) history on true
    where c.financial_space_id = p_space and c.competence_month = p_month and c.direction = 'outflow' and c.reserve_id is null and s.settlement_status in('pending','partial') group by r.budget_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'category_id',b.category_id,'month',p_month,'amount_cents',b.effective_amount,'consumed_cents',coalesce(c.amount,0),
    'predicted_cents',coalesce(p.amount,0),'remaining_cents',b.effective_amount-coalesce(c.amount,0)-coalesce(p.amount,0),'is_essential',coalesce(b.is_essential_override,category.is_essential)) order by b.id),'[]'::jsonb)
  into result from active b join finance.categories category on category.id = b.category_id left join consumed c on c.budget_id = b.id left join predicted p on p.budget_id = b.id;
  return result;
end;
$$;
revoke all on function private.validate_budget() from public,anon,authenticated;
revoke all on function api.create_budget(uuid,jsonb),api.set_budget_month_amount(uuid,uuid,date,bigint),api.budget_month_summary(uuid,date) from public,anon,authenticated;
grant execute on function api.create_budget(uuid,jsonb),api.set_budget_month_amount(uuid,uuid,date,bigint),api.budget_month_summary(uuid,date) to authenticated;
commit;
