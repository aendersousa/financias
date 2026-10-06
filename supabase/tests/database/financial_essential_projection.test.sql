begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(32);
insert into auth.users(id,email) values
 ('aaaaaaaa-0000-4000-8000-000000000291','essential-days@test.local'),
 ('aaaaaaaa-0000-4000-8000-000000000292','essential-benefit@test.local'),
 ('aaaaaaaa-0000-4000-8000-000000000293','essential-months@test.local'),
 ('aaaaaaaa-0000-4000-8000-000000000294','essential-predicted@test.local');
select ok(not has_function_privilege('authenticated','private.essential_need(uuid,date,date)','EXECUTE'),'Clients cannot call the internal projection directly');
select ok(not has_function_privilege('anon','private.essential_need(uuid,date,date)','EXECUTE'),'Anonymous callers cannot read projection data');
select throws_ok($q$select private.essential_need(gen_random_uuid(),'2026-10-02','2026-10-02')$q$,'23514','Essential projection requires a nonempty finite horizon','Half-open horizon must be nonempty');
select is((private.essential_need(gen_random_uuid(),'2026-10-02','2026-10-20')->>'essentialNeedCents')::bigint,0::bigint,'No essential budget means zero need');

-- CT-LFG-009: a parent budget covers every descendant, independently of the
-- descendant essential flag. Spending before today precedes proration.
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000291","role":"authenticated"}',true);
select api.create_personal_space('Dias essenciais') as space \gset
select api.create_financial_account(:'space','Banco','checking',500000,'2026-10-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Mercado','expense',null,null,true) as parent \gset
select api.create_category(:'space','Alimentos','expense',:'parent') as child \gset
select api.create_category(:'space','Feira','expense',:'child') as leaf \gset
select ledger_account_id as leaf_ledger from finance.categories where id=:'leaf' \gset
select api.create_budget(:'space',jsonb_build_object('category_id',:'parent','amount_cents',90000,'effective_from_month','2026-10-01')) as budget \gset
select api.create_category(:'space','Lazer','expense') as leisure \gset
select api.create_budget(:'space',jsonb_build_object('category_id',:'leisure','amount_cents',20000,'effective_from_month','2026-10-01')) as leisure_budget \gset
select api.create_category(:'space','Marca substituída','expense',null,null,true) as overridden \gset
select api.create_budget(:'space',jsonb_build_object('category_id',:'overridden','amount_cents',10000,'is_essential_override',false,'effective_from_month','2026-10-01')) as overridden_budget \gset
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-10-01','competence_month','2026-10-01','description','Gasto anterior','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'leaf_ledger','amount_cents',30000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-30000)))) as before \gset
select is((private.essential_need(:'space','2026-10-02','2026-10-20')->>'essentialNeedCents')::bigint,36000::bigint,'CT-LFG-009: (900-300) times 18/30 is 360');
select is(jsonb_array_length(private.essential_need(:'space','2026-10-02','2026-10-20')->'quotas'),1,'Nonessential budgets and explicit essential=false do not protect cash');
select is((private.essential_need(:'space','2026-10-02','2026-10-20')->'quotas'->0->>'spentBeforeCents')::bigint,30000::bigint,'Recursive coverage uses the leaf financial date before today');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-10-02','competence_month','2026-10-01','description','Compra de hoje','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'leaf_ledger','amount_cents',10000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-10000)))) as today_purchase \gset
select is((private.essential_need(:'space','2026-10-02','2026-10-20')->>'essentialNeedCents')::bigint,26000::bigint,'INV-LFG-ESS-001: today spending reduces the quota one for one');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-10-25','competence_month','2026-10-01','description','Agendado no mês','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'leaf_ledger','amount_cents',5000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-5000)))) as scheduled \gset
select is((private.essential_need(:'space','2026-10-02','2026-10-20')->>'essentialNeedCents')::bigint,21000::bigint,'Scheduled spending in a month of H also reduces the quota without proration');
select api.cancel_transaction(:'space',:'scheduled',1,'Cancelar agendamento de teste');
select is((private.essential_need(:'space','2026-10-02','2026-10-20')->>'essentialNeedCents')::bigint,26000::bigint,'Cancelled transactions do not consume the quota');
select api.create_reserve(:'space',jsonb_build_object('name','Gasto reservado','financial_account_id',:'bank','target_amount_cents',10000)) as reserve \gset
select api.reserve_contribution(:'space',:'reserve','contribution',10000,'2026-10-01');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-10-02','competence_month','2026-10-01','description','Gasto com reserva','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'leaf_ledger','reserve_id',:'reserve','amount_cents',10000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-10000))));
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-10-02','competence_month','2026-10-01','description','De competência anterior','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'leaf_ledger','original_competence_month','2026-09-01','amount_cents',10000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-10000))));
select id as charges,version as charges_version from finance.categories where financial_space_id=:'space' and system_role='financial_charges' \gset
select api.manage_category(:'space',:'charges',:'charges_version','move',jsonb_build_object('parent_id',:'parent'));
select ledger_account_id as charges_ledger from finance.categories where id=:'charges' \gset
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-10-02','competence_month','2026-10-01','description','Encargos de teste','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'charges_ledger','amount_cents',5000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-5000))));
select is((private.essential_need(:'space','2026-10-02','2026-10-20')->>'essentialNeedCents')::bigint,26000::bigint,'Reserved, original-competence and financial-charge entries are excluded');
select api.set_budget_month_amount(:'space',:'budget','2026-10-01',100000);
select is((private.essential_need(:'space','2026-10-02','2026-10-20')->>'essentialNeedCents')::bigint,32000::bigint,'Monthly amount override is used before proration');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2026-10-02','competence_month','2026-10-01','description','Acima da cota','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'leaf_ledger','amount_cents',40000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-40000))));
select is((private.essential_need(:'space','2026-10-02','2026-10-20')->>'essentialNeedCents')::bigint,0::bigint,'An essential quota cannot become negative and leisure surplus never offsets overspending');

-- CT-LFG-008: benefit cash is displayed separately. A benefit linked to an
-- ancestor of the budget category covers it; future topups are unavailable.
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000292","role":"authenticated"}',true);
select api.create_personal_space('Benefício essencial') as benefit_space \gset
select api.create_financial_account(:'benefit_space','Banco','checking',300000,'2026-10-01') as benefit_bank \gset
select api.create_financial_account(:'benefit_space','VA','benefit',100000,'2026-10-01') as va \gset
select ledger_account_id as va_ledger from finance.financial_accounts where id=:'va' \gset
select api.create_financial_account(:'benefit_space','VR','benefit',20000,'2026-10-01') as vr \gset
select api.create_category(:'benefit_space','Alimentação','expense') as food_parent \gset
select api.create_category(:'benefit_space','Mercado essencial','expense',:'food_parent',null,true) as food \gset
select ledger_account_id as food_ledger from finance.categories where id=:'food' \gset
update finance.categories set benefit_financial_account_id=:'va' where id=:'food_parent';
update finance.categories set benefit_financial_account_id=:'vr' where id=:'food';
-- Make the account order explicit, independent of UUID ordering within now().
update finance.financial_accounts set created_at='2000-01-01T00:00:00Z' where id=:'va';
update finance.financial_accounts set created_at='2000-01-02T00:00:00Z' where id=:'vr';
select api.create_budget(:'benefit_space',jsonb_build_object('category_id',:'food','amount_cents',80000,'effective_from_month','2026-10-01')) as food_budget \gset
select is((private.essential_need(:'benefit_space','2026-10-02','2026-11-05')->>'grossNeedCents')::bigint,90667::bigint,'CT-LFG-008: October 800 plus November 106.67, rounded upward');
select is((private.essential_need(:'benefit_space','2026-10-02','2026-11-05')->>'essentialNeedCents')::bigint,0::bigint,'Ancestor-linked VA covers the entire essential need');
select is((private.essential_need(:'benefit_space','2026-10-02','2026-11-05')->'benefits'->0->>'freeCents')::bigint,9333::bigint,'CT-LFG-008: free VA is 93.33 and remains separate from cash');
select is((private.essential_need(:'benefit_space','2026-10-02','2026-11-05')->'benefits'->1->>'offsetCents')::bigint,0::bigint,'Later benefit does not offset a quota already covered by VA');
select is((private.essential_need(:'benefit_space','2026-10-02','2026-11-05')->'quotas'->1->>'benefitOffsetCents')::bigint,10667::bigint,'Benefit coverage is attributed to the future monthly quota as well');
select api.post_transaction(:'benefit_space',jsonb_build_object('kind','expense','occurred_on','2026-10-02','competence_month','2026-10-01','description','Compra com VA','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'food_ledger','amount_cents',10000),jsonb_build_object('ledger_account_id',:'va_ledger','amount_cents',-10000))));
select is((private.essential_need(:'benefit_space','2026-10-02','2026-11-05')->'benefits'->0->>'freeCents')::bigint,9333::bigint,'Benefit spending decreases its balance and the need equally');
select api.create_category(:'benefit_space','Recarga','income',null,'benefit') as topup_category \gset
select ledger_account_id as topup_ledger from finance.categories where id=:'topup_category' \gset
select api.post_transaction(:'benefit_space',jsonb_build_object('kind','income','occurred_on','2026-10-03','competence_month','2026-10-01','description','Recarga futura','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'topup_ledger','amount_cents',-50000),jsonb_build_object('ledger_account_id',:'va_ledger','amount_cents',50000))));
select is((private.essential_need(:'benefit_space','2026-10-02','2026-11-05')->'benefits'->0->>'balanceCents')::bigint,90000::bigint,'Future benefit topups do not count in today balance');
select api.post_transaction(:'benefit_space',jsonb_build_object('kind','expense','occurred_on','2026-10-02','competence_month','2026-10-01','description','Benefício negativo','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'food_ledger','amount_cents',100000),jsonb_build_object('ledger_account_id',:'va_ledger','amount_cents',-100000))));
select is((private.essential_need(:'benefit_space','2026-10-02','2026-11-05')->'benefits'->0->>'balanceCents')::bigint,0::bigint,'A negative benefit balance has zero coverage capacity');
select is((private.essential_need(:'benefit_space','2026-10-02','2026-11-05')->'benefits'->1->>'offsetCents')::bigint,10667::bigint,'The next benefit covers only the remaining nonnegative November need');

-- CT-LFG-009, 25 October: the current remainder and a future partial month.
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000293","role":"authenticated"}',true);
select api.create_personal_space('Virada de mês') as month_space \gset
select api.create_financial_account(:'month_space','Banco','checking',500000,'2026-10-01') as month_bank \gset
select ledger_account_id as month_bank_ledger from finance.financial_accounts where id=:'month_bank' \gset
select api.create_category(:'month_space','Mercado','expense',null,null,true) as month_food \gset
select ledger_account_id as month_food_ledger from finance.categories where id=:'month_food' \gset
select api.create_budget(:'month_space',jsonb_build_object('category_id',:'month_food','amount_cents',90000,'effective_from_month','2026-10-01')) as month_budget \gset
select api.post_transaction(:'month_space',jsonb_build_object('kind','expense','occurred_on','2026-10-24','competence_month','2026-10-01','description','Consumo de outubro','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'month_food_ledger','amount_cents',78000),jsonb_build_object('ledger_account_id',:'month_bank_ledger','amount_cents',-78000)))) as month_purchase \gset
select is((private.essential_need(:'month_space','2026-10-25','2026-11-05')->>'essentialNeedCents')::bigint,24000::bigint,'CT-LFG-009: October 120 plus November 120 equals 240');
select api.post_transaction(:'month_space',jsonb_build_object('kind','expense','occurred_on','2026-10-24','competence_month','2026-10-01','description','Estouro de outubro','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'month_food_ledger','amount_cents',17000),jsonb_build_object('ledger_account_id',:'month_bank_ledger','amount_cents',-17000))));
select is((private.essential_need(:'month_space','2026-10-25','2026-11-05')->>'essentialNeedCents')::bigint,12000::bigint,'CT-LFG-009 overspending is floored per month, without reducing November');
select api.set_budget_month_amount(:'month_space',:'month_budget','2026-11-01',1);
select is((private.essential_need(:'month_space','2026-10-25','2026-11-05')->>'essentialNeedCents')::bigint,1::bigint,'A fractional cent quota rounds upward even for a one-cent monthly budget');
select is((private.essential_need(:'month_space','2026-10-25','2026-11-01')->>'essentialNeedCents')::bigint,0::bigint,'The horizon end is exclusive and does not reach November');

-- Estimated commitment history is shared with the budget read model. It is
-- subtracted before proration, and partial actuals do not count twice.
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000294","role":"authenticated"}',true);
select api.create_personal_space('Essenciais previstos') as predicted_space \gset
select api.create_financial_account(:'predicted_space','Banco','checking',500000,'2026-07-01') as predicted_bank \gset
select api.create_category(:'predicted_space','Energia','expense',null,null,true) as energy \gset
select api.create_budget(:'predicted_space',jsonb_build_object('category_id',:'energy','amount_cents',90000,'effective_from_month','2026-10-01')) as energy_budget \gset
select api.create_recurrence_rule(:'predicted_space',jsonb_build_object('title','Energia','direction','outflow','unit','month','starts_on','2026-07-01','ends_on','2026-10-31','day_of_month',20,'certainty','estimated','amount_cents',20000,'category_id',:'energy','payment_method','account','payment_financial_account_id',:'predicted_bank'))->>'id' as energy_rule \gset
select id as july from finance.commitments where recurrence_rule_id=:'energy_rule' and period_key='2026-07-01' \gset
select id as august from finance.commitments where recurrence_rule_id=:'energy_rule' and period_key='2026-08-01' \gset
select id as september from finance.commitments where recurrence_rule_id=:'energy_rule' and period_key='2026-09-01' \gset
select id as october from finance.commitments where recurrence_rule_id=:'energy_rule' and period_key='2026-10-01' \gset
select api.settle_commitment(:'predicted_space',:'july',33000,'2026-07-20','match_actual');
select api.settle_commitment(:'predicted_space',:'august',36000,'2026-08-20','match_actual');
select api.settle_commitment(:'predicted_space',:'september',39000,'2026-09-20','match_actual');
select is((private.essential_need(:'predicted_space','2026-10-02','2026-10-20')->'quotas'->0->>'predictedCents')::bigint,36000::bigint,'Conservative estimate uses max(due, average of last three settled amounts)');
select is((private.essential_need(:'predicted_space','2026-10-02','2026-10-20')->>'essentialNeedCents')::bigint,32400::bigint,'Estimated commitments are subtracted before the 18/30 proration');
select api.settle_commitment(:'predicted_space',:'october',5000,'2026-10-02');
select is((private.essential_need(:'predicted_space','2026-10-02','2026-10-20')->>'essentialNeedCents')::bigint,30400::bigint,'Partial settlement reduces prediction and consumes the prorated quota without duplication');
select is((private.essential_need(:'predicted_space','2026-10-02','2026-10-20')->'quotas'->0->>'predictedCents')::bigint,31000::bigint,'Only conservative unpaid estimate remains predicted');
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'predicted_space'),5::bigint,'Projection reads create no ledger transactions');
select is((select count(*) from finance.reserve_contributions where financial_space_id=:'predicted_space'),0::bigint,'Projection reads create no reserve events');
set constraints all immediate;
select * from finish();
rollback;
