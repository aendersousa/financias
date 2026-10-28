begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(8);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000131','recurrence-a@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000131","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today,date_trunc('month',now() at time zone 'America/Sao_Paulo')::date as month,(date_trunc('month',now() at time zone 'America/Sao_Paulo')+interval '1 month')::date as next_month \gset
select api.create_personal_space('Teste recorrências') as space \gset
select api.create_financial_account(:'space','Banco','checking',0) as bank \gset
select api.create_category(:'space','Salário','income',null,'recurring') as salary \gset
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Salário','direction','inflow','unit','month','is_main_income',true,'starts_on',:'month','day_of_month',31,'amount_cents',500000,'category_id',:'salary','payment_method','account','payment_financial_account_id',:'bank'))->>'id' as rule \gset
select count(*)::bigint as occurrences_before from finance.commitments where recurrence_rule_id = :'rule' \gset
select id as occurrence from finance.commitments where recurrence_rule_id = :'rule' and period_key = :'month' \gset
select is(:'occurrences_before'::bigint,13::bigint,'Generates current month plus next twelve months');
select api.settle_commitment(:'space',:'occurrence',500000,:'today') as received \gset
select api.change_recurrence_rule(:'space',:'rule',1,:'month','entire_series','{"amount_cents":550000,"day_of_month":30}') as regeneration \gset
select is((select due_amount_cents from finance.commitments where id = :'occurrence'),500000::bigint,'INV-REC-001 paid occurrence never changes');
select is((select count(*) from finance.commitments where recurrence_rule_id = :'rule' and deleted_at is null),13::bigint,'CT-REC-001 changing due day does not duplicate occurrences');
select is((select due_amount_cents from finance.commitments where recurrence_rule_id = :'rule' and period_key = :'next_month'),550000::bigint,'New rule version applies to untouched future occurrence');
select is((select count(*) from finance.recurrence_rule_versions where recurrence_rule_id = :'rule'),2::bigint,'Old rule version is retained for audit');
select is((select settlement_status from finance.commitment_settlements where id = :'occurrence'),'settled','Regeneration preserves settlement status');
reset role;
select api.job_generate_occurrences();
select api.job_generate_occurrences();
set local role authenticated;
select is((select count(*) from finance.commitments where recurrence_rule_id = :'rule' and deleted_at is null),13::bigint,'Repeated occurrence jobs are idempotent');
select api.end_recurrence_rule(:'space',:'rule',2,(:'next_month'::date-1)) as ended \gset
select is((select count(*) from finance.commitments where recurrence_rule_id = :'rule' and deleted_at is null),1::bigint,'Ending rule removes only untouched later occurrences');
set constraints all immediate;
select * from finish();
rollback;
