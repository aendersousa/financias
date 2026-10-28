-- Documento Mestre 15.9; H is the half-open interval [p_on, p_horizon_end).
-- Read only: this helper neither posts money nor creates budget/reserve events.
begin;
create function private.essential_need(p_space uuid,p_on date,p_horizon_end date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  quotas jsonb; revised_quotas jsonb; benefits jsonb := '[]'::jsonb;
  quota jsonb; benefit record; balance bigint; available bigint; covered bigint;
  offset_amount bigint; gross_need bigint; net_need bigint; total_offset bigint := 0;
begin
  if p_on is null or p_horizon_end is null or not isfinite(p_on) or not isfinite(p_horizon_end) or p_horizon_end <= p_on then
    raise exception 'Essential projection requires a nonempty finite horizon' using errcode = '23514';
  end if;
  -- Use the same live conservative commitment estimate and monthly overrides
  -- as the budget screen. Closed report snapshots must not freeze projections.
  with recursive months as (
    select d::date as month,greatest(d::date,p_on) as begins_on,
      least((d+interval '1 month')::date,p_horizon_end) as ends_on,
      (d+interval '1 month')::date as following_month
    from generate_series(date_trunc('month',p_on),date_trunc('month',p_horizon_end-1),interval '1 month') d
  ), active as (
    select m.*,b.id as budget_id,b.category_id,b.created_at,c.name as category_name,
      (summary->>'amount_cents')::bigint as amount_cents,(summary->>'predicted_cents')::bigint as predicted_cents
    from months m cross join lateral jsonb_array_elements(private.budget_month_summary_live(p_space,m.month)) summary
    join finance.budgets b on b.id=(summary->>'id')::uuid and b.financial_space_id=p_space
    join finance.categories c on c.id=b.category_id and c.financial_space_id=p_space
    where (summary->>'is_essential')::boolean and b.budget_type='consumption'
  ), coverage(budget_id,month,category_id) as (
    select budget_id,month,category_id from active
    union all
    select r.budget_id,r.month,c.id from coverage r join finance.categories c on c.parent_id=r.category_id
      and c.financial_space_id=p_space and c.deleted_at is null
  ), spending as (
    select r.budget_id,r.month,
      coalesce(sum(e.amount_cents) filter(where e.occurred_on<p_on),0)::bigint as spent_before,
      coalesce(sum(e.amount_cents) filter(where e.occurred_on>=p_on),0)::bigint as spent_from_today
    from coverage r join finance.categories c on c.id=r.category_id and c.system_role is distinct from 'financial_charges'
    join finance.posted_ledger_entries e on e.ledger_account_id=c.ledger_account_id and e.financial_space_id=p_space
      and e.effective_competence_month=r.month and e.original_competence_month is null and e.reserve_id is null
    group by r.budget_id,r.month
  ), ancestry(budget_id,month,category_id,parent_id,benefit_account_id) as (
    select a.budget_id,a.month,c.id,c.parent_id,c.benefit_financial_account_id from active a join finance.categories c on c.id=a.category_id
    union all
    select a.budget_id,a.month,c.id,c.parent_id,c.benefit_financial_account_id from ancestry a
      join finance.categories c on c.id=a.parent_id and c.financial_space_id=p_space
  ), calculated as (
    select a.*,coalesce(s.spent_before,0) as spent_before,coalesce(s.spent_from_today,0) as spent_from_today,
      a.amount_cents-coalesce(s.spent_before,0)-a.predicted_cents as base_cents,
      ceil(greatest(0,a.amount_cents::numeric-coalesce(s.spent_before,0)-a.predicted_cents)
        * (a.ends_on-a.begins_on) / (a.following_month-a.begins_on))::bigint as quota_cents,
      coalesce((select jsonb_agg(distinct an.benefit_account_id order by an.benefit_account_id)
        from ancestry an where an.budget_id=a.budget_id and an.month=a.month and an.benefit_account_id is not null),'[]'::jsonb) as benefit_ids
    from active a left join spending s on s.budget_id=a.budget_id and s.month=a.month
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'budgetId',budget_id,'categoryId',category_id,'categoryName',category_name,'month',month,
    'amountCents',amount_cents,'daysInHorizon',ends_on-begins_on,'daysRemaining',following_month-begins_on,
    'spentBeforeCents',spent_before,'predictedCents',predicted_cents,'baseCents',base_cents,
    'quotaCents',quota_cents,'spentFromTodayCents',spent_from_today,
    'grossNeedCents',greatest(0,quota_cents-spent_from_today),'benefitOffsetCents',0,
    'needCents',greatest(0,quota_cents-spent_from_today),'benefitAccountIds',benefit_ids
  ) order by month,created_at,budget_id),'[]'::jsonb) into quotas from calculated;
  select coalesce(sum((q->>'grossNeedCents')::bigint),0)::bigint into gross_need from jsonb_array_elements(quotas) q;
  for benefit in
    select f.id,f.name,coalesce(sum(e.amount_cents),0)::bigint as ledger_balance
    from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id
      and a.financial_space_id=p_space and a.liquidity='benefit'
    left join finance.posted_ledger_entries e on e.ledger_account_id=a.id and e.financial_space_id=p_space and e.occurred_on<=p_on
    where f.financial_space_id=p_space and f.deleted_at is null
    group by f.id order by f.created_at,f.id
  loop
    balance:=greatest(0,benefit.ledger_balance); available:=balance;
    select coalesce(sum((q->>'needCents')::bigint),0)::bigint into covered
      from jsonb_array_elements(quotas) q where q->'benefitAccountIds' ? benefit.id::text;
    revised_quotas:='[]'::jsonb;
    -- The stable order also explains how much each budget still protects after
    -- a benefit that covers several categories is exhausted.
    for quota in select value from jsonb_array_elements(quotas) loop
      if quota->'benefitAccountIds' ? benefit.id::text then
        offset_amount:=least(available,(quota->>'needCents')::bigint);
        available:=available-offset_amount;
        quota:=quota||jsonb_build_object('needCents',(quota->>'needCents')::bigint-offset_amount,
          'benefitOffsetCents',(quota->>'benefitOffsetCents')::bigint+offset_amount);
      end if;
      revised_quotas:=revised_quotas||jsonb_build_array(quota);
    end loop;
    quotas:=revised_quotas; total_offset:=total_offset+balance-available;
    benefits:=benefits||jsonb_build_array(jsonb_build_object('accountId',benefit.id,'name',benefit.name,
      'ledgerBalanceCents',benefit.ledger_balance,'balanceCents',balance,'coveredNeedCents',covered,
      'offsetCents',balance-available,'freeCents',available));
  end loop;
  net_need:=gross_need-total_offset;
  return jsonb_build_object('essentialNeedCents',net_need,'grossNeedCents',gross_need,
    'benefits',benefits,'quotas',quotas);
end;
$$;
revoke all on function private.essential_need(uuid,date,date) from public,anon,authenticated;
commit;
