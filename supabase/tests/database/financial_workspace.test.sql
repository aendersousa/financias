begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(7);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000161','workspace@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000161","role":"authenticated"}',true);
select api.create_personal_space('Minhas finanças') as space \gset
select api.create_financial_account(:'space','Banco','checking',10000,'2000-01-01') as bank \gset
select is(api.workspace_snapshot(:'space')->>'role','owner','Workspace exposes the authenticated membership role');
select is((api.workspace_snapshot(:'space')->'accounts'->0->>'balance_cents')::bigint,10000::bigint,'Workspace returns derived balances');
select is((api.workspace_snapshot(:'space')->'transactions'->0->>'amount_cents')::bigint,10000::bigint,'Opening amount counts only one side of the balanced transaction');
select is(jsonb_array_length(api.workspace_snapshot(:'space')->'transactions'->0->'entries'),2,'Transaction list includes both ledger entries');
select ok(exists(select 1 from jsonb_array_elements(api.workspace_snapshot(:'space')->'transactions'->0->'entries') e where e->>'account_name'='Banco' and e->>'owner_type'='financial_account'),'Transaction list identifies the financial account');
select is(api.workspace_snapshot(:'space')->'commitments','[]'::jsonb,'Empty Agenda is an empty array');
select throws_ok(format('select api.workspace_snapshot(%L)',gen_random_uuid()),'42501','Space access denied','Workspace cannot access another financial space');
set constraints all immediate;
select * from finish();
rollback;
