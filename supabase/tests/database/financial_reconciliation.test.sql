begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(12);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000211','reconciliation@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000211","role":"authenticated"}',true);
select api.create_personal_space('Teste conciliação') as space \gset
select api.create_financial_account(:'space','Banco','checking',100000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_category(:'space','Mercado','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id = :'category' \gset
select jsonb_build_object('kind','expense','occurred_on','2000-01-05','competence_month','2000-01-01','description','Mercado','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',2500),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-2500)))::text as payload \gset
select api.post_transaction(:'space',:'payload') as tx \gset
select id as bank_entry from finance.ledger_entries where ledger_transaction_id = :'tx' and ledger_account_id = :'bank_ledger' \gset
select is((select reconciliation_status from finance.ledger_entries where id = :'bank_entry'),'unreconciled','Financial entry starts unreconciled');
select is((select reconciliation_status from finance.ledger_entries where ledger_transaction_id = :'tx' and ledger_account_id = :'category_ledger'),null::text,'Category entry has no reconciliation status');
select api.reconcile_entry(:'space',:'bank_entry',1,true);
select is((select reconciliation_status from finance.ledger_entries where id = :'bank_entry'),'reconciled','Manual confirmation is persisted');
select throws_ok(format('select api.cancel_transaction(%L,%L,2,%L)',:'space',:'tx','Excluir lançamento'),'23514','Undo reconciliation before cancelling transaction','Reconciled transaction cannot be cancelled');
select throws_ok(format('select api.edit_transaction(%L,%L,2,%L::jsonb,%L)',:'space',:'tx',replace(:'payload','2500','2700'),'Corrigir valor'),'23514','Changing reconciled amounts requires confirmation','Changing reconciled value requires explicit confirmation');
select api.edit_transaction(:'space',:'tx',2,jsonb_set(:'payload'::jsonb,'{description}','"Descrição corrigida"'),'Corrigir descrição');
select is((select reconciliation_status from finance.ledger_entries where ledger_transaction_id = :'tx' and ledger_account_id = :'bank_ledger'),'reconciled','Editing description preserves unchanged reconciliation');
select api.edit_transaction(:'space',:'tx',3,replace(:'payload','2500','2700')::jsonb || '{"acknowledge_reconciliation_change":true}','Corrigir valor conferido');
select id as bank_entry from finance.ledger_entries where ledger_transaction_id = :'tx' and ledger_account_id = :'bank_ledger' \gset
select is((select reconciliation_status from finance.ledger_entries where id = :'bank_entry'),'unreconciled','Confirmed value edit clears reconciliation on changed entry');
select api.close_month(:'space','2000-01-01');
select api.annotate_transaction(:'space',:'tx',4,'{"description":"Mercado anotado","notes":"Conferência documental"}');
select is((select description from finance.ledger_transactions where id = :'tx'),'Mercado anotado','Description and notes may be annotated in closed month');
select lives_ok(format('select api.reconcile_entry(%L,%L,5,true)',:'space',:'bank_entry'),'Reconciliation metadata may change in closed month');
select throws_ok(format('select api.edit_transaction(%L,%L,6,%L::jsonb,%L)',:'space',:'tx',replace(:'payload','2500','2800')::jsonb || '{"acknowledge_reconciliation_change":true}','Tentar alterar fechado'),'23514','Period is closed','Metadata exception never unlocks financial edits');
select is((select balance_cents from finance.account_balances where id = :'bank_ledger'),97300::bigint,'Closed annotations and reconciliation do not alter balance');
select throws_ok(format('select api.transaction_detail(%L,%L)',gen_random_uuid(),:'tx'),'42501','Space access denied','Transaction details are isolated by financial space');
set constraints all immediate;
select * from finish();
rollback;
