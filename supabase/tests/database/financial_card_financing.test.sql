begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(19);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000181','financing@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000181","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select date_trunc('month',:'today'::date)::date as month \gset
select api.create_personal_space('Teste financiamento') as space \gset
select api.create_financial_account(:'space','Banco','checking',500000,:'today') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_category(:'space','Eletrônicos','expense') as category \gset
select api.create_credit_card(:'space','Cartão contrato',500000,1,10,:'bank') as card \gset
select api.open_card_balance(:'space',:'card',:'month',300000,:'today','Fatura em andamento');
select id as statement from finance.card_statements where credit_card_id = :'card' and reference_month = :'month' \gset
select api.pay_card(:'space',:'card',:'bank_ledger',50000,:'today') as payment \gset
select api.install_card_statement(:'space',:'statement',:'today',312000,6,null,null,'dddddddd-1111-4111-8111-111111111181') as plan_tx \gset
select is((select remaining_cents from finance.statement_amounts where id = :'statement'),0::bigint,'CT-CARD-004 plan settles source statement after down payment');
select is((select -balance_cents from finance.card_limits where id = :'card'),312000::bigint,'CT-CARD-004 total debt is six installments of 520');
select is((select sum(e.amount_cents) from finance.posted_ledger_entries e join finance.categories c on c.ledger_account_id = e.ledger_account_id where c.system_role = 'financial_charges'),62000::numeric,'CT-CARD-004 only financing charges become expense');
select is(api.install_card_statement(:'space',:'statement',:'today',312000,6,null,null,'dddddddd-1111-4111-8111-111111111181'),:'plan_tx'::uuid,'Plan replay does not duplicate debt');
select api.cancel_transaction(:'space',:'plan_tx',1,'Banco desfez o acordo');
select is((select remaining_cents from finance.statement_amounts where id = :'statement'),250000::bigint,'Cancelling plan restores source debt');
select api.install_card_statement(:'space',:'statement',:'today',312000,6,null,:'plan_tx') as replacement \gset
select is((select related_transaction_id from finance.ledger_transactions where id = :'replacement'),:'plan_tx'::uuid,'Replacement plan links to cancelled predecessor');
select api.create_credit_card(:'space','Cartão encargos',500000,1,10,:'bank') as charge_card \gset
select api.open_card_balance(:'space',:'charge_card',:'month',230000,:'today','Saldo anterior');
select id as charge_statement from finance.card_statements where credit_card_id = :'charge_card' and reference_month = :'month' \gset
select api.confirm_card_charges(:'space',:'charge_statement','{"revolving_interest":15400,"late_fee":2800,"late_interest":1400,"iof":876}','eeeeeeee-1111-4111-8111-111111111181') as charges \gset
select is((select -balance_cents from finance.card_limits where id = :'charge_card'),250476::bigint,'CT-CARD-003 bank-confirmed charges increase debt by 204.76');
select is((select count(*) from finance.ledger_entries where ledger_transaction_id = :'charges'),5::bigint,'Confirmed charge components remain separate entries');
select is((select charges_to_confirm from finance.card_statements where id = :'charge_statement'),false,'Confirmed charges remove pending flag');
select is(api.confirm_card_charges(:'space',:'charge_statement','{"revolving_interest":15400,"late_fee":2800,"late_interest":1400,"iof":876}','eeeeeeee-1111-4111-8111-111111111181'),:'charges'::uuid,'Charge confirmation replay is idempotent');
select api.create_credit_card(:'space','Cartão antecipação',500000,1,10,:'bank') as prepaid_card \gset
select api.record_card_purchase(:'space',:'prepaid_card',:'category',100000,10,:'today','Compra sem juros') as purchase \gset
select api.prepay_card_installments(:'space',:'purchase',array[5,6,7,8,9,10],8000,:'today','ffffffff-1111-4111-8111-111111111181') as prepaid \gset
select is((select -balance_cents from finance.card_limits where id = :'prepaid_card'),92000::bigint,'CT-CARD-006 prepayment reduces debt only by discount');
select is((select amount_cents from finance.statement_amounts where credit_card_id = :'prepaid_card' and status = 'open'),62000::bigint,'CT-CARD-006 selected installments move to open statement');
select is((select sum(e.amount_cents) from finance.posted_ledger_entries e where e.ledger_transaction_id = :'purchase' and e.card_statement_id is null),100000::numeric,'CT-CARD-006 prepayment leaves original consumption unchanged');
select is((select -sum(e.amount_cents) from finance.posted_ledger_entries e join finance.categories c on c.ledger_account_id = e.ledger_account_id where c.system_role = 'discounts_obtained'),8000::numeric,'CT-CARD-006 interest-free discount becomes separate income');
select is(api.prepay_card_installments(:'space',:'purchase',array[5,6,7,8,9,10],8000,:'today','ffffffff-1111-4111-8111-111111111181'),:'prepaid'::uuid,'Prepayment replay does not move installments twice');
select throws_ok(format('select api.prepay_card_installments(%L,%L,array[5],0,%L)',:'space',:'purchase',:'today'),'23514','Installment already refunded or prepaid','Already prepaid installment cannot be prepaid again');
select throws_ok(format('select api.prepay_card_installments(%L,%L,array[1],0,%L)',:'space',:'purchase',:'today'),'23514','Only future installments can be prepaid','Open installment cannot be prepaid');
select api.refund_transaction(:'space',:'purchase',10000,:'today',null,'cancel_remaining') as refunded_after_prepayment \gset
select is((select count(*) from finance.statement_amounts where credit_card_id = :'prepaid_card' and status = 'future' and remaining_cents < 0),0::bigint,'Refund does not credit already prepaid future installments again');
select is((select -balance_cents from finance.card_limits where id = :'prepaid_card'),82000::bigint,'Refund after prepayment reduces debt by refund amount exactly');
set constraints all immediate;
select * from finish();
rollback;
