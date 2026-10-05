-- Documento Mestre 2.0, sections 6, 8, 32, 33; ALT-001.
-- Separate schema preserves legacy tables during reconciliation.
begin;
create schema if not exists finance;
create schema if not exists private;
create schema if not exists api;
revoke all on schema finance, private, api from public, anon;
grant usage on schema finance, api to authenticated;

create table finance.financial_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  kind text not null default 'personal' check (kind in ('personal','shared')),
  base_currency char(3) not null default 'BRL' check (base_currency = 'BRL'),
  timezone text not null default 'America/Sao_Paulo',
  created_by uuid not null references auth.users(id),
  archived_at timestamptz,
  deletion_scheduled_for date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table finance.financial_space_members (
  id uuid primary key default gen_random_uuid(),
  financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  user_id uuid references auth.users(id),
  role text not null check (role in ('owner','admin','member','viewer')),
  status text not null default 'active' check (status in ('invited','active','left')),
  invited_email text,
  invitation_token_hash text,
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(financial_space_id,id),
  check (status <> 'active' or user_id is not null)
);
create unique index membership_active_unique on finance.financial_space_members(financial_space_id,user_id) where status = 'active';
create index membership_user on finance.financial_space_members(user_id);
create table finance.space_settings (
  financial_space_id uuid primary key references finance.financial_spaces(id) on delete cascade,
  minimum_safety_reserve_cents bigint not null default 0 check (minimum_safety_reserve_cents >= 0),
  fallback_cycle_day smallint not null default 1 check (fallback_cycle_day between 1 and 31),
  preferences jsonb not null default '{}'
);
create table finance.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  account_class text not null check (account_class in ('asset','liability','income','expense','equity')),
  normal_sign smallint generated always as (case when account_class in ('asset','expense') then 1 else -1 end) stored,
  liquidity text check (liquidity in ('cash','benefit','investment','person','property')),
  owner_type text not null check (owner_type in ('financial_account','credit_card','category','person','loan','system')),
  system_role text check (system_role in ('opening','balance_adjustment','investment_result')),
  name text not null check (char_length(name) between 1 and 100),
  currency char(3) not null default 'BRL' check (currency = 'BRL'),
  allows_posting boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(financial_space_id,id),
  check ((account_class = 'asset') = (liquidity is not null)),
  check ((owner_type = 'system') = (system_role is not null)),
  check (system_role is null or account_class = 'equity'),
  check ((owner_type <> 'person' or liquidity = 'person') and
    (owner_type not in ('credit_card','loan') or account_class = 'liability') and
    (owner_type <> 'category' or account_class in ('income','expense')) and
    (owner_type <> 'financial_account' or (account_class = 'asset' and liquidity <> 'person')))
);
create unique index ledger_system_role_unique on finance.ledger_accounts(financial_space_id,system_role) where system_role is not null;
create index ledger_account_liquidity on finance.ledger_accounts(financial_space_id,liquidity);
create table finance.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  ledger_account_id uuid not null,
  kind text not null check (kind in ('checking','payment','wallet','savings','benefit','investment','property')),
  name text not null,
  institution_name text,
  icon text,
  color text,
  is_emergency_reserve boolean not null default false,
  sort_order smallint not null default 0,
  archived_at timestamptz,
  deleted_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(financial_space_id,id),
  unique(financial_space_id,ledger_account_id),
  foreign key (financial_space_id,ledger_account_id) references finance.ledger_accounts(financial_space_id,id)
);
create table finance.period_closings (
  id uuid primary key default gen_random_uuid(),
  financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  closed_at timestamptz not null default now(),
  closed_by uuid not null references auth.users(id),
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(financial_space_id,id),
  check (num_nulls(reopened_at,reopened_by,reopen_reason) in (0,3)),
  check (reopen_reason is null or char_length(reopen_reason) >= 10)
);
create unique index one_closed_month on finance.period_closings(financial_space_id,month) where reopened_at is null;
create table finance.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  kind text not null check (kind in ('opening','expense','income','transfer','card_purchase','card_payment','card_rollover','card_credit_carry','card_installment_plan','card_charges','card_correction','card_prepayment','refund','payment_returned','balance_adjustment','investment_contribution','investment_redemption','investment_result','loan_disbursement','loan_payment','person_settlement','space_transfer')),
  status text not null default 'posted' check (status in ('posted','cancelled')),
  occurred_on date not null,
  competence_month date not null check (extract(day from competence_month) = 1),
  description text not null check (char_length(description) between 1 and 200),
  notes text,
  related_transaction_id uuid,
  relation_type text check (relation_type in ('refund_of','payment_returned_of','correction_of','fx_confirmation_of','prepayment_of','rollover_of','installment_plan_of')),
  source text not null default 'manual' check (source in ('manual','quick_entry','offline_queue','import','recurrence','system')),
  client_uuid uuid,
  client_payload_hash bytea,
  system_key text,
  cancellation_kind text check (cancellation_kind in ('user_deleted','user_cancelled','import_undone','schedule_failed','moved_to_other_space','system_reprocessed')),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancellation_reason text,
  updated_by uuid references auth.users(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(financial_space_id,id),
  foreign key (financial_space_id,related_transaction_id) references finance.ledger_transactions(financial_space_id,id),
  check ((related_transaction_id is null) = (relation_type is null)),
  check (related_transaction_id is distinct from id),
  check (num_nulls(client_uuid,client_payload_hash) in (0,2)),
  check ((status = 'cancelled') = (cancelled_at is not null) and (status = 'cancelled') = (cancellation_kind is not null)),
  check ((relation_type is null and kind not in ('refund','payment_returned','card_correction','card_prepayment')) or
    (relation_type = 'refund_of' and kind = 'refund') or (relation_type = 'payment_returned_of' and kind = 'payment_returned') or
    (relation_type = 'correction_of' and kind = 'card_correction') or (relation_type = 'fx_confirmation_of' and kind in ('card_correction','expense')) or
    (relation_type = 'prepayment_of' and kind = 'card_prepayment') or (relation_type = 'rollover_of' and kind = 'card_rollover') or
    (relation_type = 'installment_plan_of' and kind = 'card_installment_plan'))
);
create unique index transaction_client_uuid on finance.ledger_transactions(financial_space_id,client_uuid) where client_uuid is not null;
create unique index transaction_system_key on finance.ledger_transactions(financial_space_id,system_key) where system_key is not null;
create index transaction_date on finance.ledger_transactions(financial_space_id,occurred_on) where status = 'posted';
create table finance.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  ledger_transaction_id uuid not null,
  ledger_account_id uuid not null,
  amount_cents bigint not null check (amount_cents <> 0 and amount_cents between -9007199254740991 and 9007199254740991),
  line_number smallint not null check (line_number > 0),
  competence_month date check (extract(day from competence_month) = 1),
  original_competence_month date check (extract(day from original_competence_month) = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(financial_space_id,id),
  unique(ledger_transaction_id,line_number),
  foreign key (financial_space_id,ledger_transaction_id) references finance.ledger_transactions(financial_space_id,id),
  foreign key (financial_space_id,ledger_account_id) references finance.ledger_accounts(financial_space_id,id)
);
create index entry_account on finance.ledger_entries(financial_space_id,ledger_account_id);
create table finance.audit_logs (
  id uuid primary key default gen_random_uuid(),
  financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create function private.is_member(p_space uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from finance.financial_space_members where financial_space_id = p_space and user_id = auth.uid() and status = 'active');
$$;
create function private.require_writer(p_space uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from finance.financial_space_members where financial_space_id = p_space and user_id = auth.uid() and status = 'active' and role in ('owner','admin','member')) then
    raise exception 'No permission to write to financial space' using errcode = '42501';
  end if;
end;
$$;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_member(uuid) to authenticated;

do $$ declare t text; begin
  foreach t in array array['financial_space_members','space_settings','ledger_accounts','financial_accounts','period_closings','ledger_transactions','ledger_entries','audit_logs'] loop
    execute format('alter table finance.%I enable row level security',t);
    execute format('create policy member_read on finance.%I for select to authenticated using (private.is_member(financial_space_id))',t);
  end loop;
end $$;
alter table finance.financial_spaces enable row level security;
create policy member_read on finance.financial_spaces for select to authenticated using (private.is_member(id));
revoke all on all tables in schema finance from anon, authenticated;
grant select on all tables in schema finance to authenticated;

create function private.check_balanced_transaction() returns trigger
language plpgsql set search_path = '' as $$
declare tx uuid; n integer; total numeric; begin
  if tg_table_name = 'ledger_transactions' then tx := coalesce(new.id,old.id);
  else tx := coalesce(new.ledger_transaction_id,old.ledger_transaction_id); end if;
  if exists(select 1 from finance.ledger_transactions where id = tx) then
    select count(*),coalesce(sum(amount_cents),0) into n,total from finance.ledger_entries where ledger_transaction_id = tx;
    if n < 2 or total <> 0 then raise exception 'Transaction requires at least two entries summing to zero' using errcode = '23514'; end if;
  end if;
  return null;
end;
$$;
create constraint trigger ledger_balanced_tx after insert or update on finance.ledger_transactions deferrable initially deferred for each row execute function private.check_balanced_transaction();
create constraint trigger ledger_balanced_entries after insert or update or delete on finance.ledger_entries deferrable initially deferred for each row execute function private.check_balanced_transaction();

create function private.protect_ledger_mutation() returns trigger
language plpgsql set search_path = '' as $$
declare tx finance.ledger_transactions; posting_account finance.ledger_accounts; effective_month date; begin
  if tg_table_name = 'ledger_transactions' then
    if tg_op = 'DELETE' then raise exception 'Cancel transactions instead of deleting' using errcode = '23514'; end if;
    if tg_op = 'UPDATE' and old.status = 'cancelled' then raise exception 'Cancelled transactions are immutable' using errcode = '23514'; end if;
    if exists(select 1 from finance.period_closings where financial_space_id = new.financial_space_id and month = new.competence_month and reopened_at is null) then raise exception 'Period is closed' using errcode = '23514'; end if;
    if tg_op = 'UPDATE' and exists(select 1 from finance.period_closings where financial_space_id = old.financial_space_id and month = old.competence_month and reopened_at is null) then raise exception 'Period is closed' using errcode = '23514'; end if;
  else
    if tg_op = 'UPDATE' and (new.ledger_transaction_id <> old.ledger_transaction_id or new.financial_space_id <> old.financial_space_id) then raise exception 'Entry transaction and space are immutable' using errcode = '23514'; end if;
    select * into tx from finance.ledger_transactions where id = coalesce(new.ledger_transaction_id,old.ledger_transaction_id);
    if tx.status = 'cancelled' then raise exception 'Cancelled transactions are immutable' using errcode = '23514'; end if;
    effective_month := coalesce(new.competence_month,old.competence_month,tx.competence_month);
    if exists(select 1 from finance.period_closings where financial_space_id = tx.financial_space_id and month = effective_month and reopened_at is null) then raise exception 'Period is closed' using errcode = '23514'; end if;
    if tg_op <> 'DELETE' then
      select * into posting_account from finance.ledger_accounts where id = new.ledger_account_id;
      if tg_op = 'INSERT' and not posting_account.allows_posting then raise exception 'Account is archived' using errcode = '23514'; end if;
      if new.original_competence_month is not null and new.original_competence_month >= coalesce(new.competence_month,tx.competence_month) then raise exception 'Original competence must precede effective competence' using errcode = '23514'; end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger protect_transaction before insert or update or delete on finance.ledger_transactions for each row execute function private.protect_ledger_mutation();
create trigger protect_entry before insert or update or delete on finance.ledger_entries for each row execute function private.protect_ledger_mutation();

create view finance.posted_ledger_entries with (security_invoker = true) as
select e.*,coalesce(e.competence_month,t.competence_month) as effective_competence_month,t.occurred_on,t.kind,t.description
from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where t.status = 'posted';
create view finance.account_balances with (security_invoker = true) as
select a.id,a.financial_space_id,a.name,a.account_class,a.liquidity,a.normal_sign,
  coalesce(sum(e.amount_cents) filter (where e.occurred_on <= (now() at time zone s.timezone)::date),0)::bigint as balance_cents
from finance.ledger_accounts a join finance.financial_spaces s on s.id = a.financial_space_id
left join finance.posted_ledger_entries e on e.ledger_account_id = a.id group by a.id,s.timezone;
grant select on finance.posted_ledger_entries,finance.account_balances to authenticated;

create function api.create_personal_space(p_name text default 'Minhas finanças') returns uuid
language plpgsql security definer set search_path = '' as $$
declare space_id uuid; begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select id into space_id from finance.financial_spaces where created_by = auth.uid() and kind = 'personal' and archived_at is null;
  if space_id is not null then return space_id; end if;
  insert into finance.financial_spaces(name,created_by) values(p_name,auth.uid()) returning id into space_id;
  insert into finance.financial_space_members(financial_space_id,user_id,role,joined_at,created_by) values(space_id,auth.uid(),'owner',now(),auth.uid());
  insert into finance.space_settings(financial_space_id) values(space_id);
  insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,system_role,name,created_by) values
    (space_id,'equity','system','opening','Abertura',auth.uid()),
    (space_id,'equity','system','balance_adjustment','Ajuste de saldo',auth.uid()),
    (space_id,'equity','system','investment_result','Resultado de investimentos',auth.uid());
  return space_id;
end;
$$;
create function api.post_transaction(p_space uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tx_id uuid; existing finance.ledger_transactions; payload_hash bytea; entry jsonb; line smallint := 0; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  payload_hash := sha256(convert_to(p_payload::text,'UTF8'));
  if p_payload->>'client_uuid' is not null then
    select * into existing from finance.ledger_transactions where financial_space_id = p_space and client_uuid = (p_payload->>'client_uuid')::uuid;
    if found then
      if existing.client_payload_hash <> payload_hash then raise exception 'Client UUID reused with different payload' using errcode = '23505'; end if;
      return existing.id;
    end if;
  end if;
  if jsonb_typeof(p_payload->'entries') is distinct from 'array' or jsonb_array_length(p_payload->'entries') < 2 then raise exception 'At least two entries required' using errcode = '23514'; end if;
  insert into finance.ledger_transactions(financial_space_id,kind,occurred_on,competence_month,description,notes,source,client_uuid,client_payload_hash,related_transaction_id,relation_type,created_by)
  values(p_space,p_payload->>'kind',(p_payload->>'occurred_on')::date,(p_payload->>'competence_month')::date,p_payload->>'description',p_payload->>'notes',coalesce(p_payload->>'source','manual'),(p_payload->>'client_uuid')::uuid,case when p_payload->>'client_uuid' is null then null else payload_hash end,(p_payload->>'related_transaction_id')::uuid,p_payload->>'relation_type',auth.uid()) returning id into tx_id;
  for entry in select value from jsonb_array_elements(p_payload->'entries') loop
    line := line + 1;
    if entry->>'amount_cents' !~ '^-?[0-9]+$' then raise exception 'Amount must be integer cents' using errcode = '23514'; end if;
    insert into finance.ledger_entries(financial_space_id,ledger_transaction_id,ledger_account_id,amount_cents,line_number,competence_month,created_by)
    values(p_space,tx_id,(entry->>'ledger_account_id')::uuid,(entry->>'amount_cents')::bigint,line,(entry->>'competence_month')::date,auth.uid());
  end loop;
  if (select sum(amount_cents) from finance.ledger_entries where ledger_transaction_id = tx_id) <> 0 then raise exception 'Transaction must sum to zero' using errcode = '23514'; end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','ledger_transaction',tx_id,p_payload);
  return tx_id;
end;
$$;
create function api.cancel_transaction(p_space uuid,p_transaction uuid,p_version integer,p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tx finance.ledger_transactions; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into tx from finance.ledger_transactions where financial_space_id = p_space and id = p_transaction for update;
  if not found then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  if tx.version <> p_version then raise exception 'Transaction changed; reload before editing' using errcode = '40001'; end if;
  if tx.status = 'cancelled' then return tx.id; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Cancellation reason required' using errcode = '23514'; end if;
  update finance.ledger_transactions set status = 'cancelled',cancellation_kind = 'user_cancelled',cancelled_at = now(),cancelled_by = auth.uid(),cancellation_reason = p_reason,version = version + 1,updated_at = now(),updated_by = auth.uid() where id = tx.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data)
    values(p_space,auth.uid(),'cancelled','ledger_transaction',tx.id,to_jsonb(tx),jsonb_build_object('reason',p_reason));
  return tx.id;
end;
$$;
revoke all on all functions in schema api from public, anon, authenticated;
grant execute on function api.create_personal_space(text),api.post_transaction(uuid,jsonb),api.cancel_transaction(uuid,uuid,integer,text) to authenticated;
revoke all on function private.check_balanced_transaction(),private.protect_ledger_mutation() from public,anon,authenticated;
commit;
