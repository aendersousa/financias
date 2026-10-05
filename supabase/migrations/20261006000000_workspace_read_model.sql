begin;
create function api.workspace_snapshot(p_space uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode = '42501'; end if;
  select jsonb_build_object(
    'space',(select jsonb_build_object('id',s.id,'name',s.name,'today',private.space_today(s.id)) from finance.financial_spaces s where s.id = p_space),
    'role',(select m.role from finance.financial_space_members m where m.financial_space_id = p_space and m.user_id = auth.uid() and m.status = 'active'),
    'accounts',(select coalesce(jsonb_agg(to_jsonb(f) || jsonb_build_object('balance_cents',b.balance_cents) order by f.name),'[]') from finance.financial_accounts f join finance.account_balances b on b.id = f.ledger_account_id where f.financial_space_id = p_space and f.archived_at is null),
    'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]') from finance.categories c where c.financial_space_id = p_space and c.archived_at is null and c.deleted_at is null),
    'cards',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]') from finance.card_limits c where c.financial_space_id = p_space and c.status = 'active'),
    'statements',(select coalesce(jsonb_agg(to_jsonb(s) order by s.effective_due_on),'[]') from finance.statement_amounts s where s.financial_space_id = p_space),
    'people',(select coalesce(jsonb_agg(to_jsonb(p) order by p.nickname),'[]') from finance.person_balances p where p.financial_space_id = p_space),
    'commitments',(select coalesce(jsonb_agg(to_jsonb(c) order by c.effective_due_on),'[]') from finance.commitment_settlements c where c.financial_space_id = p_space),
    'transactions',(select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_on desc,t.created_at desc),'[]') from(select t.* from finance.ledger_transactions t where t.financial_space_id = p_space order by t.occurred_on desc,t.created_at desc limit 200) t),
    'budgets',api.budget_month_summary(p_space,date_trunc('month',private.space_today(p_space))::date)
  ) into result;
  return result;
end;
$$;
revoke all on function api.workspace_snapshot(uuid) from public,anon,authenticated;
grant execute on function api.workspace_snapshot(uuid) to authenticated;
commit;
