begin;
set search_path=public,extensions;
select plan(5);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000991','payment-totals@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000991","role":"authenticated"}',true);
select api.create_personal_space('Payment totals') as space \gset
select api.create_financial_account(:'space','Bank','checking',100000,'2000-01-01') as bank \gset
select api.create_person(:'space','Payment test') as person \gset
select api.settle_person(:'space',:'person',:'bank','lend',30000,'2000-01-02');
select is((api.people_management_summary(:'space')->'people'->0->>'received_cents')::bigint,0::bigint,'Lending does not count as a payment received');
select api.settle_person(:'space',:'person',:'bank','receive',10000,'2000-01-03') as receipt \gset
select is((api.people_management_summary(:'space')->'people'->0->>'received_cents')::bigint,10000::bigint,'Partial receipt counts as paid');
select is((api.people_management_summary(:'space')->'people'->0->>'balance_cents')::bigint,20000::bigint,'Remaining debt is the canonical balance');
select api.cancel_transaction(:'space',:'receipt',1,'test');
select is((api.people_management_summary(:'space')->'people'->0->>'received_cents')::bigint,0::bigint,'Cancelled receipts are excluded');
select api.settle_person(:'space',:'person',:'bank','receive',30000,'2000-01-04');
select is((api.people_management_summary(:'space')->'people'->0->>'received_cents')::bigint,30000::bigint,'Paid total remains after full settlement');
select * from finish();
rollback;
