begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(25);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000390','explain-owner@test.local'),('aaaaaaaa-0000-4000-8000-000000000391','explain-viewer@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000390","role":"authenticated"}',true);
select api.create_personal_space('Explicar ajuste') as space \gset
select api.create_financial_account(:'space','Inter','checking',153200,'2000-10-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Alimentação','expense') as food \gset
select api.create_category(:'space','Receita esquecida','income',null,'extraordinary') as income \gset
select api.account_adjustment(:'space',:'bank','2000-10-02',150000,'Extrato','bbbbbbbb-0000-4000-8000-000000000390') as tx \gset
select id as bank_entry from finance.ledger_entries where ledger_transaction_id=:'tx' and ledger_account_id=:'bank_ledger' \gset
select api.reconcile_entry(:'space',:'bank_entry',1,true);
select count(*) as transaction_count from finance.ledger_transactions where financial_space_id=:'space' \gset
select is(api.explain_account_adjustment(:'space',:'tx',2,2000,:'food',null,'Mercado não lançado','cccccccc-0000-4000-8000-000000000390'),:'tx'::uuid,'CT-ADJ-001 edits the existing transaction');
select is((select amount_cents from finance.ledger_entries where id=:'bank_entry'),-3200::bigint,'CT-ADJ-001 keeps the same financial entry and amount');
select is((select reconciliation_status from finance.ledger_entries where id=:'bank_entry'),'reconciled','CT-ADJ-001 preserves statement reconciliation');
select is((api.transaction_detail(:'space',:'tx')->>'unidentified_adjustment_cents')::bigint,1200::bigint,'Unidentified difference falls from 32 to 12 reais');
select is((select sum(e.amount_cents) from finance.ledger_entries e join finance.categories c on c.ledger_account_id=e.ledger_account_id where e.ledger_transaction_id=:'tx' and c.id=:'food'),2000::numeric,'Food consumption becomes 20 reais');
select is((select occurred_on from finance.ledger_transactions where id=:'tx'),'2000-10-02'::date,'Explanation keeps the original financial date');
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space'),:'transaction_count'::bigint,'No extra movement or transaction is created');
select is((select sum(amount_cents) from finance.ledger_entries where ledger_transaction_id=:'tx'),0::numeric,'Partial explanation is balanced');
select is(api.explain_account_adjustment(:'space',:'tx',2,2000,:'food',null,'Mercado não lançado','cccccccc-0000-4000-8000-000000000390'),:'tx'::uuid,'Lost response retry reuses original request even after version changes');
select throws_ok(format('select api.explain_account_adjustment(%L,%L,2,1900,%L,null,%L,%L)',:'space',:'tx',:'food','Mercado não lançado','cccccccc-0000-4000-8000-000000000390'),'23505','Client UUID reused with different operation','Conflicting retry cannot explain the difference twice');
select throws_ok(format('select api.explain_account_adjustment(%L,%L,2,1000,%L,null,%L)',:'space',:'tx',:'food','stale'),'40001','Transaction changed; reload before editing','Explanations require the current version');
select throws_ok(format('select api.explain_account_adjustment(%L,%L,3,1300,%L,null,%L)',:'space',:'tx',:'food','excess'),'23514','Explanation amount and reason required','Cannot explain more than the remaining difference');
select throws_ok(format('select api.explain_account_adjustment(%L,%L,3,100,%L,null,%L)',:'space',:'tx',:'income','wrong direction'),'23514','Active category must match the adjustment direction','Negative bank adjustment cannot be explained as income');
select api.explain_account_adjustment(:'space',:'tx',3,1200,null,null,'Saldo inicial incorreto');
select is((api.transaction_detail(:'space',:'tx')->>'unidentified_adjustment_cents')::bigint,0::bigint,'Full explanation removes unidentified difference');
select is((select count(*) from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id where e.ledger_transaction_id=:'tx' and a.system_role='balance_adjustment'),0::bigint,'No zero-value adjustment entry is left');
select is((select sum(e.amount_cents) from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id where e.ledger_transaction_id=:'tx' and a.system_role='opening'),1200::numeric,'Incorrect opening balance is corrected without new consumption');
select is((select balance_cents from finance.account_balances where id=:'bank_ledger'),150000::bigint,'Bank balance remains unchanged by all explanations');
select throws_ok(format('select api.explain_account_adjustment(%L,%L,4,100,null,null,%L)',:'space',:'tx','none'),'23514','Adjustment has no unidentified difference','An explained adjustment cannot be explained again');
select api.account_adjustment(:'space',:'bank','2000-11-02',151000,'Receita pendente') as positive_tx \gset
select api.explain_account_adjustment(:'space',:'positive_tx',1,1000,:'income','2000-12-01','Receita identificada');
select is((select sum(e.amount_cents) from finance.ledger_entries e join finance.categories c on c.ledger_account_id=e.ledger_account_id where e.ledger_transaction_id=:'positive_tx' and c.id=:'income'),-1000::numeric,'Positive bank difference becomes correctly signed income');
select is((select competence_month from finance.ledger_entries e join finance.categories c on c.ledger_account_id=e.ledger_account_id where e.ledger_transaction_id=:'positive_tx' and c.id=:'income'),'2000-12-01'::date,'Explained part can use a different open competence month');
select api.account_adjustment(:'space',:'bank','2000-12-02',150000,'Fechamento') as closed_tx \gset
select api.close_month(:'space','2000-10-01',true);
select api.close_month(:'space','2000-11-01',true);
select api.close_month(:'space','2000-12-01',true);
select throws_ok(format('select api.explain_account_adjustment(%L,%L,1,1000,%L,null,%L)',:'space',:'closed_tx',:'food','closed'),'23514','Period is closed','Closed financial and competence periods protect explanations');
reset role;
insert into finance.financial_space_members(financial_space_id,user_id,role,status,joined_at) values(:'space','aaaaaaaa-0000-4000-8000-000000000391','viewer','active',now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000391","role":"authenticated"}',true);
select throws_ok(format('select api.explain_account_adjustment(%L,%L,1,1000,%L,null,%L)',:'space',:'closed_tx',:'food','viewer'),'42501','No permission to write to financial space','Viewer cannot change explanations');
select is((api.transaction_detail(:'space',:'closed_tx')->>'unidentified_adjustment_cents')::bigint,1000::bigint,'Viewer may inspect a remaining adjustment');
select api.create_personal_space('Outro espaço') as other_space \gset
select throws_ok(format('select api.explain_account_adjustment(%L,%L,1,1000,null,null,%L)',:'other_space',:'closed_tx','other'),'P0002','Transaction not found','Financial IDs cannot cross spaces');
select ok(not has_function_privilege('authenticated','private.transaction_detail_before_adjustment(uuid,uuid)','execute'),'Read helper cannot be called directly by clients');
set constraints all immediate;
select * from finish();
rollback;
