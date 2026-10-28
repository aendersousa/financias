begin;
create table finance.people (
  id uuid primary key default gen_random_uuid(),
  financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  ledger_account_id uuid not null,
  nickname text not null check (char_length(nickname) between 1 and 100),
  notes text,
  kind text not null default 'contact' check (kind in ('contact','member','former_member','space')),
  linked_user_id uuid references auth.users(id),
  linked_financial_space_id uuid references finance.financial_spaces(id),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(financial_space_id,id),
  unique(financial_space_id,ledger_account_id),
  foreign key (financial_space_id,ledger_account_id) references finance.ledger_accounts(financial_space_id,id)
);
alter table finance.people enable row level security;
create policy member_read on finance.people for select to authenticated using (private.is_member(financial_space_id));
revoke all on finance.people from public,anon,authenticated;
grant select on finance.people to authenticated;
create view finance.person_balances with (security_invoker = true) as
select p.id,p.financial_space_id,p.nickname,p.notes,p.archived_at,b.balance_cents
from finance.people p join finance.account_balances b on b.id = p.ledger_account_id where p.deleted_at is null;
grant select on finance.person_balances to authenticated;

-- The same largest-remainder rule as src/shared/finance/money.ts (section 8.8).
create function private.divide_cents(p_total bigint,p_weights bigint[],p_order integer[] default null) returns bigint[]
language plpgsql immutable set search_path = '' as $$
declare weight_total numeric; parts bigint[]; residues numeric[]; remainder integer; indices integer[]; idx integer; sign integer := case when p_total < 0 then -1 else 1 end; begin
  if p_total is null or abs(p_total::numeric) > 9007199254740991 or coalesce(array_length(p_weights,1),0) = 0 or array_ndims(p_weights) <> 1 or array_lower(p_weights,1) <> 1 or array_position(p_weights,null) is not null then
    raise exception 'Invalid integer cents or weights' using errcode = '23514';
  end if;
  select sum(w) into weight_total from unnest(p_weights) w;
  if weight_total <= 0 then raise exception 'Weight sum must be positive' using errcode = '23514'; end if;
  if p_order is null then select array_agg(i order by i) into p_order from generate_subscripts(p_weights,1) i; end if;
  if array_ndims(p_order) <> 1 or array_lower(p_order,1) <> 1 or array_length(p_order,1) <> array_length(p_weights,1) or array_position(p_order,null) is not null or
    (select count(distinct i) from unnest(p_order) i) <> array_length(p_weights,1) or exists(select 1 from unnest(p_order) i where i < 1 or i > array_length(p_weights,1)) then
    raise exception 'Invalid tie order' using errcode = '23514';
  end if;
  for idx in 1..array_length(p_weights,1) loop
    parts[idx] := floor(abs(p_total::numeric) * p_weights[idx] / weight_total)::bigint;
    residues[idx] := abs(p_total::numeric) * p_weights[idx] - parts[idx]::numeric * weight_total;
  end loop;
  select (abs(p_total::numeric) - sum(part))::integer into remainder from unnest(parts) part;
  select array_agg(i order by residues[i] desc,array_position(p_order,i)) into indices from generate_subscripts(p_weights,1) i where p_weights[i] <> 0;
  if remainder > 0 then for idx in 1..remainder loop parts[indices[idx]] := parts[indices[idx]] + 1; end loop; end if;
  for idx in 1..array_length(parts,1) loop
    parts[idx] := parts[idx] * sign;
    if abs(parts[idx]::numeric) > 9007199254740991 then raise exception 'Unsafe result cents' using errcode = '23514'; end if;
  end loop;
  return parts;
end;
$$;
revoke all on function private.divide_cents(bigint,bigint[],integer[]) from public,anon,authenticated;

create function api.create_person(p_space uuid,p_nickname text,p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare person_id uuid; ledger_id uuid; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  insert into finance.ledger_accounts(financial_space_id,account_class,liquidity,owner_type,name,created_by)
    values(p_space,'asset','person','person',p_nickname,auth.uid()) returning id into ledger_id;
  insert into finance.people(financial_space_id,ledger_account_id,nickname,notes,created_by)
    values(p_space,ledger_id,p_nickname,p_notes,auth.uid()) returning id into person_id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data)
    values(p_space,auth.uid(),'created','person',person_id,jsonb_build_object('nickname',p_nickname,'notes',p_notes));
  return person_id;
end;
$$;

create function api.transfer_between_accounts(p_space uuid,p_from uuid,p_to uuid,p_amount_cents bigint,p_occurred_on date,p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare source finance.financial_accounts; destination finance.financial_accounts; source_liquidity text; destination_liquidity text; operation text; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_from = p_to or p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 9007199254740991 then raise exception 'Invalid transfer' using errcode = '23514'; end if;
  select * into source from finance.financial_accounts where financial_space_id = p_space and id = p_from and archived_at is null and deleted_at is null;
  if not found then raise exception 'Source account not found or archived' using errcode = '23514'; end if;
  select * into destination from finance.financial_accounts where financial_space_id = p_space and id = p_to and archived_at is null and deleted_at is null;
  if not found then raise exception 'Destination account not found or archived' using errcode = '23514'; end if;
  select liquidity into source_liquidity from finance.ledger_accounts where id = source.ledger_account_id;
  select liquidity into destination_liquidity from finance.ledger_accounts where id = destination.ledger_account_id;
  if source_liquidity not in ('cash','investment') or destination_liquidity not in ('cash','investment') then raise exception 'Transfer requires cash or investment accounts' using errcode = '23514'; end if;
  operation := case when source_liquidity = 'cash' and destination_liquidity = 'investment' then 'investment_contribution'
    when source_liquidity = 'investment' and destination_liquidity = 'cash' then 'investment_redemption' else 'transfer' end;
  return api.post_transaction(p_space,jsonb_build_object('kind',operation,'occurred_on',p_occurred_on,'competence_month',date_trunc('month',p_occurred_on)::date,
    'description','Transferência: ' || source.name || ' para ' || destination.name,'client_uuid',p_client_uuid,
    'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',source.ledger_account_id,'amount_cents',-p_amount_cents),jsonb_build_object('ledger_account_id',destination.ledger_account_id,'amount_cents',p_amount_cents))));
end;
$$;

create function api.settle_person(p_space uuid,p_person uuid,p_account uuid,p_direction text,p_amount_cents bigint,p_occurred_on date,p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare person finance.people; account finance.financial_accounts; cash_sign integer; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_direction is null or p_direction not in ('receive','pay','lend','borrow') or p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 9007199254740991 then raise exception 'Invalid person settlement' using errcode = '23514'; end if;
  select * into person from finance.people where financial_space_id = p_space and id = p_person and archived_at is null and deleted_at is null;
  if not found then raise exception 'Person not found or archived' using errcode = '23514'; end if;
  select f.* into account from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id
    where f.financial_space_id = p_space and f.id = p_account and f.archived_at is null and f.deleted_at is null and a.liquidity = 'cash';
  if not found then raise exception 'Cash account not found or archived' using errcode = '23514'; end if;
  cash_sign := case when p_direction in ('receive','borrow') then 1 else -1 end;
  return api.post_transaction(p_space,jsonb_build_object('kind','person_settlement','occurred_on',p_occurred_on,'competence_month',date_trunc('month',p_occurred_on)::date,
    'description','Acerto com ' || person.nickname,'client_uuid',p_client_uuid,
    'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',account.ledger_account_id,'amount_cents',cash_sign * p_amount_cents),jsonb_build_object('ledger_account_id',person.ledger_account_id,'amount_cents',-cash_sign * p_amount_cents))));
end;
$$;

create function api.record_shared_expense(p_space uuid,p_account uuid,p_category uuid,p_people uuid[],p_total_cents bigint,p_occurred_on date,p_description text,p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare account finance.financial_accounts; category finance.categories; person finance.people; parts bigint[]; entries jsonb; idx integer; participant_count integer; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if coalesce(array_length(p_people,1),0) = 0 or array_ndims(p_people) <> 1 or array_lower(p_people,1) <> 1 or array_position(p_people,null) is not null or (select count(distinct x) from unnest(p_people) x) <> array_length(p_people,1) then raise exception 'Select distinct people to share with' using errcode = '23514'; end if;
  participant_count := array_length(p_people,1) + 1;
  if participant_count > 100 or p_total_cents is null or p_total_cents < participant_count or p_total_cents > 9007199254740991 then raise exception 'Invalid shared expense amount' using errcode = '23514'; end if;
  select f.* into account from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.financial_space_id = p_space and f.id = p_account and f.archived_at is null and f.deleted_at is null and a.liquidity = 'cash';
  if not found then raise exception 'Cash account not found or archived' using errcode = '23514'; end if;
  select * into category from finance.categories where financial_space_id = p_space and id = p_category and kind = 'expense' and ledger_account_id is not null and archived_at is null and deleted_at is null;
  if not found then raise exception 'Expense category not found or archived' using errcode = '23514'; end if;
  parts := private.divide_cents(p_total_cents,array_fill(1::bigint,array[participant_count]));
  entries := jsonb_build_array(jsonb_build_object('ledger_account_id',account.ledger_account_id,'amount_cents',-p_total_cents),jsonb_build_object('ledger_account_id',category.ledger_account_id,'amount_cents',parts[1]));
  for idx in 1..array_length(p_people,1) loop
    select * into person from finance.people where financial_space_id = p_space and id = p_people[idx] and archived_at is null and deleted_at is null;
    if not found then raise exception 'Person not found or archived' using errcode = '23514'; end if;
    entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',person.ledger_account_id,'amount_cents',parts[idx + 1]));
  end loop;
  return api.post_transaction(p_space,jsonb_build_object('kind','expense','occurred_on',p_occurred_on,'competence_month',date_trunc('month',p_occurred_on)::date,'description',p_description,'client_uuid',p_client_uuid,'entries',entries));
end;
$$;
revoke all on function api.create_person(uuid,text,text),api.transfer_between_accounts(uuid,uuid,uuid,bigint,date,uuid),api.settle_person(uuid,uuid,uuid,text,bigint,date,uuid),api.record_shared_expense(uuid,uuid,uuid,uuid[],bigint,date,text,uuid) from public,anon,authenticated;
grant execute on function api.create_person(uuid,text,text),api.transfer_between_accounts(uuid,uuid,uuid,bigint,date,uuid),api.settle_person(uuid,uuid,uuid,text,bigint,date,uuid),api.record_shared_expense(uuid,uuid,uuid,uuid[],bigint,date,text,uuid) to authenticated;
commit;
