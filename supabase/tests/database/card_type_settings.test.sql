begin;
set search_path=public,extensions;
select plan(4);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000993','card-type@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000993","role":"authenticated"}',true);
select api.create_personal_space('Card type') as space \gset
select api.create_credit_card(:'space','Card',720000,29,4) as card \gset
select api.manage_card(:'space',:'card',1,'settings','{"card_type":"credit"}');
select is((select card_type from finance.credit_cards where id=:'card'),'credit','Credit-only type saves');
select api.manage_card(:'space',:'card',2,'settings','{"card_type":"debit"}');
select is((select card_type from finance.credit_cards where id=:'card'),'debit','Debit-only type saves');
select api.manage_card(:'space',:'card',3,'settings','{"card_type":"both"}');
select is((select card_type from finance.credit_cards where id=:'card'),'both','Combined type saves');
select throws_ok(format('select api.manage_card(%L,%L,4,%L,%L::jsonb)',:'space',:'card','settings','{"card_type":"invalid"}'),'23514','Invalid card type','Invalid type is rejected');
select * from finish();
rollback;
