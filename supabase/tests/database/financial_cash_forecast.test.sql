begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(59);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000430','forecast@test.local'),('aaaaaaaa-0000-4000-8000-000000000431','forecast-other@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000430","role":"authenticated"}',true);
select api.create_personal_space('Previsão') as space \gset
select api.create_financial_account(:'space','Banco','checking',200000,'2026-10-01') as bank \gset
select api.create_financial_account(:'space','Carteira','wallet',0,'2026-10-01') as wallet \gset
select api.create_financial_account(:'space','Benefício','benefit',90000,'2026-10-01') as benefit \gset
select api.create_category(:'space','Salário previsão','income',null,'recurring') as salary \gset
select api.create_category(:'space','Lazer previsão','expense') as expense \gset
select api.create_credit_card(:'space','Cartão B',400000,28,15,:'bank') as card \gset
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Renda principal','direction','inflow','unit','month','starts_on','2026-11-01','day_of_month',1,'is_main_income',true,'amount_cents',500000,'certainty','confirmed','business_day_adjustment','next','category_id',:'salary','payment_method','account','payment_financial_account_id',:'bank'))->>'id' as rule \gset
select api.record_card_purchase(:'space',:'card',:'expense',30000,1,'2026-10-12','Lazer no cartão') as purchase \gset
select api.create_commitment(:'space',jsonb_build_object('title','Assinatura prevista no cartão','direction','outflow','certainty','confirmed','amount_cents',20000,'due_on','2026-10-25','category_id',:'expense','payment_method','card','payment_credit_card_id',:'card')) as card_commitment \gset
select api.create_commitment(:'space',jsonb_build_object('title','VR previsto','direction','inflow','certainty','confirmed','amount_cents',90000,'due_on','2026-10-14','category_id',:'salary','payment_method','account','payment_financial_account_id',:'benefit')) as vr \gset
select api.cash_forecast(:'space','month',null,'2026-10-13') as october \gset
select is((:'october'::jsonb->>'cashBalanceCents')::bigint,200000::bigint,'Cash balance excludes benefit and card debt');
select is(:'october'::jsonb->>'until','2026-10-31','Default horizon includes the last day of the month');
select is(jsonb_array_length(:'october'::jsonb->'series'),19,'Daily series includes today and the month end');
select is((:'october'::jsonb#>>'{conservative,minimumCents}')::bigint,200000::bigint,'Buying on a card does not remove cash on the purchase date');
select is(jsonb_array_length(:'october'::jsonb->'events'),0,'No card cash flow before statement due date; benefit stays separate');
select is(:'october'::jsonb->>'nextMainIncomeOn','2026-11-03','Next principal income marker remains available outside the month plot');
select api.cash_forecast(:'space','custom','2026-11-16','2026-10-13') as november \gset
select is((select (value->>'conservativeCents')::bigint from jsonb_array_elements(:'november'::jsonb->'series') where value->>'on'='2026-11-03'),700000::bigint,'Principal income is received on its actual banking day');
select is((select (value->>'conservativeCents')::bigint from jsonb_array_elements(:'november'::jsonb->'series') where value->>'on'='2026-11-16'),650000::bigint,'Card purchase and planned occurrence are paid together on statement due date');
select is((select count(*) from jsonb_array_elements(:'november'::jsonb->'events') where value->>'kind'='statement'),1::bigint,'Card occurrences are aggregated into one statement cash event');
select is((select value->>'on' from jsonb_array_elements(:'november'::jsonb->'events') where value->>'kind'='statement'),'2026-11-16','Sunday and holiday due date moves to Monday, CT16.4.2');
select api.cash_forecast(:'space','90_days',null,'2026-10-13') as ninety \gset
select is(jsonb_array_length(:'ninety'::jsonb->'series'),90,'90-day range is half-open');
select is((select count(*) from jsonb_array_elements(:'ninety'::jsonb->'events') where value->>'label'='Renda principal'),3::bigint,'Forecast includes every principal income occurrence, not only the next one');
select api.create_reserve(:'space',jsonb_build_object('name','Meta','financial_account_id',:'bank','target_amount_cents',10000)) as reserve \gset
select api.reserve_contribution(:'space',:'reserve','contribution',10000,'2026-10-13');
select is(api.cash_forecast(:'space','month',null,'2026-10-13'),:'october'::jsonb,'A contribution does not alter the cash curve');
select api.create_commitment(:'space',jsonb_build_object('title','Saída vencida','direction','outflow','certainty','confirmed','amount_cents',250000,'due_on','2026-10-09','category_id',:'expense','payment_method','account','payment_financial_account_id',:'bank')) as overdue \gset
select api.create_commitment(:'space',jsonb_build_object('title','Entrada atrasada','direction','inflow','certainty','confirmed','amount_cents',100000,'due_on','2026-10-09','category_id',:'salary','payment_method','account','payment_financial_account_id',:'bank')) as late_income \gset
select api.cash_forecast(:'space','month',null,'2026-10-13') as overdue_curve \gset
select is(:'overdue_curve'::jsonb#>>'{conservative,firstNegativeOn}','2026-10-13','Overdue debt is counted today and exposes first negative day');
select is((:'overdue_curve'::jsonb#>>'{conservative,minimumCents}')::bigint,-50000::bigint,'Minimum balance includes overdue debt');
select is((:'overdue_curve'::jsonb#>>'{expected,minimumCents}')::bigint,50000::bigint,'Late income enters only the expected scenario today');
select api.create_commitment(:'space',jsonb_build_object('title','Entrada condicional','direction','inflow','certainty','conditional','amount_cents',12345,'due_on','2026-10-20','category_id',:'salary','payment_method','account','payment_financial_account_id',:'bank')) as conditional \gset
select api.cash_forecast(:'space','month',null,'2026-10-13') as conditional_curve \gset
select is((select (value->>'conservativeCents')::bigint from jsonb_array_elements(:'conditional_curve'::jsonb->'events') where value->>'id'=:'conditional'),0::bigint,'Conditional receipt has zero conservative effect');
select is((select (value->>'expectedCents')::bigint from jsonb_array_elements(:'conditional_curve'::jsonb->'events') where value->>'id'=:'conditional'),12345::bigint,'Conditional receipt has full expected effect');
select api.settle_commitment(:'space',:'overdue',50000,'2026-10-20','partial') as planned \gset
select api.cash_forecast(:'space','month',null,'2026-10-13') as partially_scheduled \gset
select is((select (value->>'conservativeCents')::bigint from jsonb_array_elements(:'partially_scheduled'::jsonb->'events') where value->>'id'=:'overdue'),-200000::bigint,'Scheduled settlement reduces the unpaid commitment');
select is((select (value->>'conservativeCents')::bigint from jsonb_array_elements(:'partially_scheduled'::jsonb->'events') where value->>'id'=:'planned'),-50000::bigint,'Scheduled settlement appears once on its recorded cash date');
select api.transfer_between_accounts(:'space',:'bank',:'wallet',10000,'2026-10-22') as transfer \gset
select is((select count(*) from jsonb_array_elements(api.cash_forecast(:'space','month',null,'2026-10-13')->'events') where value->>'id'=:'transfer'),0::bigint,'Cash-to-cash transfer has no forecast cash effect');
select api.create_person(:'space','Pessoa prevista') as person \gset
select api.manage_person(:'space',:'person',1,'opening',jsonb_build_object('balance_cents',50000,'on','2026-10-01'));
select api.create_commitment(:'space',jsonb_build_object('kind','reminder','title','Cobrar pessoa','person_id',:'person','due_on','2026-10-21')) as reminder \gset
select api.cash_forecast(:'space','month',null,'2026-10-13') as people_curve \gset
select is((select (value->>'expectedCents')::bigint from jsonb_array_elements(:'people_curve'::jsonb->'events') where value->>'kind'='person'),50000::bigint,'Person receivable enters expected on an open reminder');
select is((select (value->>'conservativeCents')::bigint from jsonb_array_elements(:'people_curve'::jsonb->'events') where value->>'kind'='person'),0::bigint,'Person receivable does not enter conservative');
select api.settle_person(:'space',:'person',:'bank','receive',20000,'2026-10-20') as person_payment \gset
select api.cash_forecast(:'space','month',null,'2026-10-13') as people_scheduled \gset
select is((select (value->>'expectedCents')::bigint from jsonb_array_elements(:'people_scheduled'::jsonb->'events') where value->>'kind'='person'),30000::bigint,'A scheduled person settlement is not expected twice');
select is((select (value->>'expectedCents')::bigint from jsonb_array_elements(:'people_scheduled'::jsonb->'events') where value->>'id'=:'person_payment'),20000::bigint,'Scheduled person settlement stays on its cash date');
select count(*) as commitments_before from finance.commitments where financial_space_id=:'space' \gset
select count(*) as statements_before from finance.card_statements where financial_space_id=:'space' \gset
select count(*) as transactions_before from finance.ledger_transactions where financial_space_id=:'space' \gset
select api.cash_forecast(:'space','custom','2028-10-13','2026-10-13') as long_curve \gset
select ok(exists(select 1 from jsonb_array_elements(:'long_curve'::jsonb->'events') where value->>'label'='Renda principal' and (value->>'projected')::boolean),'Ungenerated recurrence versions are projected without persistence');
select is((select count(*) from finance.commitments where financial_space_id=:'space'),:'commitments_before'::bigint,'Forecast creates no Agenda occurrences');
select is((select count(*) from finance.card_statements where financial_space_id=:'space'),:'statements_before'::bigint,'Forecast creates no statements');
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space'),:'transactions_before'::bigint,'Forecast creates no ledger transactions');
select throws_ok(format('select api.cash_forecast(%L,%L,%L,%L)',:'space','custom','2028-10-14','2026-10-13'),'23514','Forecast date must be within the next 24 months','Custom dates are capped at 24 months');
select throws_ok(format('select api.cash_forecast(%L,%L,%L,%L)',:'space','custom','2026-10-12','2026-10-13'),'23514','Forecast date must be within the next 24 months','Custom dates cannot precede today');
select throws_ok(format('select api.cash_forecast(%L,%L)',:'space','invalid'),'23514','Invalid forecast horizon','Horizon must be a supported option');

-- Income deposited on a card is not income deposited into a cash account.
select throws_ok(format('select api.create_commitment(%L,%L::jsonb)',:'space',jsonb_build_object('title','Crédito previsto no cartão','direction','inflow','certainty','confirmed','amount_cents',777,'due_on','2026-10-25','category_id',:'salary','payment_method','card','payment_credit_card_id',:'card')),'23514','new row for relation "commitments" violates check constraint "commitments_check9"','Income on a card is rejected before it can invent forecast cash');

-- An extended manual open period can overlap a closed historical cycle.
-- Follow exactly the writer's open/future/closed precedence when routing a
-- planned occurrence; matching an earlier reference month would pay too soon.
select api.open_card_balance(:'space',:'card','2026-10-01',10000,'2026-09-01');
select api.record_card_purchase(:'space',:'card',:'expense',1,1,'2026-10-06','Saldo atual para ajustar datas');
select id as open_cycle,version as open_cycle_version from finance.card_statements where credit_card_id=:'card' and reference_month='2026-11-01' \gset
select api.edit_card_statement_dates(:'space',:'open_cycle',:'open_cycle_version',jsonb_build_object('period_start','2026-08-28','due_on','2026-11-17','effective_due_on','2026-11-17'));
select api.create_commitment(:'space',jsonb_build_object('title','Ocorrência no período estendido','direction','outflow','certainty','confirmed','amount_cents',5000,'due_on','2026-09-21','category_id',:'expense','payment_method','card','payment_credit_card_id',:'card')) as overlapping \gset
select api.cash_forecast(:'space','custom','2026-11-17','2026-10-13') as overlap_curve \gset
select is((select (value->>'expectedCents')::bigint from jsonb_array_elements(:'overlap_curve'::jsonb->'events') where value->>'id'=:'open_cycle'),-55001::bigint,'Manual overlapping open cycle receives all planned/card amounts');
select is((select value->>'on' from jsonb_array_elements(:'overlap_curve'::jsonb->'events') where value->>'id'=:'open_cycle'),'2026-11-17','Stored manual due override wins over the nominal card rule');
select is((select (value->>'expectedCents')::bigint from jsonb_array_elements(:'overlap_curve'::jsonb->'events') where value->>'kind'='statement' and value->>'id'<>:'open_cycle'),-10000::bigint,'Closed historical cycle remains distinct and is not assigned open-cycle occurrences');

-- The same conservative historical values as the Livre apply to both already
-- materialized and future projected recurrences, net of partial settlements.
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Entrada histórica','direction','inflow','unit','month','starts_on','2026-07-20','day_of_month',20,'amount_cents',10000,'certainty','estimated','category_id',:'salary','payment_method','account','payment_financial_account_id',:'bank'))->>'id' as estimated_in \gset
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Saída histórica','direction','outflow','unit','month','starts_on','2026-07-21','day_of_month',21,'amount_cents',10000,'certainty','estimated','category_id',:'expense','payment_method','account','payment_financial_account_id',:'bank'))->>'id' as estimated_out \gset
select id as in_july from finance.commitments where recurrence_rule_id=:'estimated_in' and period_key='2026-07-01' \gset
select id as in_august from finance.commitments where recurrence_rule_id=:'estimated_in' and period_key='2026-08-01' \gset
select id as in_september from finance.commitments where recurrence_rule_id=:'estimated_in' and period_key='2026-09-01' \gset
select id as in_october from finance.commitments where recurrence_rule_id=:'estimated_in' and period_key='2026-10-01' \gset
select id as out_july from finance.commitments where recurrence_rule_id=:'estimated_out' and period_key='2026-07-01' \gset
select id as out_august from finance.commitments where recurrence_rule_id=:'estimated_out' and period_key='2026-08-01' \gset
select id as out_september from finance.commitments where recurrence_rule_id=:'estimated_out' and period_key='2026-09-01' \gset
select id as out_october from finance.commitments where recurrence_rule_id=:'estimated_out' and period_key='2026-10-01' \gset
select api.settle_commitment(:'space',:'in_july',9000,'2026-07-20','match_actual');
select api.settle_commitment(:'space',:'in_august',8000,'2026-08-20','match_actual');
select api.settle_commitment(:'space',:'in_september',7000,'2026-09-21','match_actual');
select api.settle_commitment(:'space',:'out_july',12000,'2026-07-21','match_actual');
select api.settle_commitment(:'space',:'out_august',15000,'2026-08-21','match_actual');
select api.settle_commitment(:'space',:'out_september',18000,'2026-09-21','match_actual');
select api.settle_commitment(:'space',:'in_october',2000,'2026-10-13','partial');
select api.settle_commitment(:'space',:'out_october',5000,'2026-10-13','partial');
select api.cash_forecast(:'space','month',null,'2026-10-13') as estimated_curve \gset
select is((select (value->>'conservativeCents')::bigint from jsonb_array_elements(:'estimated_curve'::jsonb->'events') where value->>'id'=:'in_october'),5000::bigint,'Estimated inflow uses minimum three actual receipts minus already received');
select is((select (value->>'expectedCents')::bigint from jsonb_array_elements(:'estimated_curve'::jsonb->'events') where value->>'id'=:'in_october'),8000::bigint,'Expected inflow uses due amount minus already received');
select is((select (value->>'conservativeCents')::bigint from jsonb_array_elements(:'estimated_curve'::jsonb->'events') where value->>'id'=:'out_october'),-10000::bigint,'Estimated outflow uses actual historical average minus already paid');
select is((select (value->>'expectedCents')::bigint from jsonb_array_elements(:'estimated_curve'::jsonb->'events') where value->>'id'=:'out_october'),-5000::bigint,'Expected outflow uses nominal due minus already paid');
select ok(not exists(select 1 from jsonb_array_elements(:'estimated_curve'::jsonb->'series') where (value->>'expectedCents')::bigint<(value->>'conservativeCents')::bigint),'Expected daily balances never fall below conservative balances');
select api.change_recurrence_rule(:'space',:'rule',1,'2027-11-01','this_and_following',jsonb_build_object('amount_cents',600000));
select api.cash_forecast(:'space','custom','2027-12-01','2026-10-13') as future_version_curve \gset
select is((select (value->>'expectedCents')::bigint from jsonb_array_elements(:'future_version_curve'::jsonb->'events') where value->>'label'='Renda principal' and value->>'on'='2027-11-01'),600000::bigint,'Ungenerated income uses the latest immutable effective recurrence version');
select is((select (value->>'conservativeCents')::bigint from jsonb_array_elements(:'future_version_curve'::jsonb->'events') where value->>'label'='Entrada histórica' and value->>'on'='2027-11-22'),7000::bigint,'Ungenerated estimated recurrence uses settled historical evidence too');
select id as cancelled_income,version as cancelled_income_version from finance.commitments where recurrence_rule_id=:'rule' and period_key='2026-11-01' \gset
select api.cancel_commitment(:'space',:'cancelled_income',:'cancelled_income_version','Ocorrência dispensada');
select is((select count(*) from jsonb_array_elements(api.cash_forecast(:'space','custom','2026-11-17','2026-10-13')->'events') where value->>'id'=:'cancelled_income'),0::bigint,'A cancelled occurrence is never recreated as a projected event');
select is(api.cash_forecast(:'space','month',null,'2026-10-13')->>'nextMainIncomeOn','2026-12-01','Cancelled next principal income advances marker to the next unpaid occurrence');
select api.create_person(:'space','Sem lembrete') as undated_receivable \gset
select api.manage_person(:'space',:'undated_receivable',1,'opening',jsonb_build_object('balance_cents',10000,'on','2026-10-01'));
select is((select count(*) from jsonb_array_elements(api.cash_forecast(:'space','month',null,'2026-10-13')->'events') where value->>'id'=:'undated_receivable'),0::bigint,'Person receivable without an open reminder does not enter expected cash');
select api.create_person(:'space','A pagar sem lembrete') as payable \gset
select api.manage_person(:'space',:'payable',1,'opening',jsonb_build_object('balance_cents',-30000,'on','2026-10-01'));
select api.settle_person(:'space',:'payable',:'bank','pay',5000,'2026-10-20') as payable_scheduled \gset
select api.cash_forecast(:'space','month',null,'2026-10-13') as payable_curve \gset
select is((select (value->>'conservativeCents')::bigint from jsonb_array_elements(:'payable_curve'::jsonb->'events') where value->>'id'=:'payable'),-25000::bigint,'Undated payable uses h0 and subtracts its recorded future settlement');
select is((select value->>'on' from jsonb_array_elements(:'payable_curve'::jsonb->'events') where value->>'id'=:'payable'),'2026-10-13','Undated payable remainder is dated today');
select is((select (value->>'conservativeCents')::bigint from jsonb_array_elements(:'payable_curve'::jsonb->'events') where value->>'id'=:'payable_scheduled'),-5000::bigint,'Future person payment has exactly one separate scheduled cash effect');
-- A day can net to safe cents even when its aggregated statement event is not
-- representable in the application. Reject the unsafe event before rendering.
select api.create_commitment(:'space',jsonb_build_object('title','Grande cartão A','direction','outflow','certainty','confirmed','amount_cents',5000000000000000,'due_on','2026-10-25','category_id',:'expense','payment_method','card','payment_credit_card_id',:'card'));
select api.create_commitment(:'space',jsonb_build_object('title','Grande cartão B','direction','outflow','certainty','confirmed','amount_cents',5000000000000000,'due_on','2026-10-25','category_id',:'expense','payment_method','card','payment_credit_card_id',:'card'));
select api.create_commitment(:'space',jsonb_build_object('title','Grande entrada A','direction','inflow','certainty','confirmed','amount_cents',5000000000000000,'due_on','2026-11-17','category_id',:'salary','payment_method','account','payment_financial_account_id',:'bank'));
select api.create_commitment(:'space',jsonb_build_object('title','Grande entrada B','direction','inflow','certainty','confirmed','amount_cents',5000000000000000,'due_on','2026-11-17','category_id',:'salary','payment_method','account','payment_financial_account_id',:'bank'));
select throws_ok(format('select api.cash_forecast(%L,%L,%L,%L)',:'space','custom','2026-11-17','2026-10-13'),'23514','Forecast exceeds supported cents','Aggregated statement event must remain in safe integer cents even when daily net is small');

select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000431","role":"authenticated"}',true);
select throws_ok(format('select api.cash_forecast(%L)',:'space'),'42501','Space permission required','Another user cannot read the forecast');
select api.create_personal_space('Próxima renda não gerada') as annual_space \gset
select api.create_financial_account(:'annual_space','Banco anual','checking',10000,'2026-10-01') as annual_bank \gset
select api.create_category(:'annual_space','Renda anual','income',null,'recurring') as annual_category \gset
select api.create_recurrence_rule(:'annual_space',jsonb_build_object('title','Renda anual principal','direction','inflow','unit','year','starts_on','2026-08-01','day_of_month',1,'month_of_year',8,'is_main_income',true,'amount_cents',10000,'certainty','confirmed','category_id',:'annual_category','payment_method','account','payment_financial_account_id',:'annual_bank'));
select is(api.cash_forecast(:'annual_space','month',null,'2028-09-13')->>'nextMainIncomeOn','2029-08-01','Next ungenerated annual income remains available beyond a short plot');
select is((select count(*) from jsonb_array_elements(api.cash_forecast(:'annual_space','month',null,'2028-09-13')->'events') where value->>'on'='2029-08-01'),0::bigint,'Finding the future income marker does not insert that income into the short plot');
select id as annual_rule,version as annual_rule_version from finance.recurrence_rules where financial_space_id=:'annual_space' \gset
select api.change_recurrence_rule(:'annual_space',:'annual_rule',:'annual_rule_version','2026-01-01','entire_series',jsonb_build_object('interval_count',120));
select matches(api.cash_forecast(:'annual_space','month',null,'2028-09-13')->>'nextMainIncomeOn','^2146-08-(01|02|03)$','Maximum yearly interval is bounded and finds the next effective income');
reset role;
select is(private.forecast_end('2026-10-31','month'), '2026-11-30'::date,'Month end on the last day extends through the next month');
select is(private.forecast_end('2026-10-13','30_days'), '2026-11-11'::date,'30-day range includes exactly30 days');
select is(private.forecast_end('2026-08-31','6_months'), '2027-02-27'::date,'Six months clamps absent dates before taking the preceding day');
select ok(not has_function_privilege('anon','api.cash_forecast(uuid,text,date,date)','execute'),'Anonymous forecast reads denied');
select ok(not has_function_privilege('authenticated','private.forecast_card_due(uuid,uuid,date)','execute'),'Internal card projection is private');
select * from finish();
rollback;
