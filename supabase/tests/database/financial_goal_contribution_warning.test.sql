begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000400','goal-warning@test.local'),('bbbbbbbb-0000-4000-8000-000000000400','goal-outsider@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000400","role":"authenticated"}',true);
select api.create_space('Aviso de aporte') as space \gset
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_financial_account(:'space','Conta','checking',10000,:'today') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Mercado','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id=:'category' \gset
select api.create_reserve(:'space',jsonb_build_object('name','Meta virtual','financial_account_id',:'bank','target_amount_cents',100000)) as goal \gset
select (api.free_to_spend_summary(:'space')#>>'{calculation,conservative,valueCents}')::bigint as initial_free \gset
select count(*) as audits_before from finance.audit_logs where financial_space_id=:'space' \gset
select api.preview_reserve_contribution(:'space',:'goal','contribution',15000,:'today') as preview \gset
select is((:'preview'::jsonb->>'requiresWarning')::boolean,true,'14.5.6: a goal contribution that leaves conservative free money negative warns before confirmation');
select is((:'preview'::jsonb->>'conservativeBeforeCents')::bigint,:'initial_free'::bigint,'Preview uses the canonical current conservative free balance');
select is((:'preview'::jsonb->>'conservativeAfterCents')::bigint,:'initial_free'::bigint-15000,'Preview includes the exact prospective reservation');
select is((select count(*) from finance.reserve_contributions where financial_space_id=:'space'),0::bigint,'Preview writes no contribution');
select is((select count(*) from finance.audit_logs where financial_space_id=:'space'),:'audits_before'::bigint,'Preview writes no audit or financial effect');
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,15000,%L,null,%L)',:'space',:'goal','contribution',:'today','40000000-0000-4000-8000-000000000001'),'23514','Goal contribution leaves conservative free balance negative; review and confirm the warning','Unsafe goal contribution cannot bypass explicit preflight approval');
select is((select count(*) from finance.reserve_contributions where client_uuid='40000000-0000-4000-8000-000000000001'),0::bigint,'A refused confirmation does not reserve its client UUID');
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,14000,%L,null,%L,%L)',:'space',:'goal','contribution',:'today','40000000-0000-4000-8000-000000000001',:'preview'::jsonb->>'approvalToken'),'40001','Contribution preview changed; review the current amount and free balance','Changing the amount invalidates the approval');
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,15000,%L,null,%L,%L)',:'space',:'goal','contribution',(:'today'::date+1)::text,'40000000-0000-4000-8000-000000000001',:'preview'::jsonb->>'approvalToken'),'40001','Contribution preview changed; review the current amount and free balance','Changing the date invalidates the approval');
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,15000,%L,%L,%L,%L)',:'space',:'goal','contribution',:'today','Outra observação','40000000-0000-4000-8000-000000000001',:'preview'::jsonb->>'approvalToken'),'40001','Contribution preview changed; review the current amount and free balance','Changing the note invalidates the exact reviewed request');
select api.manage_reserve(:'space',:'goal',1,'update','{"name":"Meta alterada"}');
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,15000,%L,null,%L,%L)',:'space',:'goal','contribution',:'today','40000000-0000-4000-8000-000000000001',:'preview'::jsonb->>'approvalToken'),'40001','Contribution preview changed; review the current amount and free balance','Changing the reserve plan invalidates approval even if the free amount is unchanged');
select api.preview_reserve_contribution(:'space',:'goal','contribution',15000,:'today') as preview \gset
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on',:'today','competence_month',left(:'today',7)||'-01','description','Novo gasto entre prévia e aporte','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',1000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-1000))));
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,15000,%L,null,%L,%L)',:'space',:'goal','contribution',:'today','40000000-0000-4000-8000-000000000001',:'preview'::jsonb->>'approvalToken'),'40001','Contribution preview changed; review the current amount and free balance','A concurrent expense forces another review immediately before writing');
select api.preview_reserve_contribution(:'space',:'goal','contribution',15000,:'today') as approved \gset
select api.reserve_contribution(:'space',:'goal','contribution',15000,:'today',null,'40000000-0000-4000-8000-000000000001',:'approved'::jsonb->>'approvalToken') as contribution \gset
select is((api.free_to_spend_summary(:'space')#>>'{calculation,conservative,valueCents}')::bigint,(:'approved'::jsonb->>'conservativeAfterCents')::bigint,'Approved write produces exactly the canonical preview balance');
select is(api.reserve_contribution(:'space',:'goal','contribution',15000,:'today',null,'40000000-0000-4000-8000-000000000001',:'approved'::jsonb->>'approvalToken'),:'contribution'::uuid,'Lost-response retry returns the accepted contribution despite its now-stale approval');
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,15001,%L,null,%L,%L)',:'space',:'goal','contribution',:'today','40000000-0000-4000-8000-000000000001',:'approved'::jsonb->>'approvalToken'),'23505','Client UUID reused with different reserve contribution','Changed retry still conflicts and cannot overwrite the accepted contribution');
select is((select count(*) from finance.reserve_contributions where client_uuid='40000000-0000-4000-8000-000000000001'),1::bigint,'Approval and retry record one contribution only');
select is((select balance_cents from finance.account_balances where id=:'bank_ledger'),9000::bigint,'Manual reservation never moves bank cash');
select is((api.preview_reserve_contribution(:'space',:'goal','release',1000,:'today')->>'requiresWarning')::boolean,false,'Releasing money does not use a negative-contribution warning');

-- A backdated contribution can be consumed by a later linked real expense;
-- subtracting the whole requested amount would produce an incorrect warning.
select api.create_space('Prévia cronológica') as chronology \gset
select api.create_financial_account(:'chronology','Conta cronológica','checking',20000,(:'today'::date-3)) as chronology_bank \gset
select ledger_account_id as chronology_bank_ledger from finance.financial_accounts where id=:'chronology_bank' \gset
select api.create_category(:'chronology','Viagem','expense') as chronology_category \gset
select ledger_account_id as chronology_category_ledger from finance.categories where id=:'chronology_category' \gset
select api.create_reserve(:'chronology',jsonb_build_object('name','Viagem','financial_account_id',:'chronology_bank','target_amount_cents',100000)) as chronology_goal \gset
select api.post_transaction(:'chronology',jsonb_build_object('kind','expense','occurred_on',(:'today'::date-1),'competence_month',date_trunc('month',(:'today'::date-1))::date,'description','Despesa vinculada anterior ao cadastro do aporte','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'chronology_category_ledger','amount_cents',4000,'reserve_id',:'chronology_goal'),jsonb_build_object('ledger_account_id',:'chronology_bank_ledger','amount_cents',-4000))));
select api.preview_reserve_contribution(:'chronology',:'chronology_goal','contribution',18000,(:'today'::date-2)) as chronological_preview \gset
select is((:'chronological_preview'::jsonb->>'conservativeAfterCents')::bigint,2000::bigint,'Hypothetical replay consumes the backdated contribution in chronological order');
select is((:'chronological_preview'::jsonb->>'requiresWarning')::boolean,false,'Chronology avoids a false negative warning from subtracting the entire old contribution');
select api.reserve_contribution(:'chronology',:'chronology_goal','contribution',18000,(:'today'::date-2));
select is((api.free_to_spend_summary(:'chronology')#>>'{calculation,conservative,valueCents}')::bigint,2000::bigint,'Real chronological reserve replay agrees with the write-free hypothetical preview');

select api.create_reserve(:'space',jsonb_build_object('reserve_type','provision','name','Provisão','financial_account_id',:'bank','category_id',:'category','target_amount_cents',1000,'target_date',(:'today'::date+60),'contribution_mode','manual')) as provision \gset
select is((api.preview_reserve_contribution(:'space',:'provision','contribution',1000,:'today')->>'requiresWarning')::boolean,false,'Provision funding keeps its own capacity rule and does not show the goal warning');
select api.create_reserve(:'space',jsonb_build_object('name','Meta de ciclo','financial_account_id',:'bank','target_amount_cents',1000,'target_date',(:'today'::date+60),'contribution_mode','manual')) as cycle \gset
reset role;
update finance.reserves set created_at=(date_trunc('month',:'today'::date)::date::text||' 12:00:00 America/Sao_Paulo')::timestamptz where id=:'cycle';
set local role authenticated;
select date_trunc('month',:'today'::date)::date as scheduled \gset
select throws_ok(format('select api.confirm_reserve_funding(%L,%L,%L,1000,false,%L,%L)',:'space',:'cycle',:'scheduled',:'today','40000000-0000-4000-8000-000000000002'),'23514','Goal contribution leaves conservative free balance negative; review and confirm the warning','Manual cycle confirmation also requires the same pre-contribution warning');
select api.preview_reserve_contribution(:'space',:'cycle','contribution',1000,:'today','Confirmação do aporte de '||:'scheduled') as cycle_preview \gset
select api.confirm_reserve_funding(:'space',:'cycle',:'scheduled',1000,false,:'today','40000000-0000-4000-8000-000000000002',:'cycle_preview'::jsonb->>'approvalToken') as cycle_event \gset
select is(api.confirm_reserve_funding(:'space',:'cycle',:'scheduled',1000,false,:'today','40000000-0000-4000-8000-000000000002',:'cycle_preview'::jsonb->>'approvalToken'),:'cycle_event'::uuid,'Approved cycle UUID replay does not duplicate the reserve or funding event');
select is((select count(*) from finance.reserve_funding_events where reserve_id=:'cycle'),1::bigint,'Approved manual cycle produces one funding event');

reset role;
insert into finance.period_closings(financial_space_id,month,closed_by) values(:'space',date_trunc('month',:'today'::date)::date,'aaaaaaaa-0000-4000-8000-000000000400');
set local role authenticated;
select throws_ok(format('select api.preview_reserve_contribution(%L,%L,%L,1000,%L)',:'space',:'goal','contribution',:'today'),'23514',format('Reserve contribution period is closed; reopen %s before changing reserve contributions or provision settlement',left(:'today',7)),'Preview respects closed financial competence before asking for approval');
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000400","role":"authenticated"}',true);
select throws_ok(format('select api.preview_reserve_contribution(%L,%L,%L,1000,%L)',:'space',:'goal','contribution',:'today'),'42501','No permission to write to financial space','Nonmembers cannot inspect goal free-balance previews');
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,15000,%L,null,%L,%L)',:'space',:'goal','contribution',:'today','40000000-0000-4000-8000-000000000001',:'approved'::jsonb->>'approvalToken'),'42501','No permission to write to financial space','Membership is checked even before idempotent replay');
select ok(not has_function_privilege('anon','api.preview_reserve_contribution(uuid,uuid,text,bigint,date,text)','execute'),'Anonymous clients cannot obtain reserve previews');
select ok(not has_function_privilege('authenticated','private.reserve_balance_with_contribution(uuid,uuid,date,date,bigint)','execute'),'Hypothetical replay does not expose a permission bypass');
set constraints all immediate;
select * from finish();
rollback;
