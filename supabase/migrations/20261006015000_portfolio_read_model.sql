begin;
create function api.portfolio_summary(p_space uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode = '42501'; end if;
  return jsonb_build_object('net_worth_cents',(select coalesce(sum(balance_cents),0)::bigint from finance.account_balances where financial_space_id = p_space and account_class in('asset','liability')),
    'loans',(select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('debt_cents',-b.balance_cents) order by l.name),'[]') from finance.loans l join finance.account_balances b on b.id = l.ledger_account_id where l.financial_space_id = p_space and l.status <> 'archived' and l.deleted_at is null),
    'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'liquidity',b.liquidity,'balance_cents',b.balance_cents) order by f.name),'[]') from finance.financial_accounts f join finance.account_balances b on b.id = f.ledger_account_id where f.financial_space_id = p_space and f.archived_at is null and f.deleted_at is null),
    'valuations',(select coalesce(jsonb_agg(to_jsonb(v) order by v.valued_on desc),'[]') from finance.asset_valuations v where v.financial_space_id = p_space));
end;
$$;
revoke all on function api.portfolio_summary(uuid) from public,anon,authenticated;
grant execute on function api.portfolio_summary(uuid) to authenticated;
commit;
