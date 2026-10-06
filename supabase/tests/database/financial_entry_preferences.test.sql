begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(17);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000230','models-owner@test.local'),('aaaaaaaa-0000-4000-8000-000000000231','models-member@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000230","role":"authenticated"}',true);
select api.create_personal_space('Modelos') as space \gset
select api.create_financial_account(:'space','Carteira','wallet',10000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Almoço','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id=:'category' \gset
select jsonb_build_object('kind','expense','description','Restaurante','categoryId',:'category','accountId',:'bank','amountCents',4500)::text as payload \gset
select api.save_entry_model(:'space','Meu almoço',:'payload',null,null,'bbbbbbbb-0000-4000-8000-000000000232') as model \gset
select is(api.save_entry_model(:'space','Meu almoço',:'payload',null,null,'bbbbbbbb-0000-4000-8000-000000000232'),:'model'::uuid,'Model creation retry returns one personal preference');
select is(jsonb_array_length(api.entry_preferences(:'space')->'models'),1,'Personal models are readable');
select throws_ok(format('select api.save_entry_model(%L,%L,%L,null,null,%L)',:'space','Outro nome',:'payload','bbbbbbbb-0000-4000-8000-000000000232'),'23505','Client UUID reused with different model','Model creation identity cannot change on retry');
select api.save_entry_model(:'space','Almoço preferido',:'payload',:'model',1);
select throws_ok(format('select api.save_entry_model(%L,%L,%L,%L,1)',:'space','Versão antiga',:'payload',:'model'),'40001','Entry model changed; reload before editing','Editing a preference requires its version');
select api.save_transaction_draft(:'space','Despesa incompleta','{"description":"Ainda vou conferir"}',null,null,'bbbbbbbb-0000-4000-8000-000000000233') as draft \gset
select is(jsonb_array_length(api.entry_preferences(:'space')->'drafts'),1,'Incomplete draft lives outside the journal');
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space'),1::bigint,'Models and drafts do not create financial transactions');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2000-01-02','competence_month','2000-01-01','description','Restaurante Bom Sabor','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',4500),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-4500))));
select is(api.suggest_entry_category(:'space','restaurante')->0->>'categoryId',:'category','Description suggests a category from actual space history');
select is(api.suggest_entry_category(:'space','re'),'[]'::jsonb,'Short descriptions do not produce noise');
select is(api.suggest_entry_category(:'space','restaurante','income'),'[]'::jsonb,'Suggestions respect direction of income or expense');
select api.delete_entry_preference(:'space',:'draft',1,'draft');
select is(jsonb_array_length(api.entry_preferences(:'space')->'drafts'),0,'Removing a draft does not cancel financial history');
reset role;
insert into finance.financial_space_members(financial_space_id,user_id,role,status,joined_at) values(:'space','aaaaaaaa-0000-4000-8000-000000000231','viewer','active',now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000231","role":"authenticated"}',true);
select is(jsonb_array_length(api.entry_preferences(:'space')->'models'),0,'A member cannot read another member personal templates');
select throws_ok(format('select api.delete_entry_preference(%L,%L,2,%L)',:'space',:'model','model'),'P0002','Personal preference not found','A member cannot delete another member preference');
select lives_ok(format('select api.save_entry_model(%L,%L,%L)',:'space','Modelo do leitor',:'payload'),'Viewer may configure personal models without posting');
select throws_ok(format('select api.save_transaction_draft(%L,%L,%L)',:'space','Rascunho','{}'),'42501','No permission to write to financial space','Viewer cannot create a financial draft');
select throws_ok(format('insert into finance.entry_models(financial_space_id,user_id,name,payload,original_request) values(%L,auth.uid(),%L,%L,%L)',:'space','Direto','{}','{}'),'42501',null,'Clients cannot bypass preference APIs with table writes');
select is((select count(*) from finance.entry_models where financial_space_id=:'space'),1::bigint,'RLS exposes only the current member personal preference');
reset role;
select set_config('request.jwt.claims','',true);
select throws_ok(format('select api.entry_preferences(%L)',:'space'),'42501','Space access denied','Unauthenticated users cannot access cached preference source');
set constraints all immediate;
select * from finish();
rollback;
