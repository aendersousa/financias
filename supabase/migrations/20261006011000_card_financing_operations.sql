begin;
alter table finance.card_statements add column confirmed_charges jsonb,add column charges_transaction_id uuid,
  add constraint statement_charges_transaction foreign key(financial_space_id,charges_transaction_id) references finance.ledger_transactions(financial_space_id,id);
create function private.ensure_system_category(p_space uuid,p_role text) returns uuid language plpgsql set search_path = '' as $$
declare ledger uuid; category uuid; name text; kind text; begin
  select ledger_account_id into ledger from finance.categories where financial_space_id = p_space and system_role = p_role;
  if found then return ledger; end if;
  if p_role not in('financial_charges','taxes_fees','cashback','benefits','discounts_obtained') then raise exception 'Invalid system category' using errcode = '23514'; end if;
  kind := case when p_role in('financial_charges','taxes_fees') then 'expense' else 'income' end;
  name := case p_role when 'financial_charges' then 'Encargos financeiros' when 'taxes_fees' then 'Impostos e taxas' when 'cashback' then 'Cashback' when 'benefits' then 'Benefícios' else 'Descontos obtidos' end;
  insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,name,created_by) values(p_space,kind,'category',name,auth.uid()) returning id into ledger;
  insert into finance.categories(financial_space_id,ledger_account_id,kind,name,system_role,income_class,created_by)
    values(p_space,ledger,kind,name,p_role,case when kind = 'income' then case p_role when 'cashback' then 'cashback' when 'benefits' then 'benefit' else 'financial' end end,auth.uid());
  return ledger;
end;
$$;
create function private.replay_operation(p_space uuid,p_client uuid,p_kind text,p_request jsonb) returns uuid language plpgsql stable set search_path = '' as $$
declare previous finance.ledger_transactions; begin
  if p_client is null then return null; end if;
  select * into previous from finance.ledger_transactions where financial_space_id = p_space and client_uuid = p_client;
  if not found then return null; end if;
  if previous.kind is distinct from p_kind or previous.notes is distinct from p_request::text then raise exception 'Client UUID reused with different operation' using errcode = '23505'; end if;
  return previous.id;
end;
$$;
create function api.confirm_card_charges(p_space uuid,p_statement uuid,p_components jsonb,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare statement finance.card_statements; card finance.credit_cards; charges uuid; entries jsonb := '[]'; part record; total numeric := 0; tx uuid; request jsonb; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request := jsonb_build_object('statement',p_statement,'components',p_components);
  tx := private.replay_operation(p_space,p_client_uuid,'card_charges',request); if tx is not null then return tx; end if;
  select * into statement from finance.card_statements where id = p_statement and financial_space_id = p_space for update;
  if not found or statement.status <> 'closed' then raise exception 'Charges require a closed statement' using errcode = '23514'; end if;
  if statement.confirmed_charges is not null then
    if statement.confirmed_charges = p_components then return coalesce(statement.charges_transaction_id,statement.id); end if;
    raise exception 'Charges already confirmed; register a correction' using errcode = '23514';
  end if;
  if jsonb_typeof(p_components) is distinct from 'object' then raise exception 'Invalid charge components' using errcode = '23514'; end if;
  charges := private.ensure_system_category(p_space,'financial_charges');
  select * into card from finance.credit_cards where id = statement.credit_card_id;
  for part in select key,value from jsonb_each_text(p_components) loop
    if part.key not in('revolving_interest','late_fee','late_interest','iof') or part.value !~ '^[0-9]+$' or part.value::numeric > 9007199254740991 then raise exception 'Invalid charge components' using errcode = '23514'; end if;
    total := total+part.value::bigint;
    if part.value::bigint > 0 then entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',charges,'amount_cents',part.value::bigint)); end if;
  end loop;
  if total > 9007199254740991 then raise exception 'Charges exceed safe cents range' using errcode = '23514'; end if;
  if total > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-total,'card_statement_id',statement.id));
    tx := private.post_transaction_internal(p_space,jsonb_build_object('kind','card_charges','occurred_on',statement.closing_on,'competence_month',date_trunc('month',statement.closing_on)::date,
      'description','Encargos: ' || card.name,'notes',request::text,'client_uuid',p_client_uuid,'entries',entries),auth.uid());
  end if;
  update finance.card_statements set charges_to_confirm = false,confirmed_charges = p_components,charges_transaction_id = tx,version = version+1,updated_at = now() where id = statement.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'charges_confirmed','card_statement',statement.id,to_jsonb(statement),request);
  return coalesce(tx,statement.id);
end;
$$;
create function api.install_card_statement(p_space uuid,p_statement uuid,p_on date,p_total_cents bigint,p_count integer,p_parts bigint[] default null,p_previous uuid default null,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare statement finance.card_statements; card finance.credit_cards; remaining bigint; parts bigint[]; total numeric; charges uuid; entries jsonb; next_statement uuid; idx integer; request jsonb; tx uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request := jsonb_build_object('statement',p_statement,'on',p_on,'total',p_total_cents,'count',p_count,'parts',p_parts,'previous',p_previous);
  tx := private.replay_operation(p_space,p_client_uuid,'card_installment_plan',request); if tx is not null then return tx; end if;
  if p_on is null or p_count is null or p_count not between 1 and 600 or p_total_cents is null or p_total_cents not between 1 and 9007199254740991 then raise exception 'Invalid installment plan' using errcode = '23514'; end if;
  select * into statement from finance.card_statements where financial_space_id = p_space and id = p_statement for update;
  if not found or statement.status <> 'closed' or p_on < statement.closing_on then raise exception 'Plan requires a closed statement' using errcode = '23514'; end if;
  select * into card from finance.credit_cards where id = statement.credit_card_id and status <> 'archived';
  if not found then raise exception 'Card not available' using errcode = '23514'; end if;
  select coalesce(-sum(e.amount_cents),0)::bigint into remaining from finance.posted_ledger_entries e where e.card_statement_id = statement.id;
  if remaining <= 0 then raise exception 'Statement has no debt to finance' using errcode = '23514'; end if;
  if p_previous is not null and not exists(select 1 from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id = t.id where t.id = p_previous and t.financial_space_id = p_space and t.kind = 'card_installment_plan' and t.status = 'cancelled' and e.card_statement_id = statement.id and e.amount_cents > 0) then raise exception 'Invalid previous plan' using errcode = '23514'; end if;
  parts := coalesce(p_parts,private.divide_cents(p_total_cents,array_fill(1::bigint,array[p_count]),case when card.installment_remainder = 'last' then array(select i from generate_series(p_count,1,-1) i) else null end));
  if array_ndims(parts) is distinct from 1 or array_lower(parts,1) is distinct from 1 or array_length(parts,1) is distinct from p_count or array_position(parts,null) is not null or exists(select 1 from unnest(parts) amount where amount <= 0 or amount > 9007199254740991) then raise exception 'Invalid installment amounts' using errcode = '23514'; end if;
  select sum(amount) into total from unnest(parts) amount;
  if total <> p_total_cents or total < remaining then raise exception 'Plan total must cover principal' using errcode = '23514'; end if;
  entries := jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',remaining,'card_statement_id',statement.id));
  for idx in 1..p_count loop
    next_statement := private.ensure_card_statement(p_space,card.id,statement.period_end+1,idx-1);
    if exists(select 1 from finance.card_statements where id = next_statement and status = 'closed') then raise exception 'Plan destination already closed' using errcode = '23514'; end if;
    entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-parts[idx],'card_statement_id',next_statement,'installment_number',case when p_count > 1 then idx end,'installment_count',case when p_count > 1 then p_count end));
  end loop;
  if total > remaining then
    charges := private.ensure_system_category(p_space,'financial_charges');
    entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',charges,'amount_cents',total-remaining));
  end if;
  tx := private.post_transaction_internal(p_space,jsonb_build_object('kind','card_installment_plan','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description','Parcelamento: ' || card.name,
    'notes',request::text,'related_transaction_id',p_previous,'relation_type',case when p_previous is not null then 'installment_plan_of' end,'client_uuid',p_client_uuid,'entries',entries),auth.uid());
  update finance.card_statements set balance_to_install = false,version = version+1,updated_at = now() where id = statement.id;
  return tx;
end;
$$;
create function api.prepay_card_installments(p_space uuid,p_original uuid,p_numbers integer[],p_discount_cents bigint,p_on date,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare original finance.ledger_transactions; card finance.credit_cards; selected record; next_statement uuid; entries jsonb := '[]'; principal numeric := 0; remaining bigint; charges uuid; discounts uuid; available bigint; against_charges bigint; requested integer[]; request jsonb; tx uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request := jsonb_build_object('original',p_original,'numbers',p_numbers,'discount',p_discount_cents,'on',p_on);
  tx := private.replay_operation(p_space,p_client_uuid,'card_prepayment',request); if tx is not null then return tx; end if;
  if p_on is null or p_discount_cents is null or p_discount_cents not between 0 and 9007199254740991 or coalesce(array_length(p_numbers,1),0) = 0 or array_position(p_numbers,null) is not null then raise exception 'Invalid prepayment' using errcode = '23514'; end if;
  select array_agg(distinct n order by n) into requested from unnest(p_numbers) n;
  if cardinality(requested) <> cardinality(p_numbers) then raise exception 'Duplicate installment numbers' using errcode = '23514'; end if;
  select * into original from finance.ledger_transactions where id = p_original and financial_space_id = p_space and kind = 'card_purchase' and status = 'posted' for update;
  if not found or p_on < original.occurred_on then raise exception 'Purchase not available' using errcode = '23514'; end if;
  select c.* into card from finance.credit_cards c join finance.ledger_entries e on e.ledger_account_id = c.ledger_account_id where e.ledger_transaction_id = original.id limit 1;
  next_statement := private.ensure_card_statement(p_space,card.id,p_on);
  if not exists(select 1 from finance.card_statements where id = next_statement and status = 'open') then raise exception 'Prepayment destination must be open' using errcode = '23514'; end if;
  if (select count(*) from finance.ledger_entries where ledger_transaction_id = original.id and installment_number = any(requested)) <> cardinality(requested) then raise exception 'Installment not found' using errcode = '23514'; end if;
  for selected in select e.*,s.status as cycle from finance.ledger_entries e join finance.card_statements s on s.id = e.card_statement_id where e.ledger_transaction_id = original.id and e.installment_number = any(requested) order by e.installment_number loop
    if selected.cycle <> 'future' then raise exception 'Only future installments can be prepaid' using errcode = '23514'; end if;
    select -selected.amount_cents-coalesce(sum(e.amount_cents),0) into remaining from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where t.related_transaction_id = original.id and t.status = 'posted' and e.card_statement_id = selected.card_statement_id;
    if remaining <= 0 then raise exception 'Installment already refunded or prepaid' using errcode = '23514'; end if;
    principal := principal+remaining;
    entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',remaining,'card_statement_id',selected.card_statement_id,'installment_number',selected.installment_number,'installment_count',selected.installment_count));
  end loop;
  if principal > 9007199254740991 or p_discount_cents >= principal then raise exception 'Invalid prepayment discount' using errcode = '23514'; end if;
  entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-(principal-p_discount_cents),'card_statement_id',next_statement));
  if p_discount_cents > 0 then
    charges := private.ensure_system_category(p_space,'financial_charges');
    select greatest(0,coalesce(sum(e.amount_cents),0))::bigint into available from finance.posted_ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where e.ledger_account_id = charges and (t.id = original.id or t.related_transaction_id = original.id);
    against_charges := least(available,p_discount_cents);
    if against_charges > 0 then entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',charges,'amount_cents',-against_charges)); end if;
    if p_discount_cents > against_charges then
      discounts := private.ensure_system_category(p_space,'discounts_obtained');
      entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',discounts,'amount_cents',-(p_discount_cents-against_charges)));
    end if;
  end if;
  return private.post_transaction_internal(p_space,jsonb_build_object('kind','card_prepayment','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',left('Antecipação: ' || original.description,200),
    'notes',request::text,'related_transaction_id',original.id,'relation_type','prepayment_of','client_uuid',p_client_uuid,'entries',entries),auth.uid());
end;
$$;
create or replace function private.reject_unimplemented_operations() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind not in ('opening','expense','income','transfer','balance_adjustment','investment_contribution','investment_redemption','investment_result','person_settlement','loan_disbursement','loan_payment','card_purchase','card_payment','refund','card_rollover','card_credit_carry','card_charges','card_installment_plan','card_prepayment') then raise exception 'Operation requires a financial module not yet enabled' using errcode = '0A000'; end if;
  return new;
end;
$$;
do $$ declare definition text; begin
  definition := pg_get_functiondef('private.reconcile_card_cycles(uuid,uuid)'::regprocedure);
  definition := replace(definition,'if today <= statement.effective_due_on then continue; end if;',
    'if today <= statement.effective_due_on or exists(select 1 from finance.posted_ledger_entries e where e.card_statement_id = statement.id and e.kind = ''card_installment_plan'' and e.amount_cents > 0) then continue; end if;');
  definition := replace(definition,'(select coalesce(sum(amount_cents),0)::bigint from finance.ledger_entries where card_statement_id = statement.id)',
    '(select amount_cents from finance.statement_amounts where id = statement.id)');
  execute definition;
end $$;
revoke all on function private.ensure_system_category(uuid,text),private.replay_operation(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function api.confirm_card_charges(uuid,uuid,jsonb,uuid),api.install_card_statement(uuid,uuid,date,bigint,integer,bigint[],uuid,uuid),api.prepay_card_installments(uuid,uuid,integer[],bigint,date,uuid) from public,anon,authenticated;
grant execute on function api.confirm_card_charges(uuid,uuid,jsonb,uuid),api.install_card_statement(uuid,uuid,date,bigint,integer,bigint[],uuid,uuid),api.prepay_card_installments(uuid,uuid,integer[],bigint,date,uuid) to authenticated;
commit;
