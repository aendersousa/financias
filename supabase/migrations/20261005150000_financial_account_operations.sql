begin;
create table finance.categories (
  id uuid primary key default gen_random_uuid(),
  financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  parent_id uuid,
  ledger_account_id uuid,
  kind text not null check (kind in ('expense','income')),
  name text not null check (char_length(name) between 1 and 100),
  icon text,
  color text,
  is_essential boolean not null default false,
  fixity text check (fixity in ('fixed','variable')),
  is_tax_deductible boolean not null default false,
  income_class text check (income_class in ('recurring','extraordinary','benefit','cashback','financial')),
  system_role text check (system_role in ('financial_charges','taxes_fees','cashback','benefits','discounts_obtained')),
  benefit_financial_account_id uuid,
  sort_order smallint not null default 0,
  archived_at timestamptz,
  deleted_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(financial_space_id,id),
  foreign key (financial_space_id,parent_id) references finance.categories(financial_space_id,id),
  foreign key (financial_space_id,ledger_account_id) references finance.ledger_accounts(financial_space_id,id),
  foreign key (financial_space_id,benefit_financial_account_id) references finance.financial_accounts(financial_space_id,id),
  check (parent_id is distinct from id),
  check (income_class is null or kind = 'income'),
  check ((fixity is null or kind = 'expense') and (not is_essential or kind = 'expense') and (not is_tax_deductible or kind = 'expense')),
  check (benefit_financial_account_id is null or kind = 'expense')
);
create unique index category_system_role on finance.categories(financial_space_id,system_role) where system_role is not null;
alter table finance.categories enable row level security;
create policy member_read on finance.categories for select to authenticated using (private.is_member(financial_space_id));
revoke all on finance.categories from public,anon,authenticated;
grant select on finance.categories to authenticated;

create function api.create_financial_account(p_space uuid,p_name text,p_kind text,p_opening_cents bigint default 0,p_opening_on date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare account_id uuid; ledger_id uuid; opening_id uuid; liquidity text; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_kind not in ('checking','payment','wallet','savings','benefit','investment','property') then raise exception 'Invalid account kind' using errcode = '23514'; end if;
  if p_opening_cents is null or abs(p_opening_cents::numeric) > 9007199254740991 then raise exception 'Invalid opening cents' using errcode = '23514'; end if;
  if p_kind in ('benefit','investment','savings','property') and p_opening_cents < 0 then raise exception 'This account cannot have a negative opening' using errcode = '23514'; end if;
  liquidity := case when p_kind in ('checking','payment','wallet') then 'cash' when p_kind = 'savings' then 'investment' else p_kind end;
  insert into finance.ledger_accounts(financial_space_id,account_class,liquidity,owner_type,name,created_by)
    values(p_space,'asset',liquidity,'financial_account',p_name,auth.uid()) returning id into ledger_id;
  insert into finance.financial_accounts(financial_space_id,ledger_account_id,kind,name,created_by)
    values(p_space,ledger_id,p_kind,p_name,auth.uid()) returning id into account_id;
  if p_opening_cents <> 0 then
    if p_opening_on is null then select (now() at time zone timezone)::date into p_opening_on from finance.financial_spaces where id = p_space; end if;
    select id into opening_id from finance.ledger_accounts where financial_space_id = p_space and system_role = 'opening';
    perform api.post_transaction(p_space,jsonb_build_object('kind','opening','occurred_on',p_opening_on,'competence_month',date_trunc('month',p_opening_on)::date,'description','Saldo inicial: ' || p_name,'source','system','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',ledger_id,'amount_cents',p_opening_cents),jsonb_build_object('ledger_account_id',opening_id,'amount_cents',-p_opening_cents))));
  end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','financial_account',account_id,jsonb_build_object('name',p_name,'kind',p_kind,'opening_cents',p_opening_cents));
  return account_id;
end;
$$;

create function api.create_category(p_space uuid,p_name text,p_kind text,p_parent uuid default null,p_income_class text default null,p_is_essential boolean default false,p_fixity text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare category_id uuid; ledger_id uuid; parent finance.categories; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_kind not in ('expense','income') then raise exception 'Invalid category kind' using errcode = '23514'; end if;
  if p_kind = 'income' and p_income_class is null then raise exception 'Income class is required' using errcode = '23514'; end if;
  if p_parent is not null then
    select * into parent from finance.categories where financial_space_id = p_space and id = p_parent;
    if not found or parent.kind <> p_kind or parent.archived_at is not null then raise exception 'Invalid category parent' using errcode = '23514'; end if;
    if parent.ledger_account_id is not null then raise exception 'Convert the leaf to a parent before adding children' using errcode = '23514'; end if;
  end if;
  insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,name,created_by) values(p_space,p_kind,'category',p_name,auth.uid()) returning id into ledger_id;
  insert into finance.categories(financial_space_id,parent_id,ledger_account_id,kind,name,income_class,is_essential,fixity,created_by)
    values(p_space,p_parent,ledger_id,p_kind,p_name,p_income_class,p_is_essential,case when p_kind = 'expense' then coalesce(p_fixity,'variable') else p_fixity end,auth.uid()) returning id into category_id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','category',category_id,jsonb_build_object('name',p_name,'kind',p_kind));
  return category_id;
end;
$$;

create function api.archive_financial_account(p_space uuid,p_account uuid,p_version integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare account finance.financial_accounts; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into account from finance.financial_accounts where financial_space_id = p_space and id = p_account for update;
  if not found then raise exception 'Account not found' using errcode = 'P0002'; end if;
  if account.version <> p_version then raise exception 'Account changed; reload before editing' using errcode = '40001'; end if;
  if account.archived_at is not null then return account.id; end if;
  update finance.financial_accounts set archived_at = now(),updated_at = now(),version = version + 1 where id = account.id;
  update finance.ledger_accounts set allows_posting = false,archived_at = now(),updated_at = now() where id = account.ledger_account_id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data) values(p_space,auth.uid(),'archived','financial_account',account.id,to_jsonb(account));
  return account.id;
end;
$$;
revoke all on function api.create_financial_account(uuid,text,text,bigint,date),api.create_category(uuid,text,text,uuid,text,boolean,text),api.archive_financial_account(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function api.create_financial_account(uuid,text,text,bigint,date),api.create_category(uuid,text,text,uuid,text,boolean,text),api.archive_financial_account(uuid,uuid,integer) to authenticated;
commit;
