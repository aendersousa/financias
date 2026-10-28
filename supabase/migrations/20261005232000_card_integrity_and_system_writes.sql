begin;
-- Only trusted functions can perform system events; actors remain NULL for jobs.
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.post_transaction(uuid,jsonb)'::regprocedure);
  definition := replace(definition,'api.post_transaction(p_space uuid, p_payload jsonb)','private.post_transaction_internal(p_space uuid, p_payload jsonb, p_actor uuid)');
  definition := replace(definition,'perform private.require_writer(p_space);','');
  definition := replace(definition,'auth.uid()','p_actor');
  definition := replace(definition,'client_uuid,client_payload_hash,related_transaction_id','client_uuid,client_payload_hash,system_key,related_transaction_id');
  definition := replace(definition,'else payload_hash end,(p_payload->>''related_transaction_id'')','else payload_hash end,p_payload->>''system_key'',(p_payload->>''related_transaction_id'')');
  definition := replace(definition,'payload_hash := sha256(convert_to(p_payload::text,''UTF8''));',
    'payload_hash := sha256(convert_to(p_payload::text,''UTF8''));
     if p_payload->>''system_key'' is not null then
       select * into existing from finance.ledger_transactions where financial_space_id = p_space and system_key = p_payload->>''system_key'';
       if found then return existing.id; end if;
     end if;');
  execute definition;
end $$;
revoke all on function private.post_transaction_internal(uuid,jsonb,uuid) from public,anon,authenticated;
create or replace function api.post_transaction(p_space uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_writer(p_space);
  if p_payload->>'kind' in ('card_rollover','card_credit_carry','card_installment_plan','card_prepayment','refund','card_correction','card_charges') or p_payload->>'system_key' is not null then raise exception 'Use the dedicated financial operation' using errcode = '42501'; end if;
  return private.post_transaction_internal(p_space,p_payload,auth.uid());
end;
$$;

create function private.protect_closed_card_transaction() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from finance.ledger_entries e join finance.card_statements s on s.id = e.card_statement_id where e.ledger_transaction_id = old.id and s.status = 'closed') then
    if not(new.status = 'cancelled' and old.status = 'posted' and old.kind in ('card_payment','card_rollover','card_credit_carry','card_installment_plan')) then raise exception 'Transaction contains closed statement entries' using errcode = '23514'; end if;
    if old.kind = 'card_installment_plan' and exists(select 1 from finance.ledger_entries e join finance.card_statements s on s.id = e.card_statement_id where e.ledger_transaction_id = old.id and e.amount_cents < 0 and s.status = 'closed') then raise exception 'Installment plan has closed destination statements' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
create trigger closed_card_transaction before update on finance.ledger_transactions for each row execute function private.protect_closed_card_transaction();
create function private.cancel_payment_hold() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status = 'posted' then
    update finance.card_authorizations set status = 'cancelled',resolved_at = now(),updated_at = now() where payment_transaction_id = new.id and status = 'pending';
  end if;
  return null;
end;
$$;
create trigger cancelled_payment_hold after update on finance.ledger_transactions for each row execute function private.cancel_payment_hold();
-- System transports may only be cancelled/recalculated by their dedicated service.
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.cancel_transaction(uuid,uuid,integer,text)'::regprocedure);
  definition := replace(definition,'if tx.version <> p_version then',
    'if tx.kind in (''card_rollover'',''card_credit_carry'') then raise exception ''System events cannot be cancelled directly'' using errcode = ''42501''; end if;
     if tx.version <> p_version then');
  execute definition;
  definition := pg_get_functiondef('api.pay_card(uuid,uuid,uuid,bigint,date,text,uuid)'::regprocedure);
  definition := replace(definition,'t.kind = ''card_payment'' and t.occurred_on = p_on','t.kind = ''card_payment'' and t.notes = ''payment_channel:'' || p_channel and t.occurred_on = p_on');
  definition := replace(definition,'''description'',''Pagamento: '' || card.name,','''description'',''Pagamento: '' || card.name,''notes'',''payment_channel:'' || p_channel,');
  execute definition;
end $$;
revoke all on function private.protect_closed_card_transaction(),private.cancel_payment_hold() from public,anon,authenticated;
commit;
