begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000350','fx-owner@test.local'),('aaaaaaaa-0000-4000-8000-000000000351','fx-outsider@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000350","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Conversões') as space \gset
select api.create_financial_account(:'space','Banco','checking',10000000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Viagem','expense') as category \gset
select ledger_account_id as expense_ledger from finance.categories where id=:'category' \gset
select api.create_category(:'space','Compras','expense') as second_category \gset
select ledger_account_id as second_ledger from finance.categories where id=:'second_category' \gset
select api.create_credit_card(:'space','Internacional',1000000,28,5,:'bank') as card \gset
select ledger_account_id as card_ledger from finance.credit_cards where id=:'card' \gset
select is(api.quote_foreign_currency(:'space','USD',100,5.40)->>'total_cents','54000','CT-FX-001 numeric USD conversion is exact integer BRL cents');
select is(api.quote_foreign_currency(:'space','USD',0.01,0.5)->>'total_cents','1','Commercial half-cent rounds away from zero');
select is(api.quote_foreign_currency(:'space','JPY',100,0.03)->>'original_minor','100','JPY uses integer yen rather than fabricated cents');
select is(api.quote_foreign_currency(:'space','KWD',1.001,20)->>'original_minor','1001','KWD accepts three minor-unit decimals');
select throws_ok(format('select api.quote_foreign_currency(%L,''JPY'',100.5,1)',:'space'),'23514','Original amount has invalid currency minor units','Fractional JPY is rejected');
select throws_ok(format('select api.quote_foreign_currency(%L,''USD'',100,5.12345678901)',:'space'),'23514','Positive decimal exchange rate with at most ten decimals required','Rates never silently round excess precision');
select throws_ok(format('select api.quote_foreign_currency(%L,''BRL'',100,1)',:'space'),'23514','Valid foreign currency and positive original amount required','BRL is the immutable base currency');
select is(api.quote_foreign_currency(:'space','EUR',10)->>'total_cents',null::text,'No historical rate means unavailable instead of a zero conversion');
select api.set_foreign_iof_percent(:'space',1,3.5) as settings \gset
select is(api.quote_foreign_currency(:'space','USD',100,5.4)->>'iof_suggestion_cents','1890','Configured IOF is only a numeric suggestion');
select jsonb_build_object('currency','USD','original_amount','100','rate','5.40','on',:'today','category_id',:'category','card_id',:'card','description','Compra internacional') as payload \gset
select api.record_foreign_purchase(:'space',:'payload','11111111-aaaa-4350-8350-111111111350') as purchase \gset
select ledger_transaction_id as transaction_id from finance.foreign_currency_purchases where id=:'purchase' \gset
select is(api.record_foreign_purchase(:'space',:'payload','11111111-aaaa-4350-8350-111111111350'),:'purchase'::uuid,'Foreign creation is idempotent before and after confirmation');
select is((select conversion_status from finance.foreign_currency_purchases where id=:'purchase'),'estimated','Foreign purchase defaults to estimated conversion');
select is((select sum(amount_cents)::bigint from finance.ledger_entries where ledger_transaction_id=:'transaction_id' and ledger_account_id=:'card_ledger'),-54000::bigint,'Estimated purchase already affects real card debt');
select is(api.quote_foreign_currency(:'space','USD',10)->>'total_cents','5400','Last manually recorded rate may be suggested within the same space');
select ok((api.quote_foreign_currency(:'space','USD',10)->>'suggested')::boolean,'Suggested history is explicitly labelled as a suggestion');
select api.confirm_foreign_purchase(:'space',:'purchase',1,55200,:'today',1932,'invoice','22222222-aaaa-4350-8350-222222222350');
select is((select sum(amount_cents)::bigint from finance.ledger_entries where ledger_transaction_id=:'transaction_id' and ledger_account_id=:'expense_ledger'),55200::bigint,'CT-FX-001 open purchase is edited to final BRL amount');
select is((select exchange_rate::numeric from finance.foreign_currency_purchases where id=:'purchase'),5.52::numeric,'BRL confirmation derives the effective rate on the server');
select is((select sum(amount_cents)::bigint from finance.posted_ledger_entries where ledger_account_id=:'card_ledger'),-57132::bigint,'CT-FX-001 statement totals purchase plus separate IOF exactly once');
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space' and relation_type='fx_confirmation_of'),1::bigint,'Open confirmation creates only the distinct IOF transaction');
select ok((select conversion_status='confirmed' and confirmed_by=auth.uid() and confirmed_at is not null from finance.foreign_currency_purchases where id=:'purchase'),'Confirmation records actor and time');
select is(api.confirm_foreign_purchase(:'space',:'purchase',1,55200,:'today',1932,'invoice','22222222-aaaa-4350-8350-222222222350'),:'purchase'::uuid,'Confirmation retries bypass changed versions without repeating ledger writes');
select throws_ok(format('select api.reestimate_foreign_purchase(%L,%L,2,6,%L)',:'space',:'purchase',:'today'),'23514','Confirmed conversion cannot be recalculated','A new exchange rate cannot recalculate confirmed purchases');
select throws_ok(format('select api.confirm_foreign_purchase(%L,%L,1,55201,%L,1932,''invoice'',''22222222-aaaa-4350-8350-222222222350'')',:'space',:'purchase',:'today'),'23505','Client UUID reused with different operation','Repeated UUID cannot change an already confirmed amount');
select jsonb_build_object('currency','USD','original_amount','100','rate','5.4','on',:'today','category_id',:'category','card_id',:'card','description','Compra fechada') as closed_payload \gset
select api.record_foreign_purchase(:'space',:'closed_payload') as closed_purchase \gset
select ledger_transaction_id as closed_transaction from finance.foreign_currency_purchases where id=:'closed_purchase' \gset
select card_statement_id as closed_statement from finance.ledger_entries where ledger_transaction_id=:'closed_transaction' and card_statement_id is not null \gset
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=111132 where id=:'closed_statement';
select private.refresh_space_notifications(:'space');
set local role authenticated;
select is((select count(*) from finance.notifications where type='foreign_conversion_pending' and resolved_at is null),1::bigint,'N21 is emitted once per closed statement with estimated conversion');
select api.daily_alerts(:'space') is not null as refreshed \gset
select is((select count(*) from finance.notifications where type='foreign_conversion_pending'),1::bigint,'Refreshing retains the same pending FX notification');
select api.confirm_foreign_purchase(:'space',:'closed_purchase',1,55200,:'today',1932);
select is((select sum(amount_cents)::bigint from finance.ledger_entries where ledger_transaction_id=:'closed_transaction' and ledger_account_id=:'expense_ledger'),54000::bigint,'Closed original purchase remains immutable');
select confirmation_transaction_id as correction from finance.foreign_currency_purchases where id=:'closed_purchase' \gset
select is((select kind from finance.ledger_transactions where id=:'correction'),'card_correction','Closed conversion uses linked card correction');
select is((select sum(amount_cents)::bigint from finance.ledger_entries where ledger_transaction_id=:'correction' and ledger_account_id=:'expense_ledger'),1200::bigint,'Closed confirmation posts only the difference');
select is((select card_statement_id from finance.ledger_entries where ledger_transaction_id=:'correction' and card_statement_id is not null),:'closed_statement'::uuid,'Unpaid statement before due date retains its FX difference');
select api.daily_alerts(:'space') is not null as refreshed \gset
select is((select count(*) from finance.notifications where type='foreign_conversion_pending' and resolved_at is null),0::bigint,'Confirming every foreign purchase resolves N21 without deleting history');
-- A closed financial month uses the first open competence and retains its origin.
select jsonb_build_object('currency','EUR','original_amount','10','rate','5','on','2000-01-02','category_id',:'category','account_id',:'bank','description','Compra caixa antiga','iof_cents',100) as cash_payload \gset
select api.record_foreign_purchase(:'space',:'cash_payload') as cash_purchase \gset
select ledger_transaction_id as cash_transaction,iof_transaction_id as old_iof from finance.foreign_currency_purchases where id=:'cash_purchase' \gset
select api.close_month(:'space','2000-01-01');
select throws_ok(format('select api.reestimate_foreign_purchase(%L,%L,1,6,%L)',:'space',:'cash_purchase',:'today'),'23514','Closed foreign purchase requires confirmation instead of reestimation','Closed periods reject silent reestimation');
select api.confirm_foreign_purchase(:'space',:'cash_purchase',1,5200,:'today',80);
select confirmation_transaction_id as cash_correction from finance.foreign_currency_purchases where id=:'cash_purchase' \gset
select is((select sum(amount_cents)::bigint from finance.ledger_entries where ledger_transaction_id=:'cash_transaction' and ledger_account_id=:'expense_ledger'),5000::bigint,'Closed cash purchase also preserves its original amount');
select is((select competence_month from finance.ledger_transactions where id=:'cash_correction'),'2000-02-01'::date,'Closed competence moves adjustment to first open month');
select is((select original_competence_month from finance.ledger_entries where ledger_transaction_id=:'cash_correction' and ledger_account_id=:'expense_ledger'),'2000-01-01'::date,'Adjustment identifies its previous financial month');
select is((select sum(e.amount_cents)::bigint from finance.posted_ledger_entries e join finance.categories c on c.ledger_account_id=e.ledger_account_id and c.system_role='taxes_fees' where e.ledger_transaction_id=:'old_iof' or exists(select 1 from finance.ledger_transactions t where t.id=e.ledger_transaction_id and t.related_transaction_id=:'old_iof')),80::bigint,'IOF decreases through its own linked adjustment, retaining exact cents');
-- Original foreign category weights determine the BRL allocation.
select jsonb_build_object('currency','USD','original_amount','3','rate','0.335','on',:'today','account_id',:'bank','description','Rateio estrangeiro','category_parts',jsonb_build_array(jsonb_build_object('category_id',:'category','original_amount','1'),jsonb_build_object('category_id',:'second_category','original_amount','2'))) as split_payload \gset
select api.record_foreign_purchase(:'space',:'split_payload') as split_purchase \gset
select ledger_transaction_id as split_transaction from finance.foreign_currency_purchases where id=:'split_purchase' \gset
select is((select sum(amount_cents)::bigint from finance.ledger_entries where ledger_transaction_id=:'split_transaction' and ledger_account_id=:'expense_ledger'),34::bigint,'Foreign weights distribute rounded BRL with deterministic largest remainder');
select is((select sum(amount_cents)::bigint from finance.ledger_entries where ledger_transaction_id=:'split_transaction' and ledger_account_id=:'second_ledger'),67::bigint,'Foreign category allocation preserves the total');
select api.reestimate_foreign_purchase(:'space',:'split_purchase',1,0.34,:'today','33333333-aaaa-4350-8350-333333333350');
select is((select sum(amount_cents)::bigint from finance.ledger_entries where ledger_transaction_id=:'split_transaction' and ledger_account_id=:'second_ledger'),68::bigint,'Reestimation preserves original currency category weights');
select throws_ok(format('select api.confirm_foreign_purchase(%L,%L,1,102,%L)',:'space',:'split_purchase',:'today'),'40001','Foreign purchase changed; reload before editing','Optimistic versions prevent lost currency updates');
select throws_ok(format('update finance.foreign_currency_purchases set exchange_rate=7 where id=%L',:'split_purchase'),'42501',null,'Client cannot directly mutate currency metadata');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000351","role":"authenticated"}',true);
select throws_ok(format('select api.foreign_currency_summary(%L)',:'space'),'42501','Space permission required','Another tenant cannot read foreign purchases');
select is((select count(*) from finance.foreign_currency_purchases),0::bigint,'RLS scopes the purchase metadata to memberships');
select throws_ok(format('select api.confirm_foreign_purchase(%L,%L,2,100,%L)',:'space',:'split_purchase',:'today'),'42501','No permission to write to financial space','Another tenant cannot confirm foreign purchases');
select throws_ok(format('select private.adjust_foreign_purchase(%L,%L,100,%L)',:'space',:'split_transaction',:'today'),'42501',null,'Private writer cannot be called by a client');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000350","role":"authenticated"}',true);
select is((api.foreign_currency_summary(:'space')->'purchases'->0->>'original_currency') is not null,true,'Summary exposes foreign details without making a second balance source');
set constraints all immediate;
select * from finish();
rollback;
