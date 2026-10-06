begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000352','fx-adjust-owner@test.local'),('aaaaaaaa-0000-4000-8000-000000000353','fx-adjust-member@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000352","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Ajustes cambiais') as space \gset
select api.create_financial_account(:'space','Banco','checking',10000000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Exterior','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id=:'category' \gset
select api.create_credit_card(:'space','Parcelado',1000000,28,5,:'bank') as installment_card \gset
select jsonb_build_object('currency','USD','original_amount','10','rate','1','on',:'today','category_id',:'category','card_id',:'installment_card','installments',3,'description','Parcelas em dólar') as installment_payload \gset
select api.record_foreign_purchase(:'space',:'installment_payload') as purchase \gset
select ledger_transaction_id as transaction_id from finance.foreign_currency_purchases where id=:'purchase' \gset
select is((select array_agg(-amount_cents order by installment_number)::text from finance.ledger_entries where ledger_transaction_id=:'transaction_id' and card_statement_id is not null),'{334,333,333}','Purchase distributes the initial BRL cent deterministically across installments');
select card_statement_id as first_statement from finance.ledger_entries where ledger_transaction_id=:'transaction_id' and installment_number=1 \gset
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=334 where id=:'first_statement';
set local role authenticated;
select api.confirm_foreign_purchase(:'space',:'purchase',1,1002,:'today');
select confirmation_transaction_id as correction from finance.foreign_currency_purchases where id=:'purchase' \gset
select is((select array_agg(-amount_cents order by installment_number)::text from finance.ledger_entries where ledger_transaction_id=:'transaction_id' and card_statement_id is not null),'{334,333,333}','One closed installment protects the entire original transaction');
select is((select count(*) from finance.ledger_entries where ledger_transaction_id=:'correction' and card_statement_id is not null),2::bigint,'New equal installments minus old installments correct each future statement by one cent');
select is((select sum(-amount_cents)::bigint from finance.ledger_entries where ledger_transaction_id=:'correction' and card_statement_id is not null),2::bigint,'Installment differences add up to the exact confirmed total');
select is((select coalesce(sum(amount_cents),0)::bigint from finance.ledger_entries where ledger_transaction_id=:'correction' and card_statement_id=:'first_statement'),0::bigint,'An unchanged original installment receives no fabricated correction');
-- Paid closed statement routes new differences and IOF to a new open cycle.
select api.create_credit_card(:'space','Quitado',1000000,28,5,:'bank') as paid_card \gset
select ledger_account_id as paid_card_ledger from finance.credit_cards where id=:'paid_card' \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','100','rate','5.4','on',:'today','category_id',:'category','card_id',:'paid_card','description','Compra já quitada')) as paid_purchase \gset
select ledger_transaction_id as paid_transaction from finance.foreign_currency_purchases where id=:'paid_purchase' \gset
select card_statement_id as paid_statement from finance.ledger_entries where ledger_transaction_id=:'paid_transaction' and card_statement_id is not null \gset
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=54000,period_start=(:'today')::date-20,period_end=(:'today')::date-2,closing_on=(:'today')::date-1,due_on=(:'today')::date+4,effective_due_on=(:'today')::date+4 where id=:'paid_statement';
set local role authenticated;
select api.pay_card(:'space',:'paid_card',:'bank_ledger',54000,:'today');
select api.confirm_foreign_purchase(:'space',:'paid_purchase',1,55200,:'today',1932);
select confirmation_transaction_id as paid_correction,iof_transaction_id as paid_iof from finance.foreign_currency_purchases where id=:'paid_purchase' \gset
select isnt((select card_statement_id from finance.ledger_entries where ledger_transaction_id=:'paid_correction' and card_statement_id is not null),:'paid_statement'::uuid,'Paid original statement never receives the new debt');
select is((select remaining_cents from finance.statement_amounts where id=:'paid_statement'),0::bigint,'Closed statement remains completely settled after FX confirmation');
select is((select card_statement_id from finance.ledger_entries where ledger_transaction_id=:'paid_iof' and card_statement_id is not null),(select card_statement_id from finance.ledger_entries where ledger_transaction_id=:'paid_correction' and card_statement_id is not null),'IOF and paid-statement FX difference choose the same available cycle');
-- The bank due date, rather than a mutable rate, determines correction destination.
select api.create_credit_card(:'space','Vencido',1000000,28,5,:'bank') as overdue_card \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','EUR','original_amount','100','rate','5.4','on',:'today','category_id',:'category','card_id',:'overdue_card','description','Fatura com prazo encerrado')) as overdue_purchase \gset
select ledger_transaction_id as overdue_transaction from finance.foreign_currency_purchases where id=:'overdue_purchase' \gset
select card_statement_id as overdue_statement from finance.ledger_entries where ledger_transaction_id=:'overdue_transaction' and card_statement_id is not null \gset
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=54000,period_start=(:'today')::date-5,period_end=(:'today')::date-3,closing_on=(:'today')::date-2,due_on=(:'today')::date-1,effective_due_on=(:'today')::date-1 where id=:'overdue_statement';
set local role authenticated;
select api.confirm_foreign_purchase(:'space',:'overdue_purchase',1,53000,:'today',0);
select confirmation_transaction_id as overdue_correction from finance.foreign_currency_purchases where id=:'overdue_purchase' \gset
select isnt((select card_statement_id from finance.ledger_entries where ledger_transaction_id=:'overdue_correction' and card_statement_id is not null),:'overdue_statement'::uuid,'After bank due date even a negative FX difference goes to the available open cycle');
select is((select sum(amount_cents)::bigint from finance.ledger_entries where ledger_transaction_id=:'overdue_correction' and ledger_account_id=:'category_ledger'),-1000::bigint,'Final BRL decrease posts a signed exact correction');
-- Validation, manual choice and cancelled-source protections.
select throws_ok(format('select api.record_foreign_purchase(%L,%L)',:'space',jsonb_build_object('currency','USD','original_amount','10','on',:'today','category_id',:'category','account_id',:'bank','description','Sem escolha')),'23514','Inform the exchange rate or the BRL total','An automatically suggested rate must be explicitly accepted before posting');
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','JPY','original_amount','100','brl_cents',321,'on',:'today','category_id',:'category','account_id',:'bank','description','Total em reais confirmado','confirmed',true)) as known_purchase \gset
select is((select exchange_rate from finance.foreign_currency_purchases where id=:'known_purchase'),0.0321::numeric,'Manual final BRL total derives its own decimal rate');
select is((select conversion_status from finance.foreign_currency_purchases where id=:'known_purchase'),'confirmed','A known final BRL total can start confirmed');
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','1','rate','5','on',:'today','category_id',:'category','account_id',:'bank','description','Compra a cancelar')) as cancel_purchase \gset
select ledger_transaction_id as cancel_transaction from finance.foreign_currency_purchases where id=:'cancel_purchase' \gset
select version as cancel_version from finance.ledger_transactions where id=:'cancel_transaction' \gset
select api.cancel_transaction(:'space',:'cancel_transaction',:'cancel_version','Compra cancelada pelo usuário');
select throws_ok(format('select api.confirm_foreign_purchase(%L,%L,1,500,%L)',:'space',:'cancel_purchase',:'today'),'23514','Original purchase unavailable','Cancelled source cannot generate new confirmation debt');
select throws_ok(format('select api.quote_foreign_currency(%L,''USD'',1,''NaN'')',:'space'),'23514','Positive decimal exchange rate with at most ten decimals required','NaN never enters monetary calculations');
select throws_ok(format('select api.set_foreign_iof_percent(%L,1,''Infinity'')',:'space'),'23514','IOF suggestion must be between zero and one hundred with four decimals','Non-finite IOF setting is rejected');
select throws_ok(format('select api.confirm_foreign_purchase(%L,%L,1,0,%L)',:'space',:'cancel_purchase',:'today'),'23514','Invalid BRL total','Final conversion must remain positive');
-- Per-member preferences and revoked memberships apply to N21 generation.
select api.create_credit_card(:'space','Aviso pendente',1000000,28,5,:'bank') as notice_card \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','10','rate','5','on',:'today','category_id',:'category','card_id',:'notice_card','description','Conversão pendente')) as notice_purchase \gset
select ledger_transaction_id as notice_transaction from finance.foreign_currency_purchases where id=:'notice_purchase' \gset
select card_statement_id as notice_statement from finance.ledger_entries where ledger_transaction_id=:'notice_transaction' and card_statement_id is not null \gset
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000353","role":"authenticated"}',true);
select api.create_personal_space('Outro espaço cambial') as other_space \gset
select is(api.quote_foreign_currency(:'other_space','USD',10)->>'rate',null::text,'Historical exchange-rate suggestions never leak from another space');
select api.update_user_settings(1,'{"notification_preferences":{"foreign_conversion_pending":false}}');
reset role;
insert into finance.financial_space_members(financial_space_id,user_id,role,status) values(:'space','aaaaaaaa-0000-4000-8000-000000000353','member','active');
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=5000 where id=:'notice_statement';
select private.refresh_space_notifications(:'space');
set local role authenticated;
select is((select count(*) from finance.notifications where financial_space_id=:'space' and type='foreign_conversion_pending'),0::bigint,'Member can disable N21 without suppressing notifications for other members');
select is((select count(*) from finance.foreign_currency_purchases where financial_space_id=:'space'),6::bigint,'A member may read the space FX metadata through RLS');
select throws_ok(format('select api.set_foreign_iof_percent(%L,1,4)',:'space'),'42501','Administrator permission required','Only owner/admin configure suggested IOF');
reset role;
update finance.financial_space_members set role='viewer' where financial_space_id=:'space' and user_id='aaaaaaaa-0000-4000-8000-000000000353';
set local role authenticated;
select throws_ok(format('select api.confirm_foreign_purchase(%L,%L,1,5000,%L)',:'space',:'notice_purchase',:'today'),'42501','No permission to write to financial space','Viewer cannot confirm a conversion');
select lives_ok(format('select api.foreign_currency_summary(%L)',:'space'),'Viewer may read foreign purchases');
reset role;
update finance.financial_space_members set status='left' where financial_space_id=:'space' and user_id='aaaaaaaa-0000-4000-8000-000000000353';
select private.refresh_space_notifications(:'space');
set local role authenticated;
select is((select count(*) from finance.foreign_currency_purchases where financial_space_id=:'space'),0::bigint,'Leaving a shared space immediately revokes FX metadata access');
select throws_ok(format('select api.daily_alerts(%L)',:'space'),'42501','Space access denied','A stale notification callback cannot access a revoked space');
set constraints all immediate;
select * from finish();
rollback;


