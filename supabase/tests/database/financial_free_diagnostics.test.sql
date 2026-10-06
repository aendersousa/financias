begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(40);
create function pg_temp.diagnose(p_input jsonb) returns jsonb language sql as $$
 select private.free_to_spend_diagnostics(p_input,private.calculate_free_to_spend(p_input));
$$;
create temp table diagnostic_cases(name text primary key,input jsonb);
insert into diagnostic_cases values('A','{
 "today":"2026-10-02","fallbackCycleDay":5,"cashBalanceCents":100000,"safetyReserveCents":30000,"essentialNeedCents":0,
 "commitments":[
  {"id":"salary","direction":"inflow","certainty":"confirmed","paymentLiquidity":"cash","mainIncome":true,"effectiveDueOn":"2026-11-05","dueCents":1,"paidCents":0},
  {"id":"internet","label":"Internet","direction":"outflow","certainty":"confirmed","paymentLiquidity":"cash","effectiveDueOn":"2026-10-08","dueCents":12000,"paidCents":0},
  {"id":"rent","label":"Aluguel","direction":"outflow","certainty":"confirmed","paymentLiquidity":"cash","effectiveDueOn":"2026-10-13","dueCents":150000,"paidCents":0}
 ],"statements":[],"people":[],"scheduled":[],"reserves":[]
}');
insert into diagnostic_cases select 'B',jsonb_set(jsonb_set(jsonb_set(input,'{cashBalanceCents}','560000'),'{commitments}','[
 {"id":"core","label":"Compromissos","direction":"outflow","certainty":"confirmed","paymentLiquidity":"cash","effectiveDueOn":"2026-10-20","dueCents":407000,"paidCents":0}
 ]'),'{reserves}','[
 {"id":"travel","label":"Viagem","reserveType":"goal","targetDate":null,"createdAt":"2026-01-01","holdingMode":"virtual","active":true,"balanceCents":60000},
 {"id":"ipva","label":"IPVA","reserveType":"provision","targetDate":"2026-10-31","createdAt":"2026-01-02","holdingMode":"virtual","active":true,"balanceCents":40000}
 ]')||'{"today":"2026-10-12","essentialNeedCents":30000,"essentialDetails":{"quotas":[{"month":"2026-10-01","grossNeedCents":30000}]}}'::jsonb
 from diagnostic_cases where name='A';
insert into diagnostic_cases select 'C',jsonb_set(input,'{commitments,0,dueCents}','457000') from diagnostic_cases where name='B';

select is(private.diagnostic_brl(150000),'R$ 1.500,00','Canonical currency has Portuguese thousands and decimal separators');
select is(private.diagnostic_brl(1),'R$ 0,01','Canonical currency preserves integer cents');
select is((private.calculate_free_to_spend(input)#>>'{conservative,valueCents}')::bigint,-92000::bigint,'CT-LFG011 A keeps negative Livre') from diagnostic_cases where name='A';
select is(pg_temp.diagnose(input)->>'message','Faltam R$ 620,00 até 13/10. Item descoberto: Aluguel (R$ 620,00 de R$ 1.500,00). Suas reservas também ficam descobertas.','CT-LFG011 A exact canonical text') from diagnostic_cases where name='A';
select is(pg_temp.diagnose(input)#>>'{uncoveredItem,id}','rent','CT-LFG011 A identifies the first negative item') from diagnostic_cases where name='A';
select is((pg_temp.diagnose(input)#>>'{uncoveredItem,uncoveredCents}')::bigint,62000::bigint,'CT-LFG011 A reports only the uncovered part') from diagnostic_cases where name='A';
select is(pg_temp.diagnose(input)->>'message','Suas reservas superam em R$ 70,00 o que sobra depois dos compromissos e dos essenciais. Descoberta: reserva mínima — R$ 70,00 de R$ 300,00.','CT-LFG011 B exact canonical text') from diagnostic_cases where name='B';
select is(pg_temp.diagnose(input)->>'message','Suas reservas superam em R$ 570,00 o que sobra depois dos compromissos e dos essenciais. Descoberta: meta Viagem — R$ 270,00 de R$ 600,00; reserva mínima — R$ 300,00 de R$ 300,00.','CT-LFG011 C exact canonical text and reserve priority') from diagnostic_cases where name='C';
select is((select sum((r->>'uncoveredCents')::bigint)::bigint from jsonb_array_elements(pg_temp.diagnose(input)->'uncoveredReserves') r),57000::bigint,'Uncovered reserves reconcile exactly with negative Livre') from diagnostic_cases where name='C';
select is(pg_temp.diagnose(jsonb_set(input,'{cashBalanceCents}','1000000'))->>'kind','none','Covered calculation requires no warning') from diagnostic_cases where name='C';
select is(pg_temp.diagnose(jsonb_set(input,'{safetyReserveCents}','0'))->>'message','Faltam R$ 620,00 até 13/10. Item descoberto: Aluguel (R$ 620,00 de R$ 1.500,00).','No reserve suffix when none exist') from diagnostic_cases where name='A';
select is(pg_temp.diagnose(jsonb_set(input,'{commitments,2,effectiveDueOn}','"2026-09-01"'))->>'firstNegativeOn','2026-10-02','Overdue obligations have cash date h0') from diagnostic_cases where name='A';
select is(pg_temp.diagnose(jsonb_set(input,'{cashBalanceCents}','-100'))->>'firstNegativeOn','2026-10-02','Negative opening cash is already uncovered at h0') from diagnostic_cases where name='A';
select is(pg_temp.diagnose(jsonb_set(input,'{commitments,2,cashOn}','"2026-11-10"'))->>'firstNegativeOn','2026-11-10','Counted card obligation retains its real cash date outside H') from diagnostic_cases where name='A';
select ok((pg_temp.diagnose(jsonb_set(input,'{commitments,2,cashOn}','"2026-11-10"'))->>'timelineExtendsBeyondHorizon')::boolean,'Out-of-horizon diagnostic is explicitly marked') from diagnostic_cases where name='A';
-- Conservative history, receipts on a shortage day and reserve links all use
-- the engine's already-considered values rather than nominal amounts again.
select is((pg_temp.diagnose(jsonb_set(jsonb_set(input,'{commitments,2,actualHistoryCents}','[160000,170000,180000]'),'{commitments,2,certainty}','"estimated"'))->>'shortageCents')::bigint,82000::bigint,'Conservative estimated obligation uses actual-history average') from diagnostic_cases where name='A';
select is(pg_temp.diagnose(input||jsonb_build_object('commitments',(input->'commitments')||'[{"id":"receipt","direction":"inflow","certainty":"confirmed","paymentLiquidity":"cash","effectiveDueOn":"2026-10-13","dueCents":10000,"paidCents":0}]'::jsonb))->>'message','Faltam R$ 520,00 até 13/10. Item descoberto: Aluguel (R$ 520,00 de R$ 1.500,00). Suas reservas também ficam descobertas.','Same-day income is included before the cash obligation') from diagnostic_cases where name='A';
select is((pg_temp.diagnose(input||jsonb_build_object('people','[{"id":"person","label":"João","balanceCents":-200000,"openReminderDates":[]}]'::jsonb))#>>'{uncoveredItem,id}'),'person','Undated person debt enters at h0') from diagnostic_cases where name='A';
select is((pg_temp.diagnose(input||jsonb_build_object('scheduled','[{"id":"scheduled","label":"PIX agendado","occurredOn":"2026-10-03","netCashCents":-110000,"reservedOutflows":[]}]'::jsonb))#>>'{uncoveredItem,id}'),'scheduled','Scheduled movement uses its actual cash date') from diagnostic_cases where name='A';
select is((pg_temp.diagnose(jsonb_set(input,'{commitments,2,reserveId}','"ipva"')||'{"reserves":[{"id":"ipva","label":"IPVA","reserveType":"provision","holdingMode":"virtual","active":true,"balanceCents":10000}]}'::jsonb)#>>'{uncoveredItem,totalCents}')::bigint,140000::bigint,'Reserve-covered portion is not deducted again from cash timeline') from diagnostic_cases where name='A';

insert into diagnostic_cases select 'monthly',input||'{
 "today":"2026-10-30","cashBalanceCents":5,"safetyReserveCents":0,"essentialNeedCents":10,
 "commitments":[{"id":"salary","direction":"inflow","certainty":"confirmed","paymentLiquidity":"cash","mainIncome":true,"effectiveDueOn":"2026-11-03","dueCents":1,"paidCents":0}],
 "essentialDetails":{"quotas":[{"month":"2026-10-01","grossNeedCents":30,"needCents":0},{"month":"2026-11-01","grossNeedCents":10,"needCents":10}]}
 }'::jsonb from diagnostic_cases where name='A';
select is(pg_temp.diagnose(input)->>'firstNegativeOn','2026-10-31','Net essentials are proportioned by gross month needs, not net quota balances') from diagnostic_cases where name='monthly';
select is((pg_temp.diagnose(input)#>>'{uncoveredItem,totalCents}')::bigint,4::bigint,'Largest remainder distributes October eight cents as four per day') from diagnostic_cases where name='monthly';
select is((pg_temp.diagnose(input)#>>'{uncoveredItem,uncoveredCents}')::bigint,3::bigint,'Daily essential allocation preserves the partial uncovered amount') from diagnostic_cases where name='monthly';
select is((pg_temp.diagnose(input)->>'shortageCents')::bigint,5::bigint,'Net essentials conserve all cents across months and days') from diagnostic_cases where name='monthly';
select is(pg_temp.diagnose(input)->>'message','Faltam R$ 0,05 até 31/10. Item descoberto: Essenciais (R$ 0,03 de R$ 0,04).','Daily essential warning uses canonical wording') from diagnostic_cases where name='monthly';

insert into diagnostic_cases select 'priority',input||'{"cashBalanceCents":440000,"safetyReserveCents":0,"reserves":[
 {"id":"undated","label":"Sem data","reserveType":"goal","createdAt":"2026-01-01","holdingMode":"virtual","active":true,"balanceCents":6000},
 {"id":"dated","label":"Com data","reserveType":"goal","targetDate":"2026-12-01","createdAt":"2026-02-01","holdingMode":"virtual","active":true,"balanceCents":6000},
 {"id":"later","label":"Mais tarde","reserveType":"provision","coverageDueOn":"2026-11-01","targetDate":"2026-09-01","holdingMode":"virtual","active":true,"balanceCents":2000},
 {"id":"early","label":"Primeira","reserveType":"provision","coverageDueOn":"2026-10-01","targetDate":"2026-12-01","holdingMode":"virtual","active":true,"balanceCents":2000},
 {"id":"inactive","label":"Inativa","reserveType":"goal","holdingMode":"virtual","active":false,"balanceCents":900000},
 {"id":"account","label":"Conta separada","reserveType":"goal","holdingMode":"account","active":true,"balanceCents":900000}
 ]}'::jsonb from diagnostic_cases where name='B';
select is(pg_temp.diagnose(input)#>>'{uncoveredReserves,0,id}','later','Provision cash due takes priority over target and all goals') from diagnostic_cases where name='priority';
select is(pg_temp.diagnose(input)#>>'{uncoveredReserves,1,id}','dated','Dated goal precedes older undated goal') from diagnostic_cases where name='priority';
select is(pg_temp.diagnose(input)#>>'{uncoveredReserves,2,id}','undated','Undated goal comes after dated goals') from diagnostic_cases where name='priority';
select is((pg_temp.diagnose(input)#>>'{uncoveredReserves,0,uncoveredCents}')::bigint,1000::bigint,'Reserve coverage preserves partial provision amount') from diagnostic_cases where name='priority';
select is(jsonb_array_length(pg_temp.diagnose(input)->'uncoveredReserves'),3,'Inactive and separate-account goals never enter reserve warning') from diagnostic_cases where name='priority';

insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000451','diagnostics@test.local'),('aaaaaaaa-0000-4000-8000-000000000452','diagnostics-other@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000451","role":"authenticated"}',true);
select api.create_personal_space('Diagnóstico canônico') as space \gset
select api.create_financial_account(:'space','Banco','checking',100000,'2026-10-01') as bank \gset
select api.create_category(:'space','Contas','expense') as category \gset
select api.create_category(:'space','Salário','income',null,'recurring') as income \gset
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Salário','direction','inflow','unit','month','starts_on','2026-11-05','day_of_month',5,'amount_cents',100000,'certainty','confirmed','category_id',:'income','payment_method','account','payment_financial_account_id',:'bank','is_main_income',true));
select api.create_commitment(:'space',jsonb_build_object('title','Internet','direction','outflow','certainty','confirmed','amount_cents',12000,'due_on','2026-10-08','category_id',:'category','payment_method','account','payment_financial_account_id',:'bank')) as internet \gset
select api.create_commitment(:'space',jsonb_build_object('title','Aluguel','direction','outflow','certainty','confirmed','amount_cents',150000,'due_on','2026-10-10','category_id',:'category','payment_method','account','payment_financial_account_id',:'bank')) as rent \gset
reset role;
update finance.space_settings set minimum_safety_reserve_cents=30000 where financial_space_id=:'space';
set local role authenticated;
select is(api.free_to_spend_summary(:'space','2026-10-02')#>>'{diagnostics,message}','Faltam R$ 620,00 até 13/10. Item descoberto: Aluguel (R$ 620,00 de R$ 1.500,00). Suas reservas também ficam descobertas.','API uses stored effective cash date including weekends and national holiday');
select is((api.free_to_spend_summary(:'space','2026-10-02')#>>'{calculation,conservative,valueCents}')::bigint,-92000::bigint,'Adding diagnostics leaves canonical calculation intact');
select count(*) as before_tx from finance.ledger_transactions where financial_space_id=:'space' \gset
select api.create_credit_card(:'space','Cartão',500000,1,10,:'bank') as card \gset
select api.create_commitment(:'space',jsonb_build_object('title','Compra prevista no cartão','direction','outflow','certainty','confirmed','amount_cents',200000,'due_on','2026-10-05','category_id',:'category','payment_method','card','payment_credit_card_id',:'card')) as card_agenda \gset
select count(*) as before_statement from finance.card_statements where financial_space_id=:'space' \gset
select is((select c->>'cashOn' from jsonb_array_elements(api.free_to_spend_summary(:'space','2026-10-02')#>'{input,commitments}') c where c->>'id'=:'card_agenda'),'2026-11-10','Unposted card occurrence maps to statement payment date without generating a cycle');
select is((select count(*) from finance.card_statements where financial_space_id=:'space'),:'before_statement'::bigint,'Reading projected card cash dates creates no cycles');
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space'),:'before_tx'::bigint,'Reading diagnostics creates no journal movements');
select api.record_card_purchase(:'space',:'card',:'category',1,1,'2026-10-06','Compra no período mantido');
select id as manual_cycle,version as manual_version from finance.card_statements where credit_card_id=:'card' and reference_month='2026-11-01' \gset
select api.edit_card_statement_dates(:'space',:'manual_cycle',:'manual_version',jsonb_build_object('period_start','2026-10-06','due_on','2026-11-12','effective_due_on','2026-11-12'));
select is((select c->>'cashOn' from jsonb_array_elements(api.free_to_spend_summary(:'space','2026-10-02')#>'{input,commitments}') c where c->>'id'=:'card_agenda'),'2026-11-12','Manual due override wins even when occurrence is outside overridden cycle period');
select is((select count(*) from finance.card_statements where financial_space_id=:'space'),:'before_statement'::bigint,'Out-of-period cash date lookup still creates no cycle');
select throws_ok('select private.free_to_spend_diagnostics(''{}'',''{}'')','42501','permission denied for function free_to_spend_diagnostics','Clients cannot execute the internal diagnostic helper');
select throws_ok(format('select private.projected_card_cash_on(%L,%L,%L)',:'space',:'card','2026-10-05'),'42501','permission denied for function projected_card_cash_on','Clients cannot query private cross-space cash date helper');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000452","role":"authenticated"}',true);
select throws_ok(format('select api.free_to_spend_summary(%L,%L)',:'space','2026-10-02'),'42501','Space permission required','Canonical diagnostic API enforces space membership');
set constraints all immediate;
select * from finish();
rollback;
