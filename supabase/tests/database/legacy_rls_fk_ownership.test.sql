-- Testes da migração 20261005120000_legacy_rls_fk_ownership (ANALISE_E_PLANO.md, 3.3).
-- Usuário A tenta gravar referências a conta, categoria e cartão do usuário B.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Preparação, como postgres (sem RLS). Ids fixos para não depender de sequência.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@teste.local'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@teste.local');

insert into public.accounts (id, user_id, nome, tipo) overriding system value values
  (900001, 'aaaaaaaa-0000-4000-8000-000000000001', 'Conta A', 'corrente'),
  (900002, 'bbbbbbbb-0000-4000-8000-000000000002', 'Conta B', 'corrente');

insert into public.categories (id, user_id, nome, tipo) overriding system value values
  (900011, 'aaaaaaaa-0000-4000-8000-000000000001', 'Categoria A', 'despesa'),
  (900012, 'bbbbbbbb-0000-4000-8000-000000000002', 'Categoria B', 'despesa');

insert into public.credit_cards (id, user_id, nome, dia_fechamento, dia_vencimento) overriding system value values
  (900021, 'aaaaaaaa-0000-4000-8000-000000000001', 'Cartão A', 1, 10),
  (900022, 'bbbbbbbb-0000-4000-8000-000000000002', 'Cartão B', 1, 10);

insert into public.transactions (id, user_id, account_id, category_id, tipo, valor, data) overriding system value values
  (900031, 'aaaaaaaa-0000-4000-8000-000000000001', 900001, 900011, 'despesa', 10, '2026-10-01');

-- A partir daqui, como o usuário A.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- transactions
select lives_ok(
  $$ insert into public.transactions (user_id, account_id, category_id, tipo, valor, data)
     values (auth.uid(), 900001, 900011, 'despesa', 20, '2026-10-02') $$,
  'lançamento com conta e categoria próprias é aceito');

select throws_ok(
  $$ insert into public.transactions (user_id, account_id, category_id, tipo, valor, data)
     values (auth.uid(), 900002, 900011, 'despesa', 20, '2026-10-02') $$,
  '42501', null, 'lançamento com conta de outro usuário é recusado');

select throws_ok(
  $$ insert into public.transactions (user_id, account_id, category_id, tipo, valor, data)
     values (auth.uid(), 900001, 900012, 'despesa', 20, '2026-10-02') $$,
  '42501', null, 'lançamento com categoria de outro usuário é recusado');

select throws_ok(
  $$ insert into public.transactions (user_id, account_id, category_id, tipo, valor, data, cartao_id)
     values (auth.uid(), 900001, 900011, 'despesa', 20, '2026-10-02', 900022) $$,
  '42501', null, 'lançamento com cartão de outro usuário é recusado');

select lives_ok(
  $$ insert into public.transactions (user_id, account_id, category_id, tipo, valor, data, cartao_id)
     values (auth.uid(), 900001, 900011, 'despesa', 20, '2026-10-02', 900021) $$,
  'lançamento com cartão próprio é aceito');

select throws_ok(
  $$ update public.transactions set account_id = 900002 where id = 900031 $$,
  '42501', null, 'alterar lançamento para a conta de outro usuário é recusado');

-- credit_cards
select throws_ok(
  $$ insert into public.credit_cards (user_id, nome, dia_fechamento, dia_vencimento, conta_pagamento_id)
     values (auth.uid(), 'Novo', 5, 15, 900002) $$,
  '42501', null, 'cartão com conta de pagamento de outro usuário é recusado');

select lives_ok(
  $$ insert into public.credit_cards (user_id, nome, dia_fechamento, dia_vencimento, conta_pagamento_id)
     values (auth.uid(), 'Novo', 5, 15, 900001) $$,
  'cartão com conta de pagamento própria é aceito');

-- bills
select throws_ok(
  $$ insert into public.bills (user_id, descricao, valor, vencimento, tipo, conta_id)
     values (auth.uid(), 'Luz', 100, '2026-10-10', 'pagar', 900002) $$,
  '42501', null, 'conta a pagar ligada a conta de outro usuário é recusada');

select lives_ok(
  $$ insert into public.bills (user_id, descricao, valor, vencimento, tipo, conta_id)
     values (auth.uid(), 'Luz', 100, '2026-10-10', 'pagar', 900001) $$,
  'conta a pagar ligada a conta própria é aceita');

-- budgets
select throws_ok(
  $$ insert into public.budgets (user_id, categoria_id, mes_ano, valor_planejado)
     values (auth.uid(), 900012, '2026-10', 500) $$,
  '42501', null, 'orçamento em categoria de outro usuário é recusado');

select lives_ok(
  $$ insert into public.budgets (user_id, categoria_id, mes_ano, valor_planejado)
     values (auth.uid(), 900011, '2026-10', 500) $$,
  'orçamento em categoria própria é aceito');

-- create_installment_purchase
select throws_ok(
  $$ select * from public.create_installment_purchase(900002, 900011, 900021, 300, 3, '2026-10-05', 'X', 'pago') $$,
  '42501', null, 'compra parcelada com conta de outro usuário é recusada');

select throws_ok(
  $$ select * from public.create_installment_purchase(900001, 900011, 900022, 300, 3, '2026-10-05', 'X', 'pago') $$,
  '42501', null, 'compra parcelada com cartão de outro usuário é recusada');

-- O cálculo antigo continua igual: 100,00 em 3 = 33,33 + 33,33 + 33,34 (sobra na última).
select is(
  (select array_agg(valor order by data)
     from public.create_installment_purchase(900001, 900011, 900021, 100, 3, '2026-10-05', 'TV', 'pago')),
  array[33.33, 33.33, 33.34]::numeric[],
  'compra parcelada própria gera as mesmas parcelas de antes');

select is(
  (select count(*) from public.accounts where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  0::bigint,
  'o usuário A continua sem ver as contas do usuário B');

-- Catálogo, de volta como postgres.
reset role;

select is(
  has_function_privilege('public',
    'public.create_installment_purchase(integer, integer, integer, numeric, integer, date, text, text)', 'execute'),
  false,
  'PUBLIC não executa create_installment_purchase');

select is(
  has_function_privilege('anon',
    'public.create_installment_purchase(integer, integer, integer, numeric, integer, date, text, text)', 'execute'),
  false,
  'anon não executa create_installment_purchase');

select is(
  has_function_privilege('service_role',
    'public.create_installment_purchase(integer, integer, integer, numeric, integer, date, text, text)', 'execute'),
  false,
  'service_role não executa create_installment_purchase');

select is(
  has_function_privilege('authenticated',
    'public.create_installment_purchase(integer, integer, integer, numeric, integer, date, text, text)', 'execute'),
  true,
  'authenticated executa create_installment_purchase');

select is(
  (select proconfig from pg_proc
    where oid = 'public.create_installment_purchase(integer, integer, integer, numeric, integer, date, text, text)'::regprocedure),
  array['search_path=""'],
  'create_installment_purchase tem search_path fixado em vazio');

select is(
  (select prosecdef from pg_proc
    where oid = 'public.create_installment_purchase(integer, integer, integer, numeric, integer, date, text, text)'::regprocedure),
  false,
  'create_installment_purchase não é mais SECURITY DEFINER');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_installment_purchase'),
  1::bigint,
  'existe uma única public.create_installment_purchase (nenhuma sobrecarga antiga)');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_installment_purchase' and p.prosecdef),
  0::bigint,
  'nenhuma versão de public.create_installment_purchase é SECURITY DEFINER');

select * from finish();
rollback;
