begin;
create function private.require_admin(p_space uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from finance.financial_space_members where financial_space_id = p_space and user_id = auth.uid() and status = 'active' and role in('owner','admin')) then raise exception 'Administrator permission required' using errcode = '42501'; end if;
end;
$$;
create table finance.asset_valuations (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,financial_account_id uuid not null,valued_on date not null,
  value_cents bigint not null check(value_cents between 0 and 9007199254740991),ledger_transaction_id uuid,version integer not null default 1,created_at timestamptz not null default now(),created_by uuid references auth.users(id),
  unique(financial_space_id,id),unique(financial_account_id,valued_on),foreign key(financial_space_id,financial_account_id) references finance.financial_accounts(financial_space_id,id),foreign key(financial_space_id,ledger_transaction_id) references finance.ledger_transactions(financial_space_id,id)
);
create table finance.month_snapshots (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,month date not null check(extract(day from month) = 1),
  version integer not null check(version > 0),controls jsonb not null,supersedes_id uuid,reason text not null,created_at timestamptz not null default now(),created_by uuid references auth.users(id),
  unique(financial_space_id,id),unique(financial_space_id,month,version),foreign key(financial_space_id,supersedes_id) references finance.month_snapshots(financial_space_id,id)
);
alter table finance.period_closings add column warnings jsonb not null default '[]',add column snapshot_id uuid,
  add constraint closing_snapshot foreign key(financial_space_id,snapshot_id) references finance.month_snapshots(financial_space_id,id);
alter table finance.asset_valuations enable row level security;
alter table finance.month_snapshots enable row level security;
create policy member_read on finance.asset_valuations for select to authenticated using(private.is_member(financial_space_id));
create policy member_read on finance.month_snapshots for select to authenticated using(private.is_member(financial_space_id));
revoke all on finance.asset_valuations,finance.month_snapshots from public,anon,authenticated;
grant select on finance.asset_valuations,finance.month_snapshots to authenticated;
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.budget_month_summary(uuid,date)'::regprocedure);
  definition := replace(definition,'api.budget_month_summary','private.budget_month_summary_live');
  definition := replace(definition,'if not private.is_member(p_space) then raise exception ''Space access denied'' using errcode = ''42501''; end if;','');
  execute definition;
end $$;
create function private.month_controls(p_space uuid,p_month date) returns jsonb language sql stable set search_path = '' as $$
with balances as (
  select a.id,a.account_class,a.liquidity,a.system_role,coalesce(sum(e.amount_cents),0)::bigint as balance
  from finance.ledger_accounts a left join finance.posted_ledger_entries e on e.ledger_account_id = a.id and e.occurred_on < p_month + interval '1 month'
  where a.financial_space_id = p_space group by a.id
), consumption as (
  select e.ledger_account_id,a.account_class,e.original_competence_month,sum(e.amount_cents)::bigint as amount
  from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id where e.financial_space_id = p_space and e.effective_competence_month = p_month and a.account_class in('expense','income')
  group by e.ledger_account_id,a.account_class,e.original_competence_month
)
select jsonb_build_object('month',p_month,
  'balances',coalesce((select jsonb_agg(jsonb_build_object('account_id',id,'balance_cents',balance) order by id) from balances),'[]'),
  'net_worth_cents',coalesce((select sum(balance) from balances where account_class in('asset','liability')),0),
  'consumption',coalesce((select jsonb_agg(jsonb_build_object('account_id',ledger_account_id,'class',account_class,'original_competence_month',original_competence_month,'amount_cents',amount) order by ledger_account_id,original_competence_month) from consumption),'[]'),
  'budgets',private.budget_month_summary_live(p_space,p_month)
);
$$;
create function private.save_month_snapshot(p_space uuid,p_month date,p_reason text) returns uuid language plpgsql set search_path = '' as $$
declare previous finance.month_snapshots; controls jsonb; result uuid; begin
  select * into previous from finance.month_snapshots where financial_space_id = p_space and month = p_month order by version desc limit 1;
  controls := private.month_controls(p_space,p_month);
  if previous.id is not null and previous.controls = controls then return previous.id; end if;
  insert into finance.month_snapshots(financial_space_id,month,version,controls,supersedes_id,reason,created_by)
    values(p_space,p_month,coalesce(previous.version,0)+1,controls,previous.id,p_reason,auth.uid()) returning id into result;
  return result;
end;
$$;
create function api.preview_month_closing(p_space uuid,p_month date) returns jsonb language plpgsql security definer set search_path = '' as $$
declare warnings jsonb; begin
  perform private.require_admin(p_space);
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Month must begin on day one' using errcode = '23514'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('type','open_commitment','id',c.id,'title',c.title)),'[]') into warnings from finance.commitment_settlements c where c.financial_space_id = p_space and c.competence_month = p_month and c.settlement_status in('pending','partial') and c.kind <> 'reminder';
  warnings := warnings || (select coalesce(jsonb_agg(jsonb_build_object('type','missing_valuation','id',f.id,'title',f.name)),'[]') from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id
    where f.financial_space_id = p_space and f.archived_at is null and a.liquidity in('investment','property') and not exists(select 1 from finance.asset_valuations v where v.financial_account_id = f.id and v.valued_on = (p_month+interval '1 month'-interval '1 day')::date));
  return jsonb_build_object('month',p_month,'warnings',warnings,'controls',private.month_controls(p_space,p_month));
end;
$$;
create function api.close_month(p_space uuid,p_month date,p_acknowledge_warnings boolean default false,p_client_warnings jsonb default '[]') returns uuid language plpgsql security definer set search_path = '' as $$
declare first_month date; previous_month date; warnings jsonb; photo uuid; closing uuid; later record; begin
  perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_month is null or extract(day from p_month) <> 1 or p_month >= date_trunc('month',private.space_today(p_space))::date then raise exception 'Only a finished month can be closed' using errcode = '23514'; end if;
  select id into closing from finance.period_closings where financial_space_id = p_space and month = p_month and reopened_at is null;
  if closing is not null then return closing; end if;
  select date_trunc('month',min(occurred_on))::date into first_month from finance.ledger_transactions where financial_space_id = p_space;
  previous_month := (p_month-interval '1 month')::date;
  if previous_month >= first_month and not exists(select 1 from finance.period_closings where financial_space_id = p_space and month = previous_month and reopened_at is null) then raise exception 'Close the preceding month first' using errcode = '23514'; end if;
  if jsonb_typeof(p_client_warnings) is distinct from 'array' then raise exception 'Client warnings must be an array' using errcode = '23514'; end if;
  warnings := (api.preview_month_closing(p_space,p_month)->'warnings') || p_client_warnings;
  if jsonb_array_length(warnings) > 0 and not coalesce(p_acknowledge_warnings,false) then raise exception 'Review closing warnings before confirming' using errcode = '23514'; end if;
  photo := private.save_month_snapshot(p_space,p_month,'Fechamento mensal');
  insert into finance.period_closings(financial_space_id,month,closed_by,created_by,warnings,snapshot_id) values(p_space,p_month,auth.uid(),auth.uid(),warnings,photo) returning id into closing;
  for later in select id,month from finance.period_closings where financial_space_id = p_space and month > p_month and reopened_at is null order by month loop
    photo := private.save_month_snapshot(p_space,later.month,'Recalculada pelo novo fechamento de ' || to_char(p_month,'MM/YYYY'));
    update finance.period_closings set snapshot_id = photo,updated_at = now() where id = later.id;
  end loop;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'month_closed','period_closing',closing,jsonb_build_object('month',p_month,'warnings',warnings));
  return closing;
end;
$$;
create function api.reopen_month(p_space uuid,p_month date,p_reason text) returns uuid language plpgsql security definer set search_path = '' as $$
declare closing finance.period_closings; begin
  perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if char_length(trim(coalesce(p_reason,''))) < 10 then raise exception 'Reopening reason must contain at least ten characters' using errcode = '23514'; end if;
  select * into closing from finance.period_closings where financial_space_id = p_space and month = p_month and reopened_at is null for update;
  if not found then raise exception 'Month is not closed' using errcode = 'P0002'; end if;
  update finance.period_closings set reopened_at = now(),reopened_by = auth.uid(),reopen_reason = p_reason,updated_at = now() where id = closing.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'month_reopened','period_closing',closing.id,to_jsonb(closing),jsonb_build_object('reason',p_reason));
  return closing.id;
end;
$$;
create function api.month_report(p_space uuid,p_month date) returns jsonb language plpgsql security definer set search_path = '' as $$
declare photo finance.month_snapshots; closing finance.period_closings; stale boolean; begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode = '42501'; end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Month must begin on day one' using errcode = '23514'; end if;
  select * into closing from finance.period_closings where financial_space_id = p_space and month = p_month and reopened_at is null;
  if closing.id is not null and closing.snapshot_id is not null then select * into photo from finance.month_snapshots where id = closing.snapshot_id; end if;
  select exists(select 1 from finance.period_closings old where old.financial_space_id = p_space and old.month < p_month and old.reopened_at is not null and not exists(select 1 from finance.period_closings current where current.financial_space_id = p_space and current.month = old.month and current.reopened_at is null)) into stale;
  return jsonb_build_object('month',p_month,'closed',closing.id is not null,'version',photo.version,'balances_require_recalculation',stale,'controls',case when photo.id is null then private.month_controls(p_space,p_month) else photo.controls end);
end;
$$;
create or replace function api.budget_month_summary(p_space uuid,p_month date) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode = '42501'; end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Month must begin on day one' using errcode = '23514'; end if;
  select s.controls->'budgets' into result from finance.period_closings c join finance.month_snapshots s on s.id = c.snapshot_id where c.financial_space_id = p_space and c.month = p_month and c.reopened_at is null;
  return coalesce(result,private.budget_month_summary_live(p_space,p_month));
end;
$$;
revoke all on function private.require_admin(uuid),private.budget_month_summary_live(uuid,date),private.month_controls(uuid,date),private.save_month_snapshot(uuid,date,text) from public,anon,authenticated;
revoke all on function api.preview_month_closing(uuid,date),api.close_month(uuid,date,boolean,jsonb),api.reopen_month(uuid,date,text),api.month_report(uuid,date) from public,anon,authenticated;
grant execute on function api.preview_month_closing(uuid,date),api.close_month(uuid,date,boolean,jsonb),api.reopen_month(uuid,date,text),api.month_report(uuid,date) to authenticated;
do $$ declare definition text; begin
  definition := pg_get_functiondef('private.validate_budget()'::regprocedure);
  definition := replace(definition,'perform pg_advisory_xact_lock(hashtextextended(new.financial_space_id::text,0));',
    'perform pg_advisory_xact_lock(hashtextextended(new.financial_space_id::text,0));
     if tg_op = ''INSERT'' or (new.budget_type,new.category_id,new.amount_cents,new.effective_from_month,new.effective_until_month,new.is_essential_override) is distinct from (old.budget_type,old.category_id,old.amount_cents,old.effective_from_month,old.effective_until_month,old.is_essential_override) then
       if exists(select 1 from finance.period_closings c where c.financial_space_id = new.financial_space_id and c.reopened_at is null and c.month >= new.effective_from_month and (new.effective_until_month is null or c.month <= new.effective_until_month)) then
         raise exception ''Budget includes a closed month'' using errcode = ''23514'';
       end if;
     end if;');
  execute definition;
end $$;
commit;
