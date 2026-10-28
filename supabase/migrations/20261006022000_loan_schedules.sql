begin;
-- Creditor figures are authoritative. Price/SAC suggestions are computed in the
-- shared cents-only calculator; this boundary independently validates the rows.
create table finance.loan_schedule_versions (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null,
  loan_id uuid not null,schedule_version smallint not null check(schedule_version > 0),
  effective_on date not null,mode text not null check(mode in('detailed','simplified')),
  source text not null check(source in('creditor','generated')),principal_cents bigint not null check(principal_cents between 0 and 9007199254740991),
  contract jsonb not null,created_by uuid references auth.users(id),created_at timestamptz not null default now(),
  unique(financial_space_id,id),unique(loan_id,schedule_version),
  foreign key(financial_space_id,loan_id) references finance.loans(financial_space_id,id)
);
create table finance.loan_installments (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null,loan_id uuid not null,
  installment_number smallint not null check(installment_number between 1 and 32767),due_on date not null,
  principal_cents bigint not null check(principal_cents between 0 and 9007199254740991),
  interest_cents bigint not null check(interest_cents between 0 and 9007199254740991),
  other_charges_cents bigint not null default 0 check(other_charges_cents between 0 and 9007199254740991),
  amount_cents bigint generated always as(principal_cents+interest_cents+other_charges_cents) stored,
  outstanding_after_cents bigint not null check(outstanding_after_cents between 0 and 9007199254740991),
  commitment_id uuid not null unique,reported_outstanding_cents bigint check(reported_outstanding_cents between 0 and 9007199254740991),
  schedule_version smallint not null,mode text not null check(mode in('detailed','simplified')),
  superseded_at timestamptz,created_at timestamptz not null default now(),created_by uuid references auth.users(id),
  unique(financial_space_id,id),check(amount_cents between 1 and 9007199254740991),
  foreign key(financial_space_id,loan_id) references finance.loans(financial_space_id,id),
  foreign key(loan_id,schedule_version) references finance.loan_schedule_versions(loan_id,schedule_version),
  foreign key(financial_space_id,commitment_id) references finance.commitments(financial_space_id,id)
);
create unique index loan_active_installment on finance.loan_installments(loan_id,installment_number) where superseded_at is null;
create index loan_installment_space on finance.loan_installments(financial_space_id,loan_id);
alter table finance.ledger_entries add column loan_component text check(loan_component in('principal','interest','other_charges'));
do $$ declare t text; begin
  foreach t in array array['loan_schedule_versions','loan_installments'] loop
    execute format('alter table finance.%I enable row level security',t);
    execute format('create policy member_read on finance.%I for select to authenticated using(private.is_member(financial_space_id))',t);
    execute format('revoke all on finance.%I from public,anon,authenticated',t);
    execute format('grant select on finance.%I to authenticated',t);
  end loop;
end $$;
create function private.protect_loan_history() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or tg_table_name = 'loan_schedule_versions' or
    (to_jsonb(new)-'superseded_at'-'reported_outstanding_cents'-'amount_cents') is distinct from (to_jsonb(old)-'superseded_at'-'reported_outstanding_cents'-'amount_cents') or
    (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at) then
    raise exception 'Loan schedule history is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger immutable_loan_version before update or delete on finance.loan_schedule_versions for each row execute function private.protect_loan_history();
create trigger immutable_loan_installment before update or delete on finance.loan_installments for each row execute function private.protect_loan_history();

create view finance.loan_installment_progress with(security_invoker = true) as
select i.*,s.effective_due_on,s.paid_cents,s.remaining_cents,s.settlement_status,s.overdue,
 coalesce(p.principal_paid_cents,0)::bigint as principal_paid_cents,
 coalesce(p.interest_paid_cents,0)::bigint as interest_paid_cents,
 coalesce(p.other_charges_paid_cents,0)::bigint as other_charges_paid_cents
from finance.loan_installments i join finance.commitment_settlements s on s.id = i.commitment_id
left join lateral (
 select sum(e.amount_cents) filter(where e.loan_component = 'principal') as principal_paid_cents,
 sum(e.amount_cents) filter(where e.loan_component = 'interest') as interest_paid_cents,
 sum(e.amount_cents) filter(where e.loan_component = 'other_charges') as other_charges_paid_cents
 from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id
 where e.commitment_id = i.commitment_id and t.status = 'posted'
) p on true;
grant select on finance.loan_installment_progress to authenticated;

create function private.validate_loan_component() returns trigger language plpgsql set search_path = '' as $$
declare installment finance.loan_installments; loan_ledger uuid; account finance.ledger_accounts; begin
  select * into installment from finance.loan_installments where commitment_id = new.commitment_id;
  if installment.id is null then
    if new.loan_component is not null then raise exception 'Loan component requires installment' using errcode = '23514'; end if;
    return new;
  end if;
  select ledger_account_id into loan_ledger from finance.loans where id = installment.loan_id;
  select * into account from finance.ledger_accounts where id = new.ledger_account_id;
  if installment.superseded_at is not null or new.amount_cents <= 0 or new.loan_component is null or
    (new.loan_component = 'principal' and new.ledger_account_id <> loan_ledger) or
    (new.loan_component in('interest','other_charges') and not exists(select 1 from finance.categories where ledger_account_id = account.id and system_role = 'financial_charges')) or
    (installment.mode = 'simplified' and new.loan_component <> 'principal') then
    raise exception 'Invalid loan installment component' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger loan_component_valid before insert or update on finance.ledger_entries for each row execute function private.validate_loan_component();

alter table finance.operation_requests drop constraint operation_requests_operation_check;
alter table finance.operation_requests add constraint operation_requests_operation_check check(operation in('value_asset','confirm_card_charges','create_loan','configure_loan_schedule','adjust_loan_balance','prepay_loan'));
create function private.loan_request_result(p_space uuid,p_client uuid,p_operation text,p_request jsonb) returns uuid language plpgsql stable set search_path = '' as $$
declare result uuid; begin
  result := private.replay_nonledger_operation(p_space,p_client,p_operation,p_request);
  if result is not null then return result; end if;
  if p_client is not null and exists(select 1 from finance.ledger_transactions where financial_space_id = p_space and client_uuid = p_client) then raise exception 'Client UUID reused with different operation' using errcode = '23505'; end if;
  return null;
end;
$$;
create function private.record_loan_request(p_space uuid,p_client uuid,p_operation text,p_request jsonb,p_result uuid) returns void language plpgsql set search_path = '' as $$
begin
  if p_client is not null then insert into finance.operation_requests(financial_space_id,client_uuid,operation,request,result_id,created_by) values(p_space,p_client,p_operation,p_request,p_result,auth.uid()); end if;
end;
$$;

create function api.configure_loan_schedule(p_space uuid,p_loan uuid,p_version integer,p_payload jsonb,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare loan finance.loans; request jsonb; result uuid; start_on date; mode text; account uuid; schedule_no smallint; base bigint; remaining bigint; retained bigint; row jsonb; n integer := 0; offset_no integer; principal bigint; interest bigint; charges bigint; due date; previous_due date; commitment uuid; rule record; old_row record; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request := jsonb_build_object('loan',p_loan,'version',p_version,'payload',p_payload);
  result := private.loan_request_result(p_space,p_client_uuid,'configure_loan_schedule',request); if result is not null then return result; end if;
  select * into loan from finance.loans where id = p_loan and financial_space_id = p_space and deleted_at is null and status <> 'archived' for update;
  if not found then raise exception 'Loan not available' using errcode = '23514'; end if;
  if loan.version is distinct from p_version then raise exception 'Loan changed; reload before editing' using errcode = '40001'; end if;
  start_on := (p_payload->>'effective_on')::date; mode := p_payload->>'mode'; account := (p_payload->>'payment_account_id')::uuid;
  if start_on is null or not isfinite(start_on) or mode is null or mode not in('detailed','simplified') or coalesce(p_payload->>'source','creditor') not in('creditor','generated') or
    jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') > 600 or
    (p_payload->>'monthly_interest_rate' is not null and ((p_payload->>'monthly_interest_rate')::numeric < 0 or (p_payload->>'monthly_interest_rate')::numeric > 999.999999)) or
    (p_payload->>'amortization_system' is not null and p_payload->>'amortization_system' not in('price','sac')) then raise exception 'Invalid loan schedule' using errcode = '23514'; end if;
  if not exists(select 1 from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.id = account and f.financial_space_id = p_space and f.archived_at is null and f.deleted_at is null and a.liquidity = 'cash' and a.allows_posting) then raise exception 'Cash account not found' using errcode = '23514'; end if;
  if exists(select 1 from finance.period_closings where financial_space_id = p_space and month = date_trunc('month',start_on)::date and reopened_at is null) then raise exception 'Period is closed' using errcode = '23514'; end if;
  select coalesce(max(schedule_version),0)+1 into schedule_no from finance.loan_schedule_versions where loan_id = loan.id;
  -- Preserve overdue and all partly/fully paid rows, including early payments.
  select coalesce(sum(case when i.mode = 'detailed' then greatest(i.principal_cents-i.principal_paid_cents,0) else floor(i.principal_cents::numeric*i.remaining_cents/i.amount_cents)::bigint end),0)::bigint,
    coalesce(max(installment_number),0) into retained,offset_no
  from finance.loan_installment_progress i where i.loan_id = loan.id and i.superseded_at is null and (i.due_on < start_on or i.paid_cents > 0);
  select -balance_cents-retained into base from finance.account_balances where id = loan.ledger_account_id;
  if base is null or base not between 0 and 9007199254740991 then raise exception 'Schedule principal exceeds remaining debt' using errcode = '23514'; end if;
  remaining := base;
  -- Validate everything before changing the prior Agenda or schedule version.
  for row in select value from jsonb_array_elements(p_payload->'rows') loop
    n := n+1; due := (row->>'due_on')::date;
    if row->>'number' is distinct from n::text or row->>'principal_cents' !~ '^[0-9]+$' or row->>'interest_cents' !~ '^[0-9]+$' or coalesce(row->>'other_charges_cents','0') !~ '^[0-9]+$' or row->>'outstanding_after_cents' !~ '^[0-9]+$' then raise exception 'Invalid loan schedule row' using errcode = '23514'; end if;
    principal := (row->>'principal_cents')::bigint; interest := (row->>'interest_cents')::bigint; charges := coalesce((row->>'other_charges_cents')::bigint,0);
    if principal is null or interest is null or due is null or not isfinite(due) or due < start_on or (previous_due is not null and due <= previous_due) or principal > remaining or principal::numeric+interest+charges not between 1 and 9007199254740991 or (row->>'outstanding_after_cents')::bigint is distinct from remaining-principal then raise exception 'Invalid loan schedule row' using errcode = '23514'; end if;
    if exists(select 1 from finance.period_closings where financial_space_id = p_space and month = date_trunc('month',due)::date and reopened_at is null) then raise exception 'Period is closed' using errcode = '23514'; end if;
    remaining := remaining-principal; previous_due := due;
  end loop;
  if remaining <> 0 or offset_no+n > 32767 then raise exception 'Schedule must amortize remaining principal exactly' using errcode = '23514'; end if;
  for old_row in select i.*,c.competence_month from finance.loan_installment_progress i join finance.commitments c on c.id = i.commitment_id where i.loan_id = loan.id and i.superseded_at is null and i.due_on >= start_on and i.paid_cents = 0 loop
    if exists(select 1 from finance.period_closings where financial_space_id = p_space and month = old_row.competence_month and reopened_at is null) then raise exception 'Period is closed' using errcode = '23514'; end if;
    update finance.loan_installments set superseded_at = now() where id = old_row.id;
    update finance.commitments set cancelled_at = now(),cancelled_by = auth.uid(),cancellation_reason = 'Substituída por novo cronograma do credor',version = version+1,updated_at = now() where id = old_row.commitment_id;
  end loop;
  -- End old generic-debt recurrence without rewriting any posted payment.
  for rule in select r.* from finance.recurrence_rules r where r.financial_space_id = p_space and r.archived_at is null and (r.ends_on is null or r.ends_on >= start_on) and exists(select 1 from finance.recurrence_rule_versions v where v.recurrence_rule_id = r.id and v.counterpart_account_id = loan.ledger_account_id) loop
    if rule.starts_on < start_on then perform api.end_recurrence_rule(p_space,rule.id,rule.version,start_on-1);
    else
      update finance.recurrence_rules set archived_at = now(),version = version+1,updated_at = now() where id = rule.id;
      update finance.commitments c set cancelled_at = now(),cancelled_by = auth.uid(),cancellation_reason = 'Substituída por cronograma do empréstimo',version = version+1,updated_at = now() where c.recurrence_rule_id = rule.id and c.cancelled_at is null and c.deleted_at is null and not exists(select 1 from finance.posted_ledger_entries e where e.commitment_id = c.id);
      insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'ended','recurrence_rule',rule.id,jsonb_build_object('replaced_by_loan',loan.id));
    end if;
  end loop;
  insert into finance.loan_schedule_versions(financial_space_id,loan_id,schedule_version,effective_on,mode,source,principal_cents,contract,created_by) values(p_space,loan.id,schedule_no,start_on,mode,coalesce(p_payload->>'source','creditor'),base,p_payload,auth.uid()) returning id into result;
  n := 0;
  for row in select value from jsonb_array_elements(p_payload->'rows') loop
    n := n+1; due := (row->>'due_on')::date;
    principal := (row->>'principal_cents')::bigint; interest := (row->>'interest_cents')::bigint; charges := coalesce((row->>'other_charges_cents')::bigint,0);
    commitment := private.create_loan_commitment(p_space,jsonb_build_object('title',left(loan.name || ' · Parcela ' || (offset_no+n),200),'direction','outflow','certainty','confirmed','amount_cents',principal+interest+charges,'due_on',due,'counterpart_account_id',loan.ledger_account_id,'payment_method','account','payment_financial_account_id',account));
    insert into finance.loan_installments(financial_space_id,loan_id,installment_number,due_on,principal_cents,interest_cents,other_charges_cents,outstanding_after_cents,commitment_id,schedule_version,mode,created_by) values(p_space,loan.id,offset_no+n,due,principal,interest,charges,(row->>'outstanding_after_cents')::bigint,commitment,schedule_no,mode,auth.uid());
  end loop;
  update finance.loans set schedule_mode = mode,contracted_on = coalesce((p_payload->>'contracted_on')::date,contracted_on),principal_cents = coalesce(principal_cents,nullif(base,0)),installment_count = nullif(n,0),
    monthly_interest_rate = coalesce((p_payload->>'monthly_interest_rate')::numeric,monthly_interest_rate),amortization_system = coalesce(p_payload->>'amortization_system',amortization_system),status = 'active',version = version+1,updated_at = now() where id = loan.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'schedule_configured','loan',loan.id,to_jsonb(loan),jsonb_build_object('schedule_id',result,'schedule_version',schedule_no,'payload',p_payload));
  perform private.record_loan_request(p_space,p_client_uuid,'configure_loan_schedule',request,result);
  return result;
end;
$$;

create function api.pay_loan_installment(p_space uuid,p_installment uuid,p_on date,p_amount_cents bigint default null,p_account uuid default null,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare item finance.loan_installment_progress; loan finance.loans; commitment finance.commitments; account_ledger uuid; expense uuid; amount bigint; components bigint[]; request jsonb; tx uuid; entries jsonb := '[]'; month date; k integer; component text; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request := jsonb_build_object('installment',p_installment,'on',p_on,'amount_cents',p_amount_cents,'account',p_account);
  tx := private.replay_operation(p_space,p_client_uuid,'loan_installment_payment',request); if tx is not null then return tx; end if;
  select * into item from finance.loan_installment_progress where id = p_installment and financial_space_id = p_space and superseded_at is null;
  if not found or item.settlement_status = 'cancelled' then raise exception 'Loan installment not available' using errcode = '23514'; end if;
  select * into loan from finance.loans where id = item.loan_id and status <> 'archived' and deleted_at is null;
  if not found then raise exception 'Loan not available' using errcode = '23514'; end if;
  select * into commitment from finance.commitments where id = item.commitment_id;
  amount := coalesce(p_amount_cents,item.remaining_cents);
  if p_on is null or not isfinite(p_on) or amount is null or amount < 1 or amount > item.remaining_cents then raise exception 'Payment exceeds remaining installment' using errcode = '23514'; end if;
  select f.ledger_account_id into account_ledger from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.id = coalesce(p_account,commitment.payment_financial_account_id) and f.financial_space_id = p_space and f.archived_at is null and f.deleted_at is null and a.liquidity = 'cash' and a.allows_posting;
  if not found then raise exception 'Cash account not found' using errcode = '23514'; end if;
  if item.mode = 'simplified' then components := array[amount,0::bigint,0::bigint];
  else components := private.divide_cents(amount,array[item.principal_cents-item.principal_paid_cents,item.interest_cents-item.interest_paid_cents,item.other_charges_cents-item.other_charges_paid_cents]); end if;
  if components[1] > -private.account_balance_on(p_space,loan.ledger_account_id,p_on) then raise exception 'Principal payment exceeds debt' using errcode = '23514'; end if;
  month := private.next_open_competence(p_space,commitment.competence_month);
  if components[2]+components[3] > 0 then expense := private.ensure_system_category(p_space,'financial_charges'); end if;
  for k in 1..3 loop
    if components[k] > 0 then
      component := (array['principal','interest','other_charges'])[k];
      entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',case when k = 1 then loan.ledger_account_id else expense end,'amount_cents',components[k],'commitment_id',commitment.id,'loan_component',component,'competence_month',month,'original_competence_month',case when month <> commitment.competence_month then commitment.competence_month end));
    end if;
  end loop;
  entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',account_ledger,'amount_cents',-amount));
  tx := private.post_transaction_internal(p_space,jsonb_build_object('kind','loan_payment','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',commitment.title,'client_uuid',p_client_uuid,'operation_receipt',jsonb_build_object('operation','loan_installment_payment','request',request),'entries',entries),auth.uid());
  return tx;
end;
$$;

-- Simplified mode records the creditor's debt difference as credit cost, never
-- income or a retrospective edit of an earlier principal payment.
create function api.adjust_loan_balance(p_space uuid,p_loan uuid,p_on date,p_debt_cents bigint,p_installment uuid default null,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare loan finance.loans; request jsonb; result uuid; delta bigint; expense uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request := jsonb_build_object('loan',p_loan,'on',p_on,'debt_cents',p_debt_cents,'installment',p_installment);
  result := private.loan_request_result(p_space,p_client_uuid,'adjust_loan_balance',request); if result is not null then return result; end if;
  select * into loan from finance.loans where id = p_loan and financial_space_id = p_space and schedule_mode = 'simplified' and status <> 'archived' and deleted_at is null;
  if not found then raise exception 'Simplified loan not available' using errcode = '23514'; end if;
  if p_on is null or not isfinite(p_on) or p_debt_cents is null or p_debt_cents not between 0 and 9007199254740991 then raise exception 'Invalid reported debt' using errcode = '23514'; end if;
  if exists(select 1 from finance.period_closings where financial_space_id = p_space and month = date_trunc('month',p_on)::date and reopened_at is null) then raise exception 'Period is closed' using errcode = '23514'; end if;
  if p_installment is not null and not exists(select 1 from finance.loan_installments where id = p_installment and loan_id = loan.id and superseded_at is null and mode = 'simplified') then raise exception 'Loan installment not available' using errcode = '23514'; end if;
  delta := p_debt_cents+private.account_balance_on(p_space,loan.ledger_account_id,p_on);
  result := loan.id;
  if delta <> 0 then
    expense := private.ensure_system_category(p_space,'financial_charges');
    result := private.post_transaction_internal(p_space,jsonb_build_object('kind','loan_payment','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',left('Saldo informado: ' || loan.name,200),'operation_receipt',jsonb_build_object('operation','loan_balance_adjustment','request',request),'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',expense,'amount_cents',delta),jsonb_build_object('ledger_account_id',loan.ledger_account_id,'amount_cents',-delta))),auth.uid());
  end if;
  if p_installment is not null then update finance.loan_installments set reported_outstanding_cents = p_debt_cents where id = p_installment; end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'debt_reported','loan',loan.id,request || jsonb_build_object('difference_cents',delta,'result_id',result));
  perform private.record_loan_request(p_space,p_client_uuid,'adjust_loan_balance',request,result);
  return result;
end;
$$;

create function api.prepay_loan(p_space uuid,p_loan uuid,p_version integer,p_account uuid,p_on date,p_principal_cents bigint,p_schedule jsonb,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare loan finance.loans; request jsonb; tx uuid; bank uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request := jsonb_build_object('loan',p_loan,'version',p_version,'account',p_account,'on',p_on,'principal_cents',p_principal_cents,'schedule',p_schedule);
  tx := private.loan_request_result(p_space,p_client_uuid,'prepay_loan',request); if tx is not null then return tx; end if;
  select * into loan from finance.loans where id = p_loan and financial_space_id = p_space and deleted_at is null and status <> 'archived' for update;
  if not found then raise exception 'Loan not available' using errcode = '23514'; end if;
  if loan.version is distinct from p_version then raise exception 'Loan changed; reload before editing' using errcode = '40001'; end if;
  if p_on is null or not isfinite(p_on) or p_principal_cents is null or p_principal_cents < 1 or p_principal_cents > -private.account_balance_on(p_space,loan.ledger_account_id,p_on) or (p_schedule->>'effective_on')::date is distinct from p_on then raise exception 'Invalid loan prepayment' using errcode = '23514'; end if;
  select f.ledger_account_id into bank from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.id = p_account and f.financial_space_id = p_space and f.archived_at is null and f.deleted_at is null and a.liquidity = 'cash' and a.allows_posting;
  if not found then raise exception 'Cash account not found' using errcode = '23514'; end if;
  tx := private.post_transaction_internal(p_space,jsonb_build_object('kind','loan_payment','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',left('Amortização extraordinária: ' || loan.name,200),'operation_receipt',jsonb_build_object('operation','loan_prepayment','request',request),'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',loan.ledger_account_id,'amount_cents',p_principal_cents),jsonb_build_object('ledger_account_id',bank,'amount_cents',-p_principal_cents))),auth.uid());
  perform api.configure_loan_schedule(p_space,loan.id,loan.version,p_schedule,null);
  perform private.record_loan_request(p_space,p_client_uuid,'prepay_loan',request,tx);
  return tx;
end;
$$;

-- Extend the existing creation contract without an ambiguous default overload.
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.create_loan(uuid,text,text,bigint,date,text)'::regprocedure);
  execute replace(definition,'api.create_loan','private.create_loan_generic');
end $$;
drop function api.create_loan(uuid,text,text,bigint,date,text);
create function api.create_loan(p_space uuid,p_name text,p_kind text,p_opening_cents bigint default 0,p_on date default null,p_lender text default null,p_schedule jsonb default null,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare request jsonb; loan uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request := jsonb_build_object('name',p_name,'kind',p_kind,'opening_cents',p_opening_cents,'on',p_on,'lender',p_lender,'schedule',p_schedule);
  loan := private.loan_request_result(p_space,p_client_uuid,'create_loan',request); if loan is not null then return loan; end if;
  loan := private.create_loan_generic(p_space,p_name,p_kind,p_opening_cents,p_on,p_lender);
  update finance.loans set contracted_on = coalesce(p_on,private.space_today(p_space)),principal_cents = nullif(p_opening_cents,0) where id = loan;
  if p_schedule is not null then perform api.configure_loan_schedule(p_space,loan,1,p_schedule,null); end if;
  perform private.record_loan_request(p_space,p_client_uuid,'create_loan',request,loan);
  return loan;
end;
$$;

create function api.loan_summary(p_space uuid,p_loan uuid default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(p_space) then raise exception 'Financial space not available' using errcode = '42501'; end if;
  return jsonb_build_object('loans',coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object(
    'debt_cents',-private.account_balance_on(p_space,l.ledger_account_id,private.space_today(p_space)),
    'booked_debt_cents',(select -balance_cents from finance.account_balances where id = l.ledger_account_id),
    'effective_status',case when l.status = 'archived' then 'archived' when private.account_balance_on(p_space,l.ledger_account_id,private.space_today(p_space)) = 0 and not exists(select 1 from finance.loan_installment_progress i where i.loan_id = l.id and i.superseded_at is null and i.remaining_cents > 0) and exists(select 1 from finance.posted_ledger_entries e where e.ledger_account_id = l.ledger_account_id) then 'settled' else 'active' end,
    'paid_installments',(select count(*) from finance.loan_installment_progress i where i.loan_id = l.id and i.superseded_at is null and i.settlement_status = 'settled'),
    'open_installments',(select count(*) from finance.loan_installment_progress i where i.loan_id = l.id and i.superseded_at is null and i.remaining_cents > 0),
    'installments',coalesce((select jsonb_agg(to_jsonb(i) order by i.schedule_version,i.installment_number) from finance.loan_installment_progress i where i.loan_id = l.id),'[]'::jsonb),
    'schedule_versions',coalesce((select jsonb_agg(to_jsonb(v) order by v.schedule_version) from finance.loan_schedule_versions v where v.loan_id = l.id),'[]'::jsonb)
  ) order by l.created_at,l.id) from finance.loans l where l.financial_space_id = p_space and l.deleted_at is null and (p_loan is null or l.id = p_loan)),'[]'::jsonb));
end;
$$;
create function api.archive_loan(p_space uuid,p_loan uuid,p_version integer) returns uuid language plpgsql security definer set search_path = '' as $$
declare loan finance.loans; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into loan from finance.loans where id = p_loan and financial_space_id = p_space and deleted_at is null for update;
  if not found then raise exception 'Loan not available' using errcode = '23514'; end if;
  if loan.version is distinct from p_version then raise exception 'Loan changed; reload before editing' using errcode = '40001'; end if;
  if exists(select 1 from finance.account_balances where id = loan.ledger_account_id and balance_cents <> 0) or private.account_balance_on(p_space,loan.ledger_account_id,private.space_today(p_space)) <> 0 or exists(select 1 from finance.loan_installment_progress where loan_id = loan.id and superseded_at is null and remaining_cents > 0) then raise exception 'Loan still has debt or open installments' using errcode = '23514'; end if;
  update finance.loans set status = 'archived',version = version+1,updated_at = now() where id = loan.id;
  update finance.ledger_accounts set allows_posting = false where id = loan.ledger_account_id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'archived','loan',loan.id,to_jsonb(loan),jsonb_build_object('status','archived'));
  return loan.id;
end;
$$;

-- Check the chronological liability after the entire transaction, including
-- future-dated payments, and derive settled status from debt plus open Agenda.
create function private.loan_ledger_integrity() returns trigger language plpgsql security definer set search_path = '' as $$
declare item record; tx_id uuid; account_id uuid; derived text; begin
  if tg_table_name = 'ledger_transactions' then tx_id := new.id; else tx_id := coalesce(new.ledger_transaction_id,old.ledger_transaction_id); end if;
  for item in select distinct l.* from finance.loans l where exists(select 1 from finance.ledger_entries e left join finance.loan_installments i on i.commitment_id = e.commitment_id where e.ledger_transaction_id = tx_id and (e.ledger_account_id = l.ledger_account_id or i.loan_id = l.id)) loop
    if exists(select 1 from (
      select sum(sum(e.amount_cents)) over(order by t.occurred_on) as balance
      from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id
      where e.ledger_account_id = item.ledger_account_id and t.status = 'posted' group by t.occurred_on
    ) amounts where balance > 0 or balance < -9007199254740991) then raise exception 'Loan debt cannot be negative or exceed safe cents' using errcode = '23514'; end if;
    if item.status <> 'archived' then
      derived := case when private.account_balance_on(item.financial_space_id,item.ledger_account_id,private.space_today(item.financial_space_id)) = 0
        and not exists(select 1 from finance.loan_installment_progress where loan_id = item.id and superseded_at is null and remaining_cents > 0)
        and exists(select 1 from finance.posted_ledger_entries where ledger_account_id = item.ledger_account_id) then 'settled' else 'active' end;
      if item.status <> derived then update finance.loans set status = derived,version = version+1,updated_at = now() where id = item.id; end if;
    end if;
  end loop;
  return null;
end;
$$;
create constraint trigger loan_entry_integrity after insert or update or delete on finance.ledger_entries deferrable initially deferred for each row execute function private.loan_ledger_integrity();
create constraint trigger loan_transaction_integrity after update on finance.ledger_transactions deferrable initially deferred for each row execute function private.loan_ledger_integrity();

-- Preserve every validated previous definition, then add narrow bypass guards.
do $$ declare definition text; needle text; signature text; begin
  definition := pg_get_functiondef('api.create_commitment(uuid,jsonb)'::regprocedure);
  execute replace(definition,'api.create_commitment','private.create_loan_commitment');
  execute replace(definition,'perform private.require_writer(p_space);','perform private.require_writer(p_space);
    if exists(select 1 from finance.loans l join finance.loan_schedule_versions v on v.loan_id = l.id where l.financial_space_id = p_space and l.ledger_account_id = (p_payload->>''counterpart_account_id'')::uuid) then raise exception ''Use the dedicated loan installment operation'' using errcode = ''23514''; end if;');
  definition := pg_get_functiondef('private.validate_recurrence_version()'::regprocedure);
  needle := 'if tg_op <> ''INSERT'' then';
  if position(needle in definition) = 0 then raise exception 'Loan recurrence guard point not found'; end if;
  execute replace(definition,needle,'if exists(select 1 from finance.loans l join finance.loan_schedule_versions v on v.loan_id = l.id where l.financial_space_id = new.financial_space_id and l.ledger_account_id = new.counterpart_account_id) then raise exception ''Use the dedicated loan installment operation'' using errcode = ''23514''; end if;
    ' || needle);
  definition := pg_get_functiondef('private.post_transaction_internal(uuid,jsonb,uuid)'::regprocedure);
  needle := 'commitment_id,reserve_id,created_by)';
  if position(needle in definition) = 0 then raise exception 'Loan writer column point not found'; end if;
  definition := replace(definition,needle,'commitment_id,reserve_id,loan_component,created_by)');
  needle := '(entry->>''reserve_id'')::uuid,p_actor);';
  if position(needle in definition) = 0 then raise exception 'Loan writer value point not found'; end if;
  execute replace(definition,needle,'(entry->>''reserve_id'')::uuid,entry->>''loan_component'',p_actor);');
  foreach signature in array array['api.post_transaction(uuid,jsonb)','api.edit_transaction(uuid,uuid,integer,jsonb,text)'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    needle := 'perform private.require_writer(p_space);';
    if position(needle in definition) = 0 then raise exception 'Loan generic guard point not found'; end if;
    execute replace(definition,needle,needle || '
      if exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_payload->''entries'') = ''array'' then p_payload->''entries'' else ''[]''::jsonb end) e where e->>''loan_component'' is not null or exists(select 1 from finance.loan_installments i where i.financial_space_id = p_space and i.commitment_id = (e->>''commitment_id'')::uuid)) then raise exception ''Use the dedicated loan installment operation'' using errcode = ''23514''; end if;');
  end loop;
  definition := pg_get_functiondef('api.edit_transaction(uuid,uuid,integer,jsonb,text)'::regprocedure);
  execute replace(definition,needle,needle || '
    if exists(select 1 from finance.ledger_entries e join finance.loans l on l.ledger_account_id = e.ledger_account_id where e.ledger_transaction_id = p_transaction and l.financial_space_id = p_space) then raise exception ''Operation must be corrected through its dedicated service'' using errcode = ''23514''; end if;');
  definition := pg_get_functiondef('api.settle_commitment(uuid,uuid,bigint,date,text,uuid,uuid)'::regprocedure);
  needle := 'if not found then raise exception ''Active financial commitment not found'' using errcode = ''P0002''; end if;';
  if position(needle in definition) = 0 then raise exception 'Loan manual settlement guard point not found'; end if;
  definition := replace(definition,needle,needle || '
    if exists(select 1 from finance.loans l join finance.loan_schedule_versions v on v.loan_id = l.id where l.financial_space_id = p_space and l.ledger_account_id = commitment.counterpart_account_id) then raise exception ''Use the dedicated loan installment operation'' using errcode = ''23514''; end if;');
  needle := 'perform private.require_writer(p_space);';
  execute replace(definition,needle,needle || '
    if exists(select 1 from finance.loan_installments where financial_space_id = p_space and commitment_id = p_commitment) then
      if p_category is not null or p_mode is distinct from ''partial'' then raise exception ''Correct the creditor schedule instead of changing the installment'' using errcode = ''23514''; end if;
      return api.pay_loan_installment(p_space,(select id from finance.loan_installments where commitment_id = p_commitment),p_on,p_amount_cents,null,p_client_uuid);
    end if;');
  definition := pg_get_functiondef('api.cancel_commitment(uuid,uuid,integer,text)'::regprocedure);
  execute replace(definition,needle,needle || '
    if exists(select 1 from finance.loan_installments where financial_space_id = p_space and commitment_id = p_commitment) then raise exception ''Replace the creditor schedule instead of cancelling its installment'' using errcode = ''23514''; end if;');
  definition := pg_get_functiondef('api.loan_movement(uuid,uuid,uuid,date,text,bigint,bigint,uuid)'::regprocedure);
  needle := 'if tx is not null then return tx; end if;';
  if position(needle in definition) = 0 then raise exception 'Scheduled loan movement guard point not found'; end if;
  execute replace(definition,needle,needle || '
    if exists(select 1 from finance.loan_schedule_versions where financial_space_id = p_space and loan_id = p_loan) then raise exception ''Use installment payment or extraordinary amortization for a scheduled loan'' using errcode = ''23514''; end if;');
  definition := pg_get_functiondef('api.cancel_transaction(uuid,uuid,integer,text)'::regprocedure);
  needle := 'perform private.require_writer(p_space);';
  -- Cancelling the principal alone would leave a replacement schedule based on
  -- a different debt. Preserve the atomic operation until corrected as a whole.
  execute replace(definition,needle,needle || '
    if exists(select 1 from finance.ledger_transactions where financial_space_id = p_space and id = p_transaction and operation_receipt->>''operation'' = ''loan_prepayment'') then raise exception ''Extraordinary amortization and its replacement schedule must be corrected together'' using errcode = ''23514''; end if;
    if exists(select 1 from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id = t.id join finance.loans l on l.ledger_account_id = e.ledger_account_id where t.id = p_transaction and l.financial_space_id = p_space and t.kind in(''opening'',''loan_disbursement'') and exists(select 1 from finance.loan_schedule_versions v where v.loan_id = l.id)) then raise exception ''Scheduled debt opening cannot be cancelled independently of its contract'' using errcode = ''23514''; end if;
    if exists(select 1 from finance.loans l join finance.ledger_entries e on e.ledger_account_id = l.ledger_account_id where l.financial_space_id = p_space and l.status = ''archived'' and e.ledger_transaction_id = p_transaction) then raise exception ''Archived loan history cannot be cancelled'' using errcode = ''23514''; end if;');
end $$;
revoke all on function private.create_loan_commitment(uuid,jsonb),private.loan_ledger_integrity(),private.protect_loan_history(),private.validate_loan_component(),private.loan_request_result(uuid,uuid,text,jsonb),private.record_loan_request(uuid,uuid,text,jsonb,uuid),private.create_loan_generic(uuid,text,text,bigint,date,text) from public,anon,authenticated;
revoke all on function api.configure_loan_schedule(uuid,uuid,integer,jsonb,uuid),api.pay_loan_installment(uuid,uuid,date,bigint,uuid,uuid),api.adjust_loan_balance(uuid,uuid,date,bigint,uuid,uuid),api.prepay_loan(uuid,uuid,integer,uuid,date,bigint,jsonb,uuid),api.create_loan(uuid,text,text,bigint,date,text,jsonb,uuid),api.loan_summary(uuid,uuid),api.archive_loan(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function api.configure_loan_schedule(uuid,uuid,integer,jsonb,uuid),api.pay_loan_installment(uuid,uuid,date,bigint,uuid,uuid),api.adjust_loan_balance(uuid,uuid,date,bigint,uuid,uuid),api.prepay_loan(uuid,uuid,integer,uuid,date,bigint,jsonb,uuid),api.create_loan(uuid,text,text,bigint,date,text,jsonb,uuid),api.loan_summary(uuid,uuid),api.archive_loan(uuid,uuid,integer) to authenticated;
commit;
