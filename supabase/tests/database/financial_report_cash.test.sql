begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000351','report-cash@test.local'),('aaaaaaaa-0000-4000-8000-000000000352','report-future@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000351","role":"authenticated"}',true);
select api.create_personal_space('CT-REPORT-001') as space \gset
select api.create_financial_account(:'space','Banco','checking',1000000,'2025-10-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_financial_account(:'space','CDB','investment') as cdb \gset
select ledger_account_id as cdb_ledger from finance.financial_accounts where id=:'cdb' \gset
select api.create_person(:'space','Fulano') as person \gset
select ledger_account_id as person_ledger from finance.people where id=:'person' \gset
select api.create_category(:'space','Salário','income',null,'recurring') as salary \gset
select ledger_account_id as salary_ledger from finance.categories where id=:'salary' \gset
select api.create_category(:'space','Restaurante','expense') as restaurant \gset
select ledger_account_id as restaurant_ledger from finance.categories where id=:'restaurant' \gset
select api.create_category(:'space','Mercado','expense') as market \gset
select ledger_account_id as market_ledger from finance.categories where id=:'market' \gset
select api.create_category(:'space','Lazer','expense') as leisure \gset
select ledger_account_id as leisure_ledger from finance.categories where id=:'leisure' \gset
select api.create_credit_card(:'space','Cartão A',10000000,1,10,:'bank') as card \gset
reset role;
select private.ensure_card_statement(:'space',:'card','2026-09-02') as statement \gset
update finance.card_statements set status='open',closed_at=null,closing_amount_cents=null where id=:'statement';
set local role authenticated;
select api.record_card_purchase(:'space',:'card',:'market',90000,1,'2026-09-02','Mercado antigo');
select api.record_card_purchase(:'space',:'card',:'leisure',60000,1,'2026-09-02','Lazer antigo');
select api.post_transaction(:'space',jsonb_build_object('kind','income','occurred_on','2026-10-01','competence_month','2026-10-01','description','Salário','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',500000),jsonb_build_object('ledger_account_id',:'salary_ledger','amount_cents',-500000))));
select api.post_transaction(:'space',jsonb_build_object('kind','investment_contribution','occurred_on','2026-10-01','competence_month','2026-10-01','description','Aplicação','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-200000),jsonb_build_object('ledger_account_id',:'cdb_ledger','amount_cents',200000))));
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-10-01','competence_month','2026-10-01','description','Restaurante compartilhado','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-20000),jsonb_build_object('ledger_account_id',:'restaurant_ledger','amount_cents',10000),jsonb_build_object('ledger_account_id',:'person_ledger','amount_cents',10000))));
select api.post_transaction(:'space',jsonb_build_object('kind','person_settlement','occurred_on','2026-10-02','competence_month','2026-10-01','description','Fulano paga','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',10000),jsonb_build_object('ledger_account_id',:'person_ledger','amount_cents',-10000))));
select api.pay_card(:'space',:'card',:'bank_ledger',150000,'2026-10-02') as payment \gset
select is((api.reports_summary(:'space','2026-10-01')#>>'{cash_flow,sections,operational}')::bigint,340000::bigint,'CT-REPORT-001 operational flow includes allocated card payment');
select is((api.reports_summary(:'space','2026-10-01')#>>'{cash_flow,sections,investments}')::bigint,-200000::bigint,'Application is an investment flow, never consumption');
select is((api.reports_summary(:'space','2026-10-01')#>>'{cash_flow,sections,people}')::bigint,0::bigint,'Shared cost and reimbursement reconcile the people section');
select is((api.reports_summary(:'space','2026-10-01')#>>'{cash_flow,net_cents}')::bigint,140000::bigint,'Net flow equals the cash balance change');
select is((api.reports_summary(:'space','2026-10-01')#>>'{consumption,expense_cents}')::bigint,10000::bigint,'Application and paying the card create no consumption');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(api.reports_summary(:'space','2026-10-01')#>'{cash_flow,items}') where value->>'transaction_id'=:'payment' and value->>'account_id'=:'market_ledger'),-90000::bigint,'Card payment inherits original market category');
reset role;
select is((private.report_allocate(jsonb_build_array(jsonb_build_object('account_id',:'market_ledger','source_id',null,'priority',2,'installment',false,'amount_cents',60000),jsonb_build_object('account_id',:'leisure_ledger','source_id',null,'priority',2,'installment',false,'amount_cents',40000)),33333)#>'{allocation}')->0 is not null,true,'Allocation exists');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_allocate(jsonb_build_array(jsonb_build_object('account_id',:'market_ledger','source_id',null,'priority',2,'installment',false,'amount_cents',60000),jsonb_build_object('account_id',:'leisure_ledger','source_id',null,'priority',2,'installment',false,'amount_cents',40000)),33333)->'allocation') where value->>'account_id'=:'market_ledger'),20000::bigint,'CT-REPORT-003 largest-remainder allocation is exact');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000352","role":"authenticated"}',true);
select api.create_personal_space('CT-LFG-007') as future_space \gset
select api.create_financial_account(:'future_space','Banco','checking',1000000,'2025-10-01') as future_bank \gset
select ledger_account_id as future_bank_ledger from finance.financial_accounts where id=:'future_bank' \gset
select api.create_category(:'future_space','Salário','income',null,'recurring') as future_salary \gset
select ledger_account_id as future_salary_ledger from finance.categories where id=:'future_salary' \gset
select api.create_category(:'future_space','TV','expense') as tv_category \gset
select api.post_transaction(:'future_space',jsonb_build_object('kind','income','occurred_on',d::date,'competence_month',d::date,'description','Salário','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'future_bank_ledger','amount_cents',600000),jsonb_build_object('ledger_account_id',:'future_salary_ledger','amount_cents',-600000)))) from generate_series('2025-10-01'::timestamp,'2026-09-01',interval '1 month') d;
select api.create_recurrence_rule(:'future_space',jsonb_build_object('title','Salário','direction','inflow','unit','month','is_main_income',true,'starts_on','2026-11-05','day_of_month',5,'amount_cents',600000,'category_id',:'future_salary','payment_method','account','payment_financial_account_id',:'future_bank'));
select api.create_credit_card(:'future_space','Cartão A',10000000,1,10,:'future_bank') as future_card \gset
select api.record_card_purchase(:'future_space',:'future_card',:'tv_category',360000,12,'2026-10-02','TV futura') as future_tv \gset
select is((api.financial_health(:'future_space','2026-10-02')#>>'{future_installments,total_cents}')::bigint,330000::bigint,'CT-LFG-007 excludes the open statement from future installments');
select is((api.financial_health(:'future_space','2026-10-02')#>>'{future_installments,next_cycle_cents}')::bigint,0::bigint,'The next income cycle has no future installment');
select is((api.financial_health(:'future_space','2026-10-02')#>>'{future_installments,average_cents}')::bigint,25000::bigint,'Average of six income cycles is 250 reais');
select is((api.financial_health(:'future_space','2026-10-02')#>>'{future_installments,income_percent}')::numeric,4.2::numeric,'Future installment commitment is 4.2 percent');
select is(api.financial_health(:'future_space','2026-10-02')#>>'{future_installments,cycles,0,until}','2026-12-07','Main-income cycles use effective business dates');
select api.refund_transaction(:'future_space',:'future_tv',120000,'2026-10-02',null,'cancel_remaining');
select is((api.financial_health(:'future_space','2026-10-02')#>>'{future_installments,total_cents}')::bigint,220000::bigint,'Cancel-remaining refund reduces future installments proportionately');
select api.prepay_card_installments(:'future_space',:'future_tv',array[12],0,'2026-10-02');
select is((api.financial_health(:'future_space','2026-10-02')#>>'{future_installments,total_cents}')::bigint,200000::bigint,'Prepaid future installment moves to open statement and is not counted again');
reset role;
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_health_expenses(:'future_space','2026-10-02')) where value->>'month'='2026-11-01'),40000::bigint,'Alternate consumption moves the remaining prepaid category amount to the open due month');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_health_expenses(:'future_space','2026-10-02')) where value->>'month'='2027-10-01'),0::bigint,'The prepaid source month has no duplicate consumption');
set local role authenticated;
select api.pay_card(:'future_space',:'future_card',:'future_bank_ledger',10000,'2026-10-02') as prepaid_payment \gset
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(api.reports_summary(:'future_space','2026-10-01')#>'{cash_flow,items}') where value->>'transaction_id'=:'prepaid_payment'),-10000::bigint,'Paying the prepaid statement reconciles once to cash');
select api.refund_transaction(:'future_space',:'future_tv',120000,'2026-10-02',null,'cancel_remaining');
reset role;
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_health_expenses(:'future_space','2026-10-02')) where value->>'month'='2026-11-01'),20000::bigint,'Refund after prepayment follows the moved installment due month');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_health_expenses(:'future_space','2026-10-02')) where value->>'month'='2027-10-01'),0::bigint,'Refund after prepayment leaves no negative orphan expense in old due month');
set local role authenticated;
select api.record_card_purchase(:'future_space',:'future_card',:'tv_category',360000,12,'2026-10-02','TV com crédito em fatura') as credit_tv \gset
select api.refund_transaction(:'future_space',:'credit_tv',120000,'2026-10-02',null,'credit_open_statement');
select api.prepay_card_installments(:'future_space',:'credit_tv',array[12],0,'2026-10-02');
reset role;
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_health_expenses(:'future_space','2026-10-02')) where value->>'month'='2027-10-01'),0::bigint,'Credit-open refund before prepayment moves net economic consumption, not gross technical debt');
set local role authenticated;
set constraints all immediate;
select * from finish();
rollback;
