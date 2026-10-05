begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(5);
insert into auth.users(id,email) values
 ('aaaaaaaa-0000-4000-8000-000000000041','preview-a@test.local'),
 ('bbbbbbbb-0000-4000-8000-000000000042','preview-b@test.local');
insert into public.accounts(user_id,nome,tipo,saldo_inicial) values
 ('aaaaaaaa-0000-4000-8000-000000000041','Conta A','corrente',123.45),
 ('bbbbbbbb-0000-4000-8000-000000000042','Conta B','corrente',999);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000041","role":"authenticated"}',true);
select is(jsonb_array_length(api.preview_legacy_migration()->'accounts'),1,'Preview shows only own account');
select is((api.preview_legacy_migration()->'accounts'->0->>'legacy_balance_cents')::numeric,12345::numeric,'Preview preserves exact legacy balance');
select is((api.preview_legacy_migration()->>'ready_for_automatic_migration')::boolean,false,'Preview never silently starts migration');
select is((select count(*) from finance.financial_spaces),0::bigint,'Preview creates no financial space');
select is((select saldo_inicial from public.accounts where nome = 'Conta A'),123.45::numeric,'Preview does not modify legacy values');
select * from finish();
rollback;
