begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(6);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000261','planning-job@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000261","role":"authenticated"}',true);
select api.create_personal_space('Rotina de provisões') as space \gset
select (now() at time zone 'America/Sao_Paulo')::date as today,(now() at time zone 'America/Sao_Paulo')::date+1 as tomorrow \gset
select api.create_financial_account(:'space','Banco','checking',100000,:'today') as bank \gset
select api.create_category(:'space','Seguro','expense') as category \gset
select api.create_reserve(:'space',jsonb_build_object('name','Seguro','reserve_type','provision','financial_account_id',:'bank','target_amount_cents',10000,'target_date',:'tomorrow','category_id',:'category')) as provision \gset
select id as commitment from finance.commitments where reserve_id=:'provision' \gset
select api.reserve_contribution(:'space',:'provision','contribution',15000,:'today');
select api.settle_commitment(:'space',:'commitment',10000,:'tomorrow');
set constraints all immediate;
select is((select status from finance.reserves where id=:'provision'),'active','Scheduled settlement remains active before financial date');
select throws_ok('select api.job_provision_settlements()','42501','permission denied for function job_provision_settlements','User cannot run a job across all spaces');
reset role;
-- Simulate the space reaching tomorrow without changing its transaction facts.
-- Etc/GMT-14 is tomorrow only during part of UTC day; a temporary deterministic
-- clock is scoped to this rolled-back fixture rather than the running database.
create or replace function private.space_today(p_space uuid) returns date language sql stable set search_path='' as $$ select ((now() at time zone 'America/Sao_Paulo')::date+1); $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok('select api.job_provision_settlements()','Backend job processes matured provision');
reset role;
select is((select status from finance.reserves where id=:'provision'),'settled','Job settles provision after financial date arrives');
select is((select amount_cents from finance.reserve_contributions where reserve_id=:'provision' and origin='release_on_settlement' and cancelled_at is null),5000::bigint,'Job releases only surplus without moving cash');
set local role service_role;
select api.job_provision_settlements();
reset role;
select is((select count(*) from finance.reserve_contributions where reserve_id=:'provision' and origin='release_on_settlement' and cancelled_at is null),1::bigint,'Repeated job never duplicates release');
select * from finish();
rollback;
