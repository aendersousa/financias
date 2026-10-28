begin;
create function private.validate_commitment() returns trigger language plpgsql set search_path = '' as $$
declare account finance.ledger_accounts; category finance.categories; begin
  if new.kind <> 'reminder' then
    if new.counterpart_account_id is not null then
      select * into account from finance.ledger_accounts where id = new.counterpart_account_id and financial_space_id = new.financial_space_id;
      if not found or account.owner_type = 'credit_card' or account.liquidity in ('cash','benefit','person') or account.account_class = 'equity' then raise exception 'Invalid commitment counterpart' using errcode = '23514'; end if;
    end if;
    if new.category_id is not null then
      select * into category from finance.categories where id = new.category_id and financial_space_id = new.financial_space_id;
      if not found or category.kind <> (case new.direction when 'inflow' then 'income' else 'expense' end) then raise exception 'Commitment category has wrong direction' using errcode = '23514'; end if;
    end if;
    if tg_op = 'UPDATE' and new.direction is distinct from old.direction and exists(select 1 from finance.ledger_entries where commitment_id = old.id) then raise exception 'Linked commitment direction is immutable' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
create trigger commitment_valid before insert or update on finance.commitments for each row execute function private.validate_commitment();
create function private.validate_commitment_entry() returns trigger language plpgsql set search_path = '' as $$
declare account finance.ledger_accounts; commitment finance.commitments; begin
  if new.commitment_id is not null then
    select * into account from finance.ledger_accounts where id = new.ledger_account_id;
    if account.owner_type = 'credit_card' or account.liquidity in ('cash','benefit','person') or account.account_class = 'equity' then raise exception 'Commitment link belongs on the counterpart entry' using errcode = '23514'; end if;
    select * into commitment from finance.commitments where id = new.commitment_id;
    if commitment.kind = 'reminder' or commitment.cancelled_at is not null or commitment.deleted_at is not null then raise exception 'Commitment cannot accept settlement' using errcode = '23514'; end if;
  end if;
  if new.reserve_id is not null then
    select * into account from finance.ledger_accounts where id = new.ledger_account_id;
    if account.account_class <> 'expense' and account.liquidity is distinct from 'property' then raise exception 'Reserve link belongs on consumption entry' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
create trigger commitment_entry_valid before insert or update on finance.ledger_entries for each row execute function private.validate_commitment_entry();
create function private.commitment_settlement_within_due() returns trigger language plpgsql set search_path = '' as $$
declare commitment_id uuid; commitment finance.commitments; paid numeric; begin
  for commitment_id in
    select c.id from finance.commitments c where
      (tg_table_name = 'commitments' and c.id = coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id')::uuid) or
      (tg_table_name = 'ledger_entries' and c.id in (nullif(to_jsonb(new)->>'commitment_id','')::uuid,nullif(to_jsonb(old)->>'commitment_id','')::uuid)) or
      (tg_table_name = 'ledger_transactions' and exists(select 1 from finance.ledger_entries e where e.commitment_id = c.id and e.ledger_transaction_id = coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id')::uuid))
    order by c.id loop
    select * into commitment from finance.commitments where id = commitment_id for update;
    select coalesce(sum(e.amount_cents),0) * case when commitment.direction = 'inflow' then -1 else 1 end into paid
      from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where e.commitment_id = commitment.id and t.status = 'posted';
    if (commitment.kind = 'reminder' and paid <> 0) or paid < 0 or paid > commitment.due_amount_cents then raise exception 'Settlement must be between zero and commitment amount' using errcode = '23514'; end if;
  end loop;
  return null;
end;
$$;
create constraint trigger settlement_commitment after insert or update on finance.commitments deferrable initially deferred for each row execute function private.commitment_settlement_within_due();
create constraint trigger settlement_entries after insert or update or delete on finance.ledger_entries deferrable initially deferred for each row execute function private.commitment_settlement_within_due();
create constraint trigger settlement_transaction after update on finance.ledger_transactions deferrable initially deferred for each row execute function private.commitment_settlement_within_due();

create function api.create_commitment(p_space uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare commitment_id uuid; due date := (p_payload->>'due_on')::date; kind text := coalesce(p_payload->>'kind','one_off'); begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if kind not in ('one_off','reminder') then raise exception 'Occurrences are created from recurrence rules' using errcode = '23514'; end if;
  insert into finance.commitments(financial_space_id,kind,direction,certainty,title,notes,category_id,counterpart_account_id,person_id,due_amount_cents,nominal_due_on,effective_due_on,competence_month,payment_method,payment_financial_account_id,payment_credit_card_id,reserve_id,created_by)
    values(p_space,kind,p_payload->>'direction',p_payload->>'certainty',p_payload->>'title',p_payload->>'notes',(p_payload->>'category_id')::uuid,(p_payload->>'counterpart_account_id')::uuid,(p_payload->>'person_id')::uuid,
      (p_payload->>'amount_cents')::bigint,due,case when kind = 'reminder' then due else private.effective_due_date(p_space,due,coalesce(p_payload->>'business_day_adjustment','next')) end,
      coalesce((p_payload->>'competence_month')::date,date_trunc('month',due)::date),p_payload->>'payment_method',(p_payload->>'payment_financial_account_id')::uuid,(p_payload->>'payment_credit_card_id')::uuid,(p_payload->>'reserve_id')::uuid,auth.uid()) returning id into commitment_id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','commitment',commitment_id,p_payload);
  return commitment_id;
end;
$$;

create function api.settle_commitment(p_space uuid,p_commitment uuid,p_amount_cents bigint,p_on date,p_mode text default 'partial',p_category uuid default null,p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare commitment finance.commitments; paid bigint; counterpart finance.ledger_accounts; payment_account finance.ledger_accounts; category finance.categories; card finance.credit_cards; statement_id uuid; entries jsonb; sign integer; effective_month date; tx_id uuid;
begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 9007199254740991 or p_on is null or p_mode is null or p_mode not in ('partial','match_actual','automatic') then raise exception 'Invalid settlement' using errcode = '23514'; end if;
  if p_client_uuid is not null then
    select t.id into tx_id from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id = t.id where t.financial_space_id = p_space and t.client_uuid = p_client_uuid and e.commitment_id = p_commitment;
    if tx_id is not null then
      if not exists(select 1 from finance.ledger_transactions t where t.id = tx_id and t.occurred_on = p_on and t.notes = jsonb_build_object('amount_cents',p_amount_cents,'mode',p_mode,'category',p_category)::text) then raise exception 'Client UUID reused with different settlement' using errcode = '23505'; end if;
      return tx_id;
    end if;
  end if;
  select * into commitment from finance.commitments where id = p_commitment and financial_space_id = p_space and cancelled_at is null and deleted_at is null and kind <> 'reminder' for update;
  if not found then raise exception 'Active financial commitment not found' using errcode = 'P0002'; end if;
  select paid_cents into paid from finance.commitment_settlements where id = p_commitment;
  if p_mode = 'match_actual' or (p_mode = 'automatic' and commitment.certainty = 'estimated' and p_amount_cents::numeric >= (commitment.due_amount_cents-paid)::numeric*0.9) then
    update finance.commitments set due_amount_cents = paid+p_amount_cents,version = version+1,updated_at = now() where id = commitment.id;
    insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'actual_amount_confirmed','commitment',commitment.id,to_jsonb(commitment),jsonb_build_object('amount_cents',paid+p_amount_cents));
  elsif p_amount_cents > commitment.due_amount_cents-paid then raise exception 'Payment exceeds remaining commitment' using errcode = '23514'; end if;
  if coalesce(p_category,commitment.category_id) is not null then
    select * into category from finance.categories where id = coalesce(p_category,commitment.category_id) and financial_space_id = p_space and ledger_account_id is not null and archived_at is null and deleted_at is null;
    if not found or category.kind <> (case commitment.direction when 'inflow' then 'income' else 'expense' end) then raise exception 'Choose a leaf category of the correct kind' using errcode = '23514'; end if;
    select * into counterpart from finance.ledger_accounts where id = category.ledger_account_id;
  else
    select * into counterpart from finance.ledger_accounts where id = commitment.counterpart_account_id and financial_space_id = p_space and allows_posting;
    if not found then raise exception 'Choose a settlement category or counterpart' using errcode = '23514'; end if;
  end if;
  sign := case commitment.direction when 'inflow' then -1 else 1 end;
  effective_month := private.next_open_competence(p_space,commitment.competence_month);
  entries := jsonb_build_array(jsonb_build_object('ledger_account_id',counterpart.id,'amount_cents',sign*p_amount_cents,'commitment_id',commitment.id,'reserve_id',commitment.reserve_id,
    'competence_month',effective_month,'original_competence_month',case when effective_month <> commitment.competence_month then commitment.competence_month end));
  if commitment.payment_method = 'card' then
    select * into card from finance.credit_cards where id = commitment.payment_credit_card_id and financial_space_id = p_space and status = 'active';
    if not found then raise exception 'Active payment card not found' using errcode = '23514'; end if;
    statement_id := private.ensure_card_statement(p_space,card.id,p_on);
    entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-p_amount_cents,'card_statement_id',statement_id));
  else
    select a.* into payment_account from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.id = commitment.payment_financial_account_id and f.financial_space_id = p_space and f.archived_at is null;
    if not found then raise exception 'Payment account not found' using errcode = '23514'; end if;
    entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',payment_account.id,'amount_cents',-sign*p_amount_cents));
  end if;
  tx_id := private.post_transaction_internal(p_space,jsonb_build_object('kind',case when commitment.payment_method = 'card' then 'card_purchase' when commitment.direction = 'inflow' then 'income' else 'expense' end,
    'occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',commitment.title,'notes',jsonb_build_object('amount_cents',p_amount_cents,'mode',p_mode,'category',p_category)::text,'client_uuid',p_client_uuid,'entries',entries),auth.uid());
  return tx_id;
end;
$$;
create function api.cancel_commitment(p_space uuid,p_commitment uuid,p_version integer,p_reason text) returns uuid language plpgsql security definer set search_path = '' as $$
declare commitment finance.commitments; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into commitment from finance.commitments where id = p_commitment and financial_space_id = p_space for update;
  if not found then raise exception 'Commitment not found' using errcode = 'P0002'; end if;
  if commitment.version <> p_version then raise exception 'Commitment changed; reload before editing' using errcode = '40001'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Cancellation reason required' using errcode = '23514'; end if;
  if exists(select 1 from finance.ledger_entries where commitment_id = commitment.id) then raise exception 'Cancel linked settlements before cancelling commitment' using errcode = '23514'; end if;
  update finance.commitments set cancelled_at = now(),cancelled_by = auth.uid(),cancellation_reason = p_reason,version = version+1,updated_at = now() where id = commitment.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'cancelled','commitment',commitment.id,to_jsonb(commitment),jsonb_build_object('reason',p_reason));
  return commitment.id;
end;
$$;
revoke all on function private.validate_commitment(),private.validate_commitment_entry(),private.commitment_settlement_within_due() from public,anon,authenticated;
revoke all on function api.create_commitment(uuid,jsonb),api.settle_commitment(uuid,uuid,bigint,date,text,uuid,uuid),api.cancel_commitment(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function api.create_commitment(uuid,jsonb),api.settle_commitment(uuid,uuid,bigint,date,text,uuid,uuid),api.cancel_commitment(uuid,uuid,integer,text) to authenticated;
commit;
