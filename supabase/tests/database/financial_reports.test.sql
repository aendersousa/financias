begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000341','reports@test.local'),('aaaaaaaa-0000-4000-8000-000000000342','reports-member@test.local'),('aaaaaaaa-0000-4000-8000-000000000343','reports-outsider@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000341","role":"authenticated"}',true);
select api.create_personal_space('Relatórios e Saúde') as space \gset
select api.create_financial_account(:'space','Banco','checking',10000000,'2025-10-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Salário','income',null,'recurring') as salary \gset
select ledger_account_id as salary_ledger from finance.categories where id=:'salary' \gset
select api.create_category(:'space','Custo mensal','expense') as expense \gset
select ledger_account_id as expense_ledger from finance.categories where id=:'expense' \gset
select api.create_category(:'space','TV','expense') as electronics \gset
select api.create_category(:'space','Aluguel','expense',null,null,false,'fixed') as rent \gset
select is(api.financial_health(:'space','2026-10-02')#>>'{window,reason}','insufficient_complete_months','Opening alone does not start the health window');
select is(api.financial_health(:'space','2026-10-02')#>>'{metrics,monthly_cost_cents}',null,'Insufficient history yields null, never a manufactured zero');
select api.post_transaction(:'space',jsonb_build_object('kind','income','occurred_on',d::date,'competence_month',d::date,'description','Salário','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',600000),jsonb_build_object('ledger_account_id',:'salary_ledger','amount_cents',-600000)))) from generate_series('2025-10-01'::timestamp,'2026-09-01',interval '1 month') d;
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',d::date,'competence_month',d::date,'description','Custo mensal','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-300000),jsonb_build_object('ledger_account_id',:'expense_ledger','amount_cents',300000)))) from generate_series('2025-10-01'::timestamp,'2026-09-01',interval '1 month') d;
select api.create_credit_card(:'space','Cartão A',10000000,1,10,:'bank') as card \gset
reset role;
-- Historical bank statements were explicitly reopened for entering history.
select private.ensure_card_statement(:'space',:'card','2026-03-18',n) from generate_series(0,11) n;
update finance.card_statements set status='open',closed_at=null,closing_amount_cents=null where financial_space_id=:'space';
set local role authenticated;
select api.record_card_purchase(:'space',:'card',:'electronics',360000,12,'2026-03-18','TV histórica') as tv \gset
select is((api.financial_health(:'space','2026-10-02')#>>'{window,months}')::integer,12,'Health uses the previous twelve complete months');
select is((api.financial_health(:'space','2026-10-02')#>>'{window,estimated}')::boolean,false,'Twelve months is not an estimate');
select is((api.financial_health(:'space','2026-10-02')#>>'{metrics,monthly_cost_cents}')::bigint,315000::bigint,'CT-HEALTH-002 monthly cost counts only six TV installments');
select is((api.reports_summary(:'space','2026-03-01')#>>'{consumption,expense_cents}')::bigint,660000::bigint,'Consumption still recognizes the total purchase in March');
select is((api.reports_summary(:'space','2026-03-01')#>>'{installment_consumption,expense_cents}')::bigint,300000::bigint,'Alternate March consumption excludes the first April installment');
select is((api.financial_health(:'space','2026-10-02')#>>'{metrics,recurring_income_average_cents}')::bigint,600000::bigint,'Recurring income average is monthly and excludes current month');
select is((api.financial_health(:'space','2026-10-02')#>>'{expense_groups,installments_and_debts}')::bigint,180000::bigint,'Disjoint installment group has the six due installments');
select is((select sum(value::text::numeric) from jsonb_each(api.financial_health(:'space','2026-10-02')->'expense_groups')),3780000::numeric,'Expense groups exactly reconcile the cost numerator');
select api.create_category(:'space','13º salário','income',null,'extraordinary') as extra \gset
select ledger_account_id as extra_ledger from finance.categories where id=:'extra' \gset
select api.post_transaction(:'space',jsonb_build_object('kind','income','occurred_on','2025-12-01','competence_month','2025-12-01','description','13º','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',600000),jsonb_build_object('ledger_account_id',:'extra_ledger','amount_cents',-600000))));
select is((api.financial_health(:'space','2026-10-02')#>>'{metrics,total_income_cents}')::bigint,7800000::bigint,'Extraordinary income enters the savings-rate numerator');
select is((api.financial_health(:'space','2026-10-02')#>>'{metrics,recurring_income_average_cents}')::bigint,600000::bigint,'Extraordinary income does not inflate recurring income');
select api.create_loan(:'space','Financiamento','loan',5000000,'2025-10-01') as loan \gset
select ledger_account_id as loan_ledger from finance.loans where id=:'loan' \gset
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Aluguel','direction','outflow','unit','month','starts_on','2026-11-20','day_of_month',20,'amount_cents',150000,'certainty','confirmed','category_id',:'rent','payment_method','account','payment_financial_account_id',:'bank'));
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Financiamento','direction','outflow','unit','month','starts_on','2026-11-20','day_of_month',20,'amount_cents',115000,'certainty','confirmed','counterpart_account_id',:'loan_ledger','payment_method','account','payment_financial_account_id',:'bank'));
select api.record_card_purchase(:'space',:'card',:'electronics',100000,2,'2026-10-02','Parcela próxima') as next_purchase \gset
-- TV histórica contributes 300; new purchase contributes 500 in November.
select is((api.financial_health(:'space','2026-10-02')->>'next_month_obligations_cents')::bigint,345000::bigint,'Next obligations count rent, loan and both card purchases exactly once');
select is((api.financial_health(:'space','2026-10-02')->>'next_month_amortization_cents')::bigint,115000::bigint,'Generic loan recurrence counts its entire amount as amortization');
select api.create_financial_account(:'space','CDB emergência','investment',1000000,'2025-10-01') as cdb \gset
select api.create_reserve(:'space',jsonb_build_object('reserve_type','goal','name','Emergência virtual','holding_mode','virtual','financial_account_id',:'bank','target_amount_cents',300000,'is_emergency_reserve',true)) as reserve \gset
select api.reserve_contribution(:'space',:'reserve','contribution',300000,'2026-10-01','Reserva inicial',gen_random_uuid());
select api.create_reserve(:'space',jsonb_build_object('reserve_type','goal','name','CDB','holding_mode','account','financial_account_id',:'cdb','target_amount_cents',1000000,'is_emergency_reserve',true));
reset role;
update finance.financial_accounts set is_emergency_reserve=true where id=:'cdb';
set local role authenticated;
select is((api.financial_health(:'space','2026-10-02')->>'emergency_reserve_cents')::bigint,1300000::bigint,'Investment marked directly and through goal is counted only once');
select is((api.financial_health(:'space','2026-10-02')#>>'{metrics,emergency_months}')::numeric,3.02::numeric,'Emergency denominator includes generic debt amortization');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000343","role":"authenticated"}',true);
select api.create_personal_space('Três meses estimados') as short_space \gset
select api.create_financial_account(:'short_space','Banco','checking',0,'2026-06-01') as short_bank \gset
select ledger_account_id as short_bank_ledger from finance.financial_accounts where id=:'short_bank' \gset
select api.create_category(:'short_space','Salário','income',null,'recurring') as short_salary \gset
select ledger_account_id as short_salary_ledger from finance.categories where id=:'short_salary' \gset
select api.post_transaction(:'short_space',jsonb_build_object('kind','income','occurred_on','2026-06-02','competence_month','2026-06-01','description','Uso começou no dia dois','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'short_bank_ledger','amount_cents',900000),jsonb_build_object('ledger_account_id',:'short_salary_ledger','amount_cents',-900000))));
select is((api.financial_health(:'short_space','2026-10-02')#>>'{window,months}')::integer,3,'Partial first month is excluded from the window');
select is((api.financial_health(:'short_space','2026-10-02')#>>'{window,estimated}')::boolean,true,'Three through eleven months are explicitly estimated');
select is(api.financial_health(:'short_space','2026-09-02')#>>'{metrics,savings_percent}',null,'Fewer than three months is insufficient');
select is(api.financial_health(:'short_space','2026-10-02')#>>'{metrics,savings_percent}',null,'Zero income denominator produces undefined percentage');
select api.post_transaction(:'short_space',jsonb_build_object('kind','income','occurred_on','2026-07-01','competence_month','2026-07-01','description','Renda em centavos','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'short_bank_ledger','amount_cents',10),jsonb_build_object('ledger_account_id',:'short_salary_ledger','amount_cents',-10))));
select api.create_category(:'short_space','Fixa em centavos','expense',null,null,false,'fixed') as penny_fixed \gset
select api.create_recurrence_rule(:'short_space',jsonb_build_object('title','Fixa em centavos','direction','outflow','unit','month','starts_on','2026-11-01','day_of_month',1,'amount_cents',1,'certainty','confirmed','category_id',:'penny_fixed','payment_method','account','payment_financial_account_id',:'short_bank'));
select is((api.financial_health(:'short_space','2026-10-02')#>>'{metrics,income_commitment_percent}')::numeric,30.0::numeric,'Ratios use unrounded monthly averages, then round only the percentage');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000341","role":"authenticated"}',true);
select ok(left(api.export_financial_report(:'space','consumption','2026-03-01'),1)=chr(65279),'Spreadsheet CSV has a UTF-8 BOM');
select ok(position('18/03/2026' in api.export_financial_report(:'space','consumption','2026-03-01'))=0,'Aggregated consumption exports competence date, not purchase date');
select ok(position('3600,00' in api.export_financial_report(:'space','consumption','2026-03-01'))>0,'Spreadsheet CSV uses decimal commas and reais');
select ok(position('360000' in api.export_financial_report(:'space','consumption','2026-03-01','technical'))>0,'Technical CSV preserves integer cents');
reset role;
select is(private.report_csv_cell('=1+1'),'"''=1+1"','CSV text cells neutralize formula prefixes');
select is(private.report_csv_cell('@formula'),'"''@formula"','CSV text cells neutralize spreadsheet formulas');
insert into finance.financial_space_members(financial_space_id,user_id,role,status) values(:'space','aaaaaaaa-0000-4000-8000-000000000342','member','active');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000342","role":"authenticated"}',true);
select lives_ok(format('select api.reports_summary(%L,''2026-03-01'')',:'space'),'Ordinary member can read the shared report');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000343","role":"authenticated"}',true);
select throws_ok(format('select api.reports_summary(%L,''2026-03-01'')',:'space'),'42501','Space permission required','Other tenant cannot read reports');
select throws_ok(format('select api.financial_health(%L,''2026-10-02'')',:'space'),'42501','Space permission required','Other tenant cannot read health');
select throws_ok(format('select api.export_financial_report(%L,''cash_flow'',''2026-03-01'')',:'space'),'42501','Space permission required','CSV cannot bypass tenant authorization');
select ok(not has_function_privilege('authenticated','private.report_window(uuid,date)','EXECUTE'),'Health helpers are not client-callable');
set constraints all immediate;
select * from finish();
rollback;
