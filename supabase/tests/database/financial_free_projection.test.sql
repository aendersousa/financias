begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(35);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000331','free-one@test.local'),('aaaaaaaa-0000-4000-8000-000000000332','free-essential@test.local'),('aaaaaaaa-0000-4000-8000-000000000333','free-reserve@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000331","role":"authenticated"}',true);
select api.create_personal_space('CT-LFG-001 normalizado') as space \gset
select api.create_financial_account(:'space','Banco','checking',560000,'2026-10-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_financial_account(:'space','Benefício','benefit',100000,'2026-10-01');
select api.create_financial_account(:'space','Investimento','investment',200000,'2026-10-01');
select api.create_financial_account(:'space','Bem','property',300000,'2026-10-01');
select api.create_category(:'space','Contas','expense') as expenses \gset
select api.create_category(:'space','Mercado essencial','expense') as market \gset
select api.create_category(:'space','Receita','income',null,'extraordinary') as income \gset
reset role;
update finance.space_settings set fallback_cycle_day=5,minimum_safety_reserve_cents=30000 where financial_space_id=:'space';
update finance.categories set is_essential=true where id=:'market';
set local role authenticated;
select api.create_budget(:'space',jsonb_build_object('category_id',:'market','amount_cents',30000,'effective_from_month','2026-10-01','effective_until_month','2026-10-01'));
select api.create_commitment(:'space',jsonb_build_object('title','Aluguel','direction','outflow','certainty','confirmed','amount_cents',150000,'due_on','2026-10-20','category_id',:'expenses','payment_method','account','payment_financial_account_id',:'bank'));
select api.create_commitment(:'space',jsonb_build_object('title','Energia','direction','outflow','certainty','confirmed','amount_cents',22000,'due_on','2026-10-13','category_id',:'expenses','payment_method','account','payment_financial_account_id',:'bank'));
select api.create_commitment(:'space',jsonb_build_object('title','Internet','direction','outflow','certainty','confirmed','amount_cents',11000,'due_on','2026-10-22','category_id',:'expenses','payment_method','account','payment_financial_account_id',:'bank'));
select api.create_commitment(:'space',jsonb_build_object('title','Freela','direction','inflow','certainty','conditional','amount_cents',80000,'due_on','2026-10-28','category_id',:'income','payment_method','account','payment_financial_account_id',:'bank'));
select api.create_credit_card(:'space','Cartão A',500000,1,10,:'bank') as card_a \gset
select api.create_credit_card(:'space','Cartão B',500000,5,15,:'bank') as card_b \gset
select api.open_card_balance(:'space',:'card_a','2026-10-01',130000,'2026-10-01');
select api.open_card_balance(:'space',:'card_b','2026-11-01',64000,'2026-10-05');
select api.create_reserve(:'space',jsonb_build_object('name','Viagem','financial_account_id',:'bank','target_amount_cents',60000)) as travel \gset
select api.create_reserve(:'space',jsonb_build_object('name','IPVA','financial_account_id',:'bank','target_amount_cents',40000)) as ipva \gset
select api.reserve_contribution(:'space',:'travel','contribution',60000,'2026-10-10');
select api.reserve_contribution(:'space',:'ipva','contribution',40000,'2026-10-10');
select is((api.free_to_spend_input(:'space','2026-10-12')->>'cashBalanceCents')::bigint,560000::bigint,'CT-LFG-001 cash excludes benefits, investments and property');
select is(api.free_to_spend_input(:'space','2026-10-12')->>'horizonEnd','2026-11-05','Fallback cycle uses next financial calendar day');
select is((api.free_to_spend_input(:'space','2026-10-12')->>'safetyReserveCents')::bigint,30000::bigint,'Space safety reserve is included');
select is((api.free_to_spend_input(:'space','2026-10-12')->>'essentialNeedCents')::bigint,30000::bigint,'Existing essential budget is derived rather than replaced by zero');
select is((select sum((s->>'remainingIncludingScheduledCents')::bigint)::bigint from jsonb_array_elements(api.free_to_spend_input(:'space','2026-10-12')->'statements') s),194000::bigint,'CT-LFG-001 full open and closed statement debts normalize once');
select is((select sum((r->>'balanceCents')::bigint)::bigint from jsonb_array_elements(api.free_to_spend_input(:'space','2026-10-12')->'reserves') r),100000::bigint,'CT-LFG-001 both virtual reserves are derived');
select is((select count(*) from jsonb_array_elements(api.free_to_spend_input(:'space','2026-10-12')->'commitments') c where c->>'certainty'='conditional'),1::bigint,'Conditional income retains certainty for the shared scenario engine');
with p as (select api.free_to_spend_input(:'space','2026-10-12') as data)
select is((select (data->>'cashBalanceCents')::bigint-(data->>'safetyReserveCents')::bigint-(data->>'essentialNeedCents')::bigint
  -(select sum((c->>'dueCents')::bigint-(c->>'paidCents')::bigint)::bigint from jsonb_array_elements(data->'commitments') c where c->>'direction'='outflow')
  -(select sum((s->>'remainingIncludingScheduledCents')::bigint)::bigint from jsonb_array_elements(data->'statements') s)
  -(select sum((r->>'balanceCents')::bigint)::bigint from jsonb_array_elements(data->'reserves') r) from p),23000::bigint,'CT-LFG-001 normalized independent components preserve the official conservative reference');
select is((api.free_to_spend_summary(:'space','2026-10-12')#>>'{calculation,conservative,valueCents}')::bigint,23000::bigint,'CT-LFG-001 server canonical conservative calculation');
select is((api.free_to_spend_summary(:'space','2026-10-12')#>>'{calculation,expected,valueCents}')::bigint,103000::bigint,'CT-LFG-001 server canonical expected calculation');
select id as october_statement from finance.card_statements where credit_card_id=:'card_a' and reference_month='2026-10-01' \gset
select api.pay_card(:'space',:'card_a',:'bank_ledger',30000,'2026-10-20') as scheduled_card_payment \gset
select is((select (s->>'remainingIncludingScheduledCents')::bigint from jsonb_array_elements(api.free_to_spend_input(:'space','2026-10-12')->'statements') s where s->>'id'=:'october_statement'),100000::bigint,'Future card payment reduces statement debt before cash leaves');
select is((select (s->>'netCashCents')::bigint from jsonb_array_elements(api.free_to_spend_input(:'space','2026-10-12')->'scheduled') s where s->>'id'=:'scheduled_card_payment'),-30000::bigint,'The same future card payment has one scheduled cash effect');
select is((api.free_to_spend_input(:'space','2026-10-12')->>'cashBalanceCents')::bigint,560000::bigint,'Future card payment does not change the current cash balance');
select count(*) as tx_count from finance.ledger_transactions where financial_space_id=:'space' \gset
select jsonb_typeof(api.free_to_spend_input(:'space','2026-10-12')) as projection_shape \gset
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space'),:'tx_count'::bigint,'Projection reads create no ledger transactions');
select throws_ok('select private.essential_purchase_fraction(gen_random_uuid(),gen_random_uuid(),current_date,current_date+1)','42501','permission denied for function essential_purchase_fraction','Clients cannot invoke private cross-space fraction helper');

select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000332","role":"authenticated"}',true);
select throws_ok(format('select api.free_to_spend_input(%L,%L)',:'space','2026-10-12'),'42501','Space permission required','Projection verifies membership before returning private data');
select api.create_personal_space('CT-LFG-006 essencial parcelado') as essential_space \gset
select api.create_financial_account(:'essential_space','Banco','checking',200000,'2026-10-01') as essential_bank \gset
select ledger_account_id as essential_bank_ledger from finance.financial_accounts where id=:'essential_bank' \gset
select api.create_category(:'essential_space','Mercado','expense') as essential_market \gset
select ledger_account_id as essential_market_ledger from finance.categories where id=:'essential_market' \gset
select api.create_category(:'essential_space','Salário','income',null,'recurring') as salary \gset
reset role;
update finance.categories set is_essential=true where id=:'essential_market';
set local role authenticated;
select api.create_recurrence_rule(:'essential_space',jsonb_build_object('title','Salário','direction','inflow','unit','month','starts_on','2026-10-05','day_of_month',5,'amount_cents',500000,'certainty','confirmed','category_id',:'salary','payment_method','account','payment_financial_account_id',:'essential_bank','is_main_income',true));
select id as first_salary from finance.commitments where financial_space_id=:'essential_space' and nominal_due_on='2026-10-05' \gset
select api.settle_commitment(:'essential_space',:'first_salary',500000,'2026-10-01');
select api.create_budget(:'essential_space',jsonb_build_object('category_id',:'essential_market','amount_cents',90000,'effective_from_month','2026-10-01')) as essential_budget \gset
select api.post_transaction(:'essential_space',jsonb_build_object('kind','expense','occurred_on','2026-10-01','competence_month','2026-10-01','description','Mercado anterior','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'essential_market_ledger','amount_cents',10000),jsonb_build_object('ledger_account_id',:'essential_bank_ledger','amount_cents',-10000)))) as initial_market \gset
select is(api.free_to_spend_input(:'essential_space','2026-10-02')->>'horizonEnd','2026-11-05','Received main income advances the horizon to the next unpaid occurrence');
select is((api.free_to_spend_input(:'essential_space','2026-10-02')->>'essentialNeedCents')::bigint,92000::bigint,'CT-LFG-006 essential need before purchase includes October and four November days');
select api.create_credit_card(:'essential_space','Cartão',500000,1,10,:'essential_bank') as essential_card \gset
select api.record_card_purchase(:'essential_space',:'essential_card',:'essential_market',30000,3,'2026-10-02','Mercado em três vezes') as essential_purchase \gset
select is((api.free_to_spend_input(:'essential_space','2026-10-02')->>'essentialNeedCents')::bigint,62000::bigint,'CT-LFG-006 purchase reduces essential need by its full consumption');
select is((select sum((s->>'essentialFractionCents')::bigint)::bigint from jsonb_array_elements(api.free_to_spend_input(:'essential_space','2026-10-02')->'statements') s where s->>'status'='future'),20000::bigint,'CT-LFG-006 both future essential installments count at alpha one');
select is((select sum((s->>'firstInstallmentCents')::bigint)::bigint from jsonb_array_elements(api.free_to_spend_input(:'essential_space','2026-10-02')->'statements') s),10000::bigint,'First installment is separate from the essential fraction and never counted twice');
select api.edit_transaction(:'essential_space',:'initial_market',1,jsonb_build_object('kind','expense','occurred_on','2026-10-01','competence_month','2026-10-01','description','Mercado anterior corrigido','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'essential_market_ledger','amount_cents',75000),jsonb_build_object('ledger_account_id',:'essential_bank_ledger','amount_cents',-75000))),'Corrigir consumo anterior');
select is((select sum((s->>'essentialFractionCents')::bigint)::bigint from jsonb_array_elements(api.free_to_spend_input(:'essential_space','2026-10-02')->'statements') s where s->>'status'='future'),10000::bigint,'Changing preceding consumption recalculates alpha one half without stored fractions');
select is((api.free_to_spend_input(:'essential_space','2026-10-02')->>'essentialNeedCents')::bigint,12000::bigint,'Overspent October floors at zero without compensating November need');
select api.set_budget_month_amount(:'essential_space',:'essential_budget','2026-10-01',105001);
select api.record_card_purchase(:'essential_space',:'essential_card',:'essential_market',10001,3,'2026-10-03','Apenas um centavo dentro do orçamento') as rounded_purchase \gset
select is((select sum((s->>'essentialFractionCents')::bigint)::bigint from jsonb_array_elements(api.free_to_spend_input(:'essential_space','2026-10-03')->'statements') s where s->>'status'='future'),20002::bigint,'Each weighted future installment rounds upward independently to the cent');
select api.create_recurrence_rule(:'essential_space',jsonb_build_object('title','Comissão','direction','inflow','unit','month','starts_on','2026-07-20','day_of_month',20,'amount_cents',120000,'certainty','estimated','category_id',:'salary','payment_method','account','payment_financial_account_id',:'essential_bank'));
select id as july_commission from finance.commitments where financial_space_id=:'essential_space' and title='Comissão' and nominal_due_on='2026-07-20' \gset
select id as august_commission from finance.commitments where financial_space_id=:'essential_space' and title='Comissão' and nominal_due_on='2026-08-20' \gset
select id as september_commission from finance.commitments where financial_space_id=:'essential_space' and title='Comissão' and nominal_due_on='2026-09-20' \gset
select id as october_commission from finance.commitments where financial_space_id=:'essential_space' and title='Comissão' and nominal_due_on='2026-10-20' \gset
select api.settle_commitment(:'essential_space',:'july_commission',90000,'2026-07-20','match_actual');
select api.settle_commitment(:'essential_space',:'august_commission',100000,'2026-08-20','match_actual');
select api.settle_commitment(:'essential_space',:'september_commission',140000,'2026-09-21','match_actual');
select is((select c->'actualHistoryCents' from jsonb_array_elements(api.free_to_spend_input(:'essential_space','2026-10-03')->'commitments') c where c->>'id'=:'october_commission'),'[140000,100000,90000]'::jsonb,'CT-LFG-010 normalizes the three latest settled actual receipts newest first');
select is((select (c->>'paidCents')::bigint from jsonb_array_elements(api.free_to_spend_input(:'essential_space','2026-10-03')->'commitments') c where c->>'id'=:'october_commission'),0::bigint,'The current estimate remains pending and distinct from its actual history');
select api.create_person(:'essential_space','João') as person \gset
select ledger_account_id as person_ledger from finance.people where id=:'person' \gset
select id as opening_ledger from finance.ledger_accounts where financial_space_id=:'essential_space' and system_role='opening' \gset
select api.post_transaction(:'essential_space',jsonb_build_object('kind','opening','occurred_on','2026-10-01','competence_month','2026-10-01','description','Valor a receber de João','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'person_ledger','amount_cents',40000),jsonb_build_object('ledger_account_id',:'opening_ledger','amount_cents',-40000))));
select api.create_commitment(:'essential_space',jsonb_build_object('kind','reminder','person_id',:'person','title','João em outubro','due_on','2026-10-15'));
select is((select (p->>'balanceCents')::bigint from jsonb_array_elements(api.free_to_spend_input(:'essential_space','2026-10-03')->'people') p where p->>'id'=:'person'),40000::bigint,'CT-LFG-010 person receivable comes from the ledger rather than reminder amount');
select is((select p->'openReminderDates' from jsonb_array_elements(api.free_to_spend_input(:'essential_space','2026-10-03')->'people') p where p->>'id'=:'person'),'["2026-10-15"]'::jsonb,'Open reminder dates preserve the shared engine horizon filter');

select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000333","role":"authenticated"}',true);
select api.create_personal_space('CT-GOAL-002 parcela futura') as reserve_space \gset
select api.create_financial_account(:'reserve_space','Banco','checking',200000,'2026-10-01') as reserve_bank \gset
select api.create_category(:'reserve_space','Viagem','expense') as reserve_category \gset
select api.create_category(:'reserve_space','Receita trimestral','income',null,'recurring') as reserve_salary \gset
select api.create_recurrence_rule(:'reserve_space',jsonb_build_object('title','Renda trimestral','direction','inflow','unit','month','interval_count',3,'starts_on','2026-12-20','day_of_month',20,'amount_cents',500000,'certainty','confirmed','category_id',:'reserve_salary','payment_method','account','payment_financial_account_id',:'reserve_bank','is_main_income',true));
select api.create_reserve(:'reserve_space',jsonb_build_object('name','Viagem','financial_account_id',:'reserve_bank','target_amount_cents',100000)) as reserve_goal \gset
select api.reserve_contribution(:'reserve_space',:'reserve_goal','contribution',100000,'2026-10-01');
select api.create_credit_card(:'reserve_space','Cartão viagem',500000,1,10,:'reserve_bank') as reserve_card \gset
select api.record_card_purchase(:'reserve_space',:'reserve_card',:'reserve_category',120000,3,'2026-10-02','Viagem parcelada',null,null,null,null,:'reserve_goal') as reserve_purchase \gset
select is((select (r->>'balanceCents')::bigint from jsonb_array_elements(api.free_to_spend_input(:'reserve_space','2026-10-02')->'reserves') r where r->>'id'=:'reserve_goal'),60000::bigint,'The first installment consumes the reserve once on the purchase date');
select is((select sum((part->>'amountCents')::bigint)::bigint from jsonb_array_elements(api.free_to_spend_input(:'reserve_space','2026-10-02')->'statements') s cross join lateral jsonb_array_elements(s->'reservedUnconsumed') part),40000::bigint,'Only the counted future installment carries unconsumed reserve coverage');
select is((select sum((s->>'essentialFractionCents')::bigint)::bigint from jsonb_array_elements(api.free_to_spend_input(:'reserve_space','2026-10-02')->'statements') s),0::bigint,'Reserve-linked purchases have zero essential fraction');
select is((select count(*) from jsonb_array_elements(api.free_to_spend_input(:'reserve_space','2026-10-02')->'statements') s where s->>'status'='future' and jsonb_array_length(s->'reservedUnconsumed')>0),1::bigint,'A future installment outside the horizon does not receive present-cycle coverage');
select is((api.free_to_spend_input(:'reserve_space','2026-10-02')->>'cashBalanceCents')::bigint,200000::bigint,'Card purchase and reserve consumption do not move cash');
select is(api.free_to_spend_input(:'reserve_space','2026-10-02')->>'horizonEnd','2026-12-21','Main income horizon uses the effective banking date');
select is((api.free_to_spend_input(:'reserve_space','2026-10-02')->>'essentialNeedCents')::bigint,0::bigint,'No essential budget produces zero need through the real calculation');
set constraints all immediate;
select * from finish();
rollback;
