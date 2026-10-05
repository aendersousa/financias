begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(5);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000081','archived-edit@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000081","role":"authenticated"}',true);
select api.create_personal_space('Teste arquivamento') as space \gset
select api.create_financial_account(:'space','Banco','checking',0) as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_financial_account(:'space','Outra','checking',0) as other \gset
select ledger_account_id as other_ledger from finance.financial_accounts where id = :'other' \gset
select api.create_category(:'space','Mercado','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id = :'category' \gset
select jsonb_build_object('kind','expense','occurred_on','2000-10-01','competence_month','2000-10-01','description','Mercado','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-100),jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',100)))::text as payload \gset
select api.post_transaction(:'space',:'payload') as tx \gset
select api.archive_financial_account(:'space',:'bank',1);
select api.archive_financial_account(:'space',:'other',1);
select is(api.edit_transaction(:'space',:'tx',1,replace(:'payload','100','200')::jsonb,'Corrigir histórico'),:'tx'::uuid,'Historical transaction may retain archived account');
select is((select balance_cents from finance.account_balances where id = :'bank_ledger'),-200::bigint,'Edited archived account balance remains derived');
select throws_ok(format('select api.edit_transaction(%L,%L,2,%L::jsonb,%L)',:'space',:'tx',replace(:'payload',:'bank_ledger',:'other_ledger'),'Trocar conta'),'23514','Account is archived','Cannot add another archived account during edit');
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space',:'payload'),'23514','Account is archived','Editing context does not permit new postings');
reset role;
select is((select count(*) from private.ledger_edit_accounts),0::bigint,'Trusted editing context is cleared on success and failure');
set constraints all immediate;
select * from finish();
rollback;
