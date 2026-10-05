begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(6);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000051','edit-a@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000051","role":"authenticated"}',true);
select api.create_personal_space('Teste edição') as space \gset
select api.create_financial_account(:'space','Banco','checking',0) as account \gset
select ledger_account_id as account_ledger from finance.financial_accounts where id = :'account' \gset
select api.create_category(:'space','Mercado','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id = :'category' \gset
select jsonb_build_object('kind','expense','occurred_on','2026-10-01','competence_month','2026-10-01','description','Mercado','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'account_ledger','amount_cents',-100),jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',100)))::text as payload \gset
select api.post_transaction(:'space',:'payload') as tx \gset
select is(api.edit_transaction(:'space',:'tx',1,replace(:'payload','100','200')::jsonb,'Corrigir valor'),:'tx'::uuid,'Edit replaces entries atomically');
select is((select balance_cents from finance.account_balances where id = :'account_ledger'),-200::bigint,'Balance reflects edited entries');
select is((select version from finance.ledger_transactions where id = :'tx'),2,'Edit increments optimistic version');
select is((select (before_data->'entries'->0->>'amount_cents')::bigint from finance.audit_logs where entity_id = :'tx' and action = 'edited'),-100::bigint,'Audit preserves original entry values');
select throws_ok(format('select api.edit_transaction(%L,%L,1,%L::jsonb,%L)',:'space',:'tx',:'payload','Outra edição'),'40001','Transaction changed; reload before editing','Stale concurrent edit rejected');
select throws_ok(format('select api.edit_transaction(%L,%L,2,%L::jsonb,%L)',:'space',:'tx',replace(:'payload','"amount_cents": 100','"amount_cents": 101'),'Inválido'),'23514','Transaction must sum to zero','Unbalanced edit rolls back');
set constraints all immediate;
select * from finish();
rollback;
