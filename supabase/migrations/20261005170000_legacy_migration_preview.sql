-- Read-only preflight. No existing data is changed or deleted.
begin;
create function api.preview_legacy_migration() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); result jsonb; begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'accounts',coalesce((select jsonb_agg(jsonb_build_object(
      'legacy_id',a.id,'name',a.nome,'kind',a.tipo,
      'opening_cents',a.saldo_inicial * 100,
      'legacy_balance_cents',(a.saldo_inicial + coalesce((select sum(case when t.tipo = 'receita' then t.valor else -t.valor end) from public.transactions t where t.user_id = v_user_id and t.account_id = a.id and t.status = 'pago'),0)) * 100
    ) order by a.id) from public.accounts a where a.user_id = v_user_id),'[]'::jsonb),
    'counts',jsonb_build_object(
      'transactions',(select count(*) from public.transactions t where t.user_id = v_user_id),
      'categories',(select count(*) from public.categories c where c.user_id = v_user_id),
      'cards',(select count(*) from public.credit_cards c where c.user_id = v_user_id),
      'bills',(select count(*) from public.bills b where b.user_id = v_user_id),
      'goals',(select count(*) from public.goals g where g.user_id = v_user_id),
      'budgets',(select count(*) from public.budgets b where b.user_id = v_user_id)
    ),
    'review',jsonb_build_object(
      'pending_transactions',(select count(*) from public.transactions t where t.user_id = v_user_id and t.status = 'pendente'),
      'card_transactions',(select count(*) from public.transactions t where t.user_id = v_user_id and t.cartao_id is not null),
      'fractional_cents',(select count(*) from public.transactions t where t.user_id = v_user_id and t.valor * 100 <> trunc(t.valor * 100)) + (select count(*) from public.accounts a where a.user_id = v_user_id and a.saldo_inicial * 100 <> trunc(a.saldo_inicial * 100)),
      'invalid_reference_transactions',(select count(*) from public.transactions t
        left join public.accounts a on a.id = t.account_id left join public.categories c on c.id = t.category_id left join public.credit_cards k on k.id = t.cartao_id
        where t.user_id = v_user_id and (a.user_id is distinct from v_user_id or c.user_id is distinct from v_user_id or (t.cartao_id is not null and k.user_id is distinct from v_user_id))),
      'nonpositive_transactions',(select count(*) from public.transactions t where t.user_id = v_user_id and t.valor <= 0)
    ),
    'ready_for_automatic_migration',false
  ) into result;
  return result;
end;
$$;
revoke all on function api.preview_legacy_migration() from public,anon,authenticated;
grant execute on function api.preview_legacy_migration() to authenticated;
commit;
