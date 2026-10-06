begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000371','report-metrics@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000371","role":"authenticated"}',true);
select api.create_personal_space('CT-REPORT-005') as space \gset
select api.create_financial_account(:'space','Banco','checking',10000000,'2025-09-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_financial_account(:'space','Outro banco','checking') as other_bank \gset
select ledger_account_id as other_ledger from finance.financial_accounts where id=:'other_bank' \gset
select api.create_category(:'space','Salário','income',null,'recurring') as salary \gset
select ledger_account_id as salary_ledger from finance.categories where id=:'salary' \gset
select api.create_category(:'space','13º','income',null,'extraordinary') as extra \gset
select ledger_account_id as extra_ledger from finance.categories where id=:'extra' \gset
select api.create_category(:'space','Despesas','expense') as expense \gset
select ledger_account_id as expense_ledger from finance.categories where id=:'expense' \gset
select api.create_credit_card(:'space','Cartão',10000000,1,10,:'bank') as card \gset
reset role;
select private.ensure_card_statement(:'space',:'card','2025-09-02',n) from generate_series(0,11) n;
update finance.card_statements set status='open',closed_at=null,closing_amount_cents=null where financial_space_id=:'space';
select private.ensure_system_category(:'space','cashback') as cashback_ledger \gset
select private.ensure_system_category(:'space','discounts_obtained') as discount_ledger \gset
select private.ensure_system_category(:'space','financial_charges') as charges_ledger \gset
select id as adjustment_ledger from finance.ledger_accounts where financial_space_id=:'space' and system_role='balance_adjustment' \gset
set local role authenticated;
select api.record_card_purchase(:'space',:'card',:'expense',560000,12,'2025-09-02','Parcelas da janela');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2025-09-03','competence_month','2025-09-01','description','Vestuário do mês fechado','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-50000),jsonb_build_object('ledger_account_id',:'expense_ledger','amount_cents',50000)))) as old_expense \gset
select api.post_transaction(:'space',jsonb_build_object('kind','income','occurred_on',d::date,'competence_month',d::date,'description','Salário','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',572500),jsonb_build_object('ledger_account_id',:'salary_ledger','amount_cents',-572500)))) from generate_series('2025-10-01'::timestamp,'2026-09-01',interval '1 month') d;
select api.post_transaction(:'space',jsonb_build_object('kind','income','occurred_on','2025-12-01','competence_month','2025-12-01','description','13º','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',600000),jsonb_build_object('ledger_account_id',:'extra_ledger','amount_cents',-600000))));
select api.post_transaction(:'space',jsonb_build_object('kind','income','occurred_on','2026-09-01','competence_month','2026-09-01','description','Cashback','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',30000),jsonb_build_object('ledger_account_id',:'cashback_ledger','amount_cents',-30000))));
select api.post_transaction(:'space',jsonb_build_object('kind','income','occurred_on','2026-09-01','competence_month','2026-09-01','description','Desconto obtido','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',8000),jsonb_build_object('ledger_account_id',:'discount_ledger','amount_cents',-8000))));
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2025-10-01','competence_month','2025-10-01','description','Despesas da janela','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-4520000),jsonb_build_object('ledger_account_id',:'expense_ledger','amount_cents',4520000)))) as original \gset
select api.refund_transaction(:'space',:'original',120000,'2026-09-01',:'bank');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-09-01','competence_month','2026-09-01','description','Encargos','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-60000),jsonb_build_object('ledger_account_id',:'charges_ledger','amount_cents',60000))));
select api.post_transaction(:'space',jsonb_build_object('kind','balance_adjustment','occurred_on','2026-09-01','competence_month','2026-09-01','description','Diferença não identificada','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-20000),jsonb_build_object('ledger_account_id',:'adjustment_ledger','amount_cents',20000))));
select is((api.financial_health(:'space','2026-10-02')#>>'{metrics,total_income_cents}')::bigint,7500000::bigint,'CT-REPORT-005 total income includes cashback and excludes obtained discounts');
select is((api.financial_health(:'space','2026-10-02')#>>'{metrics,monthly_cost_cents}')::bigint,420000::bigint,'CT-REPORT-005 cost includes net refunds, due installments, charges and adjustments');
select is((api.financial_health(:'space','2026-10-02')#>>'{metrics,savings_percent}')::numeric,32.8::numeric,'CT-REPORT-005 savings rate is exactly 32.8 percent');
select is((api.financial_health(:'space','2026-10-02')#>>'{metrics,recurring_income_average_cents}')::bigint,572500::bigint,'Cashback and 13th salary do not inflate recurring income');
select is((api.financial_health(:'space','2026-10-02')#>>'{metrics,credit_cost_cents}')::bigint,60000::bigint,'Credit cost includes natural financial-charge expense');
select is((api.financial_health(:'space','2026-10-02')#>>'{expense_groups,unidentified_adjustments}')::bigint,20000::bigint,'Unidentified adjustment has its own cost group');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(api.reports_summary(:'space','2026-09-01')#>'{consumption,items}') where value->>'label'='Diferença não identificada'),20000::bigint,'Consumption presents unidentified balance adjustment as a separate line');
select api.close_month(:'space','2025-09-01',true);
select is((api.reports_summary(:'space','2025-09-01')#>>'{consumption,snapshot}')::boolean,true,'Closed consumption uses its saved snapshot');
select is((api.reports_summary(:'space','2025-09-01')#>>'{consumption,expense_cents}')::bigint,610000::bigint,'Snapshot preserves the closed month consumption');
select api.refund_transaction(:'space',:'old_expense',15000,'2026-10-02',:'bank');
select is((api.reports_summary(:'space','2025-09-01')#>>'{consumption,expense_cents}')::bigint,610000::bigint,'CT-REPORT-004 later refund leaves the closed snapshot unchanged');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(api.reports_summary(:'space','2025-10-01')#>'{consumption,items}') where value->>'label'='De meses anteriores'),-15000::bigint,'Refund of closed competence has a separate prior-month line in first open month');
select is((api.reports_summary(:'space','2025-09-01')#>'{net_worth,5}'->>'snapshot')::boolean,true,'Closed net worth evolution also uses the saved snapshot');
select api.post_transaction(:'space',jsonb_build_object('kind','income','occurred_on','2026-10-02','competence_month','2026-10-01','description','Duas contas','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',30000),jsonb_build_object('ledger_account_id',:'other_ledger','amount_cents',70000),jsonb_build_object('ledger_account_id',:'salary_ledger','amount_cents',-100000))));
select is((api.reports_summary(:'space','2026-10-01',:'bank')#>>'{cash_flow,sections,operational}')::bigint,45000::bigint,'Account filter allocates income cash share plus its own refund');
select is((api.reports_summary(:'space','2026-10-01',:'other_bank')#>>'{cash_flow,sections,operational}')::bigint,70000::bigint,'Other account gets only its 700-real share');
select is((api.reports_summary(:'space','2026-10-01')#>>'{cash_flow,sections,operational}')::bigint,115000::bigint,'Filtered account allocations reconcile to total cash flow');
reset role;
update finance.financial_accounts set archived_at=now() where id=:'other_bank';
set local role authenticated;
select ok((select (value->>'archived')::boolean from jsonb_array_elements(api.reports_summary(:'space','2026-10-01')->'available_accounts') where value->>'id'=:'other_bank'),'Archived historical account remains available to report filter');
select is((api.reports_summary(:'space','2026-10-01',:'other_bank')#>>'{cash_flow,net_cents}')::bigint,70000::bigint,'Archive does not remove account history');
select ok(position('Taxa de poupança' in api.export_financial_report(:'space','financial_health','2026-10-01'))>0,'Health indicators are exportable as labeled CSV');
select throws_ok(format('select api.reports_summary(%L,''2026-10-02'')',:'space'),'23514',null,'Non-month-start report date rejected');
select throws_ok(format('select api.financial_health(%L,''infinity'')',:'space'),'23514',null,'Infinite health reference date rejected');
select count(*) as before_transactions from finance.ledger_transactions where financial_space_id=:'space' \gset
select count(*) as before_audits from finance.audit_logs where financial_space_id=:'space' \gset
select api.reports_summary(:'space','2026-10-01')->>'month';
select api.financial_health(:'space')->>'on';
select length(api.export_financial_report(:'space','cash_flow','2026-10-01'));
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space'),:'before_transactions'::bigint,'Report reads create no financial transactions');
select is((select count(*) from finance.audit_logs where financial_space_id=:'space'),:'before_audits'::bigint,'Report reads create no audit mutations');
set constraints all immediate;
select * from finish();
rollback;
