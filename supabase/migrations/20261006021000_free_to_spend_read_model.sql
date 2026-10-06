begin;
-- W_P / T_P is derived from the current consumption history. Refunds and edits
-- change the running budget use; no essential fraction is stored on a purchase.
create function private.essential_purchase_fraction(p_space uuid,p_transaction uuid,p_on date,p_horizon date) returns jsonb
language sql stable set search_path='' as $$
with recursive purchase as (
  select * from finance.ledger_transactions where id=p_transaction and financial_space_id=p_space and status='posted'
), active as (
  select b.id,b.category_id,coalesce(o.amount_cents,b.amount_cents) as amount
  from purchase p join finance.budgets b on b.financial_space_id=p_space and b.budget_type='consumption'
    and b.effective_from_month<=p.competence_month and (b.effective_until_month is null or b.effective_until_month>=p.competence_month)
  join finance.categories c on c.id=b.category_id
  left join finance.budget_month_overrides o on o.budget_id=b.id and o.month=p.competence_month
  where coalesce(b.is_essential_override,c.is_essential) and p.competence_month>=date_trunc('month',p_on)::date
    and p.competence_month<=date_trunc('month',p_horizon-1)::date
), coverage(budget_id,category_id) as (
  select id,category_id from active union all select r.budget_id,c.id from coverage r join finance.categories c on c.parent_id=r.category_id and c.financial_space_id=p_space and c.deleted_at is null
), consumed as (
  select r.budget_id,
    coalesce(sum(e.amount_cents) filter(where (t.occurred_on,t.registration_order)<(p.occurred_on,p.registration_order)),0)::bigint as before_cents,
    coalesce(sum(e.amount_cents) filter(where t.id=p.id),0)::bigint as purchase_cents
  from purchase p cross join coverage r join finance.categories c on c.id=r.category_id and c.system_role is distinct from 'financial_charges'
  join finance.ledger_entries e on e.ledger_account_id=c.ledger_account_id and e.financial_space_id=p_space and e.reserve_id is null and e.original_competence_month is null
  join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' and coalesce(e.competence_month,t.competence_month)=p.competence_month
  group by r.budget_id
), weights as (
  select coalesce(sum(least(greatest(0,c.purchase_cents),greatest(0,a.amount-c.before_cents))),0)::bigint as covered from active a join consumed c on c.budget_id=a.id
), total as (
  select coalesce(-sum(e.amount_cents),0)::bigint as amount from finance.ledger_entries e where e.ledger_transaction_id=p_transaction and e.card_statement_id is not null and e.amount_cents<0
)
select jsonb_build_object('covered',least(w.covered,t.amount),'total',t.amount) from weights w cross join total t;
$$;

create function api.free_to_spend_input(p_space uuid,p_on date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  day date:=coalesce(p_on,private.space_today(p_space)); cycle_day integer; safety bigint; cash bigint; horizon date; month_start date;
  commitments jsonb; people jsonb; reserves jsonb; scheduled jsonb:='[]'; statements jsonb:='[]'; essentials jsonb;
  movement record; entry record; statement record; purchase_part record; linked record;
  weights bigint[]; allocations bigint[]; reserve_ids uuid[]; index integer; linked_parts jsonb; fraction jsonb;
  remaining bigint; first_parts bigint; essential_parts bigint; weighted_part bigint; counted bigint; net_part bigint; charge_estimate bigint; rollover bigint;
  last_event_day date; future_events jsonb; status text; whole boolean;
begin
  if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
  if not isfinite(day) then raise exception 'Projection date must be finite' using errcode='23514'; end if;
  select fallback_cycle_day,minimum_safety_reserve_cents into cycle_day,safety from finance.space_settings where financial_space_id=p_space;
  select coalesce(sum(e.amount_cents),0)::bigint into cash from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' and t.occurred_on<=day
    join finance.ledger_accounts a on a.id=e.ledger_account_id and a.liquidity='cash' where e.financial_space_id=p_space;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'label',c.title,'direction',c.direction,'certainty',c.certainty,'effectiveDueOn',c.effective_due_on,
    'dueCents',c.due_amount_cents,'paidCents',s.paid_cents,'paymentLiquidity',case when c.payment_method='card' then 'card' when a.liquidity in('cash','benefit','investment') then a.liquidity else 'investment' end,
    'mainIncome',coalesce(r.is_main_income and r.archived_at is null,false),'cancelled',c.cancelled_at is not null,'reserveId',c.reserve_id,
    'actualHistoryCents',coalesce(history.amounts,'[]')) order by c.effective_due_on,c.created_at,c.id),'[]') into commitments
  from finance.commitments c join finance.commitment_settlements s on s.id=c.id
  left join finance.recurrence_rules r on r.id=c.recurrence_rule_id
  left join finance.financial_accounts f on f.id=c.payment_financial_account_id left join finance.ledger_accounts a on a.id=f.ledger_account_id
  left join lateral (
    select jsonb_agg(h.paid_cents order by h.period_key desc) as amounts from (
      select past.paid_cents,pc.period_key from finance.commitments pc join finance.commitment_settlements past on past.id=pc.id
      where c.recurrence_rule_id is not null and pc.recurrence_rule_id=c.recurrence_rule_id and pc.period_key<c.period_key and past.settlement_status='settled'
        and (select max(t.occurred_on) from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' where e.commitment_id=pc.id)<=day
      order by pc.period_key desc limit 3
    ) h
  ) history on true
  where c.financial_space_id=p_space and c.deleted_at is null and c.kind<>'reminder';
  select min((c->>'effectiveDueOn')::date) into horizon from jsonb_array_elements(commitments) c
    where (c->>'mainIncome')::boolean and not (c->>'cancelled')::boolean and c->>'direction'='inflow' and c->>'paymentLiquidity'='cash'
      and (c->>'effectiveDueOn')::date>day and (c->>'paidCents')::bigint<(c->>'dueCents')::bigint;
  if horizon is null then
    month_start:=date_trunc('month',day)::date; horizon:=private.clamped_day(month_start,cycle_day);
    if horizon<=day then horizon:=private.clamped_day((month_start+interval '1 month')::date,cycle_day); end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'label',p.nickname,'balanceCents',private.account_balance_on(p_space,p.ledger_account_id,day),
    'openReminderDates',coalesce((select jsonb_agg(c.effective_due_on order by c.effective_due_on,c.id) from finance.commitments c where c.person_id=p.id and c.kind='reminder' and c.deleted_at is null and c.cancelled_at is null and c.completed_at is null),'[]')) order by p.created_at,p.id),'[]') into people
    from finance.people p where p.financial_space_id=p_space and p.deleted_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'label',r.name,'holdingMode',r.holding_mode,'balanceCents',(private.reserve_balance(p_space,r.id,day)->>'balance_cents')::bigint,
    'active',(r.terminal_on is null or r.terminal_on>day)) order by r.created_at,r.id),'[]') into reserves from finance.reserves r where r.financial_space_id=p_space and r.archived_at is null;
  for movement in
    select t.id,t.occurred_on,t.description,coalesce(sum(e.amount_cents),0)::bigint as net from finance.ledger_transactions t
      join finance.ledger_entries e on e.ledger_transaction_id=t.id join finance.ledger_accounts a on a.id=e.ledger_account_id and a.liquidity='cash'
      where t.financial_space_id=p_space and t.status='posted' and t.occurred_on>day and t.occurred_on<horizon group by t.id order by t.occurred_on,t.registration_order
  loop
    if movement.net=0 then continue; end if;
    linked_parts:='[]';
    if movement.net<0 then
      select array_agg(e.amount_cents order by e.line_number),array_agg(e.reserve_id order by e.line_number) into weights,reserve_ids
        from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id where e.ledger_transaction_id=movement.id and e.amount_cents>0 and a.liquidity is distinct from 'cash';
      if weights is not null then
        allocations:=private.divide_cents(-movement.net,weights);
        for index in 1..array_length(weights,1) loop
          if reserve_ids[index] is not null and allocations[index]>0 then linked_parts:=linked_parts||jsonb_build_array(jsonb_build_object('reserveId',reserve_ids[index],'amountCents',allocations[index])); end if;
        end loop;
      end if;
    end if;
    scheduled:=scheduled||jsonb_build_array(jsonb_build_object('id',movement.id,'label',movement.description,'occurredOn',movement.occurred_on,'netCashCents',movement.net,'reservedOutflows',linked_parts));
  end loop;
  select greatest(day,coalesce(max(period_end),day)) into last_event_day from finance.card_statements where financial_space_id=p_space;
  select coalesce(jsonb_agg(jsonb_build_object('statementId',e.card_statement_id,'reserveId',r.id,'entryId',events.event_id,'on',events.occurred_on,'amountCents',events.amount_cents)),'[]') into future_events
    from finance.reserves r cross join lateral private.reserve_ledger_events(p_space,r.id,last_event_day) events join finance.ledger_entries e on e.id=events.event_id
    where r.financial_space_id=p_space and r.holding_mode='virtual' and r.archived_at is null and (r.terminal_on is null or r.terminal_on>day)
      and events.event_kind='consume' and events.occurred_on>day and e.card_statement_id is not null;
  for statement in select s.*,c.name,c.revolving_interest_monthly_percent,c.late_fee_percent,c.late_interest_monthly_percent from finance.card_statements s join finance.credit_cards c on c.id=s.credit_card_id where s.financial_space_id=p_space order by s.period_start,s.id loop
    status:=case when day<statement.period_start then 'future' when day<=statement.period_end then 'open' else 'closed' end;
    whole:=status<>'future' or statement.effective_due_on<horizon;
    select greatest(0,coalesce(-sum(e.amount_cents),0))::bigint into remaining from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' where e.card_statement_id=statement.id;
    first_parts:=0; essential_parts:=0;
    for purchase_part in select e.*,t.competence_month,t.id as purchase_id,
      coalesce(e.installment_number,case when e.line_number=(select min(first.line_number) from finance.ledger_entries first where first.ledger_transaction_id=t.id and first.card_statement_id is not null and first.amount_cents<0) then 1 else 2 end) as installment
      from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' and t.kind='card_purchase' where e.card_statement_id=statement.id and e.amount_cents<0
    loop
      select greatest(0,-purchase_part.amount_cents-coalesce(sum(e.amount_cents),0))::bigint into net_part from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id=t.id
        where t.related_transaction_id=purchase_part.purchase_id and t.status='posted' and t.kind in('refund','card_prepayment') and e.card_statement_id=statement.id;
      if purchase_part.installment=1 then first_parts:=first_parts+net_part;
      else
        fraction:=private.essential_purchase_fraction(p_space,purchase_part.purchase_id,day,horizon);
        if (fraction->>'total')::bigint>0 then essential_parts:=essential_parts+ceil(net_part::numeric*(fraction->>'covered')::bigint/(fraction->>'total')::bigint)::bigint; end if;
      end if;
    end loop;
    counted:=case when whole then remaining else least(remaining,first_parts+essential_parts) end;
    linked_parts:='[]'; weights:='{}'; reserve_ids:='{}';
    for linked in select (event->>'reserveId')::uuid as reserve_id,min((event->>'on')::date) as consumes_on,sum((event->>'amountCents')::bigint)::bigint as amount
      from jsonb_array_elements(future_events) event join finance.ledger_entries e on e.id=(event->>'entryId')::uuid
      where event->>'statementId'=statement.id::text and (whole or coalesce(e.installment_number,case when e.line_number=(select min(first.line_number) from finance.ledger_entries first where first.ledger_transaction_id=e.ledger_transaction_id and first.card_statement_id is not null and first.amount_cents<0) then 1 else 2 end)=1)
      group by event->>'reserveId' order by min((event->>'on')::date),event->>'reserveId'
    loop weights:=array_append(weights,linked.amount); reserve_ids:=array_append(reserve_ids,linked.reserve_id); end loop;
    if coalesce(array_length(weights,1),0)>0 then
      allocations:=private.divide_cents(least(counted,(select sum(x)::bigint from unnest(weights) x)),weights);
      for index in 1..array_length(weights,1) loop if allocations[index]>0 then linked_parts:=linked_parts||jsonb_build_array(jsonb_build_object('reserveId',reserve_ids[index],'amountCents',allocations[index],'occurredOn',statement.period_start)); end if; end loop;
    end if;
    charge_estimate:=0;
    if statement.charges_to_confirm and statement.revolving_interest_monthly_percent is not null then
      select coalesce(-sum(e.amount_cents),0)::bigint into rollover from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' and t.kind='card_rollover' and t.occurred_on<=day where e.card_statement_id=statement.id and e.amount_cents<0;
      charge_estimate:=ceil(greatest(0,rollover)::numeric*(statement.revolving_interest_monthly_percent+statement.late_fee_percent+statement.late_interest_monthly_percent)/100)::bigint;
    end if;
    statements:=statements||jsonb_build_array(jsonb_build_object('id',statement.id,'label',statement.name||' '||to_char(statement.reference_month,'MM/YYYY'),'status',status,'effectiveDueOn',statement.effective_due_on,
      'remainingIncludingScheduledCents',remaining,'firstInstallmentCents',first_parts,'essentialFractionCents',essential_parts,'estimatedChargesCents',charge_estimate,'chargesToConfirm',statement.charges_to_confirm,'reservedUnconsumed',linked_parts));
  end loop;
  essentials:=private.essential_need(p_space,day,horizon);
  return jsonb_build_object('today',day,'fallbackCycleDay',cycle_day,'cashBalanceCents',cash,'safetyReserveCents',safety,
    'commitments',commitments,'statements',statements,'people',people,'reserves',reserves,'scheduled',scheduled,'essentialNeedCents',(essentials->>'essentialNeedCents')::bigint,
    'horizonEnd',horizon,'essentialDetails',essentials);
end;
$$;
revoke all on function private.essential_purchase_fraction(uuid,uuid,date,date),api.free_to_spend_input(uuid,date) from public,anon,authenticated;
grant execute on function api.free_to_spend_input(uuid,date) to authenticated;
commit;
