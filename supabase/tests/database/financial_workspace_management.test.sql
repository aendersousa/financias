begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(27);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000225','workspace-owner@test.local'),('aaaaaaaa-0000-4000-8000-000000000226','workspace-member@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000225","role":"authenticated"}',true);
select api.create_personal_space('Original') as original \gset
select api.create_space('Casa','America/Manaus','shared') as space \gset
select is(jsonb_array_length(api.my_spaces()),2,'All active spaces are listed');
select is((select count(*) from finance.categories where financial_space_id=:'space' and system_role in('financial_charges','taxes_fees','cashback','benefits','discounts_obtained')),5::bigint,'New space copies five base system categories');
select is((select count(*) from finance.ledger_accounts where financial_space_id=:'space' and account_class='equity'),3::bigint,'Each space owns exactly three equity accounts');
select api.update_space(:'space',1,'Casa nova','America/Sao_Paulo');
select is(api.management_data(:'space')#>>'{space,name}','Casa nova','Administrator can edit space');
select throws_ok(format('select api.update_space(%L,1,%L,%L)',:'space','Old','America/Manaus'),'40001','Space changed; reload before editing','Space changes use optimistic concurrency');
select api.create_financial_account(:'space','Banco','checking',10000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.manage_financial_account(:'space',:'bank',1,'update','{"name":"Conta principal","institution_name":"Banco local"}');
select is((select name from finance.ledger_accounts where id=:'bank_ledger'),'Conta principal','Product and ledger names stay aligned');
select throws_ok(format('select api.manage_financial_account(%L,%L,1,%L)',:'space',:'bank','archive'),'40001','Account changed; reload before editing','Stale account changes are rejected');
select api.create_financial_account(:'space','VR','benefit',0) as benefit \gset
select throws_ok(format('select api.manage_financial_account(%L,%L,1,%L,%L)',:'space',:'benefit','update','{"liquidity":"cash"}'),'23514','Liquidity or emergency reserve is invalid for this account','Benefit cannot become unrestricted cash');
select throws_ok(format('select api.manage_financial_account(%L,%L,2,%L,%L)',:'space',:'bank','update','{"is_emergency_reserve":true}'),'23514','Liquidity or emergency reserve is invalid for this account','Cash cannot be classified as emergency investment');
select api.create_financial_account(:'space','Poupança','savings',5000,'2000-01-01') as savings \gset
select api.manage_financial_account(:'space',:'savings',1,'update','{"liquidity":"cash"}');
select is((api.workspace_snapshot(:'space')#>>'{totals,cash_cents}')::bigint,15000::bigint,'Changing liquidity changes live server totals without changing entries');
select api.account_adjustment(:'space',:'bank','2000-01-02',12000,'Extrato conferido','bbbbbbbb-0000-4000-8000-000000000225') as adjustment \gset
select is((select balance_cents from finance.account_balances where id=:'bank_ledger'),12000::bigint,'Statement balance creates only the difference');
select is((select sum(amount_cents) from finance.ledger_entries where ledger_transaction_id=:'adjustment'),0::numeric,'Adjustment remains double entry');
select is((select account_class from finance.ledger_accounts where id=(select ledger_account_id from finance.ledger_entries where ledger_transaction_id=:'adjustment' and ledger_account_id<>:'bank_ledger')),'equity','Unidentified difference is equity, outside consumption');
select is(api.account_adjustment(:'space',:'bank','2000-01-02',12000,'Extrato conferido','bbbbbbbb-0000-4000-8000-000000000225'),:'adjustment'::uuid,'Retry reuses immutable adjustment receipt');
select throws_ok(format('select api.account_adjustment(%L,%L,%L,12500,%L,%L)',:'space',:'bank','2000-01-02','Extrato conferido','bbbbbbbb-0000-4000-8000-000000000225'),'23505','Client UUID reused with different operation','Retry with changed target cannot create a second adjustment');
select api.create_category(:'space','Moradia','expense') as parent \gset
select api.create_category(:'space','Aluguel','expense',:'parent') as child \gset
select api.create_category(:'space','Mensal','expense',:'child') as grandchild \gset
select throws_ok(format('select api.create_category(%L,%L,%L,%L)',:'space','Quarto nível','expense',:'grandchild'),'23514','Category hierarchy is too deep','Category depth is limited to three levels');
select throws_ok(format('select api.create_category(%L,%L,%L,%L)',:'space','aluguel','expense',:'parent'),'23505',null,'Sibling names ignore case');
select api.manage_category(:'space',:'grandchild',1,'update','{"name":"Aluguel mensal","is_essential":true,"fixity":"fixed"}');
select ok((select is_essential and fixity='fixed' from finance.categories where id=:'grandchild'),'Category planning flags can be edited');
select api.manage_category(:'space',:'grandchild',2,'archive');
select ok((select archived_at is not null from finance.categories where id=:'grandchild'),'Leaf archive preserves category');
select api.manage_category(:'space',:'grandchild',3,'restore');
select ok((select allows_posting from finance.ledger_accounts where id=(select ledger_account_id from finance.categories where id=:'grandchild')),'Restoring a leaf reopens posting');
select id as system_category from finance.categories where financial_space_id=:'space' and system_role='cashback' \gset
select throws_ok(format('select api.manage_category(%L,%L,1,%L)',:'space',:'system_category','archive'),'23514','System category cannot be archived','System roles survive user management');
select api.manage_local_holiday(:'space','2000-01-03','Feriado municipal') as holiday \gset
reset role;
select ok(not private.is_banking_day(:'space','2000-01-03'),'Local holiday changes the banking calendar');
set local role authenticated;
select api.manage_local_holiday(:'space','2000-01-03','',true);
select is((select count(*) from finance.holidays where id=:'holiday'),0::bigint,'Local holiday can be removed');
reset role;
insert into finance.financial_space_members(financial_space_id,user_id,role,status,joined_at) values(:'space','aaaaaaaa-0000-4000-8000-000000000226','member','active',now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000226","role":"authenticated"}',true);
select throws_ok(format('select api.create_financial_account(%L,%L,%L)',:'space','Forbidden','checking'),'42501','Administrator permission required','Member cannot create product registrations');
select throws_ok(format('select api.manage_category(%L,%L,4,%L)',:'space',:'grandchild','archive'),'42501','Administrator permission required','Member cannot change category registrations');
select is(jsonb_array_length(api.my_spaces()),1,'Member sees only the shared space they belong to');
select throws_ok(format('select api.management_data(%L)',:'original'),'42501','Space access denied','Read endpoints enforce space isolation');
set constraints all immediate;
select * from finish();
rollback;
