begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(16);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000191','closing@test.local'),('aaaaaaaa-0000-4000-8000-000000000192','closing-member@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000191","role":"authenticated"}',true);
select api.create_personal_space('Teste fechamento') as space \gset
select api.create_financial_account(:'space','Banco','checking',100000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_category(:'space','Salário','income',null,'recurring') as salary \gset
select api.create_category(:'space','Mercado','expense') as market \gset
select ledger_account_id as salary_ledger from finance.categories where id = :'salary' \gset
select throws_ok(format('select api.close_month(%L,date_trunc(%L,now())::date)',:'space','month'),'23514','Only a finished month can be closed','Current month cannot be closed');
select throws_ok(format('select api.close_month(%L,%L)',:'space','2000-02-01'),'23514','Close the preceding month first','Months must be closed in sequence');
select api.close_month(:'space','2000-01-01') as january \gset
select is((api.month_report(:'space','2000-01-01')->>'closed')::boolean,true,'Month report uses closed snapshot');
select is((api.month_report(:'space','2000-01-01')->'controls'->>'net_worth_cents')::bigint,100000::bigint,'Closing snapshot stores derived net worth');
select is(api.close_month(:'space','2000-01-01'),:'january'::uuid,'Repeated close does not create duplicate closing');
select throws_ok(format($q$select api.create_budget(%L,jsonb_build_object('category_id',%L,'amount_cents',10000,'effective_from_month','2000-01-01'))$q$,:'space',:'market'),'23514','Budget includes a closed month','A new budget cannot alter a closed month');
select api.close_month(:'space','2000-02-01') as february \gset
select snapshot_id as original_february_photo from finance.period_closings where id = :'february' \gset
select is((select count(*) from finance.ledger_transactions where financial_space_id = :'space'),1::bigint,'Closing writes no ledger transactions');
select throws_ok(format('select api.reopen_month(%L,%L,%L)',:'space','2000-01-01','curto'),'23514','Reopening reason must contain at least ten characters','Reopening requires an explanatory reason');
select api.reopen_month(:'space','2000-01-01','Corrigir receita omitida');
select is((api.month_report(:'space','2000-02-01')->>'balances_require_recalculation')::boolean,true,'Later closed month signals stale balances');
select api.post_transaction(:'space',jsonb_build_object('kind','income','occurred_on','2000-01-15','competence_month','2000-01-01','description','Receita omitida','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',10000),jsonb_build_object('ledger_account_id',:'salary_ledger','amount_cents',-10000)))) as omitted \gset
select is((api.month_report(:'space','2000-02-01')->'controls'->>'net_worth_cents')::bigint,100000::bigint,'Old snapshot remains frozen while prior month is reopened');
select api.close_month(:'space','2000-01-01') as january_again \gset
select is((api.month_report(:'space','2000-02-01')->'controls'->>'net_worth_cents')::bigint,110000::bigint,'Reclosing recalculates balances in later closed months');
select is((api.month_report(:'space','2000-02-01')->>'version')::integer,2,'Changed later snapshot becomes a new version');
select is((select (controls->>'net_worth_cents')::bigint from finance.month_snapshots where id = :'original_february_photo'),100000::bigint,'Superseded snapshot is preserved');
select api.reopen_month(:'space','2000-01-01','Conferência sem alteração');
select api.close_month(:'space','2000-01-01');
select is((api.month_report(:'space','2000-01-01')->>'version')::integer,2,'Reclosing without numerical changes reuses the snapshot version');
select is((select count(*) from finance.ledger_transactions where financial_space_id = :'space'),2::bigint,'Snapshot recalculation never changes ledger');
reset role;
insert into finance.financial_space_members(financial_space_id,user_id,role,status) values(:'space','aaaaaaaa-0000-4000-8000-000000000192','member','active');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000192","role":"authenticated"}',true);
select throws_ok(format('select api.reopen_month(%L,%L,%L)',:'space','2000-01-01','Tentar reabrir o período'),'42501','Administrator permission required','Ordinary member cannot reopen periods');
set constraints all immediate;
select * from finish();
rollback;
