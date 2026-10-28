begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(21);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000251','nonledger@test.local'),('aaaaaaaa-0000-4000-8000-000000000252','nonledger-other@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000251","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Nonledger request identity') as space \gset
select api.create_financial_account(:'space','Bank','checking',100000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_financial_account(:'space','Investment','investment',100000,'2000-01-01') as investment \gset
select api.create_category(:'space','Shopping','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id = :'category' \gset
select api.value_asset(:'space',:'investment','2000-01-31',100000,'11111111-aaaa-4111-8111-111111111251') as zero_value \gset
select is((select ledger_transaction_id from finance.asset_valuations where id = :'zero_value'),null::uuid,'Zero-difference valuation creates no ledger transaction');
select is(api.value_asset(:'space',:'investment','2000-01-31',100000,'11111111-aaaa-4111-8111-111111111251'),:'zero_value'::uuid,'Zero-difference valuation is idempotent');
select api.cancel_asset_valuation(:'space',:'zero_value',1,'Cancel initial position record');
select is(api.value_asset(:'space',:'investment','2000-01-31',100000,'11111111-aaaa-4111-8111-111111111251'),:'zero_value'::uuid,'Cancelled zero-difference valuation is not recreated on retry');
select throws_ok(format('select api.value_asset(%L,%L,%L,100000,%L)',:'space',:'investment','2000-02-29','11111111-aaaa-4111-8111-111111111251'),'23505','Client UUID reused with different operation','Zero-value request UUID cannot change date');
select throws_ok(format('select api.value_asset(%L,%L,%L,100001,%L)',:'space',:'investment','2000-01-31','11111111-aaaa-4111-8111-111111111251'),'23505','Client UUID reused with different operation','Zero-value request UUID cannot change amount');
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',date_trunc('month',:'today'::date)::date,'description','Conflicting expense','client_uuid','11111111-aaaa-4111-8111-111111111251','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',100),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-100)))),'23505','Client UUID reused with different operation','Generic ledger posting cannot reuse a zero-value request UUID');
select api.create_loan(:'space','Loan','loan',0,:'today') as loan \gset
select throws_ok(format('select api.loan_movement(%L,%L,%L,%L,%L,100,0,%L)',:'space',:'loan',:'bank',:'today','receive','11111111-aaaa-4111-8111-111111111251'),'23505','Client UUID reused with different operation','Dedicated ledger service cannot reuse a zero-value request UUID');

select api.create_credit_card(:'space','Card',100000,1,15,:'bank') as card \gset
select api.open_card_balance(:'space',:'card','2000-01-01',1000,:'today','Historical statement');
select id as statement from finance.card_statements where credit_card_id = :'card' and reference_month = '2000-01-01' \gset
select api.confirm_card_charges(:'space',:'statement','{"iof":0}','11111111-aaaa-4111-8111-111111111252') as zero_charges \gset
select is(:'zero_charges'::uuid,:'statement'::uuid,'Zero charges finish without a ledger transaction');
select is(api.confirm_card_charges(:'space',:'statement','{"iof":0}','11111111-aaaa-4111-8111-111111111252'),:'zero_charges'::uuid,'Zero charges are idempotent');
select throws_ok(format('select api.confirm_card_charges(%L,%L,%L::jsonb,%L)',:'space',:'statement','{"iof":1}','11111111-aaaa-4111-8111-111111111252'),'23505','Client UUID reused with different operation','Zero-charge request UUID cannot change components');
select throws_ok(format('select api.confirm_card_charges(%L,%L,%L::jsonb,%L)',:'space',:'statement','{"iof":0}','11111111-aaaa-4111-8111-111111111251'),'23505','Client UUID reused with different operation','Charge service cannot reuse a valuation request UUID');
select throws_ok(format('select api.value_asset(%L,%L,%L,100000,%L)',:'space',:'investment','2000-02-29','11111111-aaaa-4111-8111-111111111252'),'23505','Client UUID reused with different operation','Valuation service cannot reuse a charge request UUID');
select throws_ok(format('select api.pay_card(%L,%L,%L,100,%L,%L,%L)',:'space',:'card',:'bank_ledger',:'today','pix','11111111-aaaa-4111-8111-111111111251'),'23505','Client UUID reused with different operation','Card payment rejects a reserved UUID before recalculating cycles');
select api.value_asset(:'space',:'investment','2000-01-31',100000,'11111111-aaaa-4111-8111-111111111253') as replacement_value \gset
select api.close_month(:'space','2000-01-01');
select is(api.value_asset(:'space',:'investment','2000-01-31',100000,'11111111-aaaa-4111-8111-111111111253'),:'replacement_value'::uuid,'Zero valuation retry returns original result after month closing');
select is(api.confirm_card_charges(:'space',:'statement','{"iof":0}','11111111-aaaa-4111-8111-111111111252'),:'zero_charges'::uuid,'Zero charge retry returns original result after month closing');

select api.value_asset(:'space',:'investment','2000-02-29',110000,'11111111-aaaa-4111-8111-111111111254') as increased_value \gset
select ledger_transaction_id as increased_tx from finance.asset_valuations where id = :'increased_value' \gset
select api.annotate_transaction(:'space',:'increased_tx',1,'{"notes":"Position statement saved"}');
select is(api.value_asset(:'space',:'investment','2000-02-29',110000,'11111111-aaaa-4111-8111-111111111254'),:'increased_value'::uuid,'The wrapper also preserves nonzero valuation retries after annotation');
select is((select count(*) from finance.operation_requests where financial_space_id = :'space'),4::bigint,'One permanent request result is stored for each successful UUID');
reset role;
select throws_ok(format('update finance.operation_requests set request = %L::jsonb where financial_space_id = %L and client_uuid = %L','{}',:'space','11111111-aaaa-4111-8111-111111111251'),'23514','Operation request is immutable','Request arguments cannot be replaced');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000252","role":"authenticated"}',true);
select is((select count(*) from finance.operation_requests where financial_space_id = :'space'),0::bigint,'Other users cannot read request identity or financial parameters');
select throws_ok(format('select api.value_asset(%L,%L,%L,100000,%L)',:'space',:'investment','2000-01-31','11111111-aaaa-4111-8111-111111111251'),'42501','No permission to write to financial space','Request replay still requires write access');
select api.create_personal_space('Other space') as other_space \gset
select api.create_financial_account(:'other_space','Other investment','investment',0,:'today') as other_investment \gset
select lives_ok(format('select api.value_asset(%L,%L,%L,0,%L)',:'other_space',:'other_investment',:'today','11111111-aaaa-4111-8111-111111111251'),'The same UUID remains independent in another financial space');
set constraints all immediate;
select * from finish();
rollback;
