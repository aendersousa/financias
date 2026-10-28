begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(10);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000111','cycles-a@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000111","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today, (date_trunc('month',now() at time zone 'America/Sao_Paulo')-interval '1 month')::date as previous_month \gset
select api.create_personal_space('Teste ciclos') as space \gset
select api.create_financial_account(:'space','Banco','checking',500000,:'previous_month') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_credit_card(:'space','Cartão A',500000,1,10) as card \gset
select ledger_account_id as card_ledger from finance.credit_cards where id = :'card' \gset
select api.open_card_balance(:'space',:'card',:'previous_month',200000,:'previous_month') as opening \gset
select id as previous_statement,effective_due_on as previous_due from finance.card_statements where credit_card_id = :'card' and reference_month = :'previous_month' \gset
select api.pay_card(:'space',:'card',:'bank_ledger',60000,:'previous_due') as payment \gset
select is((select remaining_cents from finance.statement_amounts where id = :'previous_statement'),0::bigint,'CT-CARD-003 old statement cleared by payment and rollover');
select is((select amount_cents from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where t.kind = 'card_rollover' and t.status = 'posted' and e.card_statement_id = :'previous_statement'),140000::bigint,'CT-CARD-003 only unpaid 1400 rolls forward');
select is((select balance_cents from finance.account_balances where id = :'card_ledger'),-140000::bigint,'INV-CARD-005 rollover preserves total debt');
select is((select count(*) from finance.ledger_transactions where kind = 'card_rollover' and status = 'posted' and created_by is not null),0::bigint,'Automatic event is attributed to system');
select api.pay_card(:'space',:'card',:'bank_ledger',40000,:'previous_due') as backdated_payment \gset
select is((select amount_cents from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where t.kind = 'card_rollover' and t.status = 'posted' and e.card_statement_id = :'previous_statement'),100000::bigint,'Backdated payment recalculates rollover');
select ok((select related_transaction_id is not null and relation_type = 'rollover_of' from finance.ledger_transactions where kind = 'card_rollover' and status = 'posted'),'Replacement rollover links to cancelled predecessor');
select throws_ok(format('select api.edit_transaction(%L,%L,1,%L::jsonb,%L)',:'space',:'opening','{"kind":"opening","occurred_on":"2000-01-01","competence_month":"2000-01-01","description":"Alterado","entries":[{},{}]}','Teste'),'23514','Transaction contains closed statement entries','Closed statement original transaction cannot be edited');
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'space',:'opening','Teste'),'23514','Transaction contains closed statement entries','Closed statement original transaction cannot be cancelled');
reset role;
select api.job_card_cycles();
select api.job_card_cycles();
set local role authenticated;
select is((select balance_cents from finance.account_balances where id = :'card_ledger'),-100000::bigint,'Repeated jobs never duplicate debt');
select is((select count(*) from finance.ledger_transactions where kind = 'card_rollover' and status = 'posted'),1::bigint,'Exactly one live rollover from original statement');
set constraints all immediate;
select * from finish();
rollback;
