begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(12);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000021','accounts-a@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000021","role":"authenticated"}',true);
select api.create_personal_space('Teste contas') as space \gset
select api.create_financial_account(:'space','Banco','checking',100000,'2026-10-01') as account \gset
select ledger_account_id as account_ledger from finance.financial_accounts where id = :'account' \gset
select is((select balance_cents from finance.account_balances where id = :'account_ledger'),100000::bigint,'Opening is a balanced ledger fact');
select is((select sum(amount_cents) from finance.ledger_entries),0::numeric,'All opening entries sum zero');
select api.create_financial_account(:'space','Poupança','savings',50000,'2026-10-01') as savings \gset
select is((select a.liquidity from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.id = :'savings'),'investment','D-022 savings excluded from cash by default');
select is((select sum(balance_cents) from finance.account_balances where liquidity = 'cash'),100000::numeric,'Cash total excludes savings');
select api.create_category(:'space','Salário','income',null,'recurring') as income \gset
select is((select income_class from finance.categories where id = :'income'),'recurring','Recurring income is classified explicitly');
select throws_ok(format('select api.create_category(%L,%L,%L)',:'space','Receita','income'),'23514','Income class is required','Unclassified income is rejected');
select throws_ok(format('select api.create_financial_account(%L,%L,%L,-1)',:'space','VA','benefit'),'23514','This account cannot have a negative opening','Benefit opening cannot be negative');
select is(api.archive_financial_account(:'space',:'account',1),:'account'::uuid,'Archiving preserves account');
select is((select balance_cents from finance.account_balances where id = :'account_ledger'),100000::bigint,'Archiving preserves historical balance');
select ok(not (select allows_posting from finance.ledger_accounts where id = :'account_ledger'),'Archived account does not accept new entries');
select throws_ok(format($q$select api.post_transaction(%L,jsonb_build_object('kind','transfer','occurred_on','2026-10-02','competence_month','2026-10-01','description','Teste','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',%L,'amount_cents',-100),jsonb_build_object('ledger_account_id',%L,'amount_cents',100))))$q$,:'space',:'account_ledger',(select ledger_account_id from finance.financial_accounts where id = :'savings')),'23514','Account is archived','Posting to archived account is rejected');
select ok((select count(*) from finance.audit_logs where entity_id = :'account') = 2,'Account creation and archive are audited');
set constraints all immediate;
select * from finish();
rollback;
