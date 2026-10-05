begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(11);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000121','agenda-a@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000121","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Teste Agenda') as space \gset
select api.create_financial_account(:'space','Banco','checking',100000,:'today') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_category(:'space','Energia','expense') as category \gset
select api.create_commitment(:'space',jsonb_build_object('title','Energia','direction','outflow','certainty','confirmed','amount_cents',10000,'due_on','2026-10-10','category_id',:'category','payment_method','account','payment_financial_account_id',:'bank')) as bill \gset
select is((select effective_due_on from finance.commitment_settlements where id = :'bill'),'2026-10-13'::date,'Agenda uses banking due date');
select is((select balance_cents from finance.account_balances where id = :'bank_ledger'),100000::bigint,'INV-AGENDA-005 creating commitment does not alter balance');
select api.settle_commitment(:'space',:'bill',4000,:'today') as partial \gset
select is((select settlement_status from finance.commitment_settlements where id = :'bill'),'partial','Partial settlement is derived from entries');
select is((select remaining_cents from finance.commitment_settlements where id = :'bill'),6000::bigint,'Remaining value is derived');
select throws_ok(format('select api.settle_commitment(%L,%L,6001,%L)',:'space',:'bill',:'today'),'23514','Payment exceeds remaining commitment','INV-AGENDA-002 overpayment rejected');
select api.cancel_transaction(:'space',:'partial',1,'Pagamento devolvido');
select is((select settlement_status from finance.commitment_settlements where id = :'bill'),'pending','Cancelling payment reopens commitment automatically');
select is((select balance_cents from finance.account_balances where id = :'bank_ledger'),100000::bigint,'Cancellation restores cash balance');
select api.create_commitment(:'space',jsonb_build_object('title','Energia estimada','direction','outflow','certainty','estimated','amount_cents',22000,'due_on',:'today','category_id',:'category','payment_method','account','payment_financial_account_id',:'bank')) as estimated \gset
select api.settle_commitment(:'space',:'estimated',21783,:'today','automatic') as actual \gset
select is((select due_amount_cents from finance.commitment_settlements where id = :'estimated'),21783::bigint,'CT-AGENDA-003 actual estimated bill amount replaces estimate');
select is((select settlement_status from finance.commitment_settlements where id = :'estimated'),'settled','CT-AGENDA-003 tolerance settles estimated commitment');
select throws_ok(format($q$select api.create_commitment(%L,jsonb_build_object('title','Inválida','direction','outflow','certainty','conditional','amount_cents',1,'due_on',%L,'payment_method','account','payment_financial_account_id',%L))$q$,:'space',:'today',:'bank'),'23514',null,'D-030 conditional certainty is only for inflows');
select is((select count(*) from finance.ledger_entries where ledger_transaction_id = :'actual' and commitment_id = :'estimated'),1::bigint,'Settlement link exists only on counterpart entry');
set constraints all immediate;
select * from finish();
rollback;
