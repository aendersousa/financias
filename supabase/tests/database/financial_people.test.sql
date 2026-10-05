begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(19);
select is(private.divide_cents(20000,array[1,1,1]::bigint[]),array[6667,6667,6666]::bigint[],'CT-AGENDA-007 payer wins ties');
select is(private.divide_cents(10000,array[1,2]::bigint[]),array[3333,6667]::bigint[],'Weighted largest remainder');
select is(private.divide_cents(10001,array[1,1,1]::bigint[],array[3,2,1]),array[3333,3334,3334]::bigint[],'Last installment wins ties');
select is(private.divide_cents(100,array[3,-1]::bigint[]),array[150,-50]::bigint[],'Signed weights for card payment allocation');
insert into auth.users(id,email) values
 ('aaaaaaaa-0000-4000-8000-000000000061','people-a@test.local'),
 ('bbbbbbbb-0000-4000-8000-000000000062','people-b@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000061","role":"authenticated"}',true);
select api.create_personal_space('Teste pessoas') as space \gset
select api.create_financial_account(:'space','Banco','checking',100000,'2000-10-01') as bank \gset
select api.create_financial_account(:'space','Carteira','wallet',0) as wallet \gset
select api.create_person(:'space','João') as person \gset
select api.create_category(:'space','Restaurante','expense') as category \gset
select api.record_shared_expense(:'space',:'bank',:'category',array[:'person'::uuid],20000,'2000-10-05','Jantar') as dinner \gset
select is((select balance_cents from finance.person_balances where id = :'person'),10000::bigint,'CT-AGENDA-006 João owes only his share');
select is((select b.balance_cents from finance.account_balances b join finance.categories c on c.ledger_account_id = b.id where c.id = :'category'),10000::bigint,'Consumption excludes person share');
select is((select sum(balance_cents) from finance.account_balances where liquidity = 'cash'),80000::numeric,'Cash falls by full restaurant payment');
select api.settle_person(:'space',:'person',:'bank','receive',10000,'2000-10-12') as settlement \gset
select is((select balance_cents from finance.person_balances where id = :'person'),0::bigint,'Person receipt settles receivable');
select is((select count(*) from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id where e.ledger_transaction_id = :'settlement' and a.account_class in ('income','expense')),0::bigint,'Receiving from person is neither income nor expense');
select api.settle_person(:'space',:'person',:'bank','borrow',7500,'2000-10-13') as borrow \gset
select is((select balance_cents from finance.person_balances where id = :'person'),-7500::bigint,'Negative person balance means payable');
select api.settle_person(:'space',:'person',:'bank','pay',7500,'2000-10-14') as pay \gset
select is((select balance_cents from finance.person_balances where id = :'person'),0::bigint,'Paying person clears payable');
select api.transfer_between_accounts(:'space',:'bank',:'wallet',10000,'2000-10-15','11111111-1111-4111-8111-111111111161') as transfer \gset
select is((select sum(balance_cents) from finance.account_balances where liquidity = 'cash'),90000::numeric,'Own transfer preserves total cash');
select is((select count(*) from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id where e.ledger_transaction_id = :'transfer' and a.account_class in ('income','expense')),0::bigint,'Own transfer creates no income or expense');
select is(api.transfer_between_accounts(:'space',:'bank',:'wallet',10000,'2000-10-15','11111111-1111-4111-8111-111111111161'),:'transfer'::uuid,'Transfer replay is idempotent');
select throws_ok(format('select api.transfer_between_accounts(%L,%L,%L,1,%L)',:'space',:'bank',:'bank','2000-10-15'),'23514','Invalid transfer','Same-account transfer rejected');
select throws_ok(format('select api.record_shared_expense(%L,%L,%L,array[%L::uuid,%L::uuid],100,%L,%L)',:'space',:'bank',:'category',:'person',:'person','2000-10-15','Duplicado'),'23514','Select distinct people to share with','Duplicate people rejected');
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000062","role":"authenticated"}',true);
select is((select count(*) from finance.person_balances),0::bigint,'Other user cannot read person debts');
select throws_ok(format('select api.settle_person(%L,%L,%L,%L,1,%L)',:'space',:'person',:'bank','receive','2000-10-15'),'42501','No permission to write to financial space','Other user cannot settle debts');
select throws_ok(format('select api.transfer_between_accounts(%L,%L,%L,1,%L)',:'space',:'bank',:'wallet','2000-10-15'),'42501','No permission to write to financial space','Other user cannot transfer funds');
set constraints all immediate;
select * from finish();
rollback;
