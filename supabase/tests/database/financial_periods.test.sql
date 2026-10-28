begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(6);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000031','periods-a@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000031","role":"authenticated"}',true);
select api.create_personal_space('Teste períodos') as space \gset
select api.create_financial_account(:'space','Banco','checking',0) as account \gset
select ledger_account_id as account_ledger from finance.financial_accounts where id = :'account' \gset
select api.create_category(:'space','Mercado','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id = :'category' \gset
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-11-01','competence_month','2026-11-01','description','Referência outubro','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'account_ledger','amount_cents',-100),jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',100,'competence_month','2026-10-01')))) as tx \gset
reset role;
insert into finance.period_closings(financial_space_id,month,closed_by) values(:'space','2026-10-01','aaaaaaaa-0000-4000-8000-000000000031');
set local role authenticated;
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'space',:'tx','Teste período'),'23514','Period is closed','Entry competence protects entire transaction');
select throws_ok(format($q$select api.post_transaction(%L,jsonb_build_object('kind','expense','occurred_on','2026-10-01','competence_month','2026-11-01','description','Data fechada','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',%L,'amount_cents',-100),jsonb_build_object('ledger_account_id',%L,'amount_cents',100))))$q$,:'space',:'account_ledger',:'category_ledger'),'23514','Period is closed','Financial date protects period independently of competence');
reset role;
select throws_ok(format('update finance.ledger_entries set competence_month = %L where ledger_transaction_id = %L and competence_month is not null','2026-11-01',:'tx'),'23514','Period is closed','Cannot move old closed competence into open month');
select lives_ok(format('update finance.ledger_transactions set description = %L where id = %L','Texto corrigido',:'tx'),'Nonfinancial description remains editable');
select throws_ok(format('delete from finance.ledger_transactions where id = %L',:'tx'),'23514','Cancel transactions instead of deleting','Deletion blocked even for privileged callers');
set local role authenticated;
select is((select status from finance.ledger_transactions where id = :'tx'),'posted','Rejected mutations preserve original fact');
set constraints all immediate;
select * from finish();
rollback;
