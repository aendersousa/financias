begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000361','report-financing@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000361","role":"authenticated"}',true);
select api.create_personal_space('CT-REPORT financiamento') as space \gset
select api.create_financial_account(:'space','Banco','checking',1000000,'2025-10-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Mercado','expense') as market \gset
select ledger_account_id as market_ledger from finance.categories where id=:'market' \gset
select api.create_category(:'space','Lazer','expense') as leisure \gset
select ledger_account_id as leisure_ledger from finance.categories where id=:'leisure' \gset
select api.create_credit_card(:'space','Cartão',10000000,1,10,:'bank') as card \gset
reset role;
select private.ensure_card_statement(:'space',:'card','2026-09-02') as statement \gset
update finance.card_statements set status='open',closed_at=null,closing_amount_cents=null where id=:'statement';
set local role authenticated;
select api.record_card_purchase(:'space',:'card',:'market',180000,1,'2026-09-02','Mercado');
select api.record_card_purchase(:'space',:'card',:'leisure',120000,1,'2026-09-02','Lazer');
select api.pay_card(:'space',:'card',:'bank_ledger',50000,'2026-10-02') as downpayment \gset
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(api.reports_summary(:'space','2026-10-01')#>'{cash_flow,items}') where value->>'transaction_id'=:'downpayment' and value->>'account_id'=:'market_ledger'),-30000::bigint,'Financing downpayment allocates 300 reais market');
set constraints all immediate;
set constraints all deferred;
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=300000 where id=:'statement';
set local role authenticated;
select api.install_card_statement(:'space',:'statement','2026-10-02',312000,6) as financing \gset
reset role;
select private.ensure_card_statement(:'space',:'card','2026-10-02',0) as first_statement \gset
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_statement_composition(:'space',:'first_statement','2026-10-02')) where value->>'account_id'=:'market_ledger'),25000::bigint,'Financed installments inherit unpaid market principal');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_statement_composition(:'space',:'first_statement','2026-10-02'))),52000::bigint,'Composition reconciles first financed installment');
select is((select sum((q.value->>'amount_cents')::bigint)::bigint from finance.card_statements s cross join lateral jsonb_array_elements(private.report_statement_composition(:'space',s.id,'2026-10-02')) q(value) where s.financial_space_id=:'space' and s.effective_due_on>='2026-11-01' and q.value->>'account_id'=:'leisure_ledger'),100000::bigint,'Cumulative allocation preserves every leisure cent across all six parts');
select is((select sum((q.value->>'amount_cents')::bigint)::bigint from finance.card_statements s cross join lateral jsonb_array_elements(private.report_statement_composition(:'space',s.id,'2026-10-02')) q(value) join finance.categories c on c.ledger_account_id=(q.value->>'account_id')::uuid where s.financial_space_id=:'space' and s.effective_due_on>='2026-11-01' and c.system_role='financial_charges'),62000::bigint,'Financing charges reconcile across all six parts');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_health_expenses(:'space','2026-10-02')) where value->>'transaction_id'=:'financing'),62000::bigint,'Health adds only new financing charges, never the refinanced principal again');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_health_expenses(:'space','2026-10-02')) where (value->>'credit_cost')::boolean),62000::bigint,'System financial-charge category contributes to credit cost');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_allocate('[{"account_id":"00000000-0000-4000-8000-000000000001","source_id":null,"priority":1,"installment":false,"amount_cents":24000},{"account_id":"00000000-0000-4000-8000-000000000002","source_id":null,"priority":1,"installment":false,"amount_cents":16000},{"account_id":"00000000-0000-4000-8000-000000000003","source_id":null,"priority":2,"installment":false,"amount_cents":30000},{"account_id":"00000000-0000-4000-8000-000000000004","source_id":null,"priority":2,"installment":false,"amount_cents":2500}]',50000)->'allocation') where value->>'account_id'='00000000-0000-4000-8000-000000000003'),9231::bigint,'CT-REPORT-003 pays prior composition first and assigns 9231 cents to pharmacy');
set local role authenticated;
select api.pay_card(:'space',:'card',:'bank_ledger',10000,'2026-10-03') as installment_payment \gset
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(api.reports_summary(:'space','2026-10-01')#>'{cash_flow,items}') where value->>'transaction_id'=:'installment_payment'),-10000::bigint,'Financed installment payment reconciles all economic categories');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(api.reports_summary(:'space','2026-10-01')#>'{cash_flow,items}') where value->>'transaction_id'=:'installment_payment' and value->>'account_id'=:'market_ledger'),-4808::bigint,'Financed installment payment retains market rather than charging everything to interest');
select is((api.reports_summary(:'space','2026-10-01')#>>'{consumption,expense_cents}')::bigint,62000::bigint,'Debt transfer and card repayment do not inflate October consumption');
select * from finish();
rollback;
