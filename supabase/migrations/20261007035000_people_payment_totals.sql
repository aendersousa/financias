begin;

-- Count actual reductions of an outstanding balance, excluding cancelled and future movements.
create or replace function private.person_payment_totals(p_space uuid,p_ledger uuid) returns jsonb
language sql stable set search_path='' as $$
  with movements as (
    select t.id,t.kind,t.occurred_on,t.created_at,sum(e.amount_cents)::numeric as amount
    from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id
    where e.financial_space_id=p_space and e.ledger_account_id=p_ledger
      and t.status='posted' and t.occurred_on<=private.space_today(p_space)
    group by t.id
  ), history as (
    select *,coalesce(sum(amount) over(order by occurred_on,created_at,id rows between unbounded preceding and 1 preceding),0) as previous
    from movements
  )
  select jsonb_build_object(
    'received_cents',coalesce(sum(least(-amount,previous)) filter(where kind='person_settlement' and amount<0 and previous>0),0),
    'paid_cents',coalesce(sum(least(amount,-previous)) filter(where kind='person_settlement' and amount>0 and previous<0),0)
  ) from history;
$$;
revoke all on function private.person_payment_totals(uuid,uuid) from public,anon,authenticated;
do $$
declare definition text; original text:='to_jsonb(p)||jsonb_build_object';
begin
  select pg_get_functiondef('api.people_management_summary(uuid,boolean)'::regprocedure) into definition;
  if position(original in definition) > 0 then
    definition:=replace(definition,original,'to_jsonb(p)||private.person_payment_totals(p_space,p.ledger_account_id)||jsonb_build_object');
    execute definition;
  end if;
end;
$$;
commit;
