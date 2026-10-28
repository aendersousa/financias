begin;
create table finance.recurrence_rules (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  direction text not null check(direction in ('inflow','outflow')),unit text not null check(unit in ('week','month','year')),title text not null,
  is_main_income boolean not null default false,is_subscription boolean not null default false,starts_on date not null,ends_on date,generated_through date,archived_at timestamptz,
  version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id),
  check(not is_main_income or direction = 'inflow'),check(ends_on is null or ends_on >= starts_on)
);
create unique index single_main_income on finance.recurrence_rules(financial_space_id) where is_main_income and archived_at is null and ends_on is null;
create table finance.reserves (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  reserve_type text not null check(reserve_type in ('goal','provision')),name text not null,holding_mode text not null check(holding_mode in ('virtual','account')),
  financial_account_id uuid not null,target_amount_cents bigint check(target_amount_cents between 1 and 9007199254740991),target_date date,category_id uuid,
  contribution_mode text not null check(contribution_mode in ('automatic','manual')),recurrence_rule_id uuid,is_emergency_reserve boolean not null default false,
  alert_thresholds smallint[] not null default '{50,75,100}',priority smallint not null default 0,status text not null default 'active' check(status in ('active','achieved','settled','closed')),archived_at timestamptz,
  version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id),
  foreign key(financial_space_id,financial_account_id) references finance.financial_accounts(financial_space_id,id),foreign key(financial_space_id,category_id) references finance.categories(financial_space_id,id),
  foreign key(financial_space_id,recurrence_rule_id) references finance.recurrence_rules(financial_space_id,id),check(reserve_type = 'goal' or holding_mode = 'virtual'),check((category_id is null and recurrence_rule_id is null) or reserve_type = 'provision')
);
create unique index one_account_goal on finance.reserves(financial_space_id,financial_account_id) where holding_mode = 'account' and archived_at is null;
create table finance.recurrence_rule_versions (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  recurrence_rule_id uuid not null,version_number integer not null check(version_number > 0),effective_from_period date not null,change_scope text not null check(change_scope in ('initial','this_and_following','entire_series')),
  interval_count smallint not null default 1 check(interval_count between 1 and 120),day_of_month smallint check(day_of_month between 1 and 31),weekday smallint check(weekday between 1 and 7),month_of_year smallint check(month_of_year between 1 and 12),
  business_day_adjustment text not null default 'next' check(business_day_adjustment in ('next','previous')),certainty text not null check(certainty in ('confirmed','estimated','conditional')),amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),
  category_id uuid,counterpart_account_id uuid,payment_method text not null check(payment_method in ('account','card')),payment_financial_account_id uuid,payment_credit_card_id uuid,reserve_id uuid,competence_offset_months smallint not null default 0 check(competence_offset_months between -12 and 12),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id),unique(recurrence_rule_id,version_number),
  foreign key(financial_space_id,recurrence_rule_id) references finance.recurrence_rules(financial_space_id,id),foreign key(financial_space_id,category_id) references finance.categories(financial_space_id,id),foreign key(financial_space_id,counterpart_account_id) references finance.ledger_accounts(financial_space_id,id),
  foreign key(financial_space_id,payment_financial_account_id) references finance.financial_accounts(financial_space_id,id),foreign key(financial_space_id,payment_credit_card_id) references finance.credit_cards(financial_space_id,id),foreign key(financial_space_id,reserve_id) references finance.reserves(financial_space_id,id),
  check(num_nonnulls(category_id,counterpart_account_id) <= 1),check((payment_method = 'account' and payment_financial_account_id is not null and payment_credit_card_id is null) or (payment_method = 'card' and payment_credit_card_id is not null and payment_financial_account_id is null))
);
create table finance.commitments (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  kind text not null check(kind in ('one_off','occurrence','reminder')),direction text check(direction in ('inflow','outflow')),certainty text check(certainty in ('confirmed','estimated','conditional')),title text not null,notes text,
  category_id uuid,counterpart_account_id uuid,person_id uuid,due_amount_cents bigint check(due_amount_cents between 1 and 9007199254740991),estimated_amount_cents bigint,
  nominal_due_on date not null,effective_due_on date not null,effective_due_on_overridden boolean not null default false,competence_month date not null check(extract(day from competence_month) = 1),
  payment_method text check(payment_method in ('account','card')),payment_financial_account_id uuid,payment_credit_card_id uuid,recurrence_rule_id uuid,recurrence_rule_version_id uuid,period_key date,reserve_id uuid,
  user_modified_at timestamptz,completed_at timestamptz,cancelled_at timestamptz,cancelled_by uuid references auth.users(id),cancellation_reason text,deleted_at timestamptz,
  version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id),
  foreign key(financial_space_id,category_id) references finance.categories(financial_space_id,id),foreign key(financial_space_id,counterpart_account_id) references finance.ledger_accounts(financial_space_id,id),foreign key(financial_space_id,person_id) references finance.people(financial_space_id,id),
  foreign key(financial_space_id,payment_financial_account_id) references finance.financial_accounts(financial_space_id,id),foreign key(financial_space_id,payment_credit_card_id) references finance.credit_cards(financial_space_id,id),
  foreign key(financial_space_id,recurrence_rule_id) references finance.recurrence_rules(financial_space_id,id),foreign key(financial_space_id,recurrence_rule_version_id) references finance.recurrence_rule_versions(financial_space_id,id),foreign key(financial_space_id,reserve_id) references finance.reserves(financial_space_id,id),
  check((kind = 'reminder') = (person_id is not null) and (kind = 'reminder') = (due_amount_cents is null) and (kind = 'reminder') = (direction is null) and (kind = 'reminder') = (certainty is null) and (kind = 'reminder') = (payment_method is null)),
  check((kind = 'occurrence') = (recurrence_rule_id is not null)),check(certainty is distinct from 'conditional' or direction = 'inflow'),check(num_nonnulls(category_id,counterpart_account_id) <= 1),check(num_nulls(recurrence_rule_id,recurrence_rule_version_id,period_key) in (0,3)),
  check((cancelled_at is null) = (cancellation_reason is null)),check(completed_at is null or kind = 'reminder'),
  check(effective_due_on >= nominal_due_on or direction = 'inflow' or effective_due_on_overridden),
  check(kind = 'reminder' or ((payment_method = 'account' and payment_financial_account_id is not null and payment_credit_card_id is null) or (payment_method = 'card' and payment_credit_card_id is not null and payment_financial_account_id is null))),check(direction is distinct from 'inflow' or payment_method = 'account')
);
create unique index recurrence_occurrence on finance.commitments(recurrence_rule_id,period_key) where deleted_at is null and recurrence_rule_id is not null;
create index commitment_due on finance.commitments(financial_space_id,effective_due_on) where cancelled_at is null and deleted_at is null;
create table finance.budgets (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  budget_type text not null check(budget_type in ('consumption','monthly_flow')),category_id uuid,amount_cents bigint not null check(amount_cents between 0 and 9007199254740991),effective_from_month date not null,effective_until_month date,is_essential_override boolean,
  version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id),
  foreign key(financial_space_id,category_id) references finance.categories(financial_space_id,id),check((budget_type = 'consumption') = (category_id is not null)),check(extract(day from effective_from_month) = 1 and (effective_until_month is null or (extract(day from effective_until_month) = 1 and effective_until_month >= effective_from_month)))
);
create table finance.budget_month_overrides (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,budget_id uuid not null,month date not null check(extract(day from month) = 1),amount_cents bigint not null check(amount_cents between 0 and 9007199254740991),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id),unique(budget_id,month),foreign key(financial_space_id,budget_id) references finance.budgets(financial_space_id,id)
);
create table finance.reserve_contributions (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,reserve_id uuid not null,kind text not null check(kind in ('contribution','release')),origin text not null check(origin in ('manual','automatic','release_on_settlement')),amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),occurred_on date not null,note text,cancelled_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references auth.users(id),unique(financial_space_id,id),foreign key(financial_space_id,reserve_id) references finance.reserves(financial_space_id,id),check(origin <> 'release_on_settlement' or kind = 'release')
);
alter table finance.ledger_entries add column commitment_id uuid,add column reserve_id uuid,
  add constraint entry_commitment foreign key(financial_space_id,commitment_id) references finance.commitments(financial_space_id,id),add constraint entry_reserve foreign key(financial_space_id,reserve_id) references finance.reserves(financial_space_id,id);
do $$ declare t text; begin
  foreach t in array array['recurrence_rules','recurrence_rule_versions','commitments','reserves','budgets','budget_month_overrides','reserve_contributions'] loop
    execute format('alter table finance.%I enable row level security',t); execute format('create policy member_read on finance.%I for select to authenticated using(private.is_member(financial_space_id))',t);
    execute format('revoke all on finance.%I from public,anon,authenticated',t); execute format('grant select on finance.%I to authenticated',t);
  end loop;
end $$;
create or replace view finance.posted_ledger_entries with(security_invoker = true) as
select e.id,e.financial_space_id,e.ledger_transaction_id,e.ledger_account_id,e.amount_cents,e.line_number,e.competence_month,e.original_competence_month,e.created_at,e.updated_at,e.created_by,
 coalesce(e.competence_month,t.competence_month) as effective_competence_month,t.occurred_on,t.kind,t.description,e.card_statement_id,e.installment_number,e.installment_count,t.card_holder_id,e.commitment_id,e.reserve_id
from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where t.status = 'posted';
create view finance.commitment_settlements with(security_invoker = true) as
select c.id,c.financial_space_id,c.title,c.kind,c.direction,c.certainty,c.due_amount_cents,c.effective_due_on,c.nominal_due_on,c.competence_month,c.payment_method,c.payment_financial_account_id,c.payment_credit_card_id,c.recurrence_rule_id,c.reserve_id,c.person_id,c.version,
 coalesce(sum(e.amount_cents) * case when c.direction = 'inflow' then -1 else 1 end,0)::bigint as paid_cents,
 (c.due_amount_cents-coalesce(sum(e.amount_cents) * case when c.direction = 'inflow' then -1 else 1 end,0))::bigint as remaining_cents,
 case when c.cancelled_at is not null then 'cancelled' when c.kind = 'reminder' then case when c.completed_at is null then 'pending' else 'settled' end
   when coalesce(sum(e.amount_cents),0) = 0 then 'pending' when coalesce(sum(e.amount_cents) * case when c.direction = 'inflow' then -1 else 1 end,0) >= c.due_amount_cents then 'settled' else 'partial' end as settlement_status,
 c.effective_due_on < (now() at time zone sp.timezone)::date as overdue
from finance.commitments c join finance.financial_spaces sp on sp.id = c.financial_space_id left join finance.posted_ledger_entries e on e.commitment_id = c.id where c.deleted_at is null group by c.id,sp.timezone;
grant select on finance.commitment_settlements to authenticated;
do $$ declare definition text; begin
  definition := pg_get_functiondef('private.post_transaction_internal(uuid,jsonb,uuid)'::regprocedure);
  definition := replace(definition,'installment_count,created_by)','installment_count,commitment_id,reserve_id,created_by)');
  definition := replace(definition,'(entry->>''installment_count'')::smallint,p_actor);','(entry->>''installment_count'')::smallint,(entry->>''commitment_id'')::uuid,(entry->>''reserve_id'')::uuid,p_actor);');
  execute definition;
end $$;
commit;
