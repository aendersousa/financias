begin;
create function private.ensure_card_statement(p_space uuid,p_card uuid,p_purchase_on date,p_offset integer default 0) returns uuid
language plpgsql set search_path = '' as $$
declare card finance.credit_cards; close_month date; closing date; previous_closing date; due date; start_on date; end_on date; cycle text; statement_id uuid; today date := private.space_today(p_space); begin
  select * into card from finance.credit_cards where financial_space_id = p_space and id = p_card;
  if not found then raise exception 'Card not found' using errcode = 'P0002'; end if;
  if p_purchase_on is null or p_offset is null or p_offset < 0 or p_offset > 600 then raise exception 'Invalid statement date or installment offset' using errcode = '23514'; end if;
  close_month := date_trunc('month',p_purchase_on)::date;
  closing := private.clamped_day(close_month,card.closing_day);
  if p_purchase_on > closing or (p_purchase_on = closing and card.closing_day_purchase_goes_next) then close_month := (close_month + interval '1 month')::date; end if;
  close_month := (close_month + make_interval(months => p_offset))::date;
  closing := private.clamped_day(close_month,card.closing_day);
  previous_closing := private.clamped_day((close_month - interval '1 month')::date,card.closing_day);
  start_on := previous_closing + case when card.closing_day_purchase_goes_next then 0 else 1 end;
  end_on := closing - case when card.closing_day_purchase_goes_next then 1 else 0 end;
  due := private.clamped_day(close_month,card.due_day);
  if due <= closing then due := private.clamped_day((close_month + interval '1 month')::date,card.due_day); end if;
  cycle := case when today < start_on then 'future' when today <= end_on then 'open' else 'closed' end;
  insert into finance.card_statements(financial_space_id,credit_card_id,reference_month,period_start,period_end,closing_on,due_on,effective_due_on,status,closed_at,closing_amount_cents,created_by)
    values(p_space,p_card,date_trunc('month',due)::date,start_on,end_on,closing,due,private.effective_due_date(p_space,due),cycle,case when cycle = 'closed' then now() end,case when cycle = 'closed' then 0 end,auth.uid())
    on conflict(credit_card_id,reference_month) do nothing returning id into statement_id;
  if statement_id is null then select id into statement_id from finance.card_statements where credit_card_id = p_card and reference_month = date_trunc('month',due)::date; end if;
  return statement_id;
end;
$$;

create view finance.statement_amounts with(security_invoker = true) as
with classified as (
  select e.*,case when e.kind = 'card_payment' then true when e.kind in ('card_rollover','card_installment_plan','card_credit_carry') then
    e.card_statement_id = (select e2.card_statement_id from finance.ledger_entries e2 join finance.card_statements s2 on s2.id = e2.card_statement_id where e2.ledger_transaction_id = e.ledger_transaction_id order by s2.reference_month,e2.line_number limit 1)
    else false end as liquidation
  from finance.posted_ledger_entries e where e.card_statement_id is not null
)
select s.id,s.financial_space_id,s.credit_card_id,s.reference_month,s.status,s.due_on,s.effective_due_on,
  coalesce(-sum(e.amount_cents) filter(where not e.liquidation and e.occurred_on <= (now() at time zone sp.timezone)::date),0)::bigint as amount_cents,
  coalesce(sum(e.amount_cents) filter(where e.liquidation and e.occurred_on <= (now() at time zone sp.timezone)::date),0)::bigint as settled_cents,
  coalesce(-sum(e.amount_cents) filter(where e.occurred_on <= (now() at time zone sp.timezone)::date),0)::bigint as remaining_cents,
  coalesce(sum(e.amount_cents) filter(where e.kind = 'card_payment' and e.occurred_on > (now() at time zone sp.timezone)::date),0)::bigint as scheduled_payment_cents
from finance.card_statements s join finance.financial_spaces sp on sp.id = s.financial_space_id
left join classified e on e.card_statement_id = s.id group by s.id,sp.timezone;
create view finance.card_limits with(security_invoker = true) as
select c.id,c.financial_space_id,c.name,c.status,b.balance_cents,
  coalesce(l.limit_cents,0)::bigint as granted_cents,
  (-b.balance_cents + coalesce(h.pending_cents,0))::bigint as used_cents,
  (coalesce(l.limit_cents,0) + b.balance_cents - coalesce(h.pending_cents,0))::bigint as free_cents
from finance.credit_cards c join finance.financial_spaces sp on sp.id = c.financial_space_id join finance.account_balances b on b.id = c.ledger_account_id
left join lateral(select limit_cents from finance.credit_card_limits where credit_card_id = c.id and valid_from <= (now() at time zone sp.timezone)::date order by valid_from desc limit 1) l on true
left join lateral(select sum(a.amount_cents) as pending_cents from finance.card_authorizations a left join finance.ledger_transactions t on t.id = a.payment_transaction_id
  where a.credit_card_id = c.id and a.status = 'pending' and a.authorized_on <= (now() at time zone sp.timezone)::date and
    ((a.kind = 'purchase' and (a.expires_on is null or a.expires_on >= (now() at time zone sp.timezone)::date)) or (a.kind = 'payment_hold' and t.status = 'posted' and a.release_on > (now() at time zone sp.timezone)::date))) h on true;
grant select on finance.statement_amounts,finance.card_limits to authenticated;

create function private.validate_card_entry() returns trigger language plpgsql set search_path = '' as $$
declare account finance.ledger_accounts; statement finance.card_statements; tx finance.ledger_transactions; begin
  if tg_op <> 'INSERT' then
    if exists(select 1 from finance.card_statements where id = old.card_statement_id and status = 'closed') then raise exception 'Closed statement entries are immutable' using errcode = '23514'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select * into account from finance.ledger_accounts where id = new.ledger_account_id;
  select * into tx from finance.ledger_transactions where id = new.ledger_transaction_id;
  if account.owner_type = 'credit_card' then
    if new.card_statement_id is null then raise exception 'Card entry requires a statement' using errcode = '23514'; end if;
    select s.* into statement from finance.card_statements s join finance.credit_cards c on c.id = s.credit_card_id where s.id = new.card_statement_id and c.ledger_account_id = new.ledger_account_id and s.financial_space_id = new.financial_space_id;
    if not found then raise exception 'Statement belongs to another card or space' using errcode = '23514'; end if;
    if statement.status = 'closed' and tx.kind not in ('card_payment','card_rollover','card_credit_carry','card_installment_plan','card_charges','card_correction','opening') then raise exception 'Closed statement does not accept purchases' using errcode = '23514'; end if;
  elsif new.card_statement_id is not null or new.installment_number is not null then raise exception 'Only card entries can reference statements or installments' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger card_entry_valid before insert or update or delete on finance.ledger_entries for each row execute function private.validate_card_entry();
create function private.card_holder_same_card() returns trigger language plpgsql set search_path = '' as $$
declare tx_id uuid; tx finance.ledger_transactions; holder finance.credit_card_holders; ledger_id uuid; begin
  if tg_table_name = 'ledger_transactions' then tx_id := coalesce(new.id,old.id); else tx_id := coalesce(new.ledger_transaction_id,old.ledger_transaction_id); end if;
  select * into tx from finance.ledger_transactions where id = tx_id;
  if tx.card_holder_id is null then return null; end if;
  select * into holder from finance.credit_card_holders where id = tx.card_holder_id;
  select ledger_account_id into ledger_id from finance.credit_cards where id = holder.credit_card_id;
  if not exists(select 1 from finance.ledger_entries where ledger_transaction_id = tx.id and ledger_account_id = ledger_id) or exists(select 1 from finance.ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id where e.ledger_transaction_id = tx.id and a.owner_type = 'credit_card' and a.id <> ledger_id) then raise exception 'Holder must belong to the transaction card' using errcode = '23514'; end if;
  return null;
end;
$$;
create constraint trigger card_holder_tx after insert or update on finance.ledger_transactions deferrable initially deferred for each row execute function private.card_holder_same_card();
create constraint trigger card_holder_entries after insert or update or delete on finance.ledger_entries deferrable initially deferred for each row execute function private.card_holder_same_card();

create or replace function private.reject_unimplemented_operations() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind not in ('opening','expense','income','transfer','balance_adjustment','investment_contribution','investment_redemption','investment_result','person_settlement','loan_disbursement','loan_payment','card_purchase','card_payment') then raise exception 'Operation requires a financial module not yet enabled' using errcode = '0A000'; end if;
  return new;
end;
$$;
-- Include card references in the common posting RPC.
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.post_transaction(uuid,jsonb)'::regprocedure);
  definition := replace(definition,'related_transaction_id,relation_type,created_by)','related_transaction_id,relation_type,card_holder_id,created_by)');
  definition := replace(definition,'p_payload->>''relation_type'',auth.uid())','p_payload->>''relation_type'',(p_payload->>''card_holder_id'')::uuid,auth.uid())');
  definition := replace(definition,'line_number,competence_month,created_by)','line_number,competence_month,card_statement_id,installment_number,installment_count,created_by)');
  definition := replace(definition,'(entry->>''competence_month'')::date,auth.uid());','(entry->>''competence_month'')::date,(entry->>''card_statement_id'')::uuid,(entry->>''installment_number'')::smallint,(entry->>''installment_count'')::smallint,auth.uid());');
  execute definition;
end $$;

create function api.create_credit_card(p_space uuid,p_name text,p_limit_cents bigint,p_closing_day integer,p_due_day integer,p_payment_account uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare card_id uuid; ledger_id uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,name,created_by) values(p_space,'liability','credit_card',p_name,auth.uid()) returning id into ledger_id;
  insert into finance.credit_cards(financial_space_id,ledger_account_id,name,closing_day,due_day,default_payment_financial_account_id,created_by)
    values(p_space,ledger_id,p_name,p_closing_day,p_due_day,p_payment_account,auth.uid()) returning id into card_id;
  insert into finance.credit_card_limits(financial_space_id,credit_card_id,limit_cents,valid_from,created_by) values(p_space,card_id,p_limit_cents,private.space_today(p_space),auth.uid());
  insert into finance.credit_card_holders(financial_space_id,credit_card_id,name,kind,created_by) values(p_space,card_id,'Titular','main',auth.uid());
  perform private.ensure_card_statement(p_space,card_id,private.space_today(p_space));
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','credit_card',card_id,jsonb_build_object('name',p_name,'limit_cents',p_limit_cents));
  return card_id;
end;
$$;

create function api.record_card_purchase(p_space uuid,p_card uuid,p_category uuid,p_total_cents bigint,p_installments integer,p_on date,p_description text,p_holder uuid default null,p_client_uuid uuid default null,p_cash_price_cents bigint default null,p_authorization uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare card finance.credit_cards; category finance.categories; statement_id uuid; parts bigint[]; order_indices integer[]; entries jsonb; idx integer; tx_id uuid; charge_category uuid; pending_auth finance.card_authorizations; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_total_cents is null or p_total_cents < 1 or p_total_cents > 9007199254740991 or p_installments is null or p_installments < 1 or p_installments > 600 or p_total_cents < p_installments then raise exception 'Invalid installment purchase' using errcode = '23514'; end if;
  if p_cash_price_cents is null then p_cash_price_cents := p_total_cents; end if;
  if p_cash_price_cents < 1 or p_cash_price_cents > p_total_cents then raise exception 'Invalid cash price' using errcode = '23514'; end if;
  select * into card from finance.credit_cards where id = p_card and financial_space_id = p_space and status = 'active';
  if not found then raise exception 'Active card not found' using errcode = '23514'; end if;
  select * into category from finance.categories where id = p_category and financial_space_id = p_space and kind = 'expense' and ledger_account_id is not null and archived_at is null and deleted_at is null;
  if not found then raise exception 'Expense category not found' using errcode = '23514'; end if;
  if p_holder is not null and not exists(select 1 from finance.credit_card_holders where id = p_holder and credit_card_id = p_card and is_active) then raise exception 'Active card holder not found' using errcode = '23514'; end if;
  if p_authorization is not null then
    select * into pending_auth from finance.card_authorizations where id = p_authorization and financial_space_id = p_space and credit_card_id = p_card and kind = 'purchase' for update;
    if not found then raise exception 'Pending authorization not found' using errcode = '23514'; end if;
    if pending_auth.status <> 'pending' and not (pending_auth.status = 'converted' and p_client_uuid is not null and exists(select 1 from finance.ledger_transactions where id = pending_auth.converted_transaction_id and client_uuid = p_client_uuid)) then raise exception 'Pending authorization not found' using errcode = '23514'; end if;
  end if;
  select array_agg(i order by case when card.installment_remainder = 'last' then -i else i end) into order_indices from generate_series(1,p_installments) i;
  parts := private.divide_cents(p_total_cents,array_fill(1::bigint,array[p_installments]),order_indices);
  entries := jsonb_build_array(jsonb_build_object('ledger_account_id',category.ledger_account_id,'amount_cents',p_cash_price_cents));
  if p_cash_price_cents < p_total_cents then
    select ledger_account_id into charge_category from finance.categories where financial_space_id = p_space and system_role = 'financial_charges' and ledger_account_id is not null;
    if charge_category is null then raise exception 'Financial charges category must be configured' using errcode = '23514'; end if;
    entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',charge_category,'amount_cents',p_total_cents-p_cash_price_cents));
  end if;
  for idx in 1..p_installments loop
    statement_id := private.ensure_card_statement(p_space,p_card,p_on,idx-1);
    entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-parts[idx],'card_statement_id',statement_id,'installment_number',case when p_installments > 1 then idx end,'installment_count',case when p_installments > 1 then p_installments end));
  end loop;
  tx_id := api.post_transaction(p_space,jsonb_build_object('kind','card_purchase','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',p_description,'card_holder_id',p_holder,'client_uuid',p_client_uuid,'entries',entries));
  if p_authorization is not null and pending_auth.status = 'pending' then
    update finance.card_authorizations set status = 'converted',converted_transaction_id = tx_id,resolved_at = now(),updated_at = now() where id = p_authorization;
    insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'converted','card_authorization',p_authorization,to_jsonb(pending_auth),jsonb_build_object('transaction_id',tx_id));
  end if;
  return tx_id;
end;
$$;

create function api.pay_card(p_space uuid,p_card uuid,p_origin_ledger uuid,p_amount_cents bigint,p_on date,p_channel text default 'pix',p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare card finance.credit_cards; origin finance.ledger_accounts; remainder bigint := p_amount_cents; amount bigint; statement record; open_statement uuid; entries jsonb; tx_id uuid; days integer; release_date date; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 9007199254740991 or p_on is null or p_channel is null or p_channel not in ('pix','debit','boleto') then raise exception 'Invalid card payment' using errcode = '23514'; end if;
  select * into card from finance.credit_cards where id = p_card and financial_space_id = p_space and status <> 'archived';
  if not found then raise exception 'Card not found' using errcode = 'P0002'; end if;
  select * into origin from finance.ledger_accounts where id = p_origin_ledger and financial_space_id = p_space and allows_posting and liquidity in ('cash','investment','person');
  if not found then raise exception 'Payment origin must be cash, investment or person' using errcode = '23514'; end if;
  if p_client_uuid is not null then
    select id into tx_id from finance.ledger_transactions where financial_space_id = p_space and client_uuid = p_client_uuid;
    if tx_id is not null then
      if not exists(select 1 from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id = t.id where t.id = tx_id and t.kind = 'card_payment' and t.occurred_on = p_on and e.ledger_account_id = p_origin_ledger and e.amount_cents = -p_amount_cents) or not exists(select 1 from finance.ledger_entries where ledger_transaction_id = tx_id and ledger_account_id = card.ledger_account_id) then raise exception 'Client UUID reused with different payment' using errcode = '23505'; end if;
      return tx_id;
    end if;
  end if;
  entries := jsonb_build_array(jsonb_build_object('ledger_account_id',p_origin_ledger,'amount_cents',-p_amount_cents));
  for statement in select s.id,coalesce(-sum(e.amount_cents) filter(where t.status = 'posted' and t.occurred_on <= p_on),0)::bigint as remaining
    from finance.card_statements s left join finance.ledger_entries e on e.card_statement_id = s.id left join finance.ledger_transactions t on t.id = e.ledger_transaction_id
    where s.credit_card_id = p_card and s.status = 'closed' group by s.id order by s.reference_month loop
    if statement.remaining > 0 and remainder > 0 then
      amount := least(statement.remaining,remainder); remainder := remainder-amount;
      entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',amount,'card_statement_id',statement.id));
    end if;
  end loop;
  if remainder > 0 then
    open_statement := private.ensure_card_statement(p_space,p_card,private.space_today(p_space));
    entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',remainder,'card_statement_id',open_statement));
  end if;
  tx_id := api.post_transaction(p_space,jsonb_build_object('kind','card_payment','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description','Pagamento: ' || card.name,'client_uuid',p_client_uuid,'entries',entries));
  days := case p_channel when 'pix' then card.limit_release_days_pix when 'debit' then card.limit_release_days_debit else card.limit_release_days_boleto end;
  if days > 0 then
    release_date := private.add_banking_days(p_space,p_on,days);
    insert into finance.card_authorizations(financial_space_id,credit_card_id,kind,authorized_on,amount_cents,description,source,payment_transaction_id,payment_channel,release_on,created_by)
      values(p_space,p_card,'payment_hold',p_on,p_amount_cents,'Pagamento aguardando compensação','system',tx_id,p_channel,release_date,auth.uid());
  end if;
  return tx_id;
end;
$$;
create function api.authorize_card_purchase(p_space uuid,p_card uuid,p_amount_cents bigint,p_on date,p_description text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare authorization_id uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if not exists(select 1 from finance.credit_cards where id = p_card and financial_space_id = p_space and status = 'active') then raise exception 'Active card not found' using errcode = '23514'; end if;
  insert into finance.card_authorizations(financial_space_id,credit_card_id,kind,authorized_on,amount_cents,description,expires_on,created_by)
    values(p_space,p_card,'purchase',p_on,p_amount_cents,p_description,p_on+30,auth.uid()) returning id into authorization_id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','card_authorization',authorization_id,jsonb_build_object('amount_cents',p_amount_cents,'description',p_description));
  return authorization_id;
end;
$$;
revoke all on function private.ensure_card_statement(uuid,uuid,date,integer),private.validate_card_entry(),private.card_holder_same_card() from public,anon,authenticated;
revoke all on function api.create_credit_card(uuid,text,bigint,integer,integer,uuid),api.record_card_purchase(uuid,uuid,uuid,bigint,integer,date,text,uuid,uuid,bigint,uuid),api.pay_card(uuid,uuid,uuid,bigint,date,text,uuid),api.authorize_card_purchase(uuid,uuid,bigint,date,text) from public,anon,authenticated;
grant execute on function api.create_credit_card(uuid,text,bigint,integer,integer,uuid),api.record_card_purchase(uuid,uuid,uuid,bigint,integer,date,text,uuid,uuid,bigint,uuid),api.pay_card(uuid,uuid,uuid,bigint,date,text,uuid),api.authorize_card_purchase(uuid,uuid,bigint,date,text) to authenticated;
commit;
