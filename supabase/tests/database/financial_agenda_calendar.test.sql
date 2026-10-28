begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(14);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000227','calendar@test.local'),('aaaaaaaa-0000-4000-8000-000000000228','calendar-outsider@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000227","role":"authenticated"}',true);
select api.create_personal_space('Calendário') as space \gset
select api.create_financial_account(:'space','Banco','checking',10000,'2000-01-01') as bank \gset
select api.create_category(:'space','Conta de luz','expense') as category \gset
select api.create_commitment(:'space',jsonb_build_object('title','Conta de luz','direction','outflow','certainty','estimated','amount_cents',1500,'due_on','2000-01-10','category_id',:'category','payment_method','account','payment_financial_account_id',:'bank')) as commitment \gset
select api.edit_commitment(:'space',:'commitment',1,'{"amount_cents":1800,"due_on":"2000-01-15","title":"Luz de janeiro"}');
select is((select due_amount_cents from finance.commitments where id=:'commitment'),1800::bigint,'One occurrence can change its amount');
select is((select nominal_due_on from finance.commitments where id=:'commitment'),'2000-01-15'::date,'Nominal due date is persisted separately');
select is((select effective_due_on from finance.commitments where id=:'commitment'),'2000-01-17'::date,'Changing nominal date reapplies banking calendar');
select ok((select user_modified_at is not null from finance.commitments where id=:'commitment'),'Touched occurrence is protected against generator overwrite');
select throws_ok(format('select api.edit_commitment(%L,%L,1,%L)',:'space',:'commitment','{"title":"Versão antiga"}'),'40001','Commitment changed; reload before editing','Occurrence edits reject stale versions');
select is(jsonb_array_length(api.agenda_month(:'space','2000-01-01')->'items'),1,'Calendar includes an occurrence once');
select is((select item->>'title' from jsonb_array_elements(api.agenda_month(:'space','2000-01-01')->'items') item where item->>'id'=:'commitment'),'Luz de janeiro','Calendar reflects occurrence edits');
select api.settle_commitment(:'space',:'commitment',500,'2000-01-11') as payment \gset
select throws_ok(format('select api.edit_commitment(%L,%L,2,%L)',:'space',:'commitment','{"amount_cents":2000}'),'23514','Cancel linked settlements before changing commitment terms','Financial terms cannot silently change paid installments');
select api.edit_commitment(:'space',:'commitment',2,'{"notes":"Comprovante conferido"}');
select is((select remaining_cents from finance.commitment_settlements where id=:'commitment'),1300::bigint,'Annotations preserve remaining balance');
select api.create_person(:'space','Amigo') as person \gset
select api.create_commitment(:'space',jsonb_build_object('kind','reminder','title','Cobrar amigo','due_on','2000-01-20','person_id',:'person')) as reminder \gset
select api.complete_reminder(:'space',:'reminder',1);
select is((select settlement_status from finance.commitment_settlements where id=:'reminder'),'settled','Reminders can be marked complete without a financial entry');
select api.complete_reminder(:'space',:'reminder',2,false);
select is((select settlement_status from finance.commitment_settlements where id=:'reminder'),'pending','Completed reminder can be reopened');
select throws_ok(format('select api.edit_commitment(%L,%L,3,%L)',:'space',:'reminder','{"amount_cents":100}'),'23514','Reminders cannot receive financial fields','Reminder cannot become a financial commitment implicitly');
select throws_ok(format('select api.agenda_month(%L,%L)',:'space','2000-01-15'),'23514','Month must begin on day one','Month query requires a calendar month');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000228","role":"authenticated"}',true);
select throws_ok(format('select api.agenda_month(%L,%L)',:'space','2000-01-01'),'42501','Space access denied','Calendar respects tenant isolation');
set constraints all immediate;
select * from finish();
rollback;
