begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(31);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000229','funding@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000229","role":"authenticated"}',true);
select api.create_personal_space('Aportes') as space \gset
select api.create_financial_account(:'space','Banco','checking',1000000,'2026-09-01') as bank \gset
select api.create_category(:'space','Salário','income',null,'recurring') as salary \gset
select api.create_category(:'space','IPVA','expense') as expense \gset
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Renda principal','direction','inflow','unit','month','starts_on','2026-09-05','day_of_month',5,'is_main_income',true,'amount_cents',600000,'certainty','confirmed','category_id',:'salary','payment_method','account','payment_financial_account_id',:'bank'))->>'id' as rule \gset
select api.create_reserve(:'space',jsonb_build_object('reserve_type','provision','name','IPVA','financial_account_id',:'bank','category_id',:'expense','target_amount_cents',240000,'target_date','2027-01-15')) as reserve \gset
reset role;
update finance.reserves set created_at='2026-10-02 15:00:00+00' where id=:'reserve';
select is(private.reserve_funding_dates(:'space','2026-10-02','2027-01-15')->'dates','["2026-10-05","2026-11-05","2026-12-07","2027-01-05"]'::jsonb,'CT-GOAL-003 effective income days before target');
select is(private.reserve_funding_dates(:'space','2026-10-02','2027-01-15')->>'lastOn','2026-09-08','Creation cycle uses holiday-adjusted previous income');
select is(private.reserve_funding_dates(:'space','2026-10-02','2027-01-15')->>'immediate','false','Late creation within cycle has no immediate contribution');
select is(private.reserve_funding_dates(:'space','2026-10-20','2027-01-15')->'dates','["2026-10-20","2026-11-05","2026-12-07","2027-01-05"]'::jsonb,'First half including the midpoint receives an immediate contribution');
select is((private.reserve_funding_plan(:'space',:'reserve','2026-10-02')->>'suggestedCents')::bigint,60000::bigint,'CT-GOAL-003 target2400 split across four income dates');
set local role authenticated;
select api.configure_reserve_plan(:'space',:'reserve',1,'{"contribution_mode":"automatic"}');
select is((select count(*) from finance.reserve_funding_events where reserve_id=:'reserve'),0::bigint,'Automatic contribution waits for actual receipt of income');
select id as income from finance.commitments where recurrence_rule_id=:'rule' and period_key='2026-10-01' \gset
select api.settle_commitment(:'space',:'income',100000,'2026-10-06','partial',null,'bbbbbbbb-0000-4000-8000-000000000229') as partial \gset
select is((select count(*) from finance.reserve_funding_events where reserve_id=:'reserve'),0::bigint,'Partial income does not fire the contribution');
select api.settle_commitment(:'space',:'income',500000,'2026-10-06','partial',null,'bbbbbbbb-0000-4000-8000-000000000230') as received \gset
select is((select amount_cents from finance.reserve_contributions where reserve_id=:'reserve' and origin='automatic'),60000::bigint,'Late income recalculates including its postponed contribution');
select is((select occurred_on from finance.reserve_contributions where reserve_id=:'reserve' and origin='automatic'),'2026-10-06'::date,'Automatic contribution is dated on actual receipt');
select is((select scheduled_for from finance.reserve_funding_events where reserve_id=:'reserve'),'2026-10-05'::date,'Original scheduled date remains available for audit');
select is(api.process_reserve_funding(:'space'),0,'Repeated funding job cannot repeat a cycle');
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space'),3::bigint,'Separating money never posts a financial transaction');
select is((api.reserve_summary(:'space')->'reserves'->0->>'balance_cents')::bigint,60000::bigint,'Reserve balance reflects the automatic contribution');
select api.configure_reserve_plan(:'space',:'reserve',3,'{"quotas":[{"due_on":"2027-01-15","amount_cents":90000},{"due_on":"2027-02-15","amount_cents":90000},{"due_on":"2027-03-15","amount_cents":90000}],"contribution_mode":"manual"}');
select is((select target_amount_cents from finance.reserves where id=:'reserve'),270000::bigint,'Quota change updates target atomically');
select is((select target_date from finance.reserves where id=:'reserve'),'2027-03-15'::date,'Last quota defines the final target date');
select is((select count(*) from finance.commitment_settlements where reserve_id=:'reserve' and settlement_status='pending'),3::bigint,'Each active quota is a linked commitment');
select is((api.reserve_funding_summary(:'space','2026-11-20')->'plans'->0->>'suggestedCents')::bigint,52500::bigint,'Cumulative targets choose maximum contribution and retain prior reserved money');
select throws_ok(format('select api.configure_reserve_plan(%L,%L,3,%L)',:'space',:'reserve','{"contribution_mode":"manual"}'),'40001','Reserve changed; reload before editing','Funding configuration checks optimistic version');
select api.workspace_snapshot(:'space')#>>'{space,today}' as today \gset
select api.create_reserve(:'space',jsonb_build_object('name','Meta manual','financial_account_id',:'bank','target_amount_cents',12000,'target_date','2027-01-15')) as manual_goal \gset
select api.confirm_reserve_funding(:'space',:'manual_goal',:'today',4500,false,:'today','bbbbbbbb-0000-4000-8000-000000000231') as manual_event \gset
select is((select contributed_cents from finance.reserve_funding_events where id=:'manual_event'),4500::bigint,'User can change the suggested amount when confirming a manual cycle');
select is(api.confirm_reserve_funding(:'space',:'manual_goal',:'today',4500,false,:'today','bbbbbbbb-0000-4000-8000-000000000231'),:'manual_event'::uuid,'Manual confirmation replay keeps one cycle event');
select throws_ok(format('select api.confirm_reserve_funding(%L,%L,%L,4600,false,%L)',:'space',:'manual_goal',:'today',:'today'),'23505','Contribution date already processed with different instructions','Changed replay cannot alter an already confirmed cycle');
select api.create_reserve(:'space',jsonb_build_object('name','Meta dispensada','financial_account_id',:'bank','target_amount_cents',12000,'target_date','2027-01-15')) as dismissed_goal \gset
select api.confirm_reserve_funding(:'space',:'dismissed_goal',:'today',0,true,:'today') as dismissed_event \gset
select is((select count(*) from finance.reserve_contributions where reserve_id=:'dismissed_goal'),0::bigint,'Dismissing a cycle records the decision without separating money');
select api.create_space('Capacidade limitada') as small_space \gset
select api.create_financial_account(:'small_space','Conta limitada','checking',30000,:'today') as small_bank \gset
select api.create_category(:'small_space','Imposto','expense') as small_expense \gset
select api.create_reserve(:'small_space',jsonb_build_object('reserve_type','provision','name','Imposto próximo','financial_account_id',:'small_bank','category_id',:'small_expense','target_amount_cents',24000,'target_date','2026-10-20','contribution_mode','automatic')) as limited \gset
select is((select amount_cents from finance.reserve_contributions where reserve_id=:'limited'),6000::bigint,'Automatic funding is capped by canonical conservative capacity');
select is((select shortfall_cents from finance.reserve_funding_events where reserve_id=:'limited'),18000::bigint,'Capacity shortfall is retained for recalculation and audit');
select is((select count(*) from finance.notifications where financial_space_id=:'small_space' and type='provision_behind'),1::bigint,'Insufficient capacity creates the behind-schedule alert once');
select api.create_reserve(:'space',jsonb_build_object('reserve_type','provision','name','Provisão do job','financial_account_id',:'bank','category_id',:'expense','target_amount_cents',10000,'target_date','2027-01-15')) as service_reserve \gset
reset role;
select is(private.reserve_funding_dates(:'space','2026-10-05','2027-01-05')->'dates','["2026-10-05","2026-11-05","2026-12-07"]'::jsonb,'Target day itself is excluded and creation date is deduplicated');
select set_config('request.jwt.claims','',true);
select lives_ok(format('select api.job_reserve_funding()'),'Service job does not require impersonating a member');
select ok(not has_function_privilege('authenticated','private.funding_free_input(uuid,date)','EXECUTE'),'Private system projection is unavailable to clients');
select ok(not has_function_privilege('authenticated','api.job_reserve_funding()','EXECUTE'),'Funding job is service-role-only');
update finance.recurrence_rules set archived_at=now() where id=:'rule';
update finance.reserves set contribution_mode='automatic',created_at='2026-10-02 15:00:00+00' where id=:'service_reserve';
select is(private.reserve_funding_dates(:'space','2026-10-02','2027-01-15')->'dates','["2026-10-02","2026-11-01","2026-12-01","2027-01-01"]'::jsonb,'No income uses calendar cycle without banking adjustment');
select is((api.job_reserve_funding()->>'events')::integer,1,'Service job can execute canonical capacity and post an actual fallback contribution without an auth user');
set constraints all immediate;
select * from finish();
rollback;
