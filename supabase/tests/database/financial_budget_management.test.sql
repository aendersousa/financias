begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(8);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000232','budget-management@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000232","role":"authenticated"}',true);
select api.create_personal_space('Orçamentos versionados') as space \gset
select api.create_category(:'space','Mercado','expense') as category \gset
select api.create_budget(:'space',jsonb_build_object('category_id',:'category','amount_cents',50000,'effective_from_month','2000-01-01')) as budget \gset
select api.manage_budget(:'space',:'budget',1,'month','2000-02-01',60000);
select is((api.budget_month_summary(:'space','2000-02-01')->0->>'amount_cents')::bigint,60000::bigint,'Monthly adjustment applies only in the selected month');
select is((api.budget_month_summary(:'space','2000-03-01')->0->>'amount_cents')::bigint,50000::bigint,'Following month retains original default');
select api.manage_budget(:'space',:'budget',2,'following','2000-02-01',70000,true) as next \gset
select is((api.budget_month_summary(:'space','2000-01-01')->0->>'amount_cents')::bigint,50000::bigint,'New plan preserves the preceding period');
select is((api.budget_month_summary(:'space','2000-02-01')->0->>'amount_cents')::bigint,60000::bigint,'Explicit monthly override remains associated with the new version');
select is((api.budget_month_summary(:'space','2000-03-01')->0->>'amount_cents')::bigint,70000::bigint,'New default applies after the override month');
select throws_ok(format('select api.manage_budget(%L,%L,2,%L,%L,80000)',:'space',:'budget','following','2000-01-01'),'40001','Budget changed; reload before editing','Stale plan modifications are rejected');
select api.manage_budget(:'space',:'next',1,'end','2000-03-01');
select is(jsonb_array_length(api.budget_month_summary(:'space','2000-04-01')),0,'Ending a plan stops it after the chosen final month');
select is(jsonb_array_length(api.budget_management_summary(:'space','2000-02-01')->'budgets'),2,'Management screen can inspect both historical plan versions');
set constraints all immediate;
select * from finish();
rollback;
