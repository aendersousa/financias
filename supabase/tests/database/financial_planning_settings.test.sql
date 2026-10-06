begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(11);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000271','planning-settings@test.local'),('aaaaaaaa-0000-4000-8000-000000000272','planning-settings-member@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000271","role":"authenticated"}',true);
select api.create_personal_space('Preferências de planejamento') as space \gset
select is((api.planning_settings(:'space')->>'minimum_safety_reserve_cents')::bigint,0::bigint,'Default safety reserve is zero');
select api.update_planning_settings(:'space',1,30000,5);
select is((api.planning_settings(:'space')->>'minimum_safety_reserve_cents')::bigint,30000::bigint,'Safety reserve stored in integer cents');
select is((api.planning_settings(:'space')->>'fallback_cycle_day')::integer,5,'Default income cycle may start on configured day');
select throws_ok(format('select api.update_planning_settings(%L,1,40000,10)',:'space'),'40001','Planning settings changed; reload before editing','Concurrent settings change rejected');
select throws_ok(format('select api.update_planning_settings(%L,2,-1,5)',:'space'),'23514','Invalid safety reserve or cycle day','Safety reserve cannot be negative');
select throws_ok(format('select api.update_planning_settings(%L,2,0,32)',:'space'),'23514','Invalid safety reserve or cycle day','Default cycle day bounded');
select api.create_financial_account(:'space','Banco','checking') as cash \gset
select api.create_financial_account(:'space','VA','benefit') as benefit \gset
select api.create_category(:'space','Alimentação','expense') as category \gset
select api.set_category_benefit(:'space',:'category',1,:'benefit');
select is((select benefit_financial_account_id from finance.categories where id=:'category'),:'benefit'::uuid,'Expense category linked to benefit in same space');
select throws_ok(format('select api.set_category_benefit(%L,%L,1,%L)',:'space',:'category',:'benefit'),'40001','Category changed; reload before editing','Benefit mapping uses category version');
select throws_ok(format('select api.set_category_benefit(%L,%L,2,%L)',:'space',:'category',:'cash'),'23514','Active benefit account in the same space required','Cash cannot masquerade as benefit');
reset role;
insert into finance.financial_space_members(financial_space_id,user_id,role,status) values(:'space','aaaaaaaa-0000-4000-8000-000000000272','member','active');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000272","role":"authenticated"}',true);
select throws_ok(format('select api.update_planning_settings(%L,2,0,1)',:'space'),'42501','Administrator permission required','Ordinary member cannot change shared planning settings');
select api.create_personal_space('Espaço de outro membro') as other_space \gset
select throws_ok(format('select api.set_category_benefit(%L,%L,2,%L)',:'other_space',:'category',:'benefit'),'23514','Active expense category required','Category mapping cannot cross spaces');
set constraints all immediate;
select * from finish();
rollback;
