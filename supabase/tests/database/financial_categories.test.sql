begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(9);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000071','categories-a@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000071","role":"authenticated"}',true);
select api.create_personal_space('Teste categorias') as space \gset
select api.create_financial_account(:'space','Banco','checking',0) as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_category(:'space','Alimentação','expense',null,null,true,'fixed') as parent \gset
select ledger_account_id as original_ledger from finance.categories where id = :'parent' \gset
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2000-10-01','competence_month','2000-10-01','description','Histórico','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-500),jsonb_build_object('ledger_account_id',:'original_ledger','amount_cents',500)))) as original_tx \gset
select api.create_category(:'space','Restaurante','expense',:'parent') as child \gset
select ok((select ledger_account_id is null from finance.categories where id = :'parent'),'D-004 parent has no ledger account');
select is((select ledger_account_id from finance.categories where parent_id = :'parent' and name = 'Alimentação (geral)'),:'original_ledger'::uuid,'General child keeps original ledger account');
select ok((select is_essential and fixity = 'fixed' from finance.categories where parent_id = :'parent' and name = 'Alimentação (geral)'),'General child inherits planning marks');
select is((select amount_cents from finance.ledger_entries where ledger_transaction_id = :'original_tx' and ledger_account_id = :'original_ledger'),500::bigint,'Historical entries are unchanged');
select is((select balance_cents from finance.category_balances where category_id = :'parent'),500::bigint,'Parent historical total is preserved');
select api.create_category(:'space','Delivery','expense',:'child') as grandchild \gset
select throws_ok(format('select api.move_category(%L,%L,%L,2)',:'space',:'parent',:'child'),'23514','Category hierarchy cannot contain cycles','Cannot move parent beneath descendant');
select throws_ok(format('select api.create_category(%L,%L,%L,%L,%L)',:'space','Salário','income',:'parent','recurring'),'23514','Invalid category parent','Cannot mix income and expense hierarchy');
reset role;
select throws_ok(format($q$update finance.categories set ledger_account_id = %L where id = %L$q$,:'bank_ledger',:'grandchild'),'23514','Category ledger account has wrong class or space','Cannot use bank account as category ledger');
select throws_ok(format($q$update finance.financial_space_members set role = 'viewer' where financial_space_id = %L; set constraints all immediate;$q$,:'space'),'23514','Financial space requires an active owner','Cannot remove final owner');
set constraints all immediate;
select * from finish();
rollback;
