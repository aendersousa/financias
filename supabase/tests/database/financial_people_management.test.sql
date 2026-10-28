begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000431','people-management@test.local'),('aaaaaaaa-0000-4000-8000-000000000432','people-other@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000431","role":"authenticated"}',true);
select api.create_personal_space() as space \gset
select is((select name from finance.financial_spaces where id=:'space'),'Pessoal','Initial personal space uses the onboarding name');
select is((select count(*) from finance.categories where financial_space_id=:'space' and system_role in('financial_charges','taxes_fees','cashback','benefits','discounts_obtained')),5::bigint,'Initial personal space copies all five base category roles');
select is(api.create_personal_space(),:'space'::uuid,'Repeated initialization reuses the same personal workspace');
select is((select count(*) from finance.categories where financial_space_id=:'space'),5::bigint,'Repeated initialization never duplicates categories');
select is(api.initialize_space_defaults(:'space'),:'space'::uuid,'Explicit onboarding initializer is idempotent for an existing workspace');
select id as charges,version as charges_version from finance.categories where financial_space_id=:'space' and system_role='financial_charges' \gset
select api.manage_category(:'space',:'charges',:'charges_version','update','{"name":"Custos do crédito"}');
select api.create_personal_space();
select is((select name from finance.categories where id=:'charges'),'Custos do crédito','Initialization preserves renamed system roles');
select api.create_space('Casa','America/Sao_Paulo','shared') as shared_space \gset
select id as member_person,version as member_person_version from finance.people where financial_space_id=:'shared_space' and linked_user_id=auth.uid() \gset
select throws_ok(format('select api.manage_person(%L,%L,%L,''archive'')',:'shared_space',:'member_person',:'member_person_version'),'23514','Active member person cannot be archived','Active shared-space member retains its mandatory person account');
select throws_ok(format('select api.manage_person(%L,%L,%L,''opening'',''{"balance_cents":100,"on":"2000-01-01"}'')',:'shared_space',:'member_person',:'member_person_version'),'23514','Person opening requires an unused contact','Contact opening cannot alter a shared member settlement');
select api.create_financial_account(:'space','Banco','checking',100000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.manage_person(:'space',null,null,'create','{"nickname":" João ","notes":"Restaurante"}','11111111-aaaa-4111-8111-111111111431') as person \gset
select ledger_account_id as person_ledger from finance.people where id=:'person' \gset
select is((select nickname from finance.people where id=:'person'),'João','Contact nickname is trimmed');
select is((select account_class||'/'||liquidity from finance.ledger_accounts where id=:'person_ledger'),'asset/person','Person has exactly one asset account with person liquidity');
select is(api.manage_person(:'space',null,null,'create','{"nickname":" João ","notes":"Restaurante"}','11111111-aaaa-4111-8111-111111111431'),:'person'::uuid,'Contact UUID creation is idempotent');
select throws_ok(format('select api.manage_person(%L,null,null,''create'',''{"nickname":"Outra"}'',''11111111-aaaa-4111-8111-111111111431'')',:'space'),'23505','Client UUID reused with different operation','Changing a contact creation payload cannot reuse its UUID');
select throws_ok(format('select api.manage_person(%L,null,null,''create'',''{"nickname":"Outra","cpf":"123"}'')',:'space'),'23514','Person creation accepts nickname and notes only','The contact API accepts no CPF or additional personal data fields');
select throws_ok(format('select api.create_person(%L,''  '')',:'space'),'23514','Invalid person nickname or notes','Legacy constructor also rejects empty nicknames');
select api.manage_person(:'space',:'person',1,'opening','{"balance_cents":3000,"on":"2000-01-02"}','22222222-aaaa-4222-8222-222222222431');
select is((select balance_cents from finance.person_balances where id=:'person'),3000::bigint,'Initial receivable is recorded as positive person balance');
select is((select count(*) from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id where e.ledger_transaction_id in(select ledger_transaction_id from finance.ledger_entries where ledger_account_id=:'person_ledger') and a.account_class in('income','expense')),0::bigint,'Person opening creates neither income nor expense');
select api.manage_person(:'space',:'person',2,'update','{"nickname":"João restaurante","notes":"Devolver depois"}');
select is((select name from finance.ledger_accounts where id=:'person_ledger'),'João restaurante','Renaming a person preserves its accounting identity');
select throws_ok(format('select api.manage_person(%L,%L,2,''update'',''{"nickname":"Obsoleto"}'')',:'space',:'person'),'40001','Person changed; reload before editing','Person updates use optimistic concurrency');
select is(api.manage_person(:'space',:'person',1,'opening','{"balance_cents":3000,"on":"2000-01-02"}','22222222-aaaa-4222-8222-222222222431'),:'person'::uuid,'Opening replay survives editable person notes and nickname');
select throws_ok(format('select api.manage_person(%L,%L,3,''opening'',''{"balance_cents":3000,"on":"2000-01-02"}'')',:'space',:'person'),'23514','Person opening requires an unused contact','A second opening cannot duplicate a person balance');
select throws_ok(format('select api.manage_person(%L,%L,3,''archive'')',:'space',:'person'),'23514','Person balance including scheduled entries must be zero','Cannot archive someone who still owes money');
select api.settle_person(:'space',:'person',:'bank','receive',3000,'2000-01-03','33333333-aaaa-4333-8333-333333333431');
select is((api.person_detail(:'space',:'person')->>'balance_cents')::bigint,0::bigint,'Person detail derives balance from opening and receipt');
select is(jsonb_array_length(api.person_detail(:'space',:'person')->'movements'),2,'Person detail explains every financial movement');
select is((api.person_detail(:'space',:'person')#>>'{movements,0,running_balance_cents}')::bigint,0::bigint,'Chronological movement balances reconcile to zero');
select throws_ok(format('select api.manage_person(%L,null,null,''create'',''{"nickname":"UUID financeiro"}'',''33333333-aaaa-4333-8333-333333333431'')',:'space'),'23505','Client UUID reused with different operation','Financial UUID cannot create a contact');
select throws_ok(format('select api.settle_person(%L,%L,%L,''lend'',1,''2000-01-04'',''11111111-aaaa-4111-8111-111111111431'')',:'space',:'person',:'bank'),'23505','Client UUID reused with different operation','Contact metadata UUID cannot create a settlement');
select api.manage_person(:'space',:'person',3,'archive');
select is(jsonb_array_length(api.people_management_summary(:'space')->'people'),0,'Archived contacts leave active selectors');
select is(jsonb_array_length(api.people_management_summary(:'space',true)->'people'),1,'Archived history remains available explicitly');
select is((select allows_posting from finance.ledger_accounts where id=:'person_ledger'),false,'Archive disables new person entries');
select is(api.manage_person(:'space',:'person',1,'opening','{"balance_cents":3000,"on":"2000-01-02"}','22222222-aaaa-4222-8222-222222222431'),:'person'::uuid,'Opening replay survives archival');
select throws_ok(format('select api.settle_person(%L,%L,%L,''lend'',1,''2000-01-04'')',:'space',:'person',:'bank'),'23514','Person not found or archived','Archived contacts cannot receive new settlements');
select api.manage_person(:'space',:'person',4,'restore');
select is((select allows_posting from finance.ledger_accounts where id=:'person_ledger'),true,'Restore permits person movements again');
select throws_ok(format('select api.manage_person(%L,%L,5,''delete'')',:'space',:'person'),'23514','Only unused and unlinked contacts may be deleted','Financial history prevents deletion');

select api.create_person(:'space','Ana') as payable \gset
select api.manage_person(:'space',:'payable',1,'opening','{"balance_cents":-7500,"on":"2000-01-02"}');
select is((api.people_management_summary(:'space')->>'payable_cents')::bigint,7500::bigint,'Negative person opening is payable and excluded from cash');
select is((select balance_cents from finance.account_balances where id=:'bank_ledger'),103000::bigint,'Opening a payable does not move cash');
select api.create_person(:'space','Contato sem uso') as unused \gset
select api.manage_person(:'space',:'unused',1,'delete');
select throws_ok(format('select api.person_detail(%L,%L)',:'space',:'unused'),'P0002','Person not found','Unused contact is deleted logically');
select is((select count(*) from finance.people where id=:'unused'),1::bigint,'Logical deletion retains the auditable entity');
select api.create_person(:'space','Lembrete') as reminded \gset
select api.create_commitment(:'space',jsonb_build_object('kind','reminder','person_id',:'reminded','title','Conversar sobre o acerto','due_on','2000-01-04')) as reminder \gset
select throws_ok(format('select api.manage_person(%L,%L,1,''delete'')',:'space',:'reminded'),'23514','Only unused and unlinked contacts may be deleted','A reminder prevents contact deletion');
select api.manage_person(:'space',:'reminded',1,'archive');
select is(jsonb_array_length(api.person_detail(:'space',:'reminded')->'reminders'),1,'Archival preserves and lists linked Agenda reminders');
select lives_ok(format('select api.complete_reminder(%L,%L,1)',:'space',:'reminder'),'Existing reminder may still be completed after archive');
select throws_ok(format('select api.create_commitment(%L,%L)',:'space',jsonb_build_object('kind','reminder','person_id',:'reminded','title','Novo vínculo','due_on','2000-01-05')),'23514','Active person required for a new reminder','Archived person cannot acquire new reminder links');
select api.create_person(:'space','Agendado') as scheduled \gset
select ledger_account_id as scheduled_ledger from finance.people where id=:'scheduled' \gset
select (now() at time zone 'America/Sao_Paulo')::date+1 as tomorrow \gset
select api.post_transaction(:'space',jsonb_build_object('kind','person_settlement','occurred_on',:'tomorrow','competence_month',date_trunc('month',(:'tomorrow')::date)::date,'description','Empréstimo amanhã','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'scheduled_ledger','amount_cents',100),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-100)))) as scheduled_tx \gset
select throws_ok(format('select api.manage_person(%L,%L,1,''archive'')',:'space',:'scheduled'),'23514','Person balance including scheduled entries must be zero','Future receivable cannot be hidden by archiving today');
select api.cancel_transaction(:'space',:'scheduled_tx',1,'Cancelar futuro de teste');
select api.manage_person(:'space',:'scheduled',1,'archive');
select throws_ok(format('select api.manage_person(%L,%L,2,''delete'')',:'space',:'scheduled'),'23514','Only unused and unlinked contacts may be deleted','Cancelled financial history also prevents deletion');
select api.create_person(:'space','Abertura zero') as zero \gset
select api.close_month(:'space','2000-01-01',true);
select api.close_month(:'space','2000-02-01');
select throws_ok(format('select api.manage_person(%L,%L,1,''opening'',''{"balance_cents":0,"on":"2000-02-01"}'')',:'space',:'zero'),'23514','Person opening month is closed','Zero person opening cannot bypass a closed month');
select api.manage_person(:'space',:'zero',1,'opening','{"balance_cents":0,"on":"2000-03-01"}','44444444-aaaa-4444-8444-444444444431');
select api.close_month(:'space','2000-03-01');
select is(api.manage_person(:'space',:'zero',1,'opening','{"balance_cents":0,"on":"2000-03-01"}','44444444-aaaa-4444-8444-444444444431'),:'zero'::uuid,'Zero opening replay survives month closing');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000432","role":"authenticated"}',true);
select throws_ok(format('select api.people_management_summary(%L,true)',:'space'),'42501','Space permission required','Other tenant cannot read contacts');
select throws_ok(format('select api.person_detail(%L,%L)',:'space',:'person'),'42501','Space permission required','Other tenant cannot read contact history');
select throws_ok(format('select api.manage_person(%L,null,null,''create'',''{"nickname":"Invasão"}'')',:'space'),'42501','No permission to write to financial space','Other tenant cannot create a contact');
reset role;
insert into finance.financial_space_members(financial_space_id,user_id,role,status) values(:'space','aaaaaaaa-0000-4000-8000-000000000432','viewer','active');
set local role authenticated;
select lives_ok(format('select api.person_detail(%L,%L)',:'space',:'person'),'Viewer may read archived and active person history');
select throws_ok(format('select api.initialize_space_defaults(%L)',:'space'),'42501','Administrator permission required','Viewer cannot initialize categories');
select throws_ok(format('select api.manage_person(%L,%L,5,''update'',''{"nickname":"Invasão"}'')',:'space',:'person'),'42501','No permission to write to financial space','Viewer cannot rename a contact');
select throws_ok(format('update finance.people set notes=''Direto'' where id=%L',:'person'),'42501',null,'Readonly contact table cannot bypass audited services');
reset role;
update finance.financial_space_members set role='member' where financial_space_id=:'space' and user_id='aaaaaaaa-0000-4000-8000-000000000432';
set local role authenticated;
select lives_ok(format('select api.manage_person(%L,null,null,''create'',''{"nickname":"Criado pelo membro"}'')',:'space'),'Member may register a contact');
select throws_ok(format('select api.initialize_space_defaults(%L)',:'space'),'42501','Administrator permission required','Ordinary member cannot initialize category roles');
select ok(not has_function_privilege('authenticated','private.ensure_default_space_categories(uuid)','EXECUTE'),'Clients cannot seed categories outside the authorized personal constructor');
-- Existing personal workspaces are completed without a second workspace or
-- another ledger account for a compatible category already named Cashback.
reset role;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000431","role":"authenticated"}',true);
insert into finance.financial_spaces(name,created_by,created_at) values('Legado','aaaaaaaa-0000-4000-8000-000000000431',now()-interval '1 day') returning id as legacy_space \gset
insert into finance.financial_space_members(financial_space_id,user_id,role,status) values(:'legacy_space','aaaaaaaa-0000-4000-8000-000000000431','owner','active');
insert into finance.space_settings(financial_space_id) values(:'legacy_space');
insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,system_role,name) values(:'legacy_space','equity','system','opening','Abertura'),(:'legacy_space','equity','system','balance_adjustment','Ajuste de saldo'),(:'legacy_space','equity','system','investment_result','Resultado de investimentos');
set local role authenticated;
select api.create_category(:'legacy_space','Cashback','income',null,'recurring') as existing_cashback \gset
select is(api.create_personal_space(),:'legacy_space'::uuid,'Legacy initialization keeps the existing personal workspace');
select is((select count(*) from finance.categories where financial_space_id=:'legacy_space'),5::bigint,'Legacy initialization adds only the four absent roles');
select is((select id from finance.categories where financial_space_id=:'legacy_space' and system_role='cashback'),:'existing_cashback'::uuid,'Compatible existing Cashback category retains its identity');
select is(api.create_personal_space(),:'legacy_space'::uuid,'Completed legacy workspace remains idempotent');
reset role;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000432","role":"authenticated"}',true);
insert into finance.financial_spaces(name,created_by) values('Modelo com grupo','aaaaaaaa-0000-4000-8000-000000000432') returning id as grouped_space \gset
insert into finance.financial_space_members(financial_space_id,user_id,role,status) values(:'grouped_space','aaaaaaaa-0000-4000-8000-000000000432','owner','active');
insert into finance.space_settings(financial_space_id) values(:'grouped_space');
insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,system_role,name) values(:'grouped_space','equity','system','opening','Abertura'),(:'grouped_space','equity','system','balance_adjustment','Ajuste de saldo'),(:'grouped_space','equity','system','investment_result','Resultado de investimentos');
set local role authenticated;
select api.create_category(:'grouped_space','Cashback','income',null,'recurring') as grouped_cashback \gset
select api.create_category(:'grouped_space','Parceiros','income',:'grouped_cashback','recurring');
select api.create_personal_space();
select is((select system_role from finance.categories where id=:'grouped_cashback'),null::text,'An existing homonymous parent is never promoted into a system role');
select is((select name from finance.categories where financial_space_id=:'grouped_space' and system_role='cashback'),'Cashback (sistema 1)','Missing system role gets a separate uniquely named leaf');
select ok((select ledger_account_id is not null from finance.categories where financial_space_id=:'grouped_space' and system_role='cashback'),'Seeded system role always has an account usable by financial services');
set constraints all immediate;
select * from finish();
rollback;
