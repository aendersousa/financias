begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
 ('aaaaaaaa-0000-4000-8000-000000000200','notifications-owner@test.local'),
 ('aaaaaaaa-0000-4000-8000-000000000201','notifications-member@test.local'),
 ('aaaaaaaa-0000-4000-8000-000000000202','notifications-viewer@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000201","role":"authenticated"}',true);
select api.create_personal_space('Outro espaço') as other_space \gset
select api.get_user_settings() as member_settings \gset
select api.update_user_settings(1,'{"notification_preferences":{"agenda":false,"cards":false,"budgets":false,"goals":false,"reserves":false}}') as member_preferences \gset
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000200","role":"authenticated"}',true);
select api.create_personal_space('Alertas') as space \gset
select (api.workspace_snapshot(:'space')->'space'->>'today')::date as today \gset
reset role;
insert into finance.financial_space_members(financial_space_id,user_id,role,status) values
 (:'space','aaaaaaaa-0000-4000-8000-000000000201','member','active'),
 (:'space','aaaaaaaa-0000-4000-8000-000000000202','viewer','active');
set local role authenticated;
select api.create_financial_account(:'space','Banco','checking',100000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Mercado','expense') as category \gset
select ledger_account_id as expense_ledger from finance.categories where id=:'category' \gset
select api.create_budget(:'space',jsonb_build_object('category_id',:'category','amount_cents',10000,'effective_from_month',date_trunc('month',:'today'::date)::date)) as budget \gset
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',date_trunc('month',:'today'::date)::date,'description','Cruza 80 e 90','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'expense_ledger','amount_cents',9500),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-9500)))) as expense \gset
reset role;
select private.refresh_space_notifications(:'space');
set local role authenticated;
select is((select count(*) from finance.notifications where type='budget_threshold'),1::bigint,'Crossing several budget thresholds creates only the highest notification');
select is((select (payload->>'threshold')::integer from finance.notifications where type='budget_threshold'),90,'The highest crossed threshold is 90 percent');
select id as notice,version as notice_version from finance.notifications where type='budget_threshold' \gset
select api.manage_notification(:'space',:'notice',:notice_version,'read') as marked \gset
select ok((select read_at is not null from finance.notifications where id=:'notice'),'Owner can mark their notification read');
select throws_ok(format('select api.manage_notification(%L,%L,1,%L)',:'space',:'notice','archive'),'40001','Notification changed; reload before editing','Stale version cannot overwrite the reading state');
select api.manage_notification(:'space',:'notice',2,'archive') as archived \gset
select ok((select archived_at is not null from finance.notifications where id=:'notice'),'Archiving retains the notification');
select api.daily_alerts(:'space') is not null as refreshed \gset
select is((select count(*) from finance.notifications where type='budget_threshold'),1::bigint,'Refreshing does not reissue an archived notification');
select api.manage_notification(:'space',:'notice',3,'restore') as restored \gset
select api.manage_notification(:'space',:'notice',4,'unread') as unread \gset
select ok((select archived_at is null and read_at is null from finance.notifications where id=:'notice'),'Restore and unread keep the same historical receipt');
select api.refund_transaction(:'space',:'expense',3000,:'today',:'bank') as refund \gset
select api.daily_alerts(:'space') is not null as refreshed \gset
select is((select count(*) from finance.notifications where type='budget_threshold'),1::bigint,'Refund does not emit the suppressed 80 percent threshold');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',date_trunc('month',:'today'::date)::date,'description','Cruza 90 novamente','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'expense_ledger','amount_cents',3000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-3000)))) as recross \gset
select api.daily_alerts(:'space') is not null as refreshed \gset
select is((select count(*) from finance.notifications where type='budget_threshold'),1::bigint,'Crossing an already observed threshold after refund does not repeat');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',date_trunc('month',:'today'::date)::date,'description','Cruza 100','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'expense_ledger','amount_cents',500),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-500)))) as reaches_limit \gset
select api.daily_alerts(:'space') is not null as refreshed \gset
select is((select count(*) from finance.notifications where type='budget_threshold'),2::bigint,'The new 100 percent crossing generates one additional notification');
select api.create_reserve(:'space',jsonb_build_object('name','Viagem','target_amount_cents',10000,'financial_account_id',:'bank')) as goal \gset
select api.reserve_contribution(:'space',:'goal','contribution',10000,:'today',null,gen_random_uuid()) as contribution \gset
reset role;
select private.refresh_space_notifications(:'space');
set local role authenticated;
select is((select count(*) from finance.notifications where type='goal_threshold'),3::bigint,'A goal reports its 50, 75 and 100 percent thresholds once each');
select api.daily_alerts(:'space') is not null as refreshed \gset
select is((select count(*) from finance.notifications where type='goal_threshold'),3::bigint,'Goal threshold notifications are not duplicated by refresh');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000201","role":"authenticated"}',true);
select is((select count(*) from finance.notifications where financial_space_id=:'space' and type in('goal_threshold','budget_threshold')),0::bigint,'Disabled goal and budget preferences suppress notifications for that member');
select is((select count(*) from finance.notifications where user_id='aaaaaaaa-0000-4000-8000-000000000200'),0::bigint,'RLS does not expose another member notifications in a shared space');
select throws_ok(format('select api.manage_notification(%L,%L,5,%L)',:'space',:'notice','read'),'P0002','Notification not found','Another member cannot mark an owner notification');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000202","role":"authenticated"}',true);
select is((select count(*) from finance.notifications where financial_space_id=:'space'),0::bigint,'Viewer receives no types by default');
select throws_ok(format('select api.daily_alerts(%L)',:'other_space'),'42501','Space access denied','Daily generation cannot cross a tenant boundary');
select api.get_user_settings() as viewer_settings \gset
select api.update_user_settings(1,'{"notification_preferences":{"agenda":true}}') as viewer_preferences \gset
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000200","role":"authenticated"}',true);
select api.create_commitment(:'space',jsonb_build_object('title','Vence hoje','direction','outflow','certainty','confirmed','amount_cents',1000,'due_on',:'today','category_id',:'category','payment_method','account','payment_financial_account_id',:'bank')) as due_today \gset
select api.create_commitment(:'space',jsonb_build_object('title','Vence amanhã','direction','outflow','certainty','confirmed','amount_cents',1000,'due_on',:'today'::date+1,'category_id',:'category','payment_method','account','payment_financial_account_id',:'bank')) as due_tomorrow \gset
select api.create_commitment(:'space',jsonb_build_object('title','Venceu ontem','direction','outflow','certainty','confirmed','amount_cents',1000,'due_on',:'today'::date-1,'category_id',:'category','payment_method','account','payment_financial_account_id',:'bank')) as overdue \gset
reset role;
-- Dates are fixed here to isolate daily-alert tests from banking-holiday rules.
update finance.commitments set effective_due_on=:'today' where id=:'due_today';
update finance.commitments set effective_due_on=:'today'::date+1 where id=:'due_tomorrow';
update finance.commitments set effective_due_on=:'today'::date-1 where id=:'overdue';
select private.collect_notifications(:'space','aaaaaaaa-0000-4000-8000-000000000200',true,(:'today'::date+time '09:00') at time zone 'America/Sao_Paulo');
select private.collect_notifications(:'space','aaaaaaaa-0000-4000-8000-000000000201',true,(:'today'::date+time '09:00') at time zone 'America/Sao_Paulo');
select private.collect_notifications(:'space','aaaaaaaa-0000-4000-8000-000000000202',true,(:'today'::date+time '09:00') at time zone 'America/Sao_Paulo');
set local role authenticated;
select is((select count(*) from finance.notifications where type like 'agenda_%'),3::bigint,'Daily generation distinguishes due today, tomorrow and overdue');
select api.daily_alerts(:'space') is not null as refreshed \gset
select is((select count(*) from finance.notifications where type like 'agenda_%'),3::bigint,'Repeated daily generation is idempotent');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000201","role":"authenticated"}',true);
select is((select count(*) from finance.notifications where type in('agenda_due_today','agenda_due_tomorrow')),0::bigint,'Disabled Agenda preferences suppress informational due alerts');
select is((select count(*) from finance.notifications where type='agenda_overdue'),1::bigint,'Urgent overdue alert cannot be disabled in the Central');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000202","role":"authenticated"}',true);
select is((select count(*) from finance.notifications where type like 'agenda_%'),3::bigint,'Viewer receives explicitly enabled Agenda types');
select id as viewer_notice,version as viewer_version from finance.notifications order by id limit 1 \gset
select lives_ok(format('select api.manage_notification(%L,%L,%s,%L)',:'space',:'viewer_notice',:viewer_version,'read'),'Viewer can manage their own reading state');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000200","role":"authenticated"}',true);
select api.settle_commitment(:'space',:'overdue',1000,:'today') as payment \gset
select api.daily_alerts(:'space') is not null as refreshed \gset
select ok((select resolved_at is not null from finance.notifications where source_id=:'overdue' and type='agenda_overdue'),'Paying an overdue commitment resolves its state alert');
-- Deliberately over-reserve after acknowledging the pre-contribution warning.
select api.reserve_contribution(:'space',:'goal','contribution',100000,:'today',null,gen_random_uuid(),api.preview_reserve_contribution(:'space',:'goal','contribution',100000,:'today')->>'approvalToken') as excessive_contribution \gset
select api.daily_alerts(:'space') is not null as refreshed \gset
select is((select count(*) from finance.notifications where type='reserve_uncovered' and resolved_at is null),2::bigint,'Uncovered reserves warn for the holding account and the total cash balance');
select api.reserve_contribution(:'space',:'goal','release',100000,:'today',null,gen_random_uuid()) as release \gset
select api.daily_alerts(:'space') is not null as refreshed \gset
select is((select count(*) from finance.notifications where type='reserve_uncovered' and resolved_at is null),0::bigint,'Covering the reserves resolves their alerts without deleting history');
select api.reserve_contribution(:'space',:'goal','contribution',100000,:'today',null,gen_random_uuid(),api.preview_reserve_contribution(:'space',:'goal','contribution',100000,:'today')->>'approvalToken') as new_excessive_contribution \gset
select api.daily_alerts(:'space') is not null as refreshed \gset
select is((select count(*) from finance.notifications where type='reserve_uncovered'),4::bigint,'A later uncovered episode has new receipts while retaining resolved history');
select is((select count(*) from finance.notifications where type='goal_threshold'),3::bigint,'Falling and recovering the goal never reissues crossed thresholds');
select api.create_category(:'space','Compras cartão','expense') as card_category \gset
select api.create_credit_card(:'space','Cartão',200000,1,10,:'bank') as card \gset
select api.record_card_purchase(:'space',:'card',:'card_category',1000,1,:'today','Compra') as purchase \gset
reset role;
select id as statement from finance.card_statements where credit_card_id=:'card' order by reference_month limit 1 \gset
update finance.card_statements set charges_to_confirm=true,balance_to_install=true where id=:'statement';
select private.refresh_space_notifications(:'space');
set local role authenticated;
select is((select count(*) from finance.notifications where type in('card_charges','card_installment_required')),2::bigint,'Card flags produce distinct charges and financing alerts');
select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version)),'[]') as versions from finance.notifications where read_at is null and archived_at is null and resolved_at is null \gset
select api.read_notifications(:'space',:'versions'::jsonb) as read_count \gset
select is((api.daily_alerts(:'space')->>'unread_count')::bigint,0::bigint,'Bulk reading uses each notification version and clears the unread counter');
select throws_ok(format('update finance.notifications set read_at=now() where id=%L',:'notice'),'42501','permission denied for table notifications','Clients cannot bypass the RPC with direct writes');
reset role;
select ok(not has_function_privilege('authenticated','api.job_daily_alerts(uuid)','execute'),'Authenticated users cannot run a job across spaces');
select ok(not has_function_privilege('anon','api.daily_alerts(uuid)','execute'),'Anonymous users cannot generate or read alerts');
select ok(not has_function_privilege('authenticated','private.collect_notifications(uuid,uuid,boolean,timestamp with time zone)','execute'),'Private actor-scoped generator cannot be called by a client');
select ok(has_function_privilege('service_role','api.job_daily_alerts(uuid)','execute'),'Daily scheduling entry point is limited to the service role');
set constraints all immediate;
select * from finish();
rollback;
