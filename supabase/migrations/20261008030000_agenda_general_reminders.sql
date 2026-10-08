begin;

-- Allow reminders without requiring an associated contact person (general personal appointments, tasks, meetings, etc.)
do $$
declare
  c_name text;
begin
  select conname into c_name
    from pg_constraint
    where conrelid = 'finance.commitments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind = ''reminder''%person_id%';
  if c_name is not null then
    execute format('alter table finance.commitments drop constraint %I', c_name);
  end if;
end $$;

alter table finance.commitments add constraint commitment_reminder_fields check(
  (kind = 'reminder') = (due_amount_cents is null) and
  (kind = 'reminder') = (direction is null) and
  (kind = 'reminder') = (certainty is null) and
  (kind = 'reminder') = (payment_method is null) and
  (person_id is null or kind = 'reminder')
);

-- Update commitment validation trigger to only require active person when person_id is provided
create or replace function private.validate_commitment() returns trigger language plpgsql set search_path = '' as $$
declare account finance.ledger_accounts; category finance.categories; begin
  if new.kind <> 'reminder' then
    if new.counterpart_account_id is not null then
      select * into account from finance.ledger_accounts where id = new.counterpart_account_id and financial_space_id = new.financial_space_id;
      if not found or account.owner_type = 'credit_card' or account.liquidity in ('cash','benefit','person') or account.account_class = 'equity' then raise exception 'Invalid commitment counterpart' using errcode = '23514'; end if;
    end if;
    if new.category_id is not null then
      select * into category from finance.categories where id = new.category_id and financial_space_id = new.financial_space_id;
      if not found or category.kind <> (case new.direction when 'inflow' then 'income' else 'expense' end) then raise exception 'Commitment category has wrong direction' using errcode = '23514'; end if;
    end if;
    if tg_op = 'UPDATE' and new.direction is distinct from old.direction and exists(select 1 from finance.ledger_entries where commitment_id = old.id) then raise exception 'Linked commitment direction is immutable' using errcode = '23514'; end if;
  else
    if new.person_id is not null and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id) and not exists(select 1 from finance.people where id = new.person_id and financial_space_id = new.financial_space_id and archived_at is null and deleted_at is null) then
      raise exception 'Active person required for a new reminder' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

commit;
