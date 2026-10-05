begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(10);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000141','budgets-a@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000141","role":"authenticated"}',true);
select api.create_personal_space('Teste orçamento') as space \gset
select api.create_financial_account(:'space','Banco','checking',200000,'2026-10-01') as bank \gset
select api.create_category(:'space','Alimentação','expense',null,null,true) as parent \gset
select api.create_category(:'space','Mercado','expense',:'parent') as category \gset
select api.create_budget(:'space',jsonb_build_object('category_id',:'parent','amount_cents',50000,'effective_from_month','2026-10-01')) as budget \gset
select throws_ok(format($q$select api.create_budget(%L,jsonb_build_object('category_id',%L,'amount_cents',10000,'effective_from_month','2026-10-01','is_essential_override',true))$q$,:'space',:'category'),'23514','Essential budgets cannot cover overlapping categories','Essential parent and child cannot overlap');
select throws_ok(format($q$select api.create_budget(%L,jsonb_build_object('category_id',%L,'amount_cents',10000,'effective_from_month','2026-11-01'))$q$,:'space',:'parent'),'23514','Budget intervals overlap for the same category','Same category cannot have overlapping budget intervals');
select api.create_commitment(:'space',jsonb_build_object('title','Mercado','direction','outflow','certainty','confirmed','amount_cents',15000,'due_on','2026-10-20','category_id',:'category','payment_method','account','payment_financial_account_id',:'bank')) as bill \gset
select is((api.budget_month_summary(:'space','2026-10-01')->0->>'predicted_cents')::bigint,15000::bigint,'Parent covers pending descendant commitments');
select api.settle_commitment(:'space',:'bill',5000,'2026-10-05') as partial \gset
select is((api.budget_month_summary(:'space','2026-10-01')->0->>'consumed_cents')::bigint,5000::bigint,'Partial payment creates actual consumption');
select is((api.budget_month_summary(:'space','2026-10-01')->0->>'predicted_cents')::bigint,10000::bigint,'Predicted value excludes paid amount');
select is((api.budget_month_summary(:'space','2026-10-01')->0->>'remaining_cents')::bigint,35000::bigint,'Remaining avoids counting paid obligations twice');
select api.set_budget_month_amount(:'space',:'budget','2026-10-01',10000);
select is((api.budget_month_summary(:'space','2026-10-01')->0->>'remaining_cents')::bigint,-5000::bigint,'Overspending stays negative');
select is((api.budget_month_summary(:'space','2026-11-01')->0->>'amount_cents')::bigint,50000::bigint,'Monthly override does not alter following months');
select throws_ok(format('select api.budget_month_summary(%L,%L)',gen_random_uuid(),'2026-10-01'),'42501','Space access denied','Budget summary does not disclose another space');
select api.create_category(:'space','Transporte','expense',null,null,true) as transport \gset
select api.create_budget(:'space',jsonb_build_object('category_id',:'transport','amount_cents',20000,'effective_from_month','2026-10-01')) as transport_budget \gset
select throws_ok(format($q$do $body$ begin perform api.move_category(%L,%L,%L,1); set constraints all immediate; end $body$ $q$,:'space',:'transport',:'parent'),
  '23514','Essential budgets cannot cover overlapping categories','Moving a category cannot bypass essential overlap protection');
set constraints all immediate;
select * from finish();
rollback;
