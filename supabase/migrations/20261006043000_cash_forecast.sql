begin;

-- Section 16 projects cash only. Recurrences beyond the materialized Agenda
-- are read from their immutable versions; no occurrence or statement is created.
create function private.forecast_end(p_on date,p_horizon text,p_until date default null) returns date
language plpgsql immutable set search_path='' as $$
declare result date;
begin
  if p_on is null or not isfinite(p_on) then raise exception 'Finite forecast date required' using errcode='23514'; end if;
  case p_horizon
    when 'month' then
      result:=(date_trunc('month',p_on)+interval '1 month - 1 day')::date;
      if result=p_on then result:=(date_trunc('month',p_on)+interval '2 months - 1 day')::date; end if;
    when '30_days' then result:=p_on+29;
    when '90_days' then result:=p_on+89;
    when '6_months' then result:=(p_on+interval '6 months')::date-1;
    when 'custom' then result:=p_until;
    else raise exception 'Invalid forecast horizon' using errcode='23514';
  end case;
  if result is null or not isfinite(result) or result<p_on or result>(p_on+interval '24 months')::date then
    raise exception 'Forecast date must be within the next 24 months' using errcode='23514';
  end if;
  return result;
end;
$$;

create function private.forecast_card_due(p_space uuid,p_card uuid,p_purchase_on date) returns jsonb
language plpgsql stable set search_path='' as $$
declare card finance.credit_cards; statement finance.card_statements; close_month date; closing date; due date;
begin
  select * into card from finance.credit_cards where financial_space_id=p_space and id=p_card;
  if not found then raise exception 'Forecast card unavailable' using errcode='23514'; end if;
  select * into statement from finance.card_statements where financial_space_id=p_space and credit_card_id=p_card
    and p_purchase_on between period_start and period_end order by case status when 'open' then 0 when 'future' then 1 else 2 end,closing_on,id limit 1;
  if found then return jsonb_build_object('id',statement.id,'on',statement.effective_due_on,'label',card.name||' '||to_char(statement.reference_month,'MM/YYYY')); end if;
  close_month:=date_trunc('month',p_purchase_on)::date;
  closing:=private.clamped_day(close_month,card.closing_day);
  if p_purchase_on>closing or (p_purchase_on=closing and card.closing_day_purchase_goes_next) then close_month:=(close_month+interval '1 month')::date; end if;
  closing:=private.clamped_day(close_month,card.closing_day);
  due:=private.clamped_day(close_month,card.due_day);
  if due<=closing then due:=private.clamped_day((close_month+interval '1 month')::date,card.due_day); end if;
  select * into statement from finance.card_statements where financial_space_id=p_space and credit_card_id=p_card and reference_month=date_trunc('month',due)::date;
  if found then return jsonb_build_object('id',statement.id,'on',statement.effective_due_on,'label',card.name||' '||to_char(statement.reference_month,'MM/YYYY')); end if;
  return jsonb_build_object('id',p_card::text||':'||to_char(due,'YYYY-MM'),'on',private.effective_due_date(p_space,due),'label',card.name||' '||to_char(due,'MM/YYYY'));
end;
$$;

create function api.cash_forecast(p_space uuid,p_horizon text default 'month',p_until date default null,p_on date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  today date:=coalesce(p_on,private.space_today(p_space)); until_on date;
  base jsonb; items jsonb:='[]'; commitments jsonb; item jsonb; card_due jsonb;
  rule finance.recurrence_rules; rule_version finance.recurrence_rule_versions;
  period date; nominal date; effective date; distance integer; payment_liquidity text; history jsonb; rule_next_income date; marker_until date;
  on_date date; conservative bigint; expected bigint; amount bigint; remaining bigint; scheduled_settlement bigint;
  movement record; reference record; series jsonb; c_min bigint; e_min bigint; c_date date; e_date date; negative_date date; next_income date;
begin
  if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
  until_on:=private.forecast_end(today,p_horizon,p_until);
  base:=api.free_to_spend_input(p_space,today);
  commitments:=base->'commitments';
  -- Keep card identity in the projection without changing the Livre contract.
  select coalesce(jsonb_agg(x.value||jsonb_build_object('paymentCardId',c.payment_credit_card_id)),'[]') into commitments
    from jsonb_array_elements(commitments) x(value) join finance.commitments c on c.id=(x.value->>'id')::uuid;
  -- The next income marker is independent of the displayed range. The month
  -- curve still identifies an income due next month, without pulling it into
  -- this month's events or changing the chosen horizon.
  select min((i->>'effectiveDueOn')::date) into next_income from jsonb_array_elements(commitments) i
    where (i->>'mainIncome')::boolean and i->>'direction'='inflow' and i->>'paymentLiquidity'='cash'
      and not (i->>'cancelled')::boolean and (i->>'paidCents')::bigint<(i->>'dueCents')::bigint and (i->>'effectiveDueOn')::date>today;

  for rule in select * from finance.recurrence_rules where financial_space_id=p_space and archived_at is null order by id loop
    select min(c.effective_due_on) into rule_next_income from finance.commitments c join finance.commitment_settlements s on s.id=c.id
      join finance.financial_accounts f on f.id=c.payment_financial_account_id join finance.ledger_accounts a on a.id=f.ledger_account_id and a.liquidity='cash'
      where c.recurrence_rule_id=rule.id and c.cancelled_at is null and c.deleted_at is null and s.remaining_cents>0 and c.effective_due_on>today;
    -- Beyond the plot, find at most the next income. The bound covers the
    -- longest permitted recurrence interval (120 units) plus a banking-year
    -- adjustment, even for yearly rules, and prevents noncash income rules
    -- from creating an unbounded scan. No additional events are persisted.
    select greatest(today,rule.starts_on,max(v.effective_from_period),until_on+31)
      +make_interval(years=>case rule.unit when 'week' then 4 when 'month' then 11 else 121 end) into marker_until
      from finance.recurrence_rule_versions v where v.recurrence_rule_id=rule.id;
    period:=private.recurrence_period(greatest(rule.starts_on,today-31),rule.unit);
    while period<=until_on+31 or rule.is_main_income and (rule_next_income is null or period<=private.recurrence_period(rule_next_income,rule.unit)) and period<=marker_until
      and (rule.ends_on is null or period<=private.recurrence_period(rule.ends_on,rule.unit)) loop
      select * into rule_version from finance.recurrence_rule_versions where recurrence_rule_id=rule.id and effective_from_period<=period order by version_number desc limit 1;
      if found and not exists(select 1 from finance.commitments where recurrence_rule_id=rule.id and period_key=period and deleted_at is null) then
        nominal:=case rule.unit when 'week' then period+rule_version.weekday-1 when 'month' then private.clamped_day(period,rule_version.day_of_month)
          else private.clamped_day(make_date(extract(year from period)::integer,rule_version.month_of_year,1),rule_version.day_of_month) end;
        distance:=case rule.unit when 'week' then (period-rule_version.effective_from_period)/7
          when 'month' then (extract(year from period)::integer-extract(year from rule_version.effective_from_period)::integer)*12+extract(month from period)::integer-extract(month from rule_version.effective_from_period)::integer
          else extract(year from period)::integer-extract(year from rule_version.effective_from_period)::integer end;
        effective:=private.effective_due_date(p_space,nominal,rule_version.business_day_adjustment);
        if rule.is_main_income and distance%rule_version.interval_count=0 and nominal>=rule.starts_on and (rule.ends_on is null or nominal<=rule.ends_on) and effective>today
          and exists(select 1 from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id and a.liquidity='cash' where f.id=rule_version.payment_financial_account_id) then
          rule_next_income:=least(rule_next_income,effective); next_income:=least(next_income,effective);
        end if;
        if distance%rule_version.interval_count=0 and nominal>=rule.starts_on and (rule.ends_on is null or nominal<=rule.ends_on) and effective>=today and effective<=until_on then
          select a.liquidity into payment_liquidity from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id where f.id=rule_version.payment_financial_account_id;
          select coalesce(jsonb_agg(h.paid_cents order by h.period_key desc),'[]') into history from (
            select s.paid_cents,c.period_key from finance.commitments c join finance.commitment_settlements s on s.id=c.id
            where c.recurrence_rule_id=rule.id and c.period_key<period and s.settlement_status='settled'
              and (select max(t.occurred_on) from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' where e.commitment_id=c.id)<=today
            order by c.period_key desc limit 3
          ) h;
          commitments:=commitments||jsonb_build_array(jsonb_build_object('id',rule.id::text||':'||period::text,'label',rule.title,'direction',rule.direction,'certainty',rule_version.certainty,
            'effectiveDueOn',effective,'dueCents',rule_version.amount_cents,'paidCents',0,'paymentLiquidity',case when rule_version.payment_method='card' then 'card' else coalesce(payment_liquidity,'investment') end,
            'paymentCardId',rule_version.payment_credit_card_id,'mainIncome',rule.is_main_income,'actualHistoryCents',history,'projected',true));
        end if;
      end if;
      period:=case rule.unit when 'week' then period+7 when 'month' then (period+interval '1 month')::date else (period+interval '1 year')::date end;
    end loop;
  end loop;
  for item in select value from jsonb_array_elements(commitments) loop
    if coalesce((item->>'cancelled')::boolean,false) or (item->>'paidCents')::bigint>=(item->>'dueCents')::bigint then continue; end if;
    effective:=(item->>'effectiveDueOn')::date;
    if coalesce((item->>'mainIncome')::boolean,false) and item->>'direction'='inflow' and item->>'paymentLiquidity'='cash' and effective>today then next_income:=least(next_income,effective); end if;
    if effective>until_on then continue; end if;
    if item->>'paymentLiquidity' not in ('cash','card') then continue; end if;
    on_date:=greatest(today,effective);
    conservative:=private.free_considered(item,false); expected:=private.free_considered(item,true);
    if item->>'direction'='inflow' then
      if item->>'certainty'='conditional' or effective<today then conservative:=0; end if;
    else conservative:=-conservative; expected:=-expected;
    end if;
    if item->>'paymentLiquidity'='card' then
      card_due:=private.forecast_card_due(p_space,(item->>'paymentCardId')::uuid,effective);
      on_date:=greatest(today,(card_due->>'on')::date);
      -- Fold every planned card occurrence into its statement event below.
      item:=item||jsonb_build_object('statementId',card_due->>'id','statementLabel',card_due->>'label');
    end if;
    if on_date>until_on or (conservative=0 and expected=0) then continue; end if;
    items:=items||jsonb_build_array(jsonb_build_object('id',item->>'id','label',item->>'label','kind',case when item->>'paymentLiquidity'='card' then 'card_occurrence' else 'commitment' end,
      'on',on_date,'conservativeCents',conservative,'expectedCents',expected,'projected',coalesce((item->>'projected')::boolean,false),'statementId',item->>'statementId','statementLabel',item->>'statementLabel'));
  end loop;
  for item in select value from jsonb_array_elements(base->'statements') loop
    on_date:=greatest(today,(item->>'effectiveDueOn')::date);
    if on_date>until_on then continue; end if;
    amount:=greatest(0,(item->>'remainingIncludingScheduledCents')::bigint)+coalesce((item->>'estimatedChargesCents')::bigint,0);
    if amount=0 then continue; end if;
    items:=items||jsonb_build_array(jsonb_build_object('id',item->>'id','statementId',item->>'id','label',item->>'label','statementLabel',item->>'label','kind','statement',
      'on',on_date,'conservativeCents',-amount,'expectedCents',-amount,'estimatedChargesCents',coalesce((item->>'estimatedChargesCents')::bigint,0)));
  end loop;
  for movement in select t.id,t.description,t.occurred_on,sum(e.amount_cents)::bigint as net from finance.ledger_transactions t
    join finance.ledger_entries e on e.ledger_transaction_id=t.id join finance.ledger_accounts a on a.id=e.ledger_account_id and a.liquidity='cash'
    where t.financial_space_id=p_space and t.status='posted' and t.occurred_on>today and t.occurred_on<=until_on group by t.id order by t.occurred_on,t.id loop
    if movement.net<>0 then items:=items||jsonb_build_array(jsonb_build_object('id',movement.id,'label',movement.description,'kind','scheduled','on',movement.occurred_on,'conservativeCents',movement.net,'expectedCents',movement.net)); end if;
  end loop;
  for item in select value from jsonb_array_elements(base->'people') loop
    amount:=(item->>'balanceCents')::bigint;
    if amount=0 then continue; end if;
    select min(value::date) into on_date from jsonb_array_elements_text(item->'openReminderDates');
    if on_date is null and amount>0 then continue; end if;
    on_date:=greatest(today,coalesce(on_date,today)); if on_date>until_on then continue; end if;
    -- A future recorded settlement already has a cash event and must not be
    -- expected again as a person balance. Only reduce the existing direction.
    select coalesce(sum(abs(e.amount_cents)),0)::bigint into scheduled_settlement from finance.people p
      join finance.ledger_entries e on e.ledger_account_id=p.ledger_account_id join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' and t.occurred_on>today
      where p.id=(item->>'id')::uuid and p.financial_space_id=p_space and sign(e.amount_cents)=-sign(amount)
        and exists(select 1 from finance.ledger_entries ce join finance.ledger_accounts ca on ca.id=ce.ledger_account_id and ca.liquidity='cash' where ce.ledger_transaction_id=t.id and sign(ce.amount_cents)=sign(amount));
    remaining:=greatest(0,abs(amount)-scheduled_settlement);
    if remaining=0 then continue; end if;
    items:=items||jsonb_build_array(jsonb_build_object('id',item->>'id','label',item->>'label','kind','person','on',on_date,'conservativeCents',case when amount<0 then -remaining else 0 end,'expectedCents',case when amount<0 then -remaining else remaining end));
  end loop;
  -- Card installments live only in these aggregated statement events.
  select coalesce(jsonb_agg(x.event order by x.on_date,x.id),'[]') into items from (
    select value as event,(value->>'on')::date as on_date,value->>'id' as id from jsonb_array_elements(items) where value->>'kind' not in ('statement','card_occurrence')
    union all
    select jsonb_build_object('id',value->>'statementId','label',min(value->>'statementLabel'),'kind','statement','on',(value->>'on')::date,
      'conservativeCents',sum((value->>'conservativeCents')::bigint),'expectedCents',sum((value->>'expectedCents')::bigint),
      'estimatedChargesCents',sum(coalesce((value->>'estimatedChargesCents')::bigint,0)),
      'occurrences',coalesce(jsonb_agg(value) filter(where value->>'kind'='card_occurrence'),'[]')),
      (value->>'on')::date,value->>'statementId'
    from jsonb_array_elements(items) where value->>'kind' in ('statement','card_occurrence') group by value->>'statementId',(value->>'on')::date
  ) x;
  if exists(select 1 from jsonb_array_elements(items) where abs((value->>'conservativeCents')::numeric)>9007199254740991 or abs((value->>'expectedCents')::numeric)>9007199254740991
    or abs(coalesce((value->>'estimatedChargesCents')::numeric,0))>9007199254740991) then raise exception 'Forecast exceeds supported cents' using errcode='23514'; end if;
  select jsonb_agg(jsonb_build_object('on',d.day,'conservativeCents',d.c,'expectedCents',d.e) order by d.day) into series from (
    select day::date as day,(base->>'cashBalanceCents')::bigint+coalesce((select sum((value->>'conservativeCents')::bigint) from jsonb_array_elements(items) where (value->>'on')::date<=day::date),0) as c,
      (base->>'cashBalanceCents')::bigint+coalesce((select sum((value->>'expectedCents')::bigint) from jsonb_array_elements(items) where (value->>'on')::date<=day::date),0) as e
    from generate_series(today::timestamp,until_on::timestamp,interval '1 day') day
  ) d;
  if exists(select 1 from jsonb_array_elements(series) where abs((value->>'conservativeCents')::numeric)>9007199254740991 or abs((value->>'expectedCents')::numeric)>9007199254740991) then raise exception 'Forecast exceeds supported cents' using errcode='23514'; end if;
  select (value->>'conservativeCents')::bigint,(value->>'on')::date into c_min,c_date from jsonb_array_elements(series) order by (value->>'conservativeCents')::bigint,value->>'on' limit 1;
  select (value->>'expectedCents')::bigint,(value->>'on')::date into e_min,e_date from jsonb_array_elements(series) order by (value->>'expectedCents')::bigint,value->>'on' limit 1;
  select min((value->>'on')::date) into negative_date from jsonb_array_elements(series) where (value->>'conservativeCents')::bigint<0;
  return jsonb_build_object('today',today,'until',until_on,'horizon',p_horizon,'cashBalanceCents',(base->>'cashBalanceCents')::bigint,'series',series,'events',items,
    'conservative',jsonb_build_object('minimumCents',c_min,'minimumOn',c_date,'firstNegativeOn',negative_date),
    'expected',jsonb_build_object('minimumCents',e_min,'minimumOn',e_date),'nextMainIncomeOn',next_income);
end;
$$;
revoke all on function private.forecast_end(date,text,date),private.forecast_card_due(uuid,uuid,date),api.cash_forecast(uuid,text,date,date) from public,anon,authenticated;
grant execute on function api.cash_forecast(uuid,text,date,date) to authenticated;
commit;
