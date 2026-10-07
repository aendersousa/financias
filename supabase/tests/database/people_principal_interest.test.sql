begin;
set search_path=public,extensions;
select plan(6);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000992','interest-totals@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000992","role":"authenticated"}',true);
select api.create_personal_space('Interest totals') as space \gset
select api.create_financial_account(:'space','Bank','checking',100000,'2000-01-01') as bank \gset
select api.create_person(:'space','Interest test') as person \gset
select api.create_category(:'space','Interest','income',null,'financial') as category \gset
select api.settle_person(:'space',:'person',:'bank','lend',30000,'2000-01-02');
select api.settle_person_with_interest(:'space',:'person',:'bank','receive',11000,1000,:'category','2000-01-03',gen_random_uuid()) as payment \gset
select is((api.people_management_summary(:'space')->'people'->0->>'lent_cents')::bigint,30000::bigint,'Principal lent stays at original amount');
select is((api.people_management_summary(:'space')->'people'->0->>'received_cents')::bigint,11000::bigint,'Total paid includes principal and interest');
select is((api.people_management_summary(:'space')->'people'->0->>'interest_received_cents')::bigint,1000::bigint,'Only actual interest payments count');
select is((api.people_management_summary(:'space')->'people'->0->>'balance_cents')::bigint,20000::bigint,'Only principal payment reduces debt');
select api.settle_person_with_interest(:'space',:'person',:'bank','receive',500,500,:'category','2000-01-04',gen_random_uuid());
select is((api.people_management_summary(:'space')->'people'->0->>'interest_received_cents')::bigint,1500::bigint,'Interest-only payments count without a person ledger entry');
select api.cancel_transaction(:'space',:'payment',1,'test');
select is((api.people_management_summary(:'space')->'people'->0->>'interest_received_cents')::bigint,500::bigint,'Cancelled interest payments are excluded');
select * from finish();
rollback;
