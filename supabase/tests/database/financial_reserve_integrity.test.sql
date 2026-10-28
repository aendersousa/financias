begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(26);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000251','reserve-integrity@test.local'),('aaaaaaaa-0000-4000-8000-000000000252','reserve-provision-integrity@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000251","role":"authenticated"}',true);
select api.create_personal_space('Integridade de reservas') as space \gset
select api.create_financial_account(:'space','Banco','checking',500000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Viagem','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id=:'category' \gset
select api.create_category(:'space','Outra despesa','expense') as other_category \gset
select ledger_account_id as other_ledger from finance.categories where id=:'other_category' \gset
select api.create_reserve(:'space',jsonb_build_object('name','Viagem encerrada','financial_account_id',:'bank','target_amount_cents',10000)) as goal \gset
select api.reserve_contribution(:'space',:'goal','contribution',10000,'2000-01-01');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2000-01-02','competence_month','2000-01-01','description','Viagem original','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'category_ledger','reserve_id',:'goal','amount_cents',6000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-6000)))) as purchase \gset
select api.manage_reserve(:'space',:'goal',(select version from finance.reserves where id=:'goal'),'close','{"on":"2000-01-03"}');
select lives_ok(format($q$select api.edit_transaction(%L,%L,1,jsonb_build_object('kind','expense','occurred_on','2000-01-02','competence_month','2000-01-01','description','Viagem corrigida','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',%L,'reserve_id',%L,'amount_cents',5000),jsonb_build_object('ledger_account_id',%L,'amount_cents',-5000))),'Corrigir valor original')$q$,:'space',:'purchase',:'category_ledger',:'goal',:'bank_ledger'),'Open-period edit may retain the historical link to a closed goal');
select is((select reserve_id from finance.ledger_entries where ledger_transaction_id=:'purchase' and ledger_account_id=:'category_ledger'),:'goal'::uuid,'Replacement retains the original reserve pair');
select throws_ok(format($q$select api.edit_transaction(%L,%L,2,jsonb_build_object('kind','expense','occurred_on','2000-01-02','competence_month','2000-01-01','description','Outra categoria','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',%L,'reserve_id',%L,'amount_cents',5000),jsonb_build_object('ledger_account_id',%L,'amount_cents',-5000))),'Mudar vínculo para outra partida')$q$,:'space',:'purchase',:'other_ledger',:'goal',:'bank_ledger'),'23514','Reserve is not active','Retention context does not authorize a different account/reserve pair');
select throws_ok(format($q$select api.edit_transaction(%L,%L,2,jsonb_build_object('kind','expense','occurred_on','2000-01-02','competence_month','2000-01-01','description','Duplicar vínculo antigo','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',%L,'reserve_id',%L,'amount_cents',5000),jsonb_build_object('ledger_account_id',%L,'amount_cents',-6000),jsonb_build_object('ledger_account_id',%L,'reserve_id',%L,'amount_cents',1000))),'Tentar duplicar vínculo antigo')$q$,:'space',:'purchase',:'category_ledger',:'goal',:'bank_ledger',:'category_ledger',:'goal'),'23514','Reserve is not active','Retention context cannot be reused for an additional entry');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2000-01-04','competence_month','2000-01-01','description','Despesa comum','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',1000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-1000)))) as unlinked_purchase \gset
select throws_ok(format($q$select api.edit_transaction(%L,%L,1,jsonb_build_object('kind','expense','occurred_on','2000-01-04','competence_month','2000-01-01','description','Vínculo novo','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',%L,'reserve_id',%L,'amount_cents',1000),jsonb_build_object('ledger_account_id',%L,'amount_cents',-1000))),'Tentar criar vínculo novo')$q$,:'space',:'unlinked_purchase',:'category_ledger',:'goal',:'bank_ledger'),'23514','Reserve is not active','An unlinked transaction cannot borrow another transaction retention context');
select throws_ok('select count(*) from private.ledger_edit_reserves','42501','permission denied for table ledger_edit_reserves','Authenticated clients cannot read or populate retention context');
reset role;
select is((select count(*) from private.ledger_edit_reserves),0::bigint,'Successful and failed edits leave no retention context');
set local role authenticated;
select api.create_reserve(:'space',jsonb_build_object('name','Meta ativa','financial_account_id',:'bank','target_amount_cents',10000)) as active_goal \gset
select api.reserve_contribution(:'space',:'active_goal','contribution',1000,'2000-01-05') as january_contribution \gset
select api.reserve_contribution(:'space',:'active_goal','contribution',1000,'2000-02-05') as february_contribution \gset
select api.close_month(:'space','2000-01-01',true);
select lives_ok(format($q$select api.manage_reserve(%L,%L,(select version from finance.reserves where id=%L),'update','{"name":"Nome corrigido"}')$q$,:'space',:'active_goal',:'active_goal'),'Reserve metadata can change without rewriting a closed contribution month');
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,100,%L)',:'space',:'active_goal','contribution','2000-01-05'),'23514','Period is closed','Public contribution rejects a closed period');
reset role;
select throws_ok(format('update finance.reserve_contributions set amount_cents=900 where id=%L',:'january_contribution'),'23514','Reserve contribution period is closed; reopen 2000-01 before changing reserve contributions or provision settlement','Internal writes cannot change a closed contribution amount');
select throws_ok(format('update finance.reserve_contributions set occurred_on=%L where id=%L','2000-02-06',:'january_contribution'),'23514','Reserve contribution period is closed; reopen 2000-01 before changing reserve contributions or provision settlement','Moving a contribution validates its old period');
select throws_ok(format('update finance.reserve_contributions set occurred_on=%L where id=%L','2000-01-06',:'february_contribution'),'23514','Reserve contribution period is closed; reopen 2000-01 before changing reserve contributions or provision settlement','Moving a contribution validates its destination period');
select throws_ok(format('update finance.reserve_contributions set cancelled_at=now() where id=%L',:'january_contribution'),'23514','Reserve contribution period is closed; reopen 2000-01 before changing reserve contributions or provision settlement','Cancelling a closed contribution is blocked');
select throws_ok(format('delete from finance.reserve_contributions where id=%L',:'january_contribution'),'23514','Reserve contribution period is closed; reopen 2000-01 before changing reserve contributions or provision settlement','Deleting a closed contribution is blocked');
select throws_ok(format($q$insert into finance.reserve_contributions(financial_space_id,reserve_id,kind,origin,amount_cents,occurred_on) values(%L,%L,'release','release_on_settlement',1,'2000-01-10')$q$,:'space',:'active_goal'),'23514','Reserve contribution period is closed; reopen 2000-01 before changing reserve contributions or provision settlement','An automatic release cannot be inserted in a closed period');
select throws_ok(format($q$update finance.reserves set status='closed',terminal_on='2000-01-10',terminal_at=clock_timestamp() where id=%L$q$,:'active_goal'),'23514','Reserve contribution period is closed; reopen 2000-01 before changing reserve contributions or provision settlement','A terminal transition cannot bypass a closed period without a release');
set local role authenticated;

-- Cancelling a January payment must not silently cancel a February release while
-- February stays closed. The deferred constraint rejects the entire RPC.
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000252","role":"authenticated"}',true);
select api.create_personal_space('Quitação em dois meses') as provision_space \gset
select api.create_financial_account(:'provision_space','Banco','checking',500000,'2000-01-01') as provision_bank \gset
select ledger_account_id as provision_bank_ledger from finance.financial_accounts where id=:'provision_bank' \gset
select api.create_category(:'provision_space','IPVA','expense') as provision_category \gset
select api.create_reserve(:'provision_space',jsonb_build_object('name','IPVA em cotas','reserve_type','provision','financial_account_id',:'provision_bank','target_amount_cents',10000,'target_date','2000-01-15','category_id',:'provision_category')) as provision \gset
select id as first_commitment from finance.commitments where reserve_id=:'provision' \gset
select api.create_commitment(:'provision_space',jsonb_build_object('title','Cota 2','direction','outflow','certainty','confirmed','amount_cents',10000,'due_on','2000-02-15','category_id',:'provision_category','payment_method','account','payment_financial_account_id',:'provision_bank','reserve_id',:'provision')) as second_commitment \gset
select api.reserve_contribution(:'provision_space',:'provision','contribution',30000,'2000-01-05');
select api.settle_commitment(:'provision_space',:'first_commitment',10000,'2000-01-10') as first_payment \gset
select api.settle_commitment(:'provision_space',:'second_commitment',10000,'2000-02-10') as second_payment \gset
set constraints all immediate;
select id as automatic_release from finance.reserve_contributions where reserve_id=:'provision' and origin='release_on_settlement' and cancelled_at is null \gset
select is((select amount_cents from finance.reserve_contributions where id=:'automatic_release'),10000::bigint,'Settled provision releases its February surplus');
select api.close_month(:'provision_space','2000-01-01',true);
select api.close_month(:'provision_space','2000-02-01',true);
select api.reopen_month(:'provision_space','2000-01-01','Corrigir pagamento de janeiro');
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'provision_space',:'first_payment','Pagamento de janeiro devolvido'),'23514','Reserve contribution period is closed; reopen 2000-02 before changing reserve contributions or provision settlement','January cancellation is atomic when it would change a closed February release');
select is((select status from finance.ledger_transactions where id=:'first_payment'),'posted','Rejected cancellation preserves the January transaction');
select is((select cancelled_at is null from finance.reserve_contributions where id=:'automatic_release'),true,'Rejected cancellation preserves the February automatic release');
select is((select status from finance.reserves where id=:'provision'),'settled','Rejected cancellation preserves provision settlement status');
select is((select balance_cents from finance.account_balances where id=:'provision_bank_ledger'),480000::bigint,'Rejected cancellation preserves cash balances');
select api.reopen_month(:'provision_space','2000-02-01','Permitir correção da quitação');
select lives_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'provision_space',:'first_payment','Pagamento de janeiro devolvido'),'Cancelling succeeds once both affected periods are reopened');
select is((select cancelled_at is not null from finance.reserve_contributions where id=:'automatic_release'),true,'Successful cancellation cancels the automatic release');
select is((select status from finance.reserves where id=:'provision'),'active','Successful cancellation reopens the provision');
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'provision_space','2000-02-10')->'reserves') x where x->>'id'=:'provision'),20000::bigint,'Successful cancellation restores only the remaining derived reserve balance');
select * from finish();
rollback;
