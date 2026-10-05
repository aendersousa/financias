begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(10);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000101','refunds-a@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000101","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Teste estornos') as space \gset
select api.create_financial_account(:'space','Banco','checking',100000,:'today') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_category(:'space','Eletrônicos','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id = :'category' \gset
select api.create_credit_card(:'space','Cartão A',500000,1,10) as card \gset
select ledger_account_id as card_ledger from finance.credit_cards where id = :'card' \gset
select api.record_card_purchase(:'space',:'card',:'category',120000,12,:'today','TV') as purchase \gset
select api.refund_transaction(:'space',:'purchase',30000,:'today',null,'cancel_remaining','11111111-1111-4111-8111-111111111101') as partial_refund \gset
select is((select balance_cents from finance.account_balances where id = :'category_ledger'),90000::bigint,'Partial refund reduces consumption by credit amount');
select is((select balance_cents from finance.account_balances where id = :'card_ledger'),-90000::bigint,'Partial refund reduces debt by same amount');
select is((select amount_cents from finance.statement_amounts where credit_card_id = :'card' and status = 'open'),7500::bigint,'Proportional refund reduces each installment to 75');
select is(api.refund_transaction(:'space',:'purchase',30000,:'today',null,'cancel_remaining','11111111-1111-4111-8111-111111111101'),:'partial_refund'::uuid,'Refund replay is idempotent');
select throws_ok(format('select api.refund_transaction(%L,%L,90001,%L)',:'space',:'purchase',:'today'),'23514','Refund exceeds remaining consumption','Cannot refund more than remaining original consumption');
select api.refund_transaction(:'space',:'purchase',90000,:'today') as final_refund \gset
select is((select balance_cents from finance.account_balances where id = :'category_ledger'),0::bigint,'INV-CARD-007 full refund neutralizes consumption');
select is((select balance_cents from finance.account_balances where id = :'card_ledger'),0::bigint,'INV-CARD-007 full refund neutralizes debt');
select is((select count(*) from finance.statement_amounts where credit_card_id = :'card' and remaining_cents <> 0),0::bigint,'Cancellation model neutralizes all installments');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',date_trunc('month',:'today'::date)::date,'description','À vista','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-10000),jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',10000)))) as cash_purchase \gset
select api.refund_transaction(:'space',:'cash_purchase',5000,:'today',:'bank') as cash_refund \gset
select is((select balance_cents from finance.account_balances where id = :'bank_ledger'),95000::bigint,'Cash refund returns money to selected account');
select is((select count(*) from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id where e.ledger_transaction_id = :'cash_refund' and a.account_class = 'income'),0::bigint,'Cash refund is never income');
set constraints all immediate;
select * from finish();
rollback;
