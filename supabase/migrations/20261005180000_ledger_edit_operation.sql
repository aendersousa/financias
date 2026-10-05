begin;
create function api.edit_transaction(p_space uuid,p_transaction uuid,p_version integer,p_payload jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tx finance.ledger_transactions; before_entries jsonb; entry jsonb; line smallint := 0; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into tx from finance.ledger_transactions where financial_space_id = p_space and id = p_transaction for update;
  if not found then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  if tx.version <> p_version then raise exception 'Transaction changed; reload before editing' using errcode = '40001'; end if;
  if tx.status = 'cancelled' then raise exception 'Cancelled transactions are immutable' using errcode = '23514'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Edit reason required' using errcode = '23514'; end if;
  if jsonb_typeof(p_payload->'entries') is distinct from 'array' or jsonb_array_length(p_payload->'entries') < 2 then raise exception 'At least two entries required' using errcode = '23514'; end if;
  if p_payload->>'kind' is distinct from tx.kind then raise exception 'Changing transaction kind requires cancellation and recreation' using errcode = '23514'; end if;
  select jsonb_agg(to_jsonb(e) order by line_number) into before_entries from finance.ledger_entries e where ledger_transaction_id = tx.id;
  update finance.ledger_transactions set occurred_on = (p_payload->>'occurred_on')::date,competence_month = (p_payload->>'competence_month')::date,
    description = p_payload->>'description',notes = p_payload->>'notes',version = version + 1,updated_at = now(),updated_by = auth.uid() where id = tx.id;
  delete from finance.ledger_entries where ledger_transaction_id = tx.id;
  for entry in select value from jsonb_array_elements(p_payload->'entries') loop
    line := line + 1;
    if entry->>'amount_cents' !~ '^-?[0-9]+$' then raise exception 'Amount must be integer cents' using errcode = '23514'; end if;
    insert into finance.ledger_entries(financial_space_id,ledger_transaction_id,ledger_account_id,amount_cents,line_number,competence_month,created_by)
    values(p_space,tx.id,(entry->>'ledger_account_id')::uuid,(entry->>'amount_cents')::bigint,line,(entry->>'competence_month')::date,auth.uid());
  end loop;
  if (select sum(amount_cents) from finance.ledger_entries where ledger_transaction_id = tx.id) <> 0 then raise exception 'Transaction must sum to zero' using errcode = '23514'; end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data)
    values(p_space,auth.uid(),'edited','ledger_transaction',tx.id,jsonb_build_object('transaction',to_jsonb(tx),'entries',before_entries),jsonb_build_object('payload',p_payload,'reason',p_reason));
  return tx.id;
end;
$$;
revoke all on function api.edit_transaction(uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function api.edit_transaction(uuid,uuid,integer,jsonb,text) to authenticated;
commit;
