begin;
create table finance.entry_models (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(char_length(trim(name)) between 1 and 100),payload jsonb not null check(jsonb_typeof(payload)='object'),version integer not null default 1,
  client_uuid uuid,original_request jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,financial_space_id,client_uuid)
);
create table finance.transaction_drafts (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(char_length(trim(title)) between 1 and 100),payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=20000),version integer not null default 1,
  client_uuid uuid,original_request jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,financial_space_id,client_uuid)
);
alter table finance.entry_models enable row level security;
alter table finance.transaction_drafts enable row level security;
create policy own_member_read on finance.entry_models for select to authenticated using(user_id=auth.uid() and private.is_member(financial_space_id));
create policy own_member_read on finance.transaction_drafts for select to authenticated using(user_id=auth.uid() and private.is_member(financial_space_id));
revoke all on finance.entry_models,finance.transaction_drafts from public,anon,authenticated;
grant select on finance.entry_models,finance.transaction_drafts to authenticated;
create function api.entry_preferences(p_space uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
  return jsonb_build_object('models',coalesce((select jsonb_agg(to_jsonb(m) order by m.name,m.id) from finance.entry_models m where financial_space_id=p_space and user_id=auth.uid()),'[]'),'drafts',coalesce((select jsonb_agg(to_jsonb(d) order by d.updated_at desc,d.id) from finance.transaction_drafts d where financial_space_id=p_space and user_id=auth.uid()),'[]'));
end;
$$;
create function api.save_entry_model(p_space uuid,p_name text,p_payload jsonb,p_model uuid default null,p_version integer default null,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.entry_models; request jsonb; result uuid; category finance.categories; account finance.financial_accounts;
begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_space::text,0));
  request:=jsonb_build_object('name',trim(p_name),'payload',p_payload,'model',p_model,'version',p_version);
  if p_model is null and p_client_uuid is not null then
    select * into previous from finance.entry_models where financial_space_id=p_space and user_id=auth.uid() and client_uuid=p_client_uuid;
    if found then if previous.original_request is distinct from request then raise exception 'Client UUID reused with different model' using errcode='23505'; end if; return previous.id; end if;
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 100 or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>20000 or p_payload->>'kind' is null or p_payload->>'kind' not in('expense','income','card_purchase') or exists(select 1 from jsonb_object_keys(p_payload) key where key not in('kind','description','categoryId','accountId','cardId','amountCents')) then raise exception 'Invalid entry model fields' using errcode='23514'; end if;
  if p_payload ? 'amountCents' and (p_payload->>'amountCents' is not null and (p_payload->>'amountCents')::numeric not between 1 and 9007199254740991 or (p_payload->>'amountCents')::numeric<>trunc((p_payload->>'amountCents')::numeric)) then raise exception 'Model amount must use positive integer cents' using errcode='23514'; end if;
  if p_payload->>'categoryId' is not null and not exists(select 1 from finance.categories where financial_space_id=p_space and id=(p_payload->>'categoryId')::uuid and ledger_account_id is not null and kind=case when p_payload->>'kind'='income' then 'income' else 'expense' end and archived_at is null and deleted_at is null) then raise exception 'Active final category required' using errcode='23514'; end if;
  if p_payload->>'kind'='card_purchase' then
    if p_payload->>'accountId' is not null or p_payload->>'cardId' is not null and not exists(select 1 from finance.credit_cards where financial_space_id=p_space and id=(p_payload->>'cardId')::uuid and status='active') then raise exception 'Active card required' using errcode='23514'; end if;
  else
    if p_payload->>'cardId' is not null or p_payload->>'accountId' is not null and not exists(select 1 from finance.financial_accounts a join finance.ledger_accounts l on l.id=a.ledger_account_id where a.financial_space_id=p_space and a.id=(p_payload->>'accountId')::uuid and a.archived_at is null and a.deleted_at is null and l.liquidity in('cash','benefit')) then raise exception 'Active cash or benefit account required' using errcode='23514'; end if;
  end if;
  if p_model is null then
    if (select count(*) from finance.entry_models where financial_space_id=p_space and user_id=auth.uid())>=200 then raise exception 'Entry model limit reached' using errcode='23514'; end if;
    insert into finance.entry_models(financial_space_id,user_id,name,payload,client_uuid,original_request) values(p_space,auth.uid(),trim(p_name),p_payload,p_client_uuid,request) returning id into result;
  else
    select * into previous from finance.entry_models where id=p_model and financial_space_id=p_space and user_id=auth.uid() for update;
    if not found then raise exception 'Personal entry model not found' using errcode='P0002'; end if;
    if previous.version is distinct from p_version then raise exception 'Entry model changed; reload before editing' using errcode='40001'; end if;
    update finance.entry_models set name=trim(p_name),payload=p_payload,version=version+1,updated_at=now() where id=p_model returning id into result;
  end if;
  return result;
end;
$$;
create function api.save_transaction_draft(p_space uuid,p_title text,p_payload jsonb,p_draft uuid default null,p_version integer default null,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.transaction_drafts; request jsonb; result uuid;
begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_space::text,0));
  request:=jsonb_build_object('title',trim(p_title),'payload',p_payload,'draft',p_draft,'version',p_version);
  if p_draft is null and p_client_uuid is not null then
    select * into previous from finance.transaction_drafts where financial_space_id=p_space and user_id=auth.uid() and client_uuid=p_client_uuid;
    if found then if previous.original_request is distinct from request then raise exception 'Client UUID reused with different draft' using errcode='23505'; end if; return previous.id; end if;
  end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 100 or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>20000 then raise exception 'Invalid transaction draft' using errcode='23514'; end if;
  if p_draft is null then
    if (select count(*) from finance.transaction_drafts where financial_space_id=p_space and user_id=auth.uid())>=1000 then raise exception 'Draft limit reached' using errcode='23514'; end if;
    insert into finance.transaction_drafts(financial_space_id,user_id,title,payload,client_uuid,original_request) values(p_space,auth.uid(),trim(p_title),p_payload,p_client_uuid,request) returning id into result;
  else
    select * into previous from finance.transaction_drafts where financial_space_id=p_space and user_id=auth.uid() and id=p_draft for update;
    if not found then raise exception 'Personal draft not found' using errcode='P0002'; end if;
    if previous.version is distinct from p_version then raise exception 'Draft changed; reload before editing' using errcode='40001'; end if;
    update finance.transaction_drafts set title=trim(p_title),payload=p_payload,version=version+1,updated_at=now() where id=p_draft returning id into result;
  end if;
  return result;
end;
$$;
create function api.delete_entry_preference(p_space uuid,p_id uuid,p_version integer,p_kind text) returns uuid language plpgsql security definer set search_path='' as $$
declare version integer;
begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_space::text,0));
  if p_kind='model' then select m.version into version from finance.entry_models m where financial_space_id=p_space and id=p_id and user_id=auth.uid() for update;
  elsif p_kind='draft' then select d.version into version from finance.transaction_drafts d where financial_space_id=p_space and id=p_id and user_id=auth.uid() for update;
  else raise exception 'Invalid preference kind' using errcode='23514'; end if;
  if version is null then raise exception 'Personal preference not found' using errcode='P0002'; end if;
  if version is distinct from p_version then raise exception 'Preference changed; reload before deleting' using errcode='40001'; end if;
  if p_kind='model' then delete from finance.entry_models where id=p_id; else delete from finance.transaction_drafts where id=p_id; end if;
  return p_id;
end;
$$;
create function api.suggest_entry_category(p_space uuid,p_description text,p_kind text default 'expense') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare normalized_description text:=lower(regexp_replace(trim(p_description),'\s+',' ','g'));
begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
  if p_kind is null or p_kind not in('expense','income','card_purchase') then raise exception 'Invalid entry kind' using errcode='23514'; end if;
  if normalized_description is null or char_length(normalized_description)<3 then return '[]'; end if;
  return coalesce((select jsonb_agg(result) from(select jsonb_build_object('categoryId',c.id,'name',c.name,'matches',count(distinct t.id)) as result
    from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id=t.id join finance.categories c on c.ledger_account_id=e.ledger_account_id
    where t.financial_space_id=p_space and t.status='posted' and t.kind in(case when p_kind='income' then 'income' else 'expense' end,case when p_kind='income' then 'income' else 'card_purchase' end) and c.kind=case when p_kind='income' then 'income' else 'expense' end and c.archived_at is null and c.deleted_at is null and e.amount_cents<>0
      and position(normalized_description in lower(regexp_replace(trim(t.description),'\s+',' ','g')))>0 group by c.id order by count(distinct t.id) desc,max(t.occurred_on) desc,c.id limit 3) ranked),'[]');
end;
$$;
revoke all on function api.entry_preferences(uuid),api.save_entry_model(uuid,text,jsonb,uuid,integer,uuid),api.save_transaction_draft(uuid,text,jsonb,uuid,integer,uuid),api.delete_entry_preference(uuid,uuid,integer,text),api.suggest_entry_category(uuid,text,text) from public,anon,authenticated;
grant execute on function api.entry_preferences(uuid),api.save_entry_model(uuid,text,jsonb,uuid,integer,uuid),api.save_transaction_draft(uuid,text,jsonb,uuid,integer,uuid),api.delete_entry_preference(uuid,uuid,integer,text),api.suggest_entry_category(uuid,text,text) to authenticated;
commit;
