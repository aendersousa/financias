begin;

-- Retaining a historical reserve link while replacing an open-period entry is
-- different from attaching a new consumption to an already terminal reserve.
-- This context is populated exclusively by the writer RPC, never by a client GUC.
create table private.ledger_edit_reserves (
  backend_pid integer not null,
  transaction_number bigint not null,
  ledger_transaction_id uuid not null,
  line_number smallint not null,
  ledger_account_id uuid not null,
  reserve_id uuid not null,
  primary key(backend_pid,transaction_number,ledger_transaction_id,line_number,ledger_account_id,reserve_id)
);
revoke all on private.ledger_edit_reserves from public,anon,authenticated;

do $$ declare definition text; needle text; begin
  definition:=pg_get_functiondef('private.validate_commitment_entry()'::regprocedure);
  needle:='and new.amount_cents>0 and not exists(select 1 from finance.reserves where id=new.reserve_id';
  if position(needle in definition)=0 then raise exception 'Expected terminal reserve insertion guard not found'; end if;
  definition:=replace(definition,needle,
    'and new.amount_cents>0 and not exists(select 1 from private.ledger_edit_reserves ctx where ctx.backend_pid=pg_backend_pid() and ctx.transaction_number=txid_current() and ctx.ledger_transaction_id=new.ledger_transaction_id and ctx.line_number=new.line_number and ctx.ledger_account_id=new.ledger_account_id and ctx.reserve_id=new.reserve_id) and not exists(select 1 from finance.reserves where id=new.reserve_id');
  execute definition;
  definition:=pg_get_functiondef('api.edit_transaction(uuid,uuid,integer,jsonb,text)'::regprocedure);
  needle:='delete from finance.ledger_entries where ledger_transaction_id = tx.id;';
  if position(needle in definition)=0 then raise exception 'Expected ledger replacement operation not found'; end if;
  definition:=replace(definition,needle,
    'insert into private.ledger_edit_reserves(backend_pid,transaction_number,ledger_transaction_id,line_number,ledger_account_id,reserve_id)
       select distinct pg_backend_pid(),txid_current(),tx.id,e.line_number,e.ledger_account_id,e.reserve_id from finance.ledger_entries e where e.ledger_transaction_id=tx.id and e.reserve_id is not null and e.amount_cents>0;
     delete from finance.ledger_entries where ledger_transaction_id = tx.id;');
  definition:=replace(definition,'return tx.id;',
    'delete from private.ledger_edit_reserves where backend_pid=pg_backend_pid() and transaction_number=txid_current() and ledger_transaction_id=tx.id;
     return tx.id;');
  execute definition;
end $$;

create function private.require_open_reserve_period(p_space uuid,p_on date) returns void
language plpgsql stable set search_path='' as $$
begin
  if p_on is not null and exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',p_on)::date and reopened_at is null) then
    raise exception 'Reserve contribution period is closed; reopen % before changing reserve contributions or provision settlement',to_char(p_on,'YYYY-MM') using errcode='23514';
  end if;
end;
$$;

-- Apply the same period rule to public operations and internal automatic
-- releases. Updating a date must validate both the old and new financial month.
create function private.reserve_contribution_open_period() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.financial_space_id,new.reserve_id,new.kind,new.origin,new.amount_cents,new.occurred_on,new.cancelled_at)
    is not distinct from (old.financial_space_id,old.reserve_id,old.kind,old.origin,old.amount_cents,old.occurred_on,old.cancelled_at) then return new; end if;
  if tg_op<>'INSERT' then perform private.require_open_reserve_period(old.financial_space_id,old.occurred_on); end if;
  if tg_op<>'DELETE' then perform private.require_open_reserve_period(new.financial_space_id,new.occurred_on); end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger reserve_contribution_period_guard before insert or update or delete on finance.reserve_contributions
  for each row execute function private.reserve_contribution_open_period();

-- A zero-balance terminal transition still changes reserve coverage. It cannot
-- bypass the closed-month rule merely because no release entry is necessary.
create function private.reserve_terminal_open_period() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.status,new.terminal_on,new.terminal_at) is not distinct from (old.status,old.terminal_on,old.terminal_at) then return new; end if;
  if tg_op='UPDATE' then perform private.require_open_reserve_period(old.financial_space_id,old.terminal_on); end if;
  perform private.require_open_reserve_period(new.financial_space_id,new.terminal_on);
  return new;
end;
$$;
create trigger reserve_terminal_period_guard before insert or update on finance.reserves
  for each row execute function private.reserve_terminal_open_period();

revoke all on function private.require_open_reserve_period(uuid,date),private.reserve_contribution_open_period(),private.reserve_terminal_open_period() from public,anon,authenticated;
commit;
