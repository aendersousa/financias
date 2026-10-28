begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(32);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000241','asset-integrity@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000241","role":"authenticated"}',true);
select api.create_personal_space('Asset integrity') as space \gset
select api.create_financial_account(:'space','Bank','checking',0,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_financial_account(:'space','Investment','investment',100000,'2000-01-01') as investment \gset
select ledger_account_id as investment_ledger from finance.financial_accounts where id = :'investment' \gset
select api.value_asset(:'space',:'investment','2000-01-31',110000,'11111111-aaaa-4111-8111-111111111241') as first_valuation \gset
select ledger_transaction_id as first_transaction from finance.asset_valuations where id = :'first_valuation' \gset
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'space',:'first_transaction','Cancel erroneous valuation'),'23514','Cancel the valuation through its dedicated service','Generic cancellation cannot orphan an active value record');
select throws_ok(format('select api.cancel_asset_valuation(%L,%L,1,%L)',:'space',:'first_valuation',''),'23514','Cancellation reason required','Valuation cancellation requires a reason');
select throws_ok(format('select api.cancel_asset_valuation(%L,%L,2,%L)',:'space',:'first_valuation','Cancel erroneous valuation'),'40001','Valuation changed; reload before editing','Valuation cancellation rejects a stale version');
select throws_ok(format('select api.cancel_asset_valuation(%L,%L,1,%L)',:'space',gen_random_uuid(),'Cancel erroneous valuation'),'P0002','Valuation not found','Valuation cancellation requires an existing scoped record');
select is(api.cancel_asset_valuation(:'space',:'first_valuation',1,'Cancel erroneous valuation'),:'first_valuation'::uuid,'Dedicated cancellation succeeds in an open period');
select is((select status from finance.ledger_transactions where id = :'first_transaction'),'cancelled','Dedicated cancellation cancels the linked transaction');
select ok((select cancelled_at is not null and cancellation_reason = 'Cancel erroneous valuation' from finance.asset_valuations where id = :'first_valuation'),'Cancelled value record is retained with reason');
select is((select balance_cents from finance.account_balances where id = :'investment_ledger'),100000::bigint,'Cancelled valuation restores the previous position');
select is(jsonb_array_length(api.preview_month_closing(:'space','2000-01-01')->'warnings'),1,'Cancelled valuation no longer satisfies closing completeness');
select is(jsonb_array_length(api.portfolio_summary(:'space')->'valuations'),0,'Portfolio active value list excludes cancelled records');
select api.value_asset(:'space',:'investment','2000-01-31',120000,'11111111-aaaa-4111-8111-111111111242') as replacement \gset
select isnt(:'replacement'::uuid,:'first_valuation'::uuid,'Replacement valuation creates a new historical record on the same date');
select is((select balance_cents from finance.account_balances where id = :'investment_ledger'),120000::bigint,'Replacement value uses the restored ledger balance');
select is((select count(*) from finance.asset_valuations where financial_account_id = :'investment' and valued_on = '2000-01-31' and cancelled_at is null),1::bigint,'Only one active value is allowed for an account and date');
select is((select count(*) from finance.audit_logs where entity_id = :'first_valuation' and action = 'cancelled'),1::bigint,'Valuation cancellation has its own audit record');
select is(api.value_asset(:'space',:'investment','2000-01-31',110000,'11111111-aaaa-4111-8111-111111111241'),:'first_valuation'::uuid,'Retrying a cancelled valuation request returns its original record');
select api.close_month(:'space','2000-01-01');
select throws_ok(format('select api.cancel_asset_valuation(%L,%L,1,%L)',:'space',:'replacement','Cancel after closing'),'23514','Period is closed','Closed period prevents valuation cancellation');

select api.value_asset(:'space',:'investment','2000-02-29',120000) as unchanged \gset
select is((select ledger_transaction_id from finance.asset_valuations where id = :'unchanged'),null::uuid,'Unchanged value is recorded without a ledger transaction');
select lives_ok(format('select api.cancel_asset_valuation(%L,%L,1,%L)',:'space',:'unchanged','Cancel unchanged position'),'An unchanged position can be cancelled without a ledger transaction');
select api.value_asset(:'space',:'investment','2000-02-29',120000) as replacement_unchanged \gset
select isnt(:'replacement_unchanged'::uuid,:'unchanged'::uuid,'Cancelled zero-difference value can be replaced on the same date');

select api.redeem_investment(:'space',:'investment',:'bank','2000-03-01',10000,0,130000,'11111111-aaaa-4111-8111-111111111243') as redemption \gset
select is((select balance_cents from finance.account_balances where id = :'investment_ledger'),130000::bigint,'Partial redemption accepts a greater informed remaining position');
select is((select balance_cents from finance.account_balances where id = :'bank_ledger'),10000::bigint,'Partial redemption credits the gross withdrawn amount');
select is((select sum(e.amount_cents) from finance.ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id where e.ledger_transaction_id = :'redemption' and a.system_role = 'investment_result'),-20000::numeric,'Partial redemption recognizes the simultaneous appreciation only as investment result');
select is((select count(*) from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id where e.financial_space_id = :'space' and a.account_class = 'income'),0::bigint,'Partial redemption appreciation does not become income');
select throws_ok(format('select api.redeem_investment(%L,%L,%L,%L,100,0,-1)',:'space',:'investment',:'bank','2000-03-02'),'23514','Invalid remaining investment position','A negative informed position is rejected');
select throws_ok(format('select api.redeem_investment(%L,%L,%L,%L,100,0,9007199254740992)',:'space',:'investment',:'bank','2000-03-02'),'23514','Invalid remaining investment position','An unsafe informed position is rejected');

select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space','{"kind":"investment_result"}'),'42501','Use the dedicated financial operation','Investment result cannot bypass the valuation service');
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space','{"kind":"investment_redemption"}'),'42501','Use the dedicated financial operation','Investment redemption cannot bypass the service');
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space','{"kind":"loan_disbursement"}'),'42501','Use the dedicated financial operation','Loan disbursement cannot bypass the service');
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space','{"kind":"loan_payment"}'),'42501','Use the dedicated financial operation','Loan amortization cannot bypass the service');
select api.create_loan(:'space','Loan','loan',5000,'2000-03-01') as loan \gset
select ledger_account_id as loan_ledger from finance.loans where id = :'loan' \gset
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space',jsonb_build_object('kind','expense','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'loan_ledger','amount_cents',6000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-6000)))),'42501','Use the dedicated financial operation','Another kind cannot disguise excessive loan amortization');
select api.loan_movement(:'space',:'loan',:'bank','2000-03-02','pay',1000,0) as loan_payment \gset
select throws_ok(format('select api.edit_transaction(%L,%L,1,%L::jsonb,%L)',:'space',:'loan_payment','{}','Increase amortization above debt'),'23514','Operation must be corrected through its dedicated service','Generic editing cannot bypass loan principal checks');
select id as result_ledger from finance.ledger_accounts where financial_space_id = :'space' and system_role = 'investment_result' \gset
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space',jsonb_build_object('kind','expense','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'result_ledger','amount_cents',-100),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',100)))),'42501','Use the dedicated financial operation','Another kind cannot post manually to investment result');
set constraints all immediate;
select * from finish();
rollback;
