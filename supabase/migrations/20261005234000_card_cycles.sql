begin;
create function private.cancel_card_system_event(p_transaction uuid) returns void language plpgsql set search_path = '' as $$
declare tx finance.ledger_transactions; begin
  select * into tx from finance.ledger_transactions where id = p_transaction and status = 'posted' for update;
  if not found then return; end if;
  update finance.ledger_transactions set status = 'cancelled',cancellation_kind = 'system_reprocessed',cancelled_at = now(),cancellation_reason = 'Recálculo dos eventos de cartão',version = version+1,updated_at = now() where id = tx.id;
  insert into finance.audit_logs(financial_space_id,action,entity_type,entity_id,before_data) values(tx.financial_space_id,'system_reprocessed','ledger_transaction',tx.id,to_jsonb(tx));
end;
$$;
create function private.reconcile_card_cycles(p_space uuid,p_card uuid) returns void language plpgsql set search_path = '' as $$
declare card finance.credit_cards; statement finance.card_statements; old_event finance.ledger_transactions; old_amount bigint; remaining bigint; next_statement uuid; entries jsonb; today date := private.space_today(p_space); cycle text; incoming_rollover boolean; event_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into card from finance.credit_cards where id = p_card and financial_space_id = p_space;
  if not found or card.status = 'archived' then return; end if;
  perform private.ensure_card_statement(p_space,p_card,today);
  for statement in select * from finance.card_statements where credit_card_id = p_card order by reference_month for update loop
    cycle := case when today < statement.period_start then 'future' when today <= statement.period_end then 'open' else 'closed' end;
    if statement.status <> cycle then
      update finance.card_statements set status = cycle,closed_at = case when cycle = 'closed' then now() end,
        closing_amount_cents = case when cycle = 'closed' then (select coalesce(sum(amount_cents),0)::bigint from finance.ledger_entries where card_statement_id = statement.id) end,
        updated_at = now(),version = version+1 where id = statement.id returning * into statement;
      insert into finance.audit_logs(financial_space_id,action,entity_type,entity_id,after_data) values(p_space,'cycle_changed','card_statement',statement.id,jsonb_build_object('status',cycle));
    end if;
    if cycle <> 'closed' then continue; end if;
    select t.* into old_event from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id = t.id
      where t.financial_space_id = p_space and t.kind = 'card_credit_carry' and e.card_statement_id = statement.id and e.amount_cents < 0 order by (t.status = 'posted') desc, split_part(t.system_key,':',3)::integer desc limit 1;
    select coalesce(-sum(e.amount_cents),0)::bigint into remaining from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id
      where e.card_statement_id = statement.id and t.status = 'posted' and t.occurred_on <= statement.period_end+1 and (old_event.id is null or t.id <> old_event.id);
    if old_event.id is not null and old_event.status = 'posted' then select -amount_cents into old_amount from finance.ledger_entries where ledger_transaction_id = old_event.id and card_statement_id = statement.id limit 1; else old_amount := 0; end if;
    if greatest(-remaining,0) <> old_amount then
      if old_event.id is not null then perform private.cancel_card_system_event(old_event.id); end if;
      update finance.card_statements set version = version+1,updated_at = now() where id = statement.id returning * into statement;
      if remaining < 0 then
        next_statement := private.ensure_card_statement(p_space,p_card,statement.period_end+1);
        entries := jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',remaining,'card_statement_id',statement.id),jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-remaining,'card_statement_id',next_statement));
        perform private.post_transaction_internal(p_space,jsonb_build_object('kind','card_credit_carry','source','system','system_key','credit_carry:' || statement.id || ':' || statement.version,
          'occurred_on',statement.period_end+1,'competence_month',date_trunc('month',statement.period_end+1)::date,'description','Transporte de saldo credor','entries',entries),null);
      end if;
    end if;
    if today <= statement.effective_due_on then continue; end if;
    select t.* into old_event from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id = t.id
      where t.financial_space_id = p_space and t.kind = 'card_rollover' and e.card_statement_id = statement.id and e.amount_cents > 0 order by (t.status = 'posted') desc, split_part(t.system_key,':',3)::integer desc limit 1;
    select coalesce(-sum(e.amount_cents),0)::bigint into remaining from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id
      where e.card_statement_id = statement.id and t.status = 'posted' and t.occurred_on <= statement.effective_due_on and (old_event.id is null or t.id <> old_event.id);
    select exists(select 1 from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where e.card_statement_id = statement.id and t.kind = 'card_rollover' and t.status = 'posted' and e.amount_cents < 0) into incoming_rollover;
    if incoming_rollover and remaining > 0 then
      update finance.card_statements set balance_to_install = true where id = statement.id;
      continue;
    end if;
    if old_event.id is not null and old_event.status = 'posted' then select amount_cents into old_amount from finance.ledger_entries where ledger_transaction_id = old_event.id and card_statement_id = statement.id limit 1; else old_amount := 0; end if;
    if greatest(remaining,0) <> old_amount then
      if old_event.id is not null then perform private.cancel_card_system_event(old_event.id); end if;
      update finance.card_statements set version = version+1,updated_at = now() where id = statement.id returning * into statement;
      if remaining > 0 then
        next_statement := private.ensure_card_statement(p_space,p_card,statement.period_end+1);
        entries := jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',remaining,'card_statement_id',statement.id),jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-remaining,'card_statement_id',next_statement));
        event_id := private.post_transaction_internal(p_space,jsonb_build_object('kind','card_rollover','source','system','system_key','rollover:' || statement.id || ':' || statement.version,
          'occurred_on',statement.effective_due_on,'competence_month',date_trunc('month',statement.effective_due_on)::date,'description','Saldo anterior de fatura',
          'related_transaction_id',old_event.id,'relation_type',case when old_event.id is not null then 'rollover_of' end,'entries',entries),null);
        update finance.card_statements set charges_to_confirm = true where id = next_statement;
      end if;
    end if;
  end loop;
  update finance.card_authorizations set status = 'released',resolved_at = now(),updated_at = now() where credit_card_id = p_card and kind = 'payment_hold' and status = 'pending' and release_on <= today;
  update finance.card_authorizations set status = 'expired',resolved_at = now(),updated_at = now() where credit_card_id = p_card and kind = 'purchase' and status = 'pending' and expires_on < today;
end;
$$;
create function private.prepare_backdated_card_payment(p_space uuid,p_card uuid,p_on date) returns void language plpgsql set search_path = '' as $$
declare event_id uuid; begin
  for event_id in select distinct t.id from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id = t.id join finance.card_statements s on s.id = e.card_statement_id
    where t.financial_space_id = p_space and s.credit_card_id = p_card and t.status = 'posted' and
      ((t.kind = 'card_rollover' and e.amount_cents > 0 and p_on <= s.effective_due_on) or (t.kind = 'card_credit_carry' and e.amount_cents < 0 and p_on <= s.period_end+1)) loop
    perform private.cancel_card_system_event(event_id);
  end loop;
end;
$$;
create function api.job_card_cycles() returns jsonb language plpgsql security definer set search_path = '' as $$
declare card record; processed integer := 0; failed integer := 0; begin
  for card in select id,financial_space_id from finance.credit_cards where status <> 'archived' order by financial_space_id,id loop
    begin
      perform private.reconcile_card_cycles(card.financial_space_id,card.id); processed := processed+1;
    exception when check_violation then
      failed := failed+1;
      insert into finance.audit_logs(financial_space_id,action,entity_type,entity_id,after_data) values(card.financial_space_id,'job_requires_review','credit_card',card.id,jsonb_build_object('job','card_cycles','error',sqlerrm));
    end;
  end loop;
  return jsonb_build_object('processed',processed,'requires_review',failed);
end;
$$;
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.pay_card(uuid,uuid,uuid,bigint,date,text,uuid)'::regprocedure);
  definition := replace(definition,'entries := jsonb_build_array(jsonb_build_object(''ledger_account_id'',p_origin_ledger',
    'perform private.reconcile_card_cycles(p_space,p_card); perform private.prepare_backdated_card_payment(p_space,p_card,p_on);
     entries := jsonb_build_array(jsonb_build_object(''ledger_account_id'',p_origin_ledger');
  definition := replace(definition,'return tx_id;','perform private.reconcile_card_cycles(p_space,p_card); return tx_id;');
  execute definition;
end $$;
create function private.reconcile_cancelled_card_payment() returns trigger language plpgsql set search_path = '' as $$
declare card record; begin
  if new.status = 'cancelled' and old.status = 'posted' and old.kind = 'card_payment' then
    for card in select distinct c.id,c.financial_space_id from finance.credit_cards c join finance.ledger_entries e on e.ledger_account_id = c.ledger_account_id where e.ledger_transaction_id = new.id loop
      perform private.reconcile_card_cycles(card.financial_space_id,card.id);
    end loop;
  end if;
  return null;
end;
$$;
create trigger cancelled_card_payment_cycles after update on finance.ledger_transactions for each row execute function private.reconcile_cancelled_card_payment();
revoke all on function private.cancel_card_system_event(uuid),private.reconcile_card_cycles(uuid,uuid),private.prepare_backdated_card_payment(uuid,uuid,date),private.reconcile_cancelled_card_payment() from public,anon,authenticated;
revoke all on function api.job_card_cycles() from public,anon,authenticated;
grant usage on schema api,finance to service_role;
grant execute on function api.job_card_cycles() to service_role;
commit;
