begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000340','notifications-complete@test.local'),('bbbbbbbb-0000-4000-8000-000000000340','notifications-complete-view@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000340","role":"authenticated"}',true);
select api.create_space('Notificações completas') as space \gset
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_financial_account(:'space','Banco','checking',0,:'today') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_category(:'space','Salário','income',null,'recurring') as salary \gset
select api.create_category(:'space','Despesas','expense') as category \gset
select ledger_account_id as expense_ledger from finance.categories where id = :'category' \gset
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',date_trunc('month',:'today'::date)::date,'description','Saldo negativo','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'expense_ledger','amount_cents',1),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-1)))) as expense \gset
select api.daily_alerts(:'space');
select is((select count(*) from finance.notifications where type = 'account_negative' and resolved_at is null),1::bigint,'N20 negative financial account emits one active alert');
select is((select count(*) from finance.notifications where type = 'free_to_spend_negative' and resolved_at is null),1::bigint,'N08 conservative negative free balance emits urgent state');
select api.daily_alerts(:'space');
select is((select count(*) from finance.notifications where type in('account_negative','free_to_spend_negative')),2::bigint,'Repeated generation does not duplicate active states');
select api.cancel_transaction(:'space',:'expense',1,'Saldo corrigido');
select api.daily_alerts(:'space');
select is((select count(*) from finance.notifications where type in('account_negative','free_to_spend_negative') and resolved_at is null),0::bigint,'Returning to nonnegative resolves both state alerts');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',date_trunc('month',:'today'::date)::date,'description','Novo episódio negativo','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'expense_ledger','amount_cents',1),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-1)))) as negative_again \gset
select api.daily_alerts(:'space');
select is((select count(*) from finance.notifications where type in('account_negative','free_to_spend_negative')),4::bigint,'A later negative episode receives new state receipts without deleting prior history');
select api.cancel_transaction(:'space',:'negative_again',1,'Segundo episódio resolvido');
select api.check_account_balance(:'space',:'bank',:'today',10,'34000000-0000-4000-8000-000000000001') as check_result \gset
select is((:'check_result'::jsonb->>'difference_cents')::bigint,10::bigint,'Balance check computes difference without posting a correction');
select is((select balance_cents from finance.account_balances where id = :'bank_ledger'),0::bigint,'Reviewing bank statement does not change ledger');
select is(api.check_account_balance(:'space',:'bank',:'today',10,'34000000-0000-4000-8000-000000000001'),:'check_result'::jsonb,'Balance check retry returns original immutable check');
select is((select count(*) from finance.notifications where type = 'account_divergent' and resolved_at is null),1::bigint,'N09 divergent check emits notification');
select api.account_adjustment(:'space',:'bank',:'today',10,'Conferência do extrato');
select api.daily_alerts(:'space');
select is((select count(*) from finance.notifications where type = 'account_divergent' and resolved_at is null),0::bigint,'Explaining bank difference automatically resolves its state alert');
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Renda principal','direction','inflow','unit','month','is_main_income',true,'starts_on',:'today','day_of_month',extract(day from :'today'::date)::integer,'amount_cents',1000,'category_id',:'salary','payment_method','account','payment_financial_account_id',:'bank'))->>'id' as rule \gset
select id as occurrence from finance.commitments where recurrence_rule_id = :'rule' order by period_key limit 1 \gset
reset role;
update finance.commitments set effective_due_on = :'today' where id = :'occurrence';
select private.collect_notifications(:'space','aaaaaaaa-0000-4000-8000-000000000340',true,(:'today'::date+time '08:59') at time zone 'America/Sao_Paulo');
set local role authenticated;
select is((select count(*) from finance.notifications where type = 'main_income_confirm'),0::bigint,'N04 income confirmation waits until nine in the space timezone');
reset role;
select private.collect_notifications(:'space','aaaaaaaa-0000-4000-8000-000000000340',true,(:'today'::date+time '09:00') at time zone 'America/Sao_Paulo');
set local role authenticated;
select is((select count(*) from finance.notifications where type = 'main_income_confirm'),1::bigint,'N04 main income occurrence is asked at nine');
select is(api.defer_income_notification(:'space',:'occurrence'),(:'today'::date+1),'Still not received defers confirmation until the following day');
reset role;
select private.collect_notifications(:'space','aaaaaaaa-0000-4000-8000-000000000340',true,(:'today'::date+time '10:00') at time zone 'America/Sao_Paulo');
select private.collect_notifications(:'space','aaaaaaaa-0000-4000-8000-000000000340',true,(:'today'::date+1+time '09:00') at time zone 'America/Sao_Paulo');
set local role authenticated;
select is((select count(*) from finance.notifications where type = 'main_income_confirm'),2::bigint,'Unreceived income is asked again tomorrow with a new daily key');
select is((select count(*) from finance.notifications where type = 'main_income_overdue' and resolved_at is null),1::bigint,'N05 overdue principal income explains moved planning horizon');
select api.settle_commitment(:'space',:'occurrence',1000,:'today');
select api.daily_alerts(:'space');
select is((select count(*) from finance.notifications where type = 'main_income_overdue' and resolved_at is null),0::bigint,'Receiving main income resolves overdue state');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',:'today'::date+1,'competence_month',date_trunc('month',:'today'::date)::date,'description','Pagamento programado','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'expense_ledger','amount_cents',1),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-1)))) as scheduled \gset
reset role;
select private.collect_notifications(:'space','aaaaaaaa-0000-4000-8000-000000000340',true,(:'today'::date+1+time '09:00') at time zone 'America/Sao_Paulo');
set local role authenticated;
select is((select count(*) from finance.notifications where type = 'scheduled_confirm' and source_id = :'scheduled'),1::bigint,'N06 future-dated entry is confirmed when its financial date arrives');
select api.create_category(:'space','Consumo comparável','expense') as parent_category \gset
select api.create_category(:'space','Filha comparável','expense',:'parent_category') as child_category \gset
select ledger_account_id as child_ledger from finance.categories where id = :'child_category' \gset
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',(date_trunc('month',:'today'::date)-interval '1 month')::date,'competence_month',(date_trunc('month',:'today'::date)-interval '1 month')::date,'description','Consumo anterior','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'child_ledger','amount_cents',1),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-1)))) as prior_consumption \gset
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',date_trunc('month',:'today'::date)::date,'description','Consumo supera anterior','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'child_ledger','amount_cents',2),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-2)))) as current_consumption \gset
select api.daily_alerts(:'space');
select is((select count(*) from finance.notifications where type = 'category_above_previous_month' and source_id = :'parent_category'),1::bigint,'N11 category parent compares all child consumption by competence');
select api.daily_alerts(:'space');
select is((select count(*) from finance.notifications where type = 'category_above_previous_month' and source_id = :'parent_category'),1::bigint,'N11 monthly comparison is emitted only once per parent');
select api.create_reserve(:'space',jsonb_build_object('name','Provisão pendente','reserve_type','provision','financial_account_id',:'bank','target_amount_cents',1000,'target_date',:'today'::date+30,'category_id',:'category')) as provision \gset
reset role;
insert into finance.reserve_funding_events(financial_space_id,reserve_id,scheduled_for,occurred_on,suggested_cents,contributed_cents,shortfall_cents,origin) values(:'space',:'provision',:'today'::date-1,:'today'::date-1,1000,0,1000,'automatic');
select private.collect_notifications(:'space','aaaaaaaa-0000-4000-8000-000000000340',true,(:'today'::date+time '09:00') at time zone 'America/Sao_Paulo');
set local role authenticated;
select is((select count(*) from finance.notifications where type = 'provision_funding_overdue' and resolved_at is null),1::bigint,'N13 insufficient previous provision funding produces overdue state');
reset role;
insert into finance.reserve_funding_events(financial_space_id,reserve_id,scheduled_for,occurred_on,suggested_cents,contributed_cents,shortfall_cents,origin) values(:'space',:'provision',:'today',:'today',1000,1000,0,'confirmed');
select private.collect_notifications(:'space','aaaaaaaa-0000-4000-8000-000000000340',true,(:'today'::date+time '09:00') at time zone 'America/Sao_Paulo');
set local role authenticated;
select is((select count(*) from finance.notifications where type = 'provision_funding_overdue' and resolved_at is null),0::bigint,'Funding the rescheduled contribution resolves its overdue alert');
select api.create_credit_card(:'space','Cartão aviso',10000,1,10,:'bank') as card \gset
select api.open_card_balance(:'space',:'card',(date_trunc('month',:'today'::date)-interval '1 month')::date,100,(date_trunc('month',:'today'::date)-interval '1 month')::date) as card_opening \gset
reset role;
select api.job_card_cycles();
select private.collect_notifications(:'space','aaaaaaaa-0000-4000-8000-000000000340',true,(:'today'::date+time '09:00') at time zone 'America/Sao_Paulo');
set local role authenticated;
select ok(exists(select 1 from finance.notifications where type = 'card_balance_carried'),'N07 card rollover creates a historical receipt with amount carried');
select throws_ok(format('select api.check_account_balance(%L,%L,%L,11,%L)',:'space',:'bank',:'today','34000000-0000-4000-8000-000000000001'),'23505','Client UUID reused with different operation','Balance check UUID rejects changed reported value');
reset role;
insert into finance.financial_space_members(financial_space_id,user_id,role) values(:'space','bbbbbbbb-0000-4000-8000-000000000340','viewer');
select private.collect_notifications(:'space','bbbbbbbb-0000-4000-8000-000000000340',true,(:'today'::date+time '09:00') at time zone 'America/Sao_Paulo');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000340","role":"authenticated"}',true);
select is((select count(*) from finance.notifications),0::bigint,'Viewer has no additional types without explicit preference');
select throws_ok(format('select api.check_account_balance(%L,%L,%L,10)',:'space',:'bank',:'today'),'42501','No permission to write to financial space','Viewer cannot record an account check');
select throws_ok('select api.job_daily_maintenance()','42501',null,'Cross-space maintenance job is denied to authenticated roles');
select throws_ok('select private.collect_extended_notifications(null,null,null,null,false,now())','42501',null,'Client cannot impersonate a notification recipient');
reset role;
select ok(has_function_privilege('service_role','api.job_daily_maintenance()','execute'),'Combined job is granted only to backend service role');
select set_config('request.jwt.claims','',true);
select lives_ok('select api.job_daily_maintenance()','Maintenance runs without impersonating a user');
set constraints all immediate;
select * from finish();
rollback;
