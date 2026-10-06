begin;
alter table finance.asset_valuations add column source text not null default 'manual' check(source in('manual','import'));
create table finance.loans (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,ledger_account_id uuid not null,name text not null check(char_length(name) between 1 and 100),
  kind text not null check(kind in('loan','financing')),lender_name text,schedule_mode text not null default 'none' check(schedule_mode in('none','detailed','simplified')),contracted_on date,
  principal_cents bigint check(principal_cents between 1 and 9007199254740991),installment_count smallint check(installment_count between 1 and 600),monthly_interest_rate numeric(9,6),amortization_system text check(amortization_system in('price','sac')),
  status text not null default 'active' check(status in('active','settled','archived')),deleted_at timestamptz,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),
  unique(financial_space_id,id),unique(ledger_account_id),foreign key(financial_space_id,ledger_account_id) references finance.ledger_accounts(financial_space_id,id)
);
alter table finance.loans enable row level security;
create policy member_read on finance.loans for select to authenticated using(private.is_member(financial_space_id));
revoke all on finance.loans from public,anon,authenticated;
grant select on finance.loans to authenticated;
create function private.account_balance_on(p_space uuid,p_ledger uuid,p_on date) returns bigint language sql stable set search_path = '' as $$
select coalesce(sum(amount_cents),0)::bigint from finance.posted_ledger_entries where financial_space_id = p_space and ledger_account_id = p_ledger and occurred_on <= p_on;
$$;
create function api.value_asset(p_space uuid,p_account uuid,p_on date,p_value_cents bigint,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare account finance.financial_accounts; account_liquidity text; previous_value bigint; difference bigint; equity uuid; tx uuid; valuation uuid; request jsonb; previous finance.asset_valuations; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_on is null or p_value_cents is null or p_value_cents not between 0 and 9007199254740991 then raise exception 'Invalid valuation' using errcode = '23514'; end if;
  request := jsonb_build_object('account',p_account,'on',p_on,'value',p_value_cents);
  tx := private.replay_operation(p_space,p_client_uuid,'investment_result',request);
  select f.* into account from finance.financial_accounts f where f.id = p_account and f.financial_space_id = p_space and f.archived_at is null and f.deleted_at is null;
  if not found then raise exception 'Valuation requires investment or property account' using errcode = '23514'; end if;
  select liquidity into account_liquidity from finance.ledger_accounts where id = account.ledger_account_id;
  if account_liquidity not in('investment','property') then raise exception 'Valuation requires investment or property account' using errcode = '23514'; end if;
  select * into previous from finance.asset_valuations where financial_account_id = p_account and valued_on = p_on;
  if previous.id is not null then
    if previous.value_cents = p_value_cents then return previous.id; end if;
    raise exception 'Position already valued on this date; correct the existing valuation' using errcode = '23514';
  end if;
  if exists(select 1 from finance.period_closings where financial_space_id = p_space and month = date_trunc('month',p_on)::date and reopened_at is null) then raise exception 'Period is closed' using errcode = '23514'; end if;
  previous_value := private.account_balance_on(p_space,account.ledger_account_id,p_on); difference := p_value_cents-previous_value;
  request := jsonb_build_object('account',p_account,'on',p_on,'value',p_value_cents);
  if difference <> 0 then
    select id into equity from finance.ledger_accounts where financial_space_id = p_space and system_role = 'investment_result';
    tx := private.post_transaction_internal(p_space,jsonb_build_object('kind','investment_result','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description','Valor informado: ' || account.name,
      'client_uuid',p_client_uuid,'notes',request::text,'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',account.ledger_account_id,'amount_cents',difference),jsonb_build_object('ledger_account_id',equity,'amount_cents',-difference))),auth.uid());
  end if;
  insert into finance.asset_valuations(financial_space_id,financial_account_id,valued_on,value_cents,ledger_transaction_id,created_by) values(p_space,p_account,p_on,p_value_cents,tx,auth.uid()) returning id into valuation;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'asset_valued','asset_valuation',valuation,request);
  return valuation;
end;
$$;
create function api.redeem_investment(p_space uuid,p_investment uuid,p_destination uuid,p_on date,p_gross_cents bigint,p_tax_cents bigint default 0,p_remaining_position_cents bigint default null,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare investment finance.financial_accounts; destination finance.financial_accounts; before_value bigint; remaining bigint; principal bigint; result bigint; taxes uuid; equity uuid; entries jsonb := '[]'; request jsonb; tx uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request := jsonb_build_object('investment',p_investment,'destination',p_destination,'on',p_on,'gross',p_gross_cents,'tax',p_tax_cents,'remaining',p_remaining_position_cents);
  tx := private.replay_operation(p_space,p_client_uuid,'investment_redemption',request); if tx is not null then return tx; end if;
  if p_on is null or p_gross_cents is null or p_gross_cents not between 1 and 9007199254740991 or p_tax_cents is null or p_tax_cents < 0 or p_tax_cents >= p_gross_cents then raise exception 'Invalid redemption' using errcode = '23514'; end if;
  select f.* into investment from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.id = p_investment and f.financial_space_id = p_space and f.archived_at is null and a.liquidity = 'investment';
  if not found then raise exception 'Investment account not found' using errcode = '23514'; end if;
  select f.* into destination from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.id = p_destination and f.financial_space_id = p_space and f.archived_at is null and a.liquidity = 'cash';
  if not found then raise exception 'Cash destination not found' using errcode = '23514'; end if;
  before_value := private.account_balance_on(p_space,investment.ledger_account_id,p_on); remaining := coalesce(p_remaining_position_cents,before_value-p_gross_cents);
  if remaining < 0 or remaining > before_value then raise exception 'Invalid remaining investment position' using errcode = '23514'; end if;
  principal := before_value-remaining; result := p_gross_cents-principal;
  entries := jsonb_build_array(jsonb_build_object('ledger_account_id',destination.ledger_account_id,'amount_cents',p_gross_cents-p_tax_cents));
  if principal > 0 then entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',investment.ledger_account_id,'amount_cents',-principal)); end if;
  if result <> 0 then select id into equity from finance.ledger_accounts where financial_space_id = p_space and system_role = 'investment_result'; entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',equity,'amount_cents',-result)); end if;
  if p_tax_cents > 0 then taxes := private.ensure_system_category(p_space,'taxes_fees'); entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',taxes,'amount_cents',p_tax_cents)); end if;
  return private.post_transaction_internal(p_space,jsonb_build_object('kind','investment_redemption','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description','Resgate: ' || investment.name,'client_uuid',p_client_uuid,'notes',request::text,'entries',entries),auth.uid());
end;
$$;
create function api.create_loan(p_space uuid,p_name text,p_kind text,p_opening_cents bigint default 0,p_on date default null,p_lender text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare ledger uuid; loan uuid; equity uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_opening_cents is null or p_opening_cents not between 0 and 9007199254740991 then raise exception 'Invalid opening debt' using errcode = '23514'; end if;
  insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,name,created_by) values(p_space,'liability','loan',p_name,auth.uid()) returning id into ledger;
  insert into finance.loans(financial_space_id,ledger_account_id,name,kind,lender_name,created_by) values(p_space,ledger,p_name,p_kind,p_lender,auth.uid()) returning id into loan;
  if p_opening_cents > 0 then
    select id into equity from finance.ledger_accounts where financial_space_id = p_space and system_role = 'opening';
    perform private.post_transaction_internal(p_space,jsonb_build_object('kind','opening','occurred_on',coalesce(p_on,private.space_today(p_space)),'competence_month',date_trunc('month',coalesce(p_on,private.space_today(p_space)))::date,'description','Saldo inicial: ' || p_name,
      'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',ledger,'amount_cents',-p_opening_cents),jsonb_build_object('ledger_account_id',equity,'amount_cents',p_opening_cents))),auth.uid());
  end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','loan',loan,jsonb_build_object('name',p_name,'opening',p_opening_cents));
  return loan;
end;
$$;
create function api.loan_movement(p_space uuid,p_loan uuid,p_account uuid,p_on date,p_direction text,p_principal_cents bigint,p_charges_cents bigint default 0,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare loan finance.loans; account finance.financial_accounts; entries jsonb; expense uuid; total bigint; cash bigint; tx uuid; kind text; request jsonb; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  kind := case when p_direction = 'receive' then 'loan_disbursement' else 'loan_payment' end;
  request := jsonb_build_object('loan',p_loan,'account',p_account,'on',p_on,'direction',p_direction,'principal',p_principal_cents,'charges',p_charges_cents);
  tx := private.replay_operation(p_space,p_client_uuid,kind,request); if tx is not null then return tx; end if;
  if p_on is null or p_direction is null or p_direction not in('receive','pay') or p_principal_cents is null or p_principal_cents not between 1 and 9007199254740991 or p_charges_cents is null or p_charges_cents not between 0 and 9007199254740991 then raise exception 'Invalid loan movement' using errcode = '23514'; end if;
  select * into loan from finance.loans where id = p_loan and financial_space_id = p_space and status = 'active' and deleted_at is null;
  if not found then raise exception 'Loan not available' using errcode = '23514'; end if;
  select f.* into account from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.id = p_account and f.financial_space_id = p_space and f.archived_at is null and a.liquidity = 'cash';
  if not found then raise exception 'Cash account not found' using errcode = '23514'; end if;
  if p_direction = 'receive' then
    if p_charges_cents >= p_principal_cents then raise exception 'Charges exceed disbursement' using errcode = '23514'; end if;
    cash := p_principal_cents-p_charges_cents;
    entries := jsonb_build_array(jsonb_build_object('ledger_account_id',loan.ledger_account_id,'amount_cents',-p_principal_cents),jsonb_build_object('ledger_account_id',account.ledger_account_id,'amount_cents',cash));
  else
    if p_principal_cents > -private.account_balance_on(p_space,loan.ledger_account_id,p_on) then raise exception 'Principal payment exceeds debt' using errcode = '23514'; end if;
    total := p_principal_cents+p_charges_cents;
    if total > 9007199254740991 then raise exception 'Payment exceeds safe cents range' using errcode = '23514'; end if;
    entries := jsonb_build_array(jsonb_build_object('ledger_account_id',loan.ledger_account_id,'amount_cents',p_principal_cents),jsonb_build_object('ledger_account_id',account.ledger_account_id,'amount_cents',-total));
  end if;
  if p_charges_cents > 0 then expense := private.ensure_system_category(p_space,'financial_charges'); entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',expense,'amount_cents',p_charges_cents)); end if;
  return private.post_transaction_internal(p_space,jsonb_build_object('kind',kind,'occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',case when p_direction = 'receive' then 'Crédito: ' else 'Pagamento: ' end || loan.name,'client_uuid',p_client_uuid,'notes',request::text,'entries',entries),auth.uid());
end;
$$;
revoke all on function private.account_balance_on(uuid,uuid,date) from public,anon,authenticated;
revoke all on function api.value_asset(uuid,uuid,date,bigint,uuid),api.redeem_investment(uuid,uuid,uuid,date,bigint,bigint,bigint,uuid),api.create_loan(uuid,text,text,bigint,date,text),api.loan_movement(uuid,uuid,uuid,date,text,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function api.value_asset(uuid,uuid,date,bigint,uuid),api.redeem_investment(uuid,uuid,uuid,date,bigint,bigint,bigint,uuid),api.create_loan(uuid,text,text,bigint,date,text),api.loan_movement(uuid,uuid,uuid,date,text,bigint,bigint,uuid) to authenticated;
commit;
