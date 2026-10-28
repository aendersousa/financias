begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(21);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000231','operation-receipts@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000231","role":"authenticated"}',true);
select api.create_personal_space('Operation receipts') as space \gset
select (now() at time zone 'America/Sao_Paulo')::date::text as today \gset
select api.create_financial_account(:'space','Bank','checking',300000,:'today') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_category(:'space','Shopping','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id = :'category' \gset
select api.create_loan(:'space','Loan','loan',10000,:'today') as loan \gset
select api.loan_movement(:'space',:'loan',:'bank',:'today','pay',1000,100,'11111111-aaaa-4111-8111-111111111231') as payment \gset
select is((select operation_receipt->>'operation' from finance.ledger_transactions where id = :'payment'),'loan_payment','Loan service stores immutable operation identity');
select api.annotate_transaction(:'space',:'payment',1,'{"notes":"Paid by transfer","description":"Annotated loan payment"}');
select is(api.loan_movement(:'space',:'loan',:'bank',:'today','pay',1000,100,'11111111-aaaa-4111-8111-111111111231'),:'payment'::uuid,'Loan retry succeeds after editing notes');
select throws_ok(format('select api.loan_movement(%L,%L,%L,%L,%L,1001,100,%L)',:'space',:'loan',:'bank',:'today','pay','11111111-aaaa-4111-8111-111111111231'),'23505','Client UUID reused with different operation','Changed loan request still conflicts after annotation');

select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',date_trunc('month',:'today'::date)::date,'description','Expense','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',3000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-3000)))) as expense \gset
select api.refund_transaction(:'space',:'expense',1000,:'today',:'bank',null,'11111111-aaaa-4111-8111-111111111232') as refund \gset
select api.annotate_transaction(:'space',:'refund',1,'{"notes":"Merchant returned funds"}');
select is(api.refund_transaction(:'space',:'expense',1000,:'today',:'bank',null,'11111111-aaaa-4111-8111-111111111232'),:'refund'::uuid,'Refund retry succeeds after editing notes');
select throws_ok(format('select api.refund_transaction(%L,%L,1001,%L,%L,null,%L)',:'space',:'expense',:'today',:'bank','11111111-aaaa-4111-8111-111111111232'),'23505','Client UUID reused with different refund','Changed refund request still conflicts');

select api.create_commitment(:'space',jsonb_build_object('direction','outflow','certainty','confirmed','title','Utility','category_id',:'category','amount_cents',5000,'due_on',:'today','payment_method','account','payment_financial_account_id',:'bank')) as commitment \gset
select api.settle_commitment(:'space',:'commitment',5000,:'today','partial',null,'11111111-aaaa-4111-8111-111111111233') as settlement \gset
select api.annotate_transaction(:'space',:'settlement',1,'{"notes":"Invoice settled"}');
select is(api.settle_commitment(:'space',:'commitment',5000,:'today','partial',null,'11111111-aaaa-4111-8111-111111111233'),:'settlement'::uuid,'Commitment retry succeeds after editing notes');
select throws_ok(format('select api.settle_commitment(%L,%L,5000,%L,%L,null,%L)',:'space',:'commitment',:'today','automatic','11111111-aaaa-4111-8111-111111111233'),'23505','Client UUID reused with different settlement','Changed settlement mode still conflicts');

select api.create_credit_card(:'space','Card',100000,1,15,:'bank') as card \gset
select api.record_card_purchase(:'space',:'card',:'category',10000,1,:'today','Purchase') as purchase \gset
select api.pay_card(:'space',:'card',:'bank_ledger',2000,:'today','pix','11111111-aaaa-4111-8111-111111111234') as card_payment \gset
select api.annotate_transaction(:'space',:'card_payment',1,'{"notes":"Pix receipt saved"}');
select is(api.pay_card(:'space',:'card',:'bank_ledger',2000,:'today','pix','11111111-aaaa-4111-8111-111111111234'),:'card_payment'::uuid,'Card payment retry succeeds after editing notes');
select throws_ok(format('select api.pay_card(%L,%L,%L,2000,%L,%L,%L)',:'space',:'card',:'bank_ledger',:'today','boleto','11111111-aaaa-4111-8111-111111111234'),'23505','Client UUID reused with different payment','Changed payment channel still conflicts');

select api.create_financial_account(:'space','Investment','investment',10000,:'today') as investment \gset
select api.redeem_investment(:'space',:'investment',:'bank',:'today',2000,0,8000,'11111111-aaaa-4111-8111-111111111235') as redemption \gset
select api.annotate_transaction(:'space',:'redemption',1,'{"notes":"Partial redemption"}');
select is(api.redeem_investment(:'space',:'investment',:'bank',:'today',2000,0,8000,'11111111-aaaa-4111-8111-111111111235'),:'redemption'::uuid,'Investment retry succeeds after editing notes');
select is((select count(*) from finance.ledger_transactions where financial_space_id = :'space' and client_uuid is not null),5::bigint,'Annotated retries create no duplicate transactions');
select is((select -balance_cents from finance.account_balances where id = (select ledger_account_id from finance.loans where id = :'loan')),9000::bigint,'Annotated loan retry amortizes only once');
select is((select balance_cents from finance.account_balances where id = (select ledger_account_id from finance.financial_accounts where id = :'investment')),8000::bigint,'Annotated redemption retry withdraws only once');
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space',jsonb_build_object('operation_receipt',jsonb_build_object('operation','loan_payment','request','{}'::jsonb))),'42501','Use the dedicated financial operation','Generic posting cannot forge a service receipt');
select api.archive_financial_account(:'space',:'bank',1);
select is(api.pay_card(:'space',:'card',:'bank_ledger',2000,:'today','pix','11111111-aaaa-4111-8111-111111111234'),:'card_payment'::uuid,'Payment receipt remains replayable after its origin account is archived');

reset role;
select throws_ok(format('update finance.ledger_transactions set operation_receipt = null where id = %L',:'payment'),'23514','Operation receipt is immutable','Service receipt cannot be changed or removed');
select is(private.receipt_from_original_payload((select after_data - 'operation_receipt' from finance.audit_logs where entity_id = :'payment' and action = 'created')),(select operation_receipt from finance.ledger_transactions where id = :'payment'),'Backfill derives loan identity from original audit despite later annotation');
select is(private.receipt_from_original_payload((select after_data - 'operation_receipt' from finance.audit_logs where entity_id = :'refund' and action = 'created')),(select operation_receipt from finance.ledger_transactions where id = :'refund'),'Backfill retains refund original, date and requested default model');
select is(private.receipt_from_original_payload((select after_data - 'operation_receipt' from finance.audit_logs where entity_id = :'settlement' and action = 'created')),(select operation_receipt from finance.ledger_transactions where id = :'settlement'),'Backfill retains settlement identity from original entries');
select is(private.receipt_from_original_payload((select after_data - 'operation_receipt' from finance.audit_logs where entity_id = :'card_payment' and action = 'created')),(select operation_receipt #- '{request,card}' from finance.ledger_transactions where id = :'card_payment'),'Backfill retains card channel, origin, amount and date');
select ok((select notes = 'Paid by transfer' from finance.ledger_transactions where id = :'payment'),'Service receipt keeps user notes editable');
set constraints all immediate;
select * from finish();
rollback;
