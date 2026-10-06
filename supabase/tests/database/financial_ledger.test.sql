begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(18);
insert into auth.users(id,email) values
 ('aaaaaaaa-0000-4000-8000-000000000011','ledger-a@test.local'),
 ('bbbbbbbb-0000-4000-8000-000000000012','ledger-b@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000011","role":"authenticated"}',true);
select api.create_personal_space('Espaço A') as space_a \gset
select is(api.create_personal_space('Espaço A'), :'space_a'::uuid,'Personal space creation is idempotent');
select is((select count(*) from finance.ledger_accounts where owner_type='system'),3::bigint,'Exactly three system accounts');
select ok(not has_table_privilege('authenticated','finance.ledger_entries','INSERT'),'No direct entry inserts');
select ok(not has_table_privilege('authenticated','finance.ledger_transactions','DELETE'),'No direct transaction deletion');
reset role;
insert into finance.ledger_accounts(id,financial_space_id,account_class,liquidity,owner_type,name) values
 ('11111111-1111-4111-8111-111111111111',:'space_a','asset','cash','financial_account','Banco'),
 ('22222222-2222-4222-8222-222222222222',:'space_a','expense',null,'category','Mercado');
set local role authenticated;
select api.post_transaction(:'space_a', '{"kind":"expense","occurred_on":"2026-10-01","competence_month":"2026-10-01","description":"Mercado","client_uuid":"33333333-3333-4333-8333-333333333333","entries":[{"ledger_account_id":"11111111-1111-4111-8111-111111111111","amount_cents":-12345},{"ledger_account_id":"22222222-2222-4222-8222-222222222222","amount_cents":12345}]}') as tx \gset
select is((select sum(amount_cents) from finance.ledger_entries where ledger_transaction_id = :'tx'),0::numeric,'INV-LEDGER-001 sum zero');
select is((select balance_cents from finance.account_balances where id = '11111111-1111-4111-8111-111111111111'),-12345::bigint,'Balance is derived from entries');
select is(api.post_transaction(:'space_a', '{"kind":"expense","occurred_on":"2026-10-01","competence_month":"2026-10-01","description":"Mercado","client_uuid":"33333333-3333-4333-8333-333333333333","entries":[{"ledger_account_id":"11111111-1111-4111-8111-111111111111","amount_cents":-12345},{"ledger_account_id":"22222222-2222-4222-8222-222222222222","amount_cents":12345}]}'),:'tx'::uuid,'INV-SYNC-001 repeated payload returns original');
select throws_ok(format($q$select api.post_transaction(%L,'{"kind":"expense","occurred_on":"2026-10-01","competence_month":"2026-10-01","description":"Changed","client_uuid":"33333333-3333-4333-8333-333333333333","entries":[]}')$q$,:'space_a'),'23505','Client UUID reused with different payload','Different replay is rejected');
select throws_ok(format($q$select api.post_transaction(%L,'{"kind":"expense","occurred_on":"2026-10-01","competence_month":"2026-10-01","description":"Bad","entries":[{"ledger_account_id":"11111111-1111-4111-8111-111111111111","amount_cents":-10},{"ledger_account_id":"22222222-2222-4222-8222-222222222222","amount_cents":11}]}')$q$,:'space_a'),'23514','Transaction must sum to zero','Unbalanced posting rejected atomically');
select is((select count(*) from finance.ledger_transactions),1::bigint,'Failed posting leaves no transaction');
select throws_ok(format($q$select api.post_transaction(%L,'{"kind":"expense","occurred_on":"2026-10-01","competence_month":"2026-10-01","description":"Bad","entries":[{"ledger_account_id":"11111111-1111-4111-8111-111111111111","amount_cents":-10.1},{"ledger_account_id":"22222222-2222-4222-8222-222222222222","amount_cents":10.1}]}')$q$,:'space_a'),'23514','Amount must be integer cents','Fractional cents rejected');
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000012","role":"authenticated"}',true);
select api.create_personal_space('Espaço B') as space_b \gset
select is((select count(*) from finance.ledger_transactions),0::bigint,'User B cannot read user A entries');
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'space_a',:'tx','Teste'),'42501','No permission to write to financial space','User B cannot mutate user A transactions');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000011","role":"authenticated"}',true);
select throws_ok(format('select api.cancel_transaction(%L,%L,99,%L)',:'space_a',:'tx','Teste'),'40001','Transaction changed; reload before editing','Optimistic version lock');
select is(api.cancel_transaction(:'space_a',:'tx',1,'Erro de digitação'),:'tx'::uuid,'Transaction cancelled');
select is((select count(*) from finance.ledger_entries where ledger_transaction_id = :'tx'),2::bigint,'Cancellation preserves entries');
select is((select balance_cents from finance.account_balances where id = '11111111-1111-4111-8111-111111111111'),0::bigint,'Cancellation removes effect on balance');
select is((select count(*) from finance.audit_logs where entity_id = :'tx'),2::bigint,'Creation and cancellation audited');
set constraints all immediate;
select * from finish();
rollback;
