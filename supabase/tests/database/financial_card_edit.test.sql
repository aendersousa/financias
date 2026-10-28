begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(5);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000151','card-edit@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000151","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Teste edição cartão') as space \gset
select api.create_financial_account(:'space','Banco','checking',100000,:'today') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_category(:'space','Mercado','expense') as category \gset
select api.create_credit_card(:'space','Cartão',100000,1,10,:'bank') as card \gset
select api.record_card_purchase(:'space',:'card',:'category',10000,2,:'today','Mercado') as purchase \gset
select jsonb_build_object('kind',t.kind,'occurred_on',t.occurred_on,'competence_month',t.competence_month,'description','Mercado corrigido','entries',jsonb_agg(to_jsonb(e) order by e.line_number))::text as payload
from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id = t.id where t.id = :'purchase' group by t.id \gset
select is(api.edit_transaction(:'space',:'purchase',1,:'payload','Corrigir descrição'),:'purchase'::uuid,'Open card purchase can be edited without losing its statement');
select is((select description from finance.ledger_transactions where id = :'purchase'),'Mercado corrigido','Edited description is persisted');
select is((select count(*) from finance.ledger_entries where ledger_transaction_id = :'purchase' and card_statement_id is not null),2::bigint,'Edit retains statement references');
select is((select sum(installment_number) from finance.ledger_entries where ledger_transaction_id = :'purchase' and card_statement_id is not null),3::bigint,'Edit retains installment numbers');
select api.pay_card(:'space',:'card',:'bank_ledger',1000,:'today') as payment \gset
select throws_ok(format('select api.edit_transaction(%L,%L,1,%L::jsonb,%L)',:'space',:'payment',:'payload','Tentar mudar'),'23514','Operation must be corrected through its dedicated service','Generic edit cannot bypass payment allocation and limit holds');
set constraints all immediate;
select * from finish();
rollback;
