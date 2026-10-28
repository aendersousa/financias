begin;
alter table finance.ledger_entries add column reconciliation_status text check(reconciliation_status in('unreconciled','suggested','reconciled')),
  add column reconciliation_source text check(reconciliation_source in('manual','import')),add column reconciled_at timestamptz,add column import_candidate_id uuid,
  add constraint reconciliation_timestamp check((reconciliation_status is not distinct from 'reconciled') = (reconciled_at is not null) and (reconciliation_source is null or reconciliation_status = 'reconciled'));
update finance.ledger_entries e set reconciliation_status = 'unreconciled' from finance.ledger_accounts a where a.id = e.ledger_account_id and a.owner_type in('financial_account','credit_card');
create function private.validate_reconciliation() returns trigger language plpgsql set search_path = '' as $$
declare owner text; begin
  select owner_type into owner from finance.ledger_accounts where id = new.ledger_account_id;
  if owner in('financial_account','credit_card') then
    if tg_op = 'INSERT' and new.reconciliation_status is null then new.reconciliation_status := 'unreconciled'; end if;
    if new.reconciliation_status is null then raise exception 'Financial entry requires reconciliation status' using errcode = '23514'; end if;
  elsif new.reconciliation_status is not null or new.reconciled_at is not null or new.reconciliation_source is not null or new.import_candidate_id is not null then raise exception 'Only financial or card entries can be reconciled' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger entry_reconciliation_valid before insert or update on finance.ledger_entries for each row execute function private.validate_reconciliation();
do $$ declare definition text; begin
  definition := pg_get_functiondef('private.protect_ledger_mutation()'::regprocedure);
  definition := replace(definition,'if tg_table_name = ''ledger_transactions'' then',
    'if tg_op = ''UPDATE'' then
       if tg_table_name = ''ledger_transactions'' and (to_jsonb(old)->>''status'') = ''posted'' and (to_jsonb(new)-array[''description'',''notes'',''version'',''updated_at'',''updated_by'']) = (to_jsonb(old)-array[''description'',''notes'',''version'',''updated_at'',''updated_by'']) then return new; end if;
       if tg_table_name = ''ledger_entries'' and (to_jsonb(new)-array[''reconciliation_status'',''reconciliation_source'',''reconciled_at'',''import_candidate_id'',''updated_at'']) = (to_jsonb(old)-array[''reconciliation_status'',''reconciliation_source'',''reconciled_at'',''import_candidate_id'',''updated_at'']) then return new; end if;
     end if;
     if tg_table_name = ''ledger_transactions'' then');
  execute definition;
  definition := pg_get_functiondef('private.validate_card_entry()'::regprocedure);
  definition := replace(definition,'if tg_op <> ''INSERT'' then',
    'if tg_op = ''UPDATE'' and (to_jsonb(new)-array[''reconciliation_status'',''reconciliation_source'',''reconciled_at'',''import_candidate_id'',''updated_at'']) = (to_jsonb(old)-array[''reconciliation_status'',''reconciliation_source'',''reconciled_at'',''import_candidate_id'',''updated_at'']) then return new; end if;
     if tg_op <> ''INSERT'' then');
  execute definition;
  definition := pg_get_functiondef('private.protect_closed_card_transaction()'::regprocedure);
  definition := replace(definition,'BEGIN',
    'BEGIN
     if old.status = ''posted'' and (to_jsonb(new)-array[''description'',''notes'',''version'',''updated_at'',''updated_by'']) = (to_jsonb(old)-array[''description'',''notes'',''version'',''updated_at'',''updated_by'']) then return new; end if;');
  -- PostgreSQL preserves the original lower-case function body.
  if position('array[''description''' in definition) = 0 then
    definition := replace(definition,'begin',
      'begin
       if old.status = ''posted'' and (to_jsonb(new)-array[''description'',''notes'',''version'',''updated_at'',''updated_by'']) = (to_jsonb(old)-array[''description'',''notes'',''version'',''updated_at'',''updated_by'']) then return new; end if;');
  end if;
  execute definition;
  definition := pg_get_functiondef('api.cancel_transaction(uuid,uuid,integer,text)'::regprocedure);
  definition := replace(definition,'if tx.version <> p_version then',
    'if exists(select 1 from finance.ledger_entries where ledger_transaction_id = tx.id and reconciliation_status = ''reconciled'') then raise exception ''Undo reconciliation before cancelling transaction'' using errcode = ''23514''; end if;
     if tx.version <> p_version then');
  execute definition;
end $$;
create function api.annotate_transaction(p_space uuid,p_transaction uuid,p_version integer,p_changes jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare tx finance.ledger_transactions; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into tx from finance.ledger_transactions where id = p_transaction and financial_space_id = p_space for update;
  if not found then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  if tx.status <> 'posted' then raise exception 'Cancelled transactions are immutable' using errcode = '23514'; end if;
  if tx.version is distinct from p_version then raise exception 'Transaction changed; reload before editing' using errcode = '40001'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_changes) field where field not in('description','notes')) then raise exception 'Only description and notes may be annotated' using errcode = '23514'; end if;
  update finance.ledger_transactions set description = coalesce(p_changes->>'description',description),notes = case when p_changes ? 'notes' then p_changes->>'notes' else notes end,version = version+1,updated_at = now(),updated_by = auth.uid() where id = tx.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'annotated','ledger_transaction',tx.id,to_jsonb(tx),p_changes);
  return tx.id;
end;
$$;
create function api.reconcile_entry(p_space uuid,p_entry uuid,p_version integer,p_reconciled boolean) returns uuid language plpgsql security definer set search_path = '' as $$
declare entry finance.ledger_entries; tx finance.ledger_transactions; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into entry from finance.ledger_entries where id = p_entry and financial_space_id = p_space for update;
  if not found or entry.reconciliation_status is null then raise exception 'Financial entry not found' using errcode = '23514'; end if;
  select * into tx from finance.ledger_transactions where id = entry.ledger_transaction_id for update;
  if tx.status <> 'posted' then raise exception 'Cancelled transactions cannot be reconciled' using errcode = '23514'; end if;
  if tx.version is distinct from p_version then raise exception 'Transaction changed; reload before editing' using errcode = '40001'; end if;
  if p_reconciled is null then raise exception 'Reconciliation choice required' using errcode = '23514'; end if;
  if entry.import_candidate_id is not null then raise exception 'Undo imported reconciliation through import service' using errcode = '23514'; end if;
  update finance.ledger_entries set reconciliation_status = case when p_reconciled then 'reconciled' else 'unreconciled' end,reconciliation_source = case when p_reconciled then 'manual' end,reconciled_at = case when p_reconciled then now() end,updated_at = now() where id = entry.id;
  update finance.ledger_transactions set version = version+1,updated_at = now(),updated_by = auth.uid() where id = tx.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'reconciliation_changed','ledger_entry',entry.id,to_jsonb(entry),jsonb_build_object('reconciled',p_reconciled));
  return tx.id;
end;
$$;
create function private.restore_reconciliation(p_transaction uuid,p_before jsonb) returns void language plpgsql set search_path = '' as $$
declare entry finance.ledger_entries; original jsonb; begin
  for entry in select * from finance.ledger_entries where ledger_transaction_id = p_transaction loop
    select value into original from jsonb_array_elements(p_before) where (value->>'line_number')::smallint = entry.line_number and (value->>'ledger_account_id')::uuid = entry.ledger_account_id and (value->>'amount_cents')::bigint = entry.amount_cents;
    if original->>'reconciliation_status' = 'reconciled' then
      update finance.ledger_entries set reconciliation_status = 'reconciled',reconciliation_source = original->>'reconciliation_source',reconciled_at = (original->>'reconciled_at')::timestamptz,import_candidate_id = (original->>'import_candidate_id')::uuid where id = entry.id;
    end if;
  end loop;
end;
$$;
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.edit_transaction(uuid,uuid,integer,jsonb,text)'::regprocedure);
  definition := replace(definition,'update finance.ledger_transactions set occurred_on',
    'if not coalesce((p_payload->>''acknowledge_reconciliation_change'')::boolean,false) and exists(select 1 from jsonb_array_elements(before_entries) prior where prior->>''reconciliation_status'' = ''reconciled'' and not exists(select 1 from jsonb_array_elements(p_payload->''entries'') with ordinality incoming(value,line) where (incoming.value->>''ledger_account_id'')::uuid = (prior->>''ledger_account_id'')::uuid and (incoming.value->>''amount_cents'')::bigint = (prior->>''amount_cents'')::bigint and incoming.line = (prior->>''line_number'')::smallint)) then
       raise exception ''Changing reconciled amounts requires confirmation'' using errcode = ''23514'';
     end if;
     update finance.ledger_transactions set occurred_on');
  definition := replace(definition,'return tx.id;','perform private.restore_reconciliation(tx.id,before_entries); return tx.id;');
  execute definition;
end $$;
create function api.transaction_detail(p_space uuid,p_transaction uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare tx finance.ledger_transactions; begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode = '42501'; end if;
  select * into tx from finance.ledger_transactions where id = p_transaction and financial_space_id = p_space;
  if not found then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('transaction',to_jsonb(tx),'entries',(select jsonb_agg(to_jsonb(e) || jsonb_build_object('account_name',a.name,'account_class',a.account_class,'owner_type',a.owner_type) order by e.line_number) from finance.ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id where e.ledger_transaction_id = tx.id));
end;
$$;
revoke all on function private.validate_reconciliation(),private.restore_reconciliation(uuid,jsonb) from public,anon,authenticated;
revoke all on function api.annotate_transaction(uuid,uuid,integer,jsonb),api.reconcile_entry(uuid,uuid,integer,boolean),api.transaction_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function api.annotate_transaction(uuid,uuid,integer,jsonb),api.reconcile_entry(uuid,uuid,integer,boolean),api.transaction_detail(uuid,uuid) to authenticated;
commit;
