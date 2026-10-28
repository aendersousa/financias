begin;
create function api.edit_commitment(p_space uuid,p_commitment uuid,p_version integer,p_changes jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.commitments; paid bigint; due date; method text; financial_changes boolean; category uuid;
begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into previous from finance.commitments where financial_space_id=p_space and id=p_commitment and cancelled_at is null and deleted_at is null for update;
  if not found then raise exception 'Active commitment not found' using errcode='P0002'; end if;
  if previous.version is distinct from p_version then raise exception 'Commitment changed; reload before editing' using errcode='40001'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_changes) key where key not in('title','notes','amount_cents','certainty','due_on','effective_due_on','competence_month','category_id','payment_method','payment_financial_account_id','payment_credit_card_id')) then raise exception 'Invalid commitment fields' using errcode='23514'; end if;
  financial_changes:=p_changes ?| array['amount_cents','certainty','due_on','effective_due_on','competence_month','category_id','payment_method','payment_financial_account_id','payment_credit_card_id'];
  if financial_changes and exists(select 1 from finance.loan_installments where commitment_id=p_commitment) then raise exception 'Correct the creditor schedule instead of changing the installment' using errcode='23514'; end if;
  if financial_changes and previous.reserve_id is not null then raise exception 'Edit the linked provision instead of changing its commitment' using errcode='23514'; end if;
  if previous.recurrence_rule_id is not null and exists(select 1 from finance.recurrence_rules where id=previous.recurrence_rule_id and is_main_income) then perform private.require_admin(p_space); end if;
  if financial_changes and previous.kind='reminder' then raise exception 'Reminders cannot receive financial fields' using errcode='23514'; end if;
  select paid_cents into paid from finance.commitment_settlements where id=p_commitment;
  if financial_changes and paid<>0 then raise exception 'Cancel linked settlements before changing commitment terms' using errcode='23514'; end if;
  if financial_changes and (exists(select 1 from finance.period_closings where financial_space_id=p_space and month=previous.competence_month and reopened_at is null) or exists(select 1 from finance.period_closings where financial_space_id=p_space and month=coalesce((p_changes->>'competence_month')::date,previous.competence_month) and reopened_at is null)) then raise exception 'Period is closed' using errcode='23514'; end if;
  due:=coalesce((p_changes->>'due_on')::date,previous.nominal_due_on);
  method:=coalesce(p_changes->>'payment_method',previous.payment_method);
  category:=case when p_changes ? 'category_id' then (p_changes->>'category_id')::uuid else previous.category_id end;
  if category is not null and not exists(select 1 from finance.categories where id=category and financial_space_id=p_space and archived_at is null and deleted_at is null) then raise exception 'Active category required' using errcode='23514'; end if;
  if previous.kind<>'reminder' and method='account' and not exists(select 1 from finance.financial_accounts where id=coalesce((p_changes->>'payment_financial_account_id')::uuid,previous.payment_financial_account_id) and financial_space_id=p_space and archived_at is null and deleted_at is null) then raise exception 'Active payment account required' using errcode='23514'; end if;
  if previous.kind<>'reminder' and method='card' and not exists(select 1 from finance.credit_cards where id=coalesce((p_changes->>'payment_credit_card_id')::uuid,previous.payment_credit_card_id) and financial_space_id=p_space and status='active') then raise exception 'Active payment card required' using errcode='23514'; end if;
  if p_changes ? 'title' and (p_changes->>'title' is null or char_length(trim(p_changes->>'title')) not between 1 and 100) or due is null or not isfinite(due) then raise exception 'Invalid commitment title or date' using errcode='23514'; end if;
  update finance.commitments set title=coalesce(trim(p_changes->>'title'),title),notes=case when p_changes ? 'notes' then p_changes->>'notes' else notes end,
    due_amount_cents=coalesce((p_changes->>'amount_cents')::bigint,due_amount_cents),certainty=coalesce(p_changes->>'certainty',certainty),nominal_due_on=due,
    effective_due_on=case when p_changes ? 'effective_due_on' then (p_changes->>'effective_due_on')::date when p_changes ? 'due_on' and kind<>'reminder' then private.effective_due_date(p_space,due) when p_changes ? 'due_on' then due else effective_due_on end,
    effective_due_on_overridden=case when p_changes ? 'effective_due_on' then true when p_changes ? 'due_on' then false else effective_due_on_overridden end,
    competence_month=coalesce((p_changes->>'competence_month')::date,competence_month),category_id=category,counterpart_account_id=case when category is not null then null else counterpart_account_id end,
    payment_method=method,payment_financial_account_id=case when method='account' then coalesce((p_changes->>'payment_financial_account_id')::uuid,payment_financial_account_id) end,
    payment_credit_card_id=case when method='card' then coalesce((p_changes->>'payment_credit_card_id')::uuid,payment_credit_card_id) end,user_modified_at=now(),version=version+1,updated_at=now() where id=p_commitment;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'occurrence_edited','commitment',p_commitment,to_jsonb(previous),p_changes);
  return p_commitment;
end;
$$;
create function api.complete_reminder(p_space uuid,p_commitment uuid,p_version integer,p_completed boolean default true) returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.commitments;
begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into previous from finance.commitments where financial_space_id=p_space and id=p_commitment and kind='reminder' and cancelled_at is null and deleted_at is null for update;
  if not found then raise exception 'Active reminder not found' using errcode='P0002'; end if;
  if previous.version is distinct from p_version then raise exception 'Commitment changed; reload before editing' using errcode='40001'; end if;
  if p_completed is null then raise exception 'Choose reminder state' using errcode='23514'; end if;
  update finance.commitments set completed_at=case when p_completed then now() end,user_modified_at=now(),version=version+1,updated_at=now() where id=p_commitment;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'reminder_completed','commitment',p_commitment,to_jsonb(previous),jsonb_build_object('completed',p_completed));
  return p_commitment;
end;
$$;
create function api.agenda_month(p_space uuid,p_month date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; today date;
begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
  if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 then raise exception 'Month must begin on day one' using errcode='23514'; end if;
  today:=private.space_today(p_space);
  select jsonb_build_object('month',p_month,'today',today,'items',coalesce(jsonb_agg(item order by day,rank,item->>'id'),'[]')) into result from (
    select c.effective_due_on as day,1 as rank,to_jsonb(c)||to_jsonb(s)||jsonb_build_object('type',c.kind,'on',c.effective_due_on,'category_name',(select name from finance.categories where id=c.category_id),'payment_name',coalesce((select name from finance.financial_accounts where id=c.payment_financial_account_id),(select name from finance.credit_cards where id=c.payment_credit_card_id)),'loan_installment',exists(select 1 from finance.loan_installments where commitment_id=c.id)) as item
      from finance.commitments c join finance.commitment_settlements s on s.id=c.id where c.financial_space_id=p_space and c.effective_due_on>=p_month and c.effective_due_on<(p_month+interval '1 month')::date
    union all
    select s.effective_due_on,2,to_jsonb(s)||jsonb_build_object('type','card_statement','on',s.effective_due_on,'title','Fatura: '||c.name,'direction','outflow','settlement_status',case when s.remaining_cents<=0 then 'settled' else 'pending' end,'version',c.version)
      from finance.statement_amounts s join finance.credit_cards c on c.id=s.credit_card_id where s.financial_space_id=p_space and s.effective_due_on>=p_month and s.effective_due_on<(p_month+interval '1 month')::date
    union all
    select t.occurred_on,3,to_jsonb(t)||jsonb_build_object('type','scheduled_transaction','on',t.occurred_on,'title',t.description,'remaining_cents',abs(sum(e.amount_cents) filter(where l.liquidity='cash')),'direction',case when sum(e.amount_cents) filter(where l.liquidity='cash')<0 then 'outflow' else 'inflow' end,'settlement_status','scheduled')
      from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id=t.id join finance.ledger_accounts l on l.id=e.ledger_account_id where t.financial_space_id=p_space and t.status='posted' and t.occurred_on>today and t.occurred_on>=p_month and t.occurred_on<(p_month+interval '1 month')::date group by t.id
  ) items;
  return result;
end;
$$;
revoke all on function api.edit_commitment(uuid,uuid,integer,jsonb),api.complete_reminder(uuid,uuid,integer,boolean),api.agenda_month(uuid,date) from public,anon,authenticated;
grant execute on function api.edit_commitment(uuid,uuid,integer,jsonb),api.complete_reminder(uuid,uuid,integer,boolean),api.agenda_month(uuid,date) to authenticated;
commit;
