begin;
-- Documento Mestre 15.12: explain the existing conservative calculation.
-- This is not the independent, complete cash-flow forecast of section 16.
create function private.diagnostic_brl(p_cents bigint) returns text
language sql immutable set search_path='' as $$
 select 'R$ '||translate(to_char(p_cents::numeric/100,'FM999,999,999,999,990.00'),',.','.,');
$$;

-- Read-only counterpart of statement selection. Never create cycles on a read.
-- Stored transition/manual dates have precedence over current card rules.
create function private.projected_card_cash_on(p_space uuid,p_card uuid,p_purchase_on date) returns date
language plpgsql stable set search_path='' as $$
declare card finance.credit_cards; cash_on date; closing date; close_month date; due date;
begin
 select effective_due_on into cash_on from finance.card_statements where financial_space_id=p_space and credit_card_id=p_card
  and p_purchase_on between period_start and period_end order by case status when 'open' then 0 when 'future' then 1 else 2 end,closing_on,id limit 1;
 if found then return cash_on; end if;
 select * into card from finance.credit_cards where financial_space_id=p_space and id=p_card;
 if not found then raise exception 'Card not found' using errcode='P0002'; end if;
 close_month:=date_trunc('month',p_purchase_on)::date; closing:=private.clamped_day(close_month,card.closing_day);
 if p_purchase_on>closing or p_purchase_on=closing and card.closing_day_purchase_goes_next then close_month:=(close_month+interval '1 month')::date; end if;
 closing:=private.clamped_day(close_month,card.closing_day); due:=private.clamped_day(close_month,card.due_day);
 if due<=closing then due:=private.clamped_day((close_month+interval '1 month')::date,card.due_day); end if;
 -- The writer also reuses a cycle by reference month when a manual period
 -- makes the purchase out of period. Its stored payment override still wins.
 select effective_due_on into cash_on from finance.card_statements where financial_space_id=p_space and credit_card_id=p_card and reference_month=date_trunc('month',due)::date;
 if found then return cash_on; end if;
 return private.effective_due_date(p_space,due);
end;
$$;

create function private.free_to_spend_diagnostics(p_input jsonb,p_calculation jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare
 scenario jsonb:=p_calculation->'conservative'; day date:=(p_input->>'today')::date; horizon date:=(p_calculation->>'horizonEnd')::date;
 resources bigint; core bigint; available bigint; amount bigint; covered bigint; shortage bigint; cash_balance bigint;
 item jsonb; source jsonb; event jsonb; sources jsonb:='{}'; events jsonb:='[]'; uncovered jsonb:='[]'; first_item jsonb;
 first_day date; cash_on date; key text; label text; message text; part text; reserves_exist boolean;
 months date[]; weights bigint[]; allocations bigint[]; daily_weights bigint[]; daily_parts bigint[]; idx integer; day_idx integer; begins date; ends date;
begin
 if (scenario->>'valueCents')::bigint>=0 then return jsonb_build_object('kind','none'); end if;
 resources:=(scenario->>'cashCents')::bigint+(scenario->>'expectedInflowsCents')::bigint;
 core:=(scenario->>'committedCents')::bigint+(scenario->>'essentialCents')::bigint;
 reserves_exist:=(scenario->>'reservedCents')::bigint>0 or (scenario->>'safetyCents')::bigint>0;
 if resources>=core then
  available:=resources-core; shortage:=-(scenario->>'valueCents')::bigint;
  for item in select r from jsonb_array_elements(coalesce(p_input->'reserves','[]')) r
   where (r->>'active')::boolean and r->>'holdingMode'='virtual'
   order by case when r->>'reserveType'='provision' then 0 else 1 end,
    case when r->>'reserveType'='provision' then coalesce(r->>'coverageDueOn',r->>'targetDate')::date else (r->>'targetDate')::date end nulls last,r->>'createdAt',r->>'id'
  loop
   amount:=greatest(0,(item->>'balanceCents')::bigint); covered:=least(available,amount); available:=available-covered;
   if covered<amount then
    label:=case when item->>'reserveType'='provision' then 'provisão ' else 'meta ' end||coalesce(nullif(item->>'label',''),'sem nome');
    uncovered:=uncovered||jsonb_build_array(jsonb_build_object('id',item->>'id','label',label,'uncoveredCents',amount-covered,'totalCents',amount));
   end if;
  end loop;
  amount:=(scenario->>'safetyCents')::bigint; covered:=least(available,amount);
  if covered<amount then uncovered:=uncovered||jsonb_build_array(jsonb_build_object('id','minimum_safety','label','reserva mínima','uncoveredCents',amount-covered,'totalCents',amount)); end if;
  message:=format('Suas reservas superam em %s o que sobra depois dos compromissos e dos essenciais.',private.diagnostic_brl(shortage));
  select string_agg(format('%s — %s de %s',u->>'label',private.diagnostic_brl((u->>'uncoveredCents')::bigint),private.diagnostic_brl((u->>'totalCents')::bigint)),'; ' order by n)
   into part from jsonb_array_elements(uncovered) with ordinality a(u,n);
  if part is not null then message:=message||' Descoberta: '||part||'.'; end if;
  return jsonb_build_object('kind','reserves','shortageCents',shortage,'uncoveredReserves',uncovered,'message',message);
 end if;

 -- Resolve each considered item using its cash date, not its competence date
 -- or the reserve's earlier consumption date. Only amounts already included
 -- by the canonical conservative engine are used, including uncovered links.
 for item in select c from jsonb_array_elements(coalesce(p_input->'commitments','[]')) c loop
  source:=jsonb_build_object('label',coalesce(item->>'label','Conta da agenda'),'on',coalesce(item->>'cashOn',item->>'effectiveDueOn'));
  sources:=sources||jsonb_build_object('income:'||(item->>'id'),source,'agenda:'||(item->>'id'),source);
 end loop;
 for item in select s from jsonb_array_elements(coalesce(p_input->'statements','[]')) s loop
  source:=jsonb_build_object('label',coalesce(item->>'label','Fatura'),'on',item->>'effectiveDueOn');
  sources:=sources||jsonb_build_object('card:'||(item->>'id'),source,'card_reserve:'||(item->>'id'),source);
 end loop;
 for item in select p from jsonb_array_elements(coalesce(p_input->'people','[]')) p loop
  select min(d::date) into cash_on from jsonb_array_elements_text(coalesce(item->'openReminderDates','[]')) d;
  sources:=sources||jsonb_build_object('person:'||(item->>'id'),jsonb_build_object('label',coalesce(item->>'label','Valor com pessoa'),'on',cash_on));
 end loop;
 for item in select s from jsonb_array_elements(coalesce(p_input->'scheduled','[]')) s loop
  source:=jsonb_build_object('label',coalesce(item->>'label','Movimentação agendada'),'on',item->>'occurredOn');
  sources:=sources||jsonb_build_object('scheduled:'||(item->>'id'),source,'scheduled_reserve:'||(item->>'id'),source);
 end loop;
 for item in select i from jsonb_array_elements(scenario->'items') i loop
  amount:=(item->>'amountCents')::bigint;
  if amount=0 then continue; end if;
  key:=(item->>'group')||':'||split_part(item->>'id',':',1); source:=sources->key;
  if source is null then raise exception 'Diagnostic source missing' using errcode='23514'; end if;
  cash_on:=greatest(day,coalesce((source->>'on')::date,day));
  events:=events||jsonb_build_array(jsonb_build_object('id',item->>'id','group',item->>'group','label',source->>'label','on',cash_on,'amountCents',amount));
 end loop;

 -- Allocate the net essential need by each month's GROSS need, then equally
 -- over that month's days in H. Largest-remainder allocation preserves cents;
 -- month/day order deterministically resolves ties without creating money.
 amount:=(scenario->>'essentialCents')::bigint;
 if amount>0 then
  select array_agg(m order by m),array_agg(w order by m) into months,weights from (
   select date_trunc('month',(q->>'month')::date)::date as m,sum(greatest(0,(q->>'grossNeedCents')::bigint))::bigint as w
    from jsonb_array_elements(coalesce(p_input#>'{essentialDetails,quotas}','[]')) q group by 1
  ) monthly where w>0 and m<horizon and (m+interval '1 month')::date>day;
  if months is null then raise exception 'Essential diagnostic requires monthly gross needs' using errcode='23514'; end if;
  allocations:=private.divide_cents(amount,weights);
  for idx in 1..array_length(months,1) loop
   begins:=greatest(day,months[idx]); ends:=least(horizon,(months[idx]+interval '1 month')::date);
   daily_weights:=array_fill(1::bigint,array[ends-begins]); daily_parts:=private.divide_cents(allocations[idx],daily_weights);
   for day_idx in 1..array_length(daily_parts,1) loop
    if daily_parts[day_idx]>0 then events:=events||jsonb_build_array(jsonb_build_object('id','essential:'||(begins+day_idx-1)::text,'group','essential','label','Essenciais','on',begins+day_idx-1,'amountCents',-daily_parts[day_idx])); end if;
   end loop;
  end loop;
 end if;
 shortage:=core-resources; cash_balance:=(scenario->>'cashCents')::bigint;
 if cash_balance<0 then
  first_day:=day; first_item:=jsonb_build_object('id','cash','label','Saldo em contas','uncoveredCents',-cash_balance,'totalCents',-cash_balance);
 end if;
 -- Same-day cash receipts precede obligations; obligation ties use their group
 -- and immutable identity, and essential daily protection follows real items.
 for event in select e from jsonb_array_elements(events) e order by (e->>'on')::date,
  case when (e->>'amountCents')::bigint>0 then 0 when e->>'group'='essential' then 2 else 1 end,e->>'group',e->>'id'
 loop
  amount:=(event->>'amountCents')::bigint;
  if first_item is null and cash_balance+amount<0 then
   first_day:=(event->>'on')::date;
   first_item:=jsonb_build_object('id',event->>'id','label',event->>'label','uncoveredCents',least(-amount,-cash_balance-amount),'totalCents',-amount);
  end if;
  cash_balance:=cash_balance+amount;
 end loop;
 if first_item is null or cash_balance<>resources-core then raise exception 'Diagnostic does not reconcile with conservative calculation' using errcode='23514'; end if;
 message:=format('Faltam %s até %s. Item descoberto: %s (%s de %s).',private.diagnostic_brl(shortage),to_char(first_day,'DD/MM'),first_item->>'label',private.diagnostic_brl((first_item->>'uncoveredCents')::bigint),private.diagnostic_brl((first_item->>'totalCents')::bigint));
 if reserves_exist then message:=message||' Suas reservas também ficam descobertas.'; end if;
 return jsonb_build_object('kind','commitments','shortageCents',shortage,'firstNegativeOn',first_day,'uncoveredItem',first_item,'reservesAlsoUncovered',reserves_exist,
  'timelineExtendsBeyondHorizon',exists(select 1 from jsonb_array_elements(events) e where (e->>'on')::date>=horizon),'message',message);
end;
$$;

create or replace function api.free_to_spend_summary(p_space uuid,p_on date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare input jsonb; calculation jsonb; enriched jsonb; item jsonb; commitment finance.commitments;
begin
 input:=api.free_to_spend_input(p_space,p_on);
 select coalesce(jsonb_agg(i||jsonb_build_object('reserveType',r.reserve_type,'targetDate',r.target_date,'createdAt',r.created_at,
  'coverageDueOn',coalesce((select min(c.effective_due_on) from finance.commitments c join finance.commitment_settlements s on s.id=c.id where c.reserve_id=r.id and c.financial_space_id=p_space and c.cancelled_at is null and c.deleted_at is null and s.remaining_cents>0),r.target_date)) order by n),'[]') into enriched
  from jsonb_array_elements(input->'reserves') with ordinality a(i,n) join finance.reserves r on r.id=(i->>'id')::uuid and r.financial_space_id=p_space;
 input:=jsonb_set(input,'{reserves}',enriched);
 enriched:='[]';
 for item in select c from jsonb_array_elements(input->'commitments') c loop
  select * into commitment from finance.commitments where id=(item->>'id')::uuid and financial_space_id=p_space;
  item:=item||jsonb_build_object('cashOn',case when commitment.payment_method='card' then private.projected_card_cash_on(p_space,commitment.payment_credit_card_id,commitment.effective_due_on) else commitment.effective_due_on end);
  enriched:=enriched||jsonb_build_array(item);
 end loop;
 input:=jsonb_set(input,'{commitments}',enriched); calculation:=private.calculate_free_to_spend(input);
 return jsonb_build_object('input',input,'calculation',calculation,'diagnostics',private.free_to_spend_diagnostics(input,calculation));
end;
$$;
revoke all on function private.diagnostic_brl(bigint),private.projected_card_cash_on(uuid,uuid,date),private.free_to_spend_diagnostics(jsonb,jsonb) from public,anon,authenticated;
revoke all on function api.free_to_spend_summary(uuid,date) from public,anon,authenticated;
grant execute on function api.free_to_spend_summary(uuid,date) to authenticated;
commit;
