-- Testes da migração dos dados do app antigo (20261006050000_legacy_data_migration).
-- Datas relativas a hoje (D) no fuso America/Sao_Paulo, porque a classificação das
-- compras de cartão depende da fatura aberta de hoje. Cartão: fechamento dia 1,
-- vencimento dia 10. Valores conferidos ao centavo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

create temporary table d as select (now() at time zone 'America/Sao_Paulo')::date as today;
grant select on d to public;

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'a@teste.local'),
  ('b2000000-0000-4000-8000-000000000002', 'b@teste.local'),
  ('c3000000-0000-4000-8000-000000000003', 'c@teste.local');

-- O cadastro no app antigo cria 12 categorias padrão por usuário (gatilho da base).
-- Para não depender dele, garanto as que o teste usa.
insert into public.categories (user_id, nome, tipo)
select u, n, t
  from (values ('a1000000-0000-4000-8000-000000000001'::uuid), ('c3000000-0000-4000-8000-000000000003'::uuid)) us(u)
 cross join (values ('Salário', 'receita'), ('Freelance', 'receita'), ('Alimentação', 'despesa'),
                    ('Lazer', 'despesa'), ('Moradia', 'despesa'), ('Compras', 'despesa')) c(n, t)
 where not exists (select 1 from public.categories x where x.user_id = us.u and x.nome = c.n);

insert into public.categories (id, user_id, nome, tipo) overriding system value values
  (910011, 'a1000000-0000-4000-8000-000000000001', 'Alimentação', 'despesa'),
  (910012, 'a1000000-0000-4000-8000-000000000001', 'Cashback', 'receita');

insert into public.accounts (id, user_id, nome, tipo, saldo_inicial) overriding system value values
  (910001, 'a1000000-0000-4000-8000-000000000001', 'Conta Corrente', 'corrente', 1000.00),
  (910002, 'a1000000-0000-4000-8000-000000000001', 'Poupança', 'poupanca', 500.00),
  (910003, 'a1000000-0000-4000-8000-000000000001', 'Carteira', 'carteira', 0),
  (920001, 'b2000000-0000-4000-8000-000000000002', 'Conta B', 'corrente', 50.00),
  (930001, 'c3000000-0000-4000-8000-000000000003', 'Conta C', 'corrente', 0);

insert into public.credit_cards (id, user_id, nome, limite, dia_fechamento, dia_vencimento, conta_pagamento_id) overriding system value values
  (910021, 'a1000000-0000-4000-8000-000000000001', 'Cartão A', 5000, 1, 10, 910001);

create function pg_temp.cat(p_user uuid, p_name text) returns integer language sql as
  $$ select min(id) from public.categories where user_id = p_user and nome = p_name $$;

insert into public.transactions (id, user_id, account_id, category_id, tipo, valor, data, descricao, status, cartao_id, recorrencia_id)
overriding system value
select v.id, 'a1000000-0000-4000-8000-000000000001', v.acc, v.cat, v.tipo, v.valor, (select today from d) + v.dd, v.descr, v.status, v.card, v.grp
  from (values
    (910101, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Salário'), 'receita', 5000.00, -40, 'Salário', 'pago', null::integer, null::integer),
    (910102, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Alimentação'), 'despesa', 120.50, -10, 'Mercado', 'pago', null, null),
    (910103, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Lazer'), 'despesa', 80.00, -5, 'Cinema', 'pago', 910021, null),
    (910104, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Moradia'), 'despesa', 50.00, 5, 'Taxa agendada', 'pago', null, null),
    (910105, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Moradia'), 'despesa', 200.00, 10, 'Condomínio', 'pendente', null, null),
    (910106, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Freelance'), 'receita', 300.00, 15, 'Freela', 'pendente', null, null),
    (910107, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Compras'), 'despesa', 99.99, 0, 'Loja', 'pendente', 910021, null),
    (910108, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Compras'), 'despesa', 100.00, 0, 'TV (1/3)', 'pago', 910021, 910108),
    (910109, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Compras'), 'despesa', 100.00, 35, 'TV (2/3)', 'pendente', 910021, 910108),
    (910110, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Compras'), 'despesa', 100.01, 70, 'TV (3/3)', 'pendente', 910021, 910108),
    (910111, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Compras'), 'despesa', 45.00, -120, 'Compra antiga', 'pendente', 910021, null),
    (910112, 910001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Compras'), 'despesa', 0, -1, 'Zero', 'pago', null, null),
    (910113, 920001, pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Compras'), 'despesa', 10.00, -1, 'Conta de outro', 'pago', null, null),
    (910114, 910001, 910011, 'despesa', 12.34, -3, 'Padaria', 'pago', null, null),
    (910115, 910001, 910012, 'receita', 5.00, -2, 'Cashback', 'pago', null, null)
  ) v(id, acc, cat, tipo, valor, dd, descr, status, card, grp);

insert into public.bills (id, user_id, descricao, valor, vencimento, tipo, status, recorrencia, conta_id) overriding system value values
  (910201, 'a1000000-0000-4000-8000-000000000001', 'Luz', 150.00, (select today from d) + 7, 'pagar', 'pendente', 'mensal', null),
  (910202, 'a1000000-0000-4000-8000-000000000001', 'Água', 80.00, (select today from d) - 7, 'pagar', 'pago', null, null);

insert into public.goals (id, user_id, nome, valor_alvo, valor_atual, prazo) overriding system value values
  (910301, 'a1000000-0000-4000-8000-000000000001', 'Viagem', 2000.00, 600.00, (select today from d) + 200);

insert into public.budgets (user_id, categoria_id, mes_ano, valor_planejado) values
  ('a1000000-0000-4000-8000-000000000001', pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Alimentação'), '2026-01', 900),
  ('a1000000-0000-4000-8000-000000000001', pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Alimentação'), '2026-02', 900),
  ('a1000000-0000-4000-8000-000000000001', pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Alimentação'), '2026-03', 800),
  ('a1000000-0000-4000-8000-000000000001', pg_temp.cat('a1000000-0000-4000-8000-000000000001', 'Lazer'), '2026-01', 0);

-- Usuário C: valor com fração de centavo, que tem de impedir a aplicação.
insert into public.transactions (user_id, account_id, category_id, tipo, valor, data, descricao, status) values
  ('c3000000-0000-4000-8000-000000000003', 930001, pg_temp.cat('c3000000-0000-4000-8000-000000000003', 'Compras'),
   'despesa', 10.005, (select today from d) - 1, 'Fração', 'pago');

-- 1. Funções auxiliares
select is(legacy_migration.to_cents(19.90), 1990::bigint, 'to_cents: 19,90 → 1990');
select throws_ok($$ select legacy_migration.to_cents(10.005) $$, '22023', null, 'to_cents recusa fração de centavo');
select is((select row(period_start, period_end, closing_on, due_on)::text
             from legacy_migration.card_cycle(1, 10, true, '2026-10-05')),
          row('2026-10-01'::date, '2026-10-31'::date, '2026-11-01'::date, '2026-11-10'::date)::text,
          'card_cycle: Cartão A, compra de 05/10/2026 vai para a fatura nov/26 (fecha 01/11, vence 10/11)');
select is((select reference_month from legacy_migration.card_cycle(5, 15, true, '2026-10-05')),
          '2026-11-01'::date, 'card_cycle: Cartão B, compra no dia do fechamento vai para a fatura seguinte');

-- 2. Ensaio com A e B: confere e desfaz tudo
select is((legacy_migration.run('dry_run', array['a1000000-0000-4000-8000-000000000001',
                                                 'b2000000-0000-4000-8000-000000000002']::uuid[])->>'ok')::boolean,
          true, 'dry_run de A e B: conferência sem erro nem diferença');
select is((select count(*) from finance.financial_spaces
            where created_by in ('a1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002')),
          0::bigint, 'dry_run não deixa espaço criado');
select is((select count(*) from legacy_migration.runs), 0::bigint, 'dry_run não deixa execução registrada');

-- 3. Aplicação de verdade
create temporary table rep as
select legacy_migration.run('apply', array['a1000000-0000-4000-8000-000000000001',
                                           'b2000000-0000-4000-8000-000000000002']::uuid[]) as r;
select is((select (r->>'ok')::boolean from rep), true, 'apply de A e B: relatório ok');
select is((select jsonb_array_length(r->'errors') from rep), 0, 'apply: nenhum erro');
select is((select jsonb_array_length(r->'conference'->'failed') from rep), 0, 'apply: nenhuma diferença na conferência');
select is((select count(*) from legacy_migration.runs where mode = 'apply' and status = 'completed'), 1::bigint,
          'apply registra a execução como concluída');

create temporary table sp as
select s.id, s.created_by from finance.financial_spaces s
 where s.created_by in ('a1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002');

create function pg_temp.acct(p_legacy integer) returns bigint language sql as $$
  select coalesce(sum(e.amount_cents), 0)
    from legacy_migration.map m
    join finance.financial_accounts fa on fa.id = m.target_id
    join finance.ledger_entries e on e.ledger_account_id = fa.ledger_account_id
    join finance.ledger_transactions t on t.id = e.ledger_transaction_id and t.status = 'posted'
   where m.legacy_table = 'accounts' and m.legacy_id = p_legacy $$;

-- Saldos: 1000 + 5000 − 120,50 − 80 (cartão pago) − 50 (agendado) − 100 (TV 1/3 paga) − 12,34 + 5
select is(pg_temp.acct(910001), 564216::bigint, 'conta corrente de A: 5.642,16, igual ao saldo do app antigo');
select is(pg_temp.acct(910002), 50000::bigint, 'poupança de A: 500,00');
select is(pg_temp.acct(910003), 0::bigint, 'carteira de A: 0,00');
select is(pg_temp.acct(920001), 5000::bigint, 'conta de B: 50,00 (o lançamento de A na conta de B não entra)');
select is((select a.liquidity from legacy_migration.map m join finance.financial_accounts fa on fa.id = m.target_id
             join finance.ledger_accounts a on a.id = fa.ledger_account_id
            where m.legacy_table = 'accounts' and m.legacy_id = 910002),
          'investment', 'poupança migra com liquidez investment (D-022)');
select is((select count(*) from finance.ledger_transactions t join sp on sp.id = t.financial_space_id
            where sp.created_by = 'a1000000-0000-4000-8000-000000000001' and t.occurred_on > (select today from d)
              and t.status = 'posted' and t.kind = 'expense'),
          1::bigint, 'lançamento pago com data futura vira agendado');

-- Cartão: aberta 99,99 + parcelas futuras 100,00 e 100,01 = 300,00
select is((select (-sum(e.amount_cents))::bigint from legacy_migration.map m
             join finance.credit_cards c on c.id = m.target_id
             join finance.ledger_entries e on e.ledger_account_id = c.ledger_account_id
             join finance.ledger_transactions t on t.id = e.ledger_transaction_id and t.status = 'posted'
            where m.legacy_table = 'credit_cards' and m.legacy_id = 910021),
          30000::bigint, 'dívida do cartão: 300,00 (fatura aberta + parcelas futuras)');
select is((select array_agg(e.amount_cents::text || '@' || e.installment_number || '/' || e.installment_count order by e.installment_number)
             from legacy_migration.map m
             join finance.credit_cards c on c.id = m.target_id
             join finance.ledger_entries e on e.ledger_account_id = c.ledger_account_id and e.installment_number is not null
            where m.legacy_table = 'credit_cards' and m.legacy_id = 910021),
          array['-10000@2/3', '-10001@3/3'], 'parcelas futuras com o valor exato de cada uma (2/3 e 3/3)');
select is((select count(distinct e.card_statement_id) from legacy_migration.map m
             join finance.credit_cards c on c.id = m.target_id
             join finance.ledger_entries e on e.ledger_account_id = c.ledger_account_id and e.installment_number is not null
            where m.legacy_table = 'credit_cards' and m.legacy_id = 910021),
          2::bigint, 'cada parcela futura está na sua fatura');
select is((select started_on from legacy_migration.map m join finance.credit_cards c on c.id = m.target_id
            where m.legacy_table = 'credit_cards' and m.legacy_id = 910021),
          (select today from d), 'cartão começa a ser usado na data de corte');
select is((select rule from legacy_migration.map where legacy_table = 'transactions' and legacy_id = 910111),
          'pendente no cartão de fatura já vencida: considerada paga fora do app',
          'compra pendente de fatura já vencida fica fora do Ledger (decisão 6)');

-- Não migrados e motivos
select is((select outcome || ': ' || rule from legacy_migration.map where legacy_table = 'transactions' and legacy_id = 910112),
          'not_migrated: valor zero', 'lançamento de valor zero não migra');
select is((select outcome from legacy_migration.map where legacy_table = 'transactions' and legacy_id = 910113),
          'not_migrated', 'lançamento com conta de outro usuário não migra');
select is((select outcome from legacy_migration.map where legacy_table = 'bills' and legacy_id = 910202),
          'not_migrated', 'conta marcada como paga sem lançamento não migra');

-- Pendentes → Agenda
select is((select count(*) from finance.commitments c join sp on sp.id = c.financial_space_id
            where sp.created_by = 'a1000000-0000-4000-8000-000000000001'),
          3::bigint, 'dois lançamentos pendentes e uma conta pendente viram compromissos');
select is((select direction || '/' || due_amount_cents from legacy_migration.map m join finance.commitments c on c.id = m.target_id
            where m.legacy_table = 'transactions' and m.legacy_id = 910106),
          'inflow/30000', 'receita pendente vira compromisso de entrada de 300,00');

-- Categorias
select is((select c.name from legacy_migration.map m join finance.categories c on c.id = m.target_id
            where m.legacy_table = 'categories' and m.legacy_id = 910011),
          'Alimentação (2)', 'categoria repetida recebe sufixo');
select is((select c.system_role from legacy_migration.map m join finance.categories c on c.id = m.target_id
            where m.legacy_table = 'categories' and m.legacy_id = 910012),
          'cashback', 'categoria Cashback antiga liga-se à categoria de sistema');
select is((select c.income_class from legacy_migration.map m join finance.categories c on c.id = m.target_id
             join public.categories o on o.id = m.legacy_id
            where m.legacy_table = 'categories' and o.user_id = 'a1000000-0000-4000-8000-000000000001' and o.nome = 'Salário'),
          'recurring', 'Salário vira receita recorrente (decisão 9)');

-- Meta e orçamentos
select is((select sum(rc.amount_cents)::bigint from legacy_migration.map m join finance.reserve_contributions rc on rc.reserve_id = m.target_id
            where m.legacy_table = 'goals' and m.legacy_id = 910301),
          60000::bigint, 'meta Viagem com 600,00 guardados');
select is((select array_agg(b.amount_cents::text || ':' || b.effective_from_month || '..' || b.effective_until_month
                             order by b.effective_from_month)
             from finance.budgets b join sp on sp.id = b.financial_space_id
            where sp.created_by = 'a1000000-0000-4000-8000-000000000001'),
          array['90000:2026-01-01..2026-02-01', '80000:2026-03-01..2026-03-01'],
          'orçamentos mensais agrupados em vigências');

-- Cobertura e trava das tabelas antigas
select is((select count(*) from legacy_migration.conference where check_name = 'cobertura' and not ok), 0::bigint,
          'todo registro antigo de A e B está no mapa');
select is(has_table_privilege('authenticated', 'public.transactions', 'INSERT'), false,
          'tabelas antigas ficam sem INSERT para authenticated');
select is(has_table_privilege('authenticated', 'public.transactions', 'SELECT'), true,
          'tabelas antigas continuam legíveis');
select throws_like($$ select legacy_migration.run('apply', array['c3000000-0000-4000-8000-000000000003']::uuid[]) $$,
                   '%já foi aplicada%', 'não é possível aplicar duas vezes');

-- 4. Fração de centavo: o ensaio aponta o erro
select is((legacy_migration.run('dry_run', array['c3000000-0000-4000-8000-000000000003']::uuid[])->>'ok')::boolean,
          false, 'valor com fração de centavo impede a migração');

select * from finish();
rollback;
