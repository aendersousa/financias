-- Section 33.7: old and new financial/competence dates, including entry overrides.
begin;
create or replace function private.protect_ledger_mutation() returns trigger
language plpgsql set search_path = '' as $$
declare tx finance.ledger_transactions; posting_account finance.ledger_accounts; locked boolean; begin
  if tg_table_name = 'ledger_transactions' then
    if tg_op = 'DELETE' then raise exception 'Cancel transactions instead of deleting' using errcode = '23514'; end if;
    if tg_op = 'UPDATE' and old.status = 'cancelled' then raise exception 'Cancelled transactions are immutable' using errcode = '23514'; end if;
    if tg_op = 'UPDATE' and (new.id <> old.id or new.financial_space_id <> old.financial_space_id) then raise exception 'Transaction identity and space are immutable' using errcode = '23514'; end if;
    -- All writing/closing RPCs use this lock, serializing changes within a space.
    perform pg_advisory_xact_lock(hashtextextended(new.financial_space_id::text,0));
    select exists(select 1 from finance.period_closings c where c.financial_space_id = new.financial_space_id and c.reopened_at is null and
      (c.month = date_trunc('month',new.occurred_on)::date or c.month = new.competence_month or
       (tg_op = 'UPDATE' and (c.month = date_trunc('month',old.occurred_on)::date or c.month = old.competence_month)) or
       exists(select 1 from finance.ledger_entries e where e.ledger_transaction_id = new.id and coalesce(e.competence_month,new.competence_month) = c.month))) into locked;
    if locked then
      if tg_op = 'INSERT' or (to_jsonb(new) - array['description','notes','version','updated_at','updated_by']) is distinct from (to_jsonb(old) - array['description','notes','version','updated_at','updated_by']) then
        raise exception 'Period is closed' using errcode = '23514';
      end if;
    end if;
  else
    if tg_op = 'UPDATE' and (new.ledger_transaction_id <> old.ledger_transaction_id or new.financial_space_id <> old.financial_space_id or new.id <> old.id) then raise exception 'Entry transaction and space are immutable' using errcode = '23514'; end if;
    select * into tx from finance.ledger_transactions where id = coalesce(new.ledger_transaction_id,old.ledger_transaction_id);
    perform pg_advisory_xact_lock(hashtextextended(tx.financial_space_id::text,0));
    if tx.status = 'cancelled' then raise exception 'Cancelled transactions are immutable' using errcode = '23514'; end if;
    if exists(select 1 from finance.period_closings c where c.financial_space_id = tx.financial_space_id and c.reopened_at is null and
      (c.month = date_trunc('month',tx.occurred_on)::date or c.month = tx.competence_month or
       c.month = coalesce(new.competence_month,tx.competence_month) or c.month = coalesce(old.competence_month,tx.competence_month) or
       exists(select 1 from finance.ledger_entries e where e.ledger_transaction_id = tx.id and coalesce(e.competence_month,tx.competence_month) = c.month))) then
      raise exception 'Period is closed' using errcode = '23514';
    end if;
    if tg_op <> 'DELETE' then
      select * into posting_account from finance.ledger_accounts where id = new.ledger_account_id;
      if tg_op = 'INSERT' and not posting_account.allows_posting then raise exception 'Account is archived' using errcode = '23514'; end if;
      if new.original_competence_month is not null and new.original_competence_month >= coalesce(new.competence_month,tx.competence_month) then raise exception 'Original competence must precede effective competence' using errcode = '23514'; end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
-- Unsupported financial operations must not be accepted before their rules exist.
create function private.reject_unimplemented_operations() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind not in ('opening','expense','income','transfer','balance_adjustment','investment_contribution','investment_redemption','investment_result','person_settlement','loan_disbursement','loan_payment') then
    raise exception 'Operation requires a financial module not yet enabled' using errcode = '0A000';
  end if;
  return new;
end;
$$;
create trigger restrict_operations before insert on finance.ledger_transactions for each row execute function private.reject_unimplemented_operations();
revoke all on function private.reject_unimplemented_operations() from public,anon,authenticated;
commit;
