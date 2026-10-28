begin;

-- 1. Redefine api.settle_person with smart explicit default descriptions and optional custom description
drop function if exists api.settle_person(uuid,uuid,uuid,text,bigint,date,uuid);

create or replace function api.settle_person(
  p_space uuid,
  p_person uuid,
  p_account uuid,
  p_direction text,
  p_amount_cents bigint,
  p_occurred_on date,
  p_client_uuid uuid default null,
  p_description text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  person finance.people;
  account finance.financial_accounts;
  cash_sign integer;
  v_description text;
begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));

  if p_direction is null or p_direction not in ('receive','pay','lend','borrow') or p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 9007199254740991 then
    raise exception 'Invalid person settlement' using errcode = '23514';
  end if;

  select * into person from finance.people where financial_space_id = p_space and id = p_person and archived_at is null and deleted_at is null;
  if not found then raise exception 'Person not found or archived' using errcode = '23514'; end if;

  select f.* into account from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id
    where f.financial_space_id = p_space and f.id = p_account and f.archived_at is null and f.deleted_at is null and a.liquidity = 'cash';
  if not found then raise exception 'Cash account not found or archived' using errcode = '23514'; end if;

  cash_sign := case when p_direction in ('receive','borrow') then 1 else -1 end;

  v_description := coalesce(
    nullif(trim(p_description), ''),
    case
      when p_direction = 'lend' then 'Empréstimo para ' || person.nickname
      when p_direction = 'borrow' then 'Empréstimo de ' || person.nickname
      when p_direction = 'receive' then 'Recebimento de ' || person.nickname
      when p_direction = 'pay' then 'Pagamento para ' || person.nickname
      else 'Acerto com ' || person.nickname
    end
  );

  return api.post_transaction(
    p_space,
    jsonb_build_object(
      'kind', 'person_settlement',
      'occurred_on', p_occurred_on,
      'competence_month', date_trunc('month', p_occurred_on)::date,
      'description', v_description,
      'client_uuid', p_client_uuid,
      'entries', jsonb_build_array(
        jsonb_build_object('ledger_account_id', account.ledger_account_id, 'amount_cents', cash_sign * p_amount_cents),
        jsonb_build_object('ledger_account_id', person.ledger_account_id, 'amount_cents', -cash_sign * p_amount_cents)
      )
    )
  );
end;
$$;

revoke all on function api.settle_person(uuid,uuid,uuid,text,bigint,date,uuid,text) from public,anon,authenticated;
grant execute on function api.settle_person(uuid,uuid,uuid,text,bigint,date,uuid,text) to authenticated;

-- 2. Update api.person_detail to include transaction version and notes in movements
create or replace function api.person_detail(p_space uuid, p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  person finance.people;
  movements jsonb;
  reminders jsonb;
begin
  if not private.is_member(p_space) then raise exception 'Space permission required' using errcode = '42501'; end if;
  select * into person from finance.people where financial_space_id = p_space and id = p_person and deleted_at is null;
  if not found then raise exception 'Person not found' using errcode = 'P0002'; end if;

  with grouped as (
    select
      t.id,
      t.version,
      t.notes,
      t.occurred_on,
      t.created_at,
      t.description,
      t.kind,
      t.status,
      sum(e.amount_cents)::bigint as person_amount_cents
    from finance.ledger_entries e
    join finance.ledger_transactions t on t.id = e.ledger_transaction_id
    where e.ledger_account_id = person.ledger_account_id
    group by t.id, t.version, t.notes, t.occurred_on, t.created_at, t.description, t.kind, t.status
  ),
  history as (
    select g.*,
      sum(case when status = 'posted' then person_amount_cents else 0 end) over (order by occurred_on, created_at, id rows unbounded preceding) as running_balance_cents
    from grouped g
  ),
  recent as (
    select * from history order by occurred_on desc, created_at desc, id desc limit 200
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by occurred_on desc, created_at desc, id desc), '[]') into movements from recent r;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.effective_due_on, c.id), '[]') into reminders
    from finance.commitments c where c.financial_space_id = p_space and c.person_id = person.id and c.deleted_at is null and c.cancelled_at is null;

  return jsonb_build_object(
    'person', to_jsonb(person),
    'balance_cents', private.account_balance_on(p_space, person.ledger_account_id, private.space_today(p_space)),
    'movements', movements,
    'reminders', reminders
  );
end;
$$;

revoke all on function api.person_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function api.person_detail(uuid,uuid) to authenticated;

-- 3. Retrospectively update existing loan movements that were recorded as 'Acerto com [Nome]'
update finance.ledger_transactions t
set description = 'Empréstimo para ' || p.nickname,
    updated_at = now()
from finance.ledger_entries e
join finance.people p on p.ledger_account_id = e.ledger_account_id
where t.id = e.ledger_transaction_id
  and t.kind = 'person_settlement'
  and t.description = 'Acerto com ' || p.nickname
  and e.amount_cents > 0
  and (
    p.notes like '%[Empréstimo%'
    or exists (
      select 1 from finance.commitments c
      where c.person_id = p.id and c.title like '%Parcela%'
    )
  );

commit;

