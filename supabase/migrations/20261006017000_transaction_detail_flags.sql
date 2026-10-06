begin;
create or replace function api.transaction_detail(p_space uuid,p_transaction uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare tx finance.ledger_transactions; locked boolean; remaining numeric; begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode = '42501'; end if;
  select * into tx from finance.ledger_transactions where id = p_transaction and financial_space_id = p_space;
  if not found then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  select exists(select 1 from finance.period_closings c where c.financial_space_id = p_space and c.reopened_at is null and
    (c.month = date_trunc('month',tx.occurred_on)::date or c.month = tx.competence_month or exists(select 1 from finance.ledger_entries e where e.ledger_transaction_id = tx.id and coalesce(e.competence_month,tx.competence_month) = c.month))) into locked;
  select coalesce(sum(e.amount_cents),0) into remaining from finance.posted_ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id join finance.ledger_accounts a on a.id = e.ledger_account_id
    where a.account_class = 'expense' and (t.id = tx.id or (t.related_transaction_id = tx.id and t.kind = 'refund'));
  return jsonb_build_object('transaction',to_jsonb(tx),'financially_locked',locked,'remaining_consumption_cents',remaining,
    'entries',(select jsonb_agg(to_jsonb(e) || jsonb_build_object('account_name',a.name,'account_class',a.account_class,'owner_type',a.owner_type,'statement_status',s.status) order by e.line_number)
      from finance.ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id left join finance.card_statements s on s.id = e.card_statement_id where e.ledger_transaction_id = tx.id));
end;
$$;
commit;
