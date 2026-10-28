begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(15);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000171','tags-a@test.local'),('aaaaaaaa-0000-4000-8000-000000000172','tags-b@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000172","role":"authenticated"}',true);
select api.create_personal_space('Espaço B') as space_b \gset
select api.create_tag(:'space_b','Tag privada') as tag_b \gset
select api.get_user_settings();
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000171","role":"authenticated"}',true);
select api.create_personal_space('Espaço A') as space \gset
select is((api.get_user_settings()->>'privacy_mode')::boolean,false,'Default privacy preference is false');
select is((api.update_user_settings(1,'{"privacy_mode":true,"theme":"dark"}')->>'privacy_mode')::boolean,true,'Startup privacy preference is stored on server');
select throws_ok($q$select api.update_user_settings(1,'{"theme":"light"}')$q$,'40001','Settings changed; reload before editing','Stale preferences update rejected');
select throws_ok(format('select api.update_user_settings(2,jsonb_build_object(%L,%L))','active_financial_space_id',:'space_b'),'42501','Space access denied','Active space must belong to current user');
select is((select count(*) from finance.user_settings),1::bigint,'User settings are isolated by RLS');
select api.create_financial_account(:'space','Banco','checking',100000,'2000-01-01') as bank \gset
select id as tx from finance.ledger_transactions where financial_space_id = :'space' limit 1 \gset
select api.create_tag(:'space','Viagem') as tag \gset
select api.create_tag(:'space','Férias') as destination \gset
select throws_ok(format('select api.create_tag(%L,%L)',:'space','viagem'),'23505',null,'Tag names are case insensitive');
select api.set_transaction_tags(:'space',:'tx',array[:'tag'::uuid,:'destination'::uuid],'{}');
select is((select count(*) from finance.ledger_transaction_tags where ledger_transaction_id = :'tx'),2::bigint,'Tags attach without writing ledger entries');
select throws_ok(format('select api.set_transaction_tags(%L,%L,%L::uuid[],%L::uuid[])',:'space',:'tx','{}','{}'),'40001','Tags changed; reload before editing','Concurrent tag changes are detected');
select throws_ok(format('select api.set_transaction_tags(%L,%L,%L::uuid[],%L::uuid[])',:'space',:'tx','{' || :'tag_b' || '}','{' || :'tag' || ',' || :'destination' || '}'),'23514','Tag not available in this space','Cross-space tags rejected');
select throws_ok(format('select api.manage_tag(%L,%L,1,%L)',:'space',:'tag','delete'),'23514','Linked tag cannot be deleted','Linked tag cannot be deleted');
select api.manage_tag(:'space',:'tag',1,'merge',null,:'destination');
select is((select count(*) from finance.ledger_transaction_tags where ledger_transaction_id = :'tx'),1::bigint,'Merge deduplicates destination links');
select is((select count(*) from finance.tags where id = :'tag'),0::bigint,'Merged source tag is removed');
reset role;
insert into finance.period_closings(financial_space_id,month,closed_by) values(:'space','2000-01-01','aaaaaaaa-0000-4000-8000-000000000171');
set local role authenticated;
select is(api.set_transaction_tags(:'space',:'tx','{}',array[:'destination'::uuid]),:'tx'::uuid,'Tags may be removed in a closed month');
select is((select sum(balance_cents) from finance.account_balances where financial_space_id = :'space' and liquidity = 'cash'),100000::numeric,'Tag changes preserve balances');
select is((select count(*) from finance.audit_logs where entity_type = 'ledger_transaction' and action = 'tags_changed'),2::bigint,'Tag changes in closed months are audited');
set constraints all immediate;
select * from finish();
rollback;
