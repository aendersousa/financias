begin;
create table finance.credit_cards (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  ledger_account_id uuid not null,name text not null check(char_length(name) between 1 and 100),issuer_name text,brand text,last_digits varchar(4),
  closing_day smallint not null check(closing_day between 1 and 31),due_day smallint not null check(due_day between 1 and 31),
  closing_day_purchase_goes_next boolean not null default true,installment_remainder text not null default 'first' check(installment_remainder in ('first','last')),
  limit_release_days_pix smallint not null default 0 check(limit_release_days_pix >= 0),limit_release_days_debit smallint not null default 0 check(limit_release_days_debit >= 0),limit_release_days_boleto smallint not null default 3 check(limit_release_days_boleto >= 0),
  default_payment_financial_account_id uuid,default_refund_model text not null default 'cancel_remaining' check(default_refund_model in ('cancel_remaining','credit_open_statement')),
  revolving_interest_monthly_percent numeric(7,4),late_fee_percent numeric(7,4) not null default 2,late_interest_monthly_percent numeric(7,4) not null default 1,
  started_on date,status text not null default 'active' check(status in ('active','cancelled','archived')),cancelled_on date,archived_at timestamptz,deleted_at timestamptz,
  version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),
  unique(financial_space_id,id),unique(financial_space_id,ledger_account_id),
  foreign key(financial_space_id,ledger_account_id) references finance.ledger_accounts(financial_space_id,id),
  foreign key(financial_space_id,default_payment_financial_account_id) references finance.financial_accounts(financial_space_id,id),
  check((status = 'active') = (cancelled_on is null)),check((status = 'archived') = (archived_at is not null)),
  check(last_digits is null or last_digits ~ '^[0-9]{4}$')
);
create table finance.credit_card_holders (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  credit_card_id uuid not null,name text not null,kind text not null check(kind in ('main','additional','virtual')),last_digits varchar(4),person_id uuid,is_active boolean not null default true,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id),
  foreign key(financial_space_id,credit_card_id) references finance.credit_cards(financial_space_id,id),foreign key(financial_space_id,person_id) references finance.people(financial_space_id,id),
  check(last_digits is null or last_digits ~ '^[0-9]{4}$')
);
create table finance.credit_card_limits (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  credit_card_id uuid not null,limit_cents bigint not null check(limit_cents between 0 and 9007199254740991),valid_from date not null,reason text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id),unique(credit_card_id,valid_from),
  foreign key(financial_space_id,credit_card_id) references finance.credit_cards(financial_space_id,id)
);
create table finance.card_statements (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  credit_card_id uuid not null,reference_month date not null check(extract(day from reference_month) = 1),period_start date not null,period_end date not null,closing_on date not null,due_on date not null,effective_due_on date not null,
  status text not null check(status in ('future','open','closed')),closed_at timestamptz,closing_amount_cents bigint,charges_to_confirm boolean not null default false,balance_to_install boolean not null default false,bank_total_cents bigint,dates_overridden boolean not null default false,
  version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id),unique(credit_card_id,reference_month),
  foreign key(financial_space_id,credit_card_id) references finance.credit_cards(financial_space_id,id),
  check(period_start <= period_end and period_end <= closing_on and closing_on < due_on and due_on <= effective_due_on),check((status = 'closed') = (closed_at is not null))
);
create table finance.card_authorizations (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  credit_card_id uuid not null,kind text not null check(kind in ('purchase','payment_hold')),authorized_on date not null,amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),description text not null,
  status text not null default 'pending' check(status in ('pending','converted','expired','cancelled','released')),source text not null default 'manual' check(source in ('manual','import','system')),
  converted_transaction_id uuid,payment_transaction_id uuid,payment_channel text check(payment_channel in ('pix','debit','boleto')),expires_on date,release_on date,resolved_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id),
  foreign key(financial_space_id,credit_card_id) references finance.credit_cards(financial_space_id,id),
  foreign key(financial_space_id,converted_transaction_id) references finance.ledger_transactions(financial_space_id,id),foreign key(financial_space_id,payment_transaction_id) references finance.ledger_transactions(financial_space_id,id),
  check((kind = 'purchase' and status in ('pending','converted','expired','cancelled')) or (kind = 'payment_hold' and status in ('pending','released','cancelled'))),
  check((kind = 'payment_hold') = (payment_transaction_id is not null) and (kind = 'payment_hold') = (release_on is not null) and (kind = 'payment_hold') = (payment_channel is not null)),check((status = 'converted') = (converted_transaction_id is not null))
);
alter table finance.ledger_transactions add column card_holder_id uuid,
  add constraint transaction_card_holder foreign key(financial_space_id,card_holder_id) references finance.credit_card_holders(financial_space_id,id);
alter table finance.ledger_entries add column card_statement_id uuid,add column installment_number smallint,add column installment_count smallint,
  add constraint entry_statement foreign key(financial_space_id,card_statement_id) references finance.card_statements(financial_space_id,id),
  add constraint installment_pair check(num_nulls(installment_number,installment_count) in (0,2)),
  add constraint installment_range check(installment_count >= 2 and installment_number between 1 and installment_count);
create index entry_statement on finance.ledger_entries(card_statement_id) where card_statement_id is not null;
do $$ declare t text; begin
  foreach t in array array['credit_cards','credit_card_holders','credit_card_limits','card_statements','card_authorizations'] loop
    execute format('alter table finance.%I enable row level security',t);
    execute format('create policy member_read on finance.%I for select to authenticated using (private.is_member(financial_space_id))',t);
    execute format('revoke all on finance.%I from public,anon,authenticated',t);
    execute format('grant select on finance.%I to authenticated',t);
  end loop;
end $$;
-- Preserve the existing view column order; append newly introduced card fields.
create or replace view finance.posted_ledger_entries with(security_invoker = true) as
select e.id,e.financial_space_id,e.ledger_transaction_id,e.ledger_account_id,e.amount_cents,e.line_number,e.competence_month,e.original_competence_month,e.created_at,e.updated_at,e.created_by,
 coalesce(e.competence_month,t.competence_month) as effective_competence_month,t.occurred_on,t.kind,t.description,e.card_statement_id,e.installment_number,e.installment_count,t.card_holder_id
from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where t.status = 'posted';
commit;
