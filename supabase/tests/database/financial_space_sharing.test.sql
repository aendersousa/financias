begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000260','ana@sharing.local'),('bbbbbbbb-0000-4000-8000-000000000260','bruno@sharing.local'),('cccccccc-0000-4000-8000-000000000260','carla@sharing.local'),('dddddddd-0000-4000-8000-000000000260','viewer@sharing.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000260","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today,date_trunc('month',now() at time zone 'America/Sao_Paulo')::date as month \gset
select api.create_space('Casa','America/Sao_Paulo','shared') as casa \gset
select api.create_space('Ana pessoal') as ana_space \gset
select api.create_financial_account(:'ana_space','Banco Ana','checking',200000,:'today') as ana_bank \gset
select api.create_financial_account(:'casa','Conta conjunta','checking',0,:'today') as casa_bank \gset
select api.create_category(:'casa','Mercado','expense') as market \gset
select ledger_account_id as market_ledger from finance.categories where id = :'market' \gset
select id as ana_member,person_id as ana_person from finance.financial_space_members where financial_space_id = :'casa' and status = 'active' \gset
select is((select kind from finance.people where id = :'ana_person'),'member','Shared-space owner has member person');
select is((select count(*) from finance.categories where financial_space_id = :'casa' and system_role = 'space_contribution_in'),1::bigint,'Owner receives contribution category');
select api.invite_space_member(:'casa',' BRUNO@SHARING.LOCAL ','member','Bruno') as invitation \gset
select (:'invitation'::jsonb)->>'token' as token,(:'invitation'::jsonb)->>'id' as invitation_id \gset
select is((select char_length(invitation_token_hash) from finance.financial_space_members where id = :'invitation_id'),64,'Invitation stores SHA-256 hash');
select isnt((select invitation_token_hash from finance.financial_space_members where id = :'invitation_id'),:'token','Bearer token is never stored');
select ok((select invitation_expires_at > now()+interval '6 days 23 hours' and invitation_expires_at <= now()+interval '7 days 1 minute' from finance.financial_space_members where id = :'invitation_id'),'Invitation expires after seven days');
select throws_ok(format('select api.accept_space_invitation(%L)',:'token'),'42501','Invitation belongs to another email','Authenticated user must own invited email');
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000260","role":"authenticated"}',true);
select is(api.accept_space_invitation(:'token'),:'casa'::uuid,'Invited email accepts the shared space');
select throws_ok(format('select api.accept_space_invitation(%L)',:'token'),'23514','Invitation has already been used','Invitation is single use');
select id as bruno_member,person_id as bruno_person from finance.financial_space_members where financial_space_id = :'casa' and user_id = 'bbbbbbbb-0000-4000-8000-000000000260' and status = 'active' \gset
select is((select invited_email from finance.financial_space_members where id = :'bruno_member'),null::text,'Accepted email is cleared from invitation');
select is((select nickname from finance.people where id = :'bruno_person'),'Bruno','Accepted member receives their named person account');
select ok(exists(select 1 from finance.notifications where type = 'membership_changed'),'Acceptance emits N-19 membership notification');
select throws_ok(format('select api.invite_space_member(%L,%L,%L)',:'casa','carla@sharing.local','member'),'42501','Administrator permission required','Ordinary member cannot invite');
select throws_ok(format('select api.configure_space_split(%L,1,%L,%L)',:'casa',:'today','equal'),'42501','Administrator permission required','Ordinary member cannot configure division');
select api.create_space('Bruno pessoal') as bruno_space \gset
select api.create_financial_account(:'bruno_space','Banco Bruno','checking',200000,:'today') as bruno_bank \gset
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000260","role":"authenticated"}',true);
select api.manage_space_member(:'casa',:'bruno_member',2,'role','admin');
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000260","role":"authenticated"}',true);
select throws_ok(format('select api.invite_space_member(%L,%L,%L)',:'casa','carla@sharing.local','owner'),'23514','Invalid invitation email or role','Administrator cannot invite owner');
select api.invite_space_member(:'casa','carla@sharing.local','member') as revoked_invitation \gset
select api.invite_space_member(:'casa','viewer@sharing.local','viewer') as expired_invitation \gset
reset role;
update finance.financial_space_members set invitation_expires_at = now()-interval '1 second' where id = (:'expired_invitation'::jsonb->>'id')::uuid;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"dddddddd-0000-4000-8000-000000000260","role":"authenticated"}',true);
select throws_ok(format('select api.accept_space_invitation(%L)',:'expired_invitation'::jsonb->>'token'),'23514','Invitation is invalid or expired','Expired bearer token cannot grant membership');
select is((select count(*) from finance.ledger_transactions where financial_space_id = :'casa'),0::bigint,'Nonmember RLS exposes no journals');
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000260","role":"authenticated"}',true);
select api.revoke_space_invitation(:'casa',(:'revoked_invitation'::jsonb->>'id')::uuid,1);
select set_config('request.jwt.claims','{"sub":"cccccccc-0000-4000-8000-000000000260","role":"authenticated"}',true);
select throws_ok(format('select api.accept_space_invitation(%L)',:'revoked_invitation'::jsonb->>'token'),'23514','Invitation is invalid or expired','Revoked invitation cannot be accepted');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000260","role":"authenticated"}',true);
select throws_ok(format('select api.manage_space_member(%L,%L,1,%L)',:'casa',:'ana_member','leave'),'23514','Last owner cannot leave or be demoted','Last owner must transfer ownership before leaving');
select api.configure_space_split(:'casa',1,:'today','percentage',jsonb_build_array(jsonb_build_object('member_id',:'ana_member','weight',600000),jsonb_build_object('member_id',:'bruno_member','weight',400000)),'26000000-0000-4000-8000-000000000001') as split_id \gset
select is(api.configure_space_split(:'casa',1,:'today','percentage',jsonb_build_array(jsonb_build_object('member_id',:'ana_member','weight',600000),jsonb_build_object('member_id',:'bruno_member','weight',400000)),'26000000-0000-4000-8000-000000000001'),:'split_id'::uuid,'Division version replay is idempotent');
select throws_ok(format('select api.configure_space_split(%L,2,%L,%L,%L::jsonb)',:'casa',:'today','percentage',jsonb_build_array(jsonb_build_object('member_id',:'ana_member','weight',600000),jsonb_build_object('member_id',:'bruno_member','weight',300000))::text),'23514','Percentage weights must sum to 100 percent','Percentages must total exactly one million units');
select api.create_space_transfer(:'ana_space',:'casa',:'ana_bank',:'casa_bank',:'today',150000,'contribution','26000000-0000-4000-8000-000000000002') as ana_transfer \gset
select is(api.create_space_transfer(:'ana_space',:'casa',:'ana_bank',:'casa_bank',:'today',150000,'contribution','26000000-0000-4000-8000-000000000002'),:'ana_transfer'::uuid,'Paired contribution is idempotent');
select is((select count(*) from finance.ledger_transactions where space_transfer_id = :'ana_transfer'),2::bigint,'Transfer has exactly two journals');
select ok((select bool_and(s = 0) from (select sum(e.amount_cents) as s from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where t.space_transfer_id = :'ana_transfer' group by t.id) q),'Both journals balance independently');
select throws_ok(format('select api.create_space_transfer(%L,%L,%L,%L,%L,150001,%L,%L)',:'ana_space',:'casa',:'ana_bank',:'casa_bank',:'today','contribution','26000000-0000-4000-8000-000000000002'),'23505','Client UUID reused with different operation','Transfer UUID cannot be reused with different amount');
select origin_transaction_id as origin_tx,destination_transaction_id as destination_tx from finance.space_transfer_pairs where id = :'ana_transfer' \gset
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'ana_space',:'origin_tx','Desfazer só uma ponta'),'23514','Edit or cancel both space transfer journals together','Generic cancellation cannot orphan the other space');
select throws_ok(format('select api.edit_transaction(%L,%L,1,%L::jsonb,%L)',:'ana_space',:'origin_tx',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',:'month','description','Mudar só origem','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',(select ledger_account_id from finance.financial_accounts where id = :'ana_bank'),'amount_cents',-1),jsonb_build_object('ledger_account_id',(select ledger_account_id from finance.categories where financial_space_id = :'ana_space' and system_role = 'space_transfer_out'),'amount_cents',1)))::text,'Correção só origem'),'23514','Edit or cancel both space transfer journals together','Generic editing cannot mutate one journal');
select api.edit_space_transfer(:'ana_transfer',1,:'today',149999,'Correção do valor','26000000-0000-4000-8000-000000000003');
select is((select amount_cents from finance.space_transfer_pairs where id = :'ana_transfer'),149999::bigint,'Paired correction updates both journal amounts');
select is(api.edit_space_transfer(:'ana_transfer',1,:'today',149999,'Correção do valor','26000000-0000-4000-8000-000000000003'),:'ana_transfer'::uuid,'Paired edit replay precedes stale optimistic version');
select api.edit_space_transfer(:'ana_transfer',2,:'today',150000,'Restaurar valor conferido');
select id as paired_bank_entry from finance.ledger_entries where ledger_transaction_id = :'origin_tx' and reconciliation_status is not null \gset
select api.reconcile_entry(:'ana_space',:'paired_bank_entry',3,true);
select is((select reconciliation_status from finance.ledger_entries where id = :'paired_bank_entry'),'reconciled','Paired journal cash entry can be reconciled without changing its financial pair');
select api.reconcile_entry(:'ana_space',:'paired_bank_entry',4,false);
select api.create_space_transfer(:'ana_space',:'casa',:'ana_bank',:'casa_bank',:'today',1,'contribution') as cancel_pair \gset
select api.cancel_space_transfer(:'cancel_pair',1,'Teste de cancelamento pareado');
select is((select count(*) from finance.ledger_transactions where space_transfer_id = :'cancel_pair' and status = 'cancelled'),2::bigint,'Paired cancellation cancels both journals');
select throws_ok(format('select api.create_budget(%L,%L::jsonb)',:'ana_space',jsonb_build_object('category_id',(select id from finance.categories where financial_space_id = :'ana_space' and system_role = 'space_transfer_out'),'amount_cents',1000,'effective_from_month',:'month')::text),'23514','Budget requires an active consumption category','Space transfer out is outside consumption budgets');
select api.create_space_personal_expense(:'ana_space',:'casa',:'market',:'today',30000,'Mercado pago pela Ana',:'ana_bank') as personal_expense \gset
select is((select balance_cents from finance.person_balances where id = :'ana_person'),-30000::bigint,'Casa owes Ana for personally paid expense');
select api.edit_space_transfer(:'personal_expense',1,:'today',29999,'Corrigir despesa paga pessoalmente','26000000-0000-4000-8000-000000000006');
select is((select balance_cents from finance.person_balances where id = :'ana_person'),-29999::bigint,'Personal expense correction changes matching person debt in both journals');
select api.edit_space_transfer(:'personal_expense',2,:'today',30000,'Restaurar demonstrativo da despesa');
select throws_ok(format('select api.create_loan(%L,%L,%L,0,null,null,null,%L)',:'casa','Reusar correção pareada','loan','26000000-0000-4000-8000-000000000006'),'23505','Client UUID reused with different operation','Paired edit reserves UUID in destination as well as origin');
select api.create_space_transfer(:'ana_space',:'casa',:'ana_bank',:'casa_bank',:'today',30000,'debt_settlement') as debt_pair \gset
select is((select balance_cents from finance.person_balances where id = :'ana_person'),0::bigint,'29.6 matched space transfer reimburses personal expense');
select api.cancel_space_transfer(:'debt_pair',1,'Manter dívida para exemplo de saída');
select is((select balance_cents from finance.person_balances where id = :'ana_person'),-30000::bigint,'Paired reimbursement cancellation restores both person balances');
select is((select coalesce(sum(e.amount_cents),0)::bigint from finance.posted_ledger_entries e join finance.categories c on c.ledger_account_id = e.ledger_account_id where e.financial_space_id = :'ana_space' and c.system_role is distinct from 'space_transfer_out'),0::bigint,'Personally paid Casa expense creates no consumption in personal space');
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000260","role":"authenticated"}',true);
select api.create_space_transfer(:'bruno_space',:'casa',:'bruno_bank',:'casa_bank',:'today',150000,'contribution') as bruno_transfer \gset
select api.post_transaction(:'casa',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',:'month','description','Despesas da Casa','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'market_ledger','amount_cents',270000),jsonb_build_object('ledger_account_id',(select ledger_account_id from finance.financial_accounts where id = :'casa_bank'),'amount_cents',-270000)))) as house_expense \gset
select api.sharing_summary(:'casa',:'month',:'today')->'settlement' as settlement \gset
select is((:'settlement'::jsonb->>'cost_cents')::bigint,300000::bigint,'CT-SHARE D includes Casa expenses paid personally');
select is((select (value->>'settlement_cents')::bigint from jsonb_array_elements(:'settlement'::jsonb->'members') where value->>'member_id' = :'ana_member'),-30000::bigint,'CT-SHARE Ana owes 30000 under sixty percent share');
select is((select (value->>'settlement_cents')::bigint from jsonb_array_elements(:'settlement'::jsonb->'members') where value->>'member_id' = :'bruno_member'),30000::bigint,'CT-SHARE Bruno has 30000 to receive');
select is((select sum((value->>'settlement_cents')::bigint)::bigint from jsonb_array_elements(:'settlement'::jsonb->'members')),0::bigint,'Member settlements sum exactly to zero before exit');
select api.record_member_settlement(:'casa',:'ana_member',:'bruno_member',:'today',30000,'26000000-0000-4000-8000-000000000004') as external_settlement \gset
select is((select sum(abs((value->>'settlement_cents')::bigint))::bigint from jsonb_array_elements(api.sharing_summary(:'casa',:'month',:'today')->'settlement'->'members')),0::bigint,'29.7 external Pix reclassifies contributions and clears both shares');
select is((select balance_cents from finance.person_balances where id = :'ana_person'),-30000::bigint,'External division settlement does not erase separate personal debt');
select api.cancel_transaction(:'casa',:'external_settlement',1,'Manter acerto para exemplo de saída');
select is(api.record_member_settlement(:'casa',:'ana_member',:'bruno_member',:'today',30000,'26000000-0000-4000-8000-000000000004'),:'external_settlement'::uuid,'Cancelled external settlement replay remains idempotent');
select throws_ok(format('select api.create_loan(%L,%L,%L,0,null,null,null,%L)',:'casa','Reusar UUID divisão','loan','26000000-0000-4000-8000-000000000001'),'23505','Client UUID reused with different operation','Nonledger division request reserves UUID across services');
select throws_ok(format('select api.manage_space_member(%L,%L,1,%L,%L)',:'casa',:'ana_member','role','admin'),'42501','Owner permission required','Administrator cannot change roles');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000260","role":"authenticated"}',true);
select api.manage_space_member(:'casa',:'bruno_member',3,'role','owner');
select api.manage_space_member(:'casa',:'ana_member',1,'leave');
select throws_ok(format('select api.sharing_summary(%L)',:'casa'),'42501','Space access denied','Removed member immediately loses read access');
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'casa','{}'),'42501','No permission to write to financial space','Removed member queued mutation is denied by server');
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000260","role":"authenticated"}',true);
select is((select balance_cents from finance.person_balances where id = :'ana_person'),0::bigint,'29.8.4 Ana closing share offsets Casa personal debt');
select is((select kind from finance.people where id = :'ana_person'),'former_member','Leaving person becomes former member');
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'casa',(select ledger_transaction_id from finance.space_split_closures where member_id = :'ana_member'),'Cancelar encerramento'),'23514','Member division closing journal is immutable','Exit closing journal cannot orphan immutable checkpoint');
select alike((select nickname from finance.people where id = :'ana_person'),'%(ex-membro)','Former member nickname identifies their preserved history');
select api.sharing_summary(:'casa',:'month',(:'today'::date+1))->'settlement' as after_exit \gset
select is((select (value->>'settlement_cents')::bigint from jsonb_array_elements(:'after_exit'::jsonb->'members') where value->>'member_id' = :'bruno_member'),30000::bigint,'Checkpoint preserves Bruno claim after Ana leaves');
select is((select (value->>'carry_in_cents')::bigint from jsonb_array_elements(:'after_exit'::jsonb->'members') where value->>'member_id' = :'bruno_member'),30000::bigint,'Read model exposes carried claim and checkpoint');
select is((:'after_exit'::jsonb->>'cost_cents')::bigint,0::bigint,'Checkpoint does not divide the old prefix again');
select is((select balance_cents from finance.account_balances where id = (select ledger_account_id from finance.financial_accounts where id = :'casa_bank')),30000::bigint,'Remaining joint cash backs Bruno preserved 30000 claim');
select api.create_space_transfer(:'bruno_space',:'casa',:'bruno_bank',:'casa_bank',(:'today'::date+1),30000,'withdrawal') as bruno_withdrawal \gset
select api.sharing_summary(:'casa',:'month',(:'today'::date+1))->'settlement' as after_withdrawal \gset
select is((select (value->>'settlement_cents')::bigint from jsonb_array_elements(:'after_withdrawal'::jsonb->'members') where value->>'member_id' = :'bruno_member'),0::bigint,'Withdrawal settles carried Bruno claim instead of creating a new deficit');
select is((select (value->>'carry_settled_cents')::bigint from jsonb_array_elements(:'after_withdrawal'::jsonb->'members') where value->>'member_id' = :'bruno_member'),30000::bigint,'Carry settlement is separately explained');
select throws_ok(format('select api.configure_space_split(%L,3,%L,%L)',:'casa',:'today','equal'),'23514','Division period is already closed','Checkpoint division cannot be retrospectively changed');
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'casa',:'house_expense','Mudar prefixo fechado'),'23514','Member division prefix is already closed','Closed checkpoint cannot be invalidated by old financial cancellation');
select api.create_space('Teste centavos','America/Sao_Paulo','shared') as cents_space \gset
select api.invite_space_member(:'cents_space','ana@sharing.local','member','Ana') as cents_invitation \gset
select api.create_financial_account(:'cents_space','Banco centavos','checking',0,:'today') as cents_bank \gset
select api.create_category(:'cents_space','Centavos','expense') as cents_category \gset
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000260","role":"authenticated"}',true);
select api.accept_space_invitation(:'cents_invitation'::jsonb->>'token');
select api.post_transaction(:'cents_space',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',:'month','description','Um centavo','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',(select ledger_account_id from finance.categories where id = :'cents_category'),'amount_cents',1),jsonb_build_object('ledger_account_id',(select ledger_account_id from finance.financial_accounts where id = :'cents_bank'),'amount_cents',-1)))) as cents_transaction \gset
select is((select sum((value->>'share_cents')::bigint)::bigint from jsonb_array_elements(api.sharing_summary(:'cents_space',:'month',:'today')->'settlement'->'members')),1::bigint,'Largest remainder preserves one cent in equal division');
select is((select sum((value->>'settlement_cents')::bigint)::bigint from jsonb_array_elements(api.sharing_summary(:'cents_space',:'month',:'today')->'settlement'->'members')),0::bigint,'One-cent surplus and shares conserve zero-sum settlement');
select api.create_space('Origem fechamento') as closed_origin \gset
select api.create_space('Destino fechamento') as closed_destination \gset
select api.create_financial_account(:'closed_origin','Origem','checking',100,'2000-01-01') as closed_origin_account \gset
select api.create_financial_account(:'closed_destination','Destino','checking',0,'2000-01-01') as closed_destination_account \gset
select api.create_space_transfer(:'closed_origin',:'closed_destination',:'closed_origin_account',:'closed_destination_account','2000-01-02',50,'contribution','26000000-0000-4000-8000-000000000005') as closed_transfer \gset
select api.close_month(:'closed_origin','2000-01-01',true);
select throws_ok(format('select api.edit_space_transfer(%L,1,%L,51,%L)',:'closed_transfer','2000-01-02','Corrigir mês fechado'),'23514','Period is closed','Either closed space blocks paired editing');
select throws_ok(format('select api.cancel_space_transfer(%L,1,%L)',:'closed_transfer','Cancelar mês fechado'),'23514','Period is closed','Either closed space blocks paired cancellation');
select is((select count(*) from finance.ledger_transactions where space_transfer_id = :'closed_transfer' and status = 'posted'),2::bigint,'Failed closed-period cancellation retains both journals');
select is(api.create_space_transfer(:'closed_origin',:'closed_destination',:'closed_origin_account',:'closed_destination_account','2000-01-02',50,'contribution','26000000-0000-4000-8000-000000000005'),:'closed_transfer'::uuid,'Paired create replay is allowed after closing');
select throws_ok(format('select api.create_space_transfer(%L,%L,%L,%L,%L,1)',:'closed_origin',:'bruno_space',:'closed_origin_account',:'bruno_bank',:'today'),'42501','No permission to write to financial space','Transfer requires writer membership in both spaces');
select throws_ok('select private.lock_spaces(null,null)','42501',null,'Private paired lock cannot be invoked by authenticated clients');
select throws_ok(format('update finance.financial_space_members set role=%L where id=%L','owner',:'ana_member'),'42501',null,'Member role cannot be escalated by direct table update');
select api.create_credit_card(:'closed_origin','Cartão pessoal',100000,20,25,:'closed_origin_account') as personal_card \gset
select api.create_category(:'closed_destination','Despesa cartão pessoal','expense') as card_category \gset
select api.create_space_personal_expense(:'closed_origin',:'closed_destination',:'card_category',:'today',101,'Despesa no cartão pessoal',null,:'personal_card') as personal_card_pair \gset
select api.edit_space_transfer(:'personal_card_pair',1,:'today',103,'Corrigir compra no cartão pessoal');
select is((select amount_cents from finance.space_transfer_pairs where id = :'personal_card_pair'),103::bigint,'Personal credit-card expense also supports paired correction');
select api.cancel_space_transfer(:'personal_card_pair',2,'Cancelar compra de teste pareada');
select is((select count(*) from finance.ledger_transactions where space_transfer_id = :'personal_card_pair' and status = 'cancelled'),2::bigint,'Personal credit-card expense cancels both sides atomically');
set constraints all immediate;
select * from finish();
rollback;
