begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000370','queue-owner@test.local'),('bbbbbbbb-0000-4000-8000-000000000370','queue-outsider@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000370","role":"authenticated"}',true);
select api.create_space('Fila original') as space \gset
select api.create_space('Fila destino') as target \gset
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_financial_account(:'space','Carteira','wallet',100000,:'today') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Restaurante','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id=:'category' \gset
select api.create_category(:'space','Salário','income',null,'recurring') as income \gset
select ledger_account_id as income_ledger from finance.categories where id=:'income' \gset
select jsonb_build_object('kind','expense','amountCents',4500,'description','Almoço','occurredOn',:'today','categoryId',:'category','categoryLedgerId',:'category_ledger','accountId',:'bank','accountLedgerId',:'bank_ledger') as content \gset
select jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',left(:'today',7)||'-01','description','Almoço','client_uuid','37000000-0000-4000-8000-000000000001','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',4500),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-4500))) as payload \gset
select is(api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000001',:'content')->>'comparison','missing','A rejected request reserves no UUID and can be corrected');
select api.post_transaction(:'space',:'payload') as tx \gset
select is(api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000001',:'content')->>'comparison','same','CT-SYNC-001: a lost response is the same original request');
select is((api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000001',:'content')#>>'{server,amountCents}')::bigint,4500::bigint,'Read model returns the actual server amount');
select is(api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000001',jsonb_set(:'content','{amountCents}','5400'))->>'comparison','different','CT-SYNC-001: same UUID with 54 instead of 45 is a conflict');
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space',jsonb_set(jsonb_set(:'payload','{entries,0,amount_cents}','5400'),'{entries,1,amount_cents}','-5400')),'23505','Client UUID reused with different payload','Comparison never overwrites the existing server transaction');
select is(api.post_transaction(:'space',:'payload'),:'tx'::uuid,'Original request is still replayable after comparison');
select api.edit_transaction(:'space',:'tx',1,jsonb_set(jsonb_set(jsonb_set(:'payload','{description}','"Almoço corrigido"'),'{entries,0,amount_cents}','4600'),'{entries,1,amount_cents}','-4600'),'Correção conferida pelo usuário');
select is(api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000001',:'content')->>'comparison','same','Original UUID identity survives a server correction');
select is((api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000001',:'content')#>>'{server,amountCents}')::bigint,4600::bigint,'Comparison shows the corrected server fact');
select is((api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000001',:'content')#>>'{original,amountCents}')::bigint,4500::bigint,'Comparison also preserves the original accepted amount');
select api.cancel_transaction(:'space',:'tx',2,'Cancelamento do almoço de teste');
select is(api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000001',:'content')#>>'{server,status}','cancelled','Cancelled server facts remain visible and their UUID remains reserved');
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space' and client_uuid='37000000-0000-4000-8000-000000000001'),1::bigint,'All comparisons are read-only and create no duplicate financial fact');
select is(api.queue_conflict_summary(:'target','37000000-0000-4000-8000-000000000001',:'content')->>'comparison','missing','UUID namespaces and comparisons are scoped by financial space');

select api.create_credit_card(:'space','Cartão',100000,1,15,:'bank') as card \gset
select api.record_card_purchase(:'space',:'card',:'category',3780,1,:'today','Compra rápida',null,'37000000-0000-4000-8000-000000000002') as purchase \gset
select jsonb_build_object('kind','card_purchase','amountCents',3780,'description','','occurredOn',:'today','categoryId',:'category','categoryLedgerId',:'category_ledger','cardId',:'card') as card_content \gset
select is(api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000002',:'card_content')->>'comparison','same','Card comparison understands the default quick description and server-derived statement');
select is(api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000002',jsonb_set(:'card_content','{amountCents}','3781'))->>'comparison','different','Changed card amount conflicts independently of statement derivation');
select is(api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000002',jsonb_set(:'card_content','{description}','"Outra compra"'))->>'comparison','different','Changed card description conflicts');

select api.create_financial_account(:'target','Banco destino','checking',0,:'today') as target_bank \gset
select api.create_category(:'target','Mercado destino','expense') as target_category \gset
select is(jsonb_array_length(api.queue_reassignment_options(:'target','expense')->'accounts'),1,'Recovery offers only active accounts of the target space');
select ok(exists(select 1 from jsonb_array_elements(api.queue_reassignment_options(:'target','expense')->'categories') c where c->>'id'=:'target_category'),'Target categories can be chosen before replacing local references');
select ok(not exists(select 1 from jsonb_array_elements(api.queue_reassignment_options(:'target','expense')->'categories') c where c->>'id'=:'category'),'Original category UUID is never offered as a target category');
select ok(not exists(select 1 from jsonb_array_elements(api.queue_reassignment_options(:'space','income')->'categories') c where c->>'id'=:'category'),'Income recovery excludes expense categories');
select api.archive_financial_account(:'target',:'target_bank',1);
select is(jsonb_array_length(api.queue_reassignment_options(:'target','expense')->'accounts'),0,'Archived accounts are excluded from recovery choices');
select api.create_financial_account(:'space','Aplicação','investment',10000,:'today') as investment \gset
select api.value_asset(:'space',:'investment',:'today',10000,'37000000-0000-4000-8000-000000000003');
select is(api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000003',:'content')->>'comparison','operation','A UUID reserved by a zero-effect financial operation is still a conflict');
select is(api.queue_conflict_summary(:'space','37000000-0000-4000-8000-000000000003',:'content')->>'reservedOperation','value_asset','Recovery identifies the other operation without fabricating a transaction');
select throws_ok(format('select api.queue_conflict_summary(%L,%L,%L::jsonb)',:'space','37000000-0000-4000-8000-000000000001',jsonb_set(:'content','{amountCents}','45.5')),'23514','Invalid queued entry','Comparison rejects fractional cents');
select throws_ok(format('select api.queue_conflict_summary(%L,%L,%L::jsonb)',:'space','37000000-0000-4000-8000-000000000001',jsonb_set(:'content','{occurredOn}','"infinity"')),'23514','Invalid queued entry','Comparison rejects infinite dates before projection');
select throws_ok(format('select api.queue_reassignment_options(%L,%L)',:'space','transfer'),'23514','Invalid queued entry kind','Only offline quick-entry kinds are accepted');
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000370","role":"authenticated"}',true);
select throws_ok(format('select api.queue_conflict_summary(%L,%L,%L::jsonb)',:'space','37000000-0000-4000-8000-000000000001',:'content'),'42501','Space access denied','Nonmembers cannot inspect another user’s UUID or its existence');
select throws_ok(format('select api.queue_reassignment_options(%L,%L)',:'target','expense'),'42501','No permission to write to financial space','Nonmembers cannot read reassignment account/category choices');
select api.create_space('Destino após acesso removido') as outsider_target \gset
select lives_ok(format('select api.queue_reassignment_options(%L,%L)',:'outsider_target','expense'),'Recovery in an accessible destination does not query original-space membership');
select ok(not has_function_privilege('anon','api.queue_conflict_summary(uuid,uuid,jsonb)','execute'),'Anonymous access to comparison is disabled');
select ok(not has_function_privilege('authenticated','private.queue_payload_summary(uuid,jsonb)','execute'),'Private summary cannot bypass API membership checks');
set constraints all immediate;
select * from finish();
rollback;
