begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(14);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000195','dashboard-cash@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000195","role":"authenticated"}',true);
select api.create_personal_space('Saldos separados') as space \gset
select api.create_financial_account(:'space','Banco','checking',10000,'2000-01-01') as bank \gset
select api.create_financial_account(:'space','Carteira','wallet',2000,'2000-01-01') as wallet \gset
select api.create_financial_account(:'space','VR','benefit',3000,'2000-01-01') as benefit \gset
select api.create_financial_account(:'space','Poupança','savings',4000,'2000-01-01') as savings \gset
select api.create_financial_account(:'space','Bem','property',5000,'2000-01-01') as property \gset
select api.create_financial_account(:'space','Saldo agendado','checking',6000,(api.workspace_snapshot(:'space')->'space'->>'today')::date + 1) as scheduled \gset
select is((select sum((a->>'balance_cents')::bigint)::bigint from jsonb_array_elements(api.workspace_snapshot(:'space')->'accounts') a where a->>'liquidity' = 'cash'),12000::bigint,'Cash balance includes checking and wallet but excludes benefits, savings and property');
select is((select sum((a->>'balance_cents')::bigint)::bigint from jsonb_array_elements(api.workspace_snapshot(:'space')->'accounts') a where a->>'liquidity' = 'benefit'),3000::bigint,'Benefit balance remains separate');
select is((select sum((a->>'balance_cents')::bigint)::bigint from jsonb_array_elements(api.workspace_snapshot(:'space')->'accounts') a where a->>'liquidity' = 'investment'),4000::bigint,'Savings defaults to investment liquidity');
select is((select sum((a->>'balance_cents')::bigint)::bigint from jsonb_array_elements(api.workspace_snapshot(:'space')->'accounts') a where a->>'liquidity' = 'property'),5000::bigint,'Property balance remains separate');
select is((select (a->>'balance_cents')::bigint from jsonb_array_elements(api.workspace_snapshot(:'space')->'accounts') a where a->>'id' = :'scheduled'),0::bigint,'Future entries are excluded from today balances');
select is(api.workspace_snapshot(:'space')#>>'{space,timezone}','America/Sao_Paulo','Quick-entry cache knows the actual space timezone');
select is((api.workspace_snapshot(:'space')#>>'{totals,cash_cents}')::bigint,12000::bigint,'Cash aggregate is calculated by server and preserved in cache');
select is((api.workspace_snapshot(:'space')#>>'{totals,benefit_cents}')::bigint,3000::bigint,'Server aggregate separates benefits');
select is((api.workspace_snapshot(:'space')#>>'{totals,investment_cents}')::bigint,4000::bigint,'Server aggregate separates investments');
select is((api.workspace_snapshot(:'space')#>>'{totals,property_cents}')::bigint,5000::bigint,'Server aggregate separates property');
select is((api.workspace_snapshot(:'space')#>>'{totals,card_used_cents}')::bigint,0::bigint,'Empty cards have canonical zero aggregate');
select is((api.workspace_snapshot(:'space')#>>'{totals,commitment_outflows_cents}')::bigint,0::bigint,'Empty agenda has canonical zero aggregate');
reset role;
-- Simulate the persisted choice of liquidity without modifying the product kind.
update finance.ledger_accounts set liquidity = 'cash' where id = (select ledger_account_id from finance.financial_accounts where id = :'savings');
set local role authenticated;
select is((select a->>'kind' from jsonb_array_elements(api.workspace_snapshot(:'space')->'accounts') a where a->>'id' = :'savings'),'savings','Changing ledger liquidity keeps the savings product kind');
select is((select sum((a->>'balance_cents')::bigint)::bigint from jsonb_array_elements(api.workspace_snapshot(:'space')->'accounts') a where a->>'liquidity' = 'cash'),16000::bigint,'Balance follows ledger liquidity rather than the product kind');
set constraints all immediate;
select * from finish();
rollback;
