begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(32);
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000241','reserves@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000241","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Metas e provisões') as space \gset
select api.create_financial_account(:'space','Banco','checking',500000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Viagem','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id=:'category' \gset
select api.create_reserve(:'space',jsonb_build_object('name','Viagem','financial_account_id',:'bank','target_amount_cents',200000)) as goal \gset
select api.reserve_contribution(:'space',:'goal','contribution',200000,'2000-01-01',null,'11111111-aaaa-4111-8111-111111111241') as contribution \gset
select is((select balance_cents from finance.account_balances where id=:'bank_ledger'),500000::bigint,'INV-LEDGER-010 contribution does not move cash');
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space'),1::bigint,'Contributions create no ledger entries');
select is(api.reserve_contribution(:'space',:'goal','contribution',200000,'2000-01-01',null,'11111111-aaaa-4111-8111-111111111241'),:'contribution'::uuid,'Contribution replay is idempotent');
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,200001,%L,null,%L)',:'space',:'goal','contribution','2000-01-01','11111111-aaaa-4111-8111-111111111241'),'23505','Client UUID reused with different reserve contribution','Different contribution cannot reuse request');
select api.post_transaction(:'space',jsonb_build_object('kind','expense','occurred_on','2000-01-02','competence_month','2000-01-01','description','Viagem maior que reserva','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'category_ledger','reserve_id',:'goal','amount_cents',300000),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-300000)))) as purchase \gset
select is((api.reserve_summary(:'space','2000-01-02')->'reserves'->0->>'balance_cents')::bigint,0::bigint,'INV-GOAL-003 expense over balance consumes only available reserve');
select api.refund_transaction(:'space',:'purchase',50000,'2000-01-03',:'bank') as refund1 \gset
select is((select reserve_id from finance.ledger_entries where ledger_transaction_id=:'refund1' and ledger_account_id=:'category_ledger'),:'goal'::uuid,'Refund inherits reserve link');
select is((api.reserve_summary(:'space','2000-01-03')->'reserves'->0->>'balance_cents')::bigint,0::bigint,'Refund first offsets ordinary part of expense');
select api.refund_transaction(:'space',:'purchase',70000,'2000-01-04',:'bank') as refund2 \gset
select is((api.reserve_summary(:'space','2000-01-04')->'reserves'->0->>'balance_cents')::bigint,20000::bigint,'Refund restores only portion actually consumed after ordinary part');
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,20001,%L)',:'space',:'goal','release','2000-01-04'),'23514','Release exceeds reserve balance','Cannot release more than available');
select api.manage_reserve(:'space',:'goal',(select version from finance.reserves where id=:'goal'),'close','{"on":"2000-01-04","reason":"Encerrar viagem"}');
select api.refund_transaction(:'space',:'purchase',20000,'2000-01-05',:'bank') as refund3 \gset
select is((api.reserve_summary(:'space','2000-01-05')->'reserves'->0->>'balance_cents')::bigint,0::bigint,'Refund to closed goal remains ordinary money');
select throws_ok(format($q$select api.post_transaction(%L,jsonb_build_object('kind','expense','occurred_on','2000-01-05','competence_month','2000-01-01','description','Reserva encerrada','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',%L,'reserve_id',%L,'amount_cents',100),jsonb_build_object('ledger_account_id',%L,'amount_cents',-100))))$q$,:'space',:'category_ledger',:'goal',:'bank_ledger'),'23514','Reserve is not active','Terminal reserve rejects new consumption');
select api.create_financial_account(:'space','Caixinha','investment',100000,'2000-01-01') as investment \gset
select api.create_reserve(:'space',jsonb_build_object('name','Emergência','holding_mode','account','financial_account_id',:'investment','target_amount_cents',200000)) as account_goal \gset
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space','2000-01-05')->'reserves') x where x->>'id'=:'account_goal'),100000::bigint,'Account goal follows investment balance');
select throws_ok(format('select api.reserve_contribution(%L,%L,%L,1000,%L)',:'space',:'account_goal','contribution','2000-01-05'),'23514','Active virtual reserve required','Account goal cannot accept virtual contribution');
select throws_ok(format($q$select api.create_reserve(%L,jsonb_build_object('name','Inválida','financial_account_id',%L,'target_amount_cents',1000))$q$,:'space',:'investment'),'23514','Choose cash for a virtual reserve or investment for an account goal','Virtual reserve requires cash holding account');
select api.create_reserve(:'space',jsonb_build_object('name','IPVA','reserve_type','provision','financial_account_id',:'bank','target_amount_cents',240000,'target_date','2000-01-15','category_id',:'category')) as provision \gset
select id as commitment from finance.commitments where reserve_id=:'provision' \gset
select is((select count(*) from finance.commitments where reserve_id=:'provision'),1::bigint,'Provision creates its linked commitment');
select api.reserve_contribution(:'space',:'provision','contribution',180000,'2000-01-05');
select api.settle_commitment(:'space',:'commitment',240000,'2000-01-15') as ipva_payment \gset
set constraints all immediate;
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space','2000-01-15')->'reserves') x where x->>'id'=:'provision'),0::bigint,'CT-GOAL-002 provision never goes negative on larger settlement');
select is((select status from finance.reserves where id=:'provision'),'settled','Provision becomes settled with all commitments paid');
select api.cancel_transaction(:'space',:'ipva_payment',1,'Pagamento devolvido pelo banco');
select is((select status from finance.reserves where id=:'provision'),'active','Cancelling settlement reopens provision');
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space','2000-01-15')->'reserves') x where x->>'id'=:'provision'),180000::bigint,'Cancelling transaction restores derived consumption');
set constraints all deferred;
select api.create_reserve(:'space',jsonb_build_object('name','Viagem cartão','financial_account_id',:'bank','target_amount_cents',200000)) as card_goal \gset
-- These consumption fixtures intentionally over-reserve cash; consent is
-- explicit so the 14.5.6 guard stays active while testing reserve chronology.
select api.reserve_contribution(:'space',:'card_goal','contribution',200000,:'today',null,null,api.preview_reserve_contribution(:'space',:'card_goal','contribution',200000,:'today')->>'approvalToken');
select api.create_credit_card(:'space','Cartão viagem',500000,1,10,:'bank') as card \gset
select api.record_card_purchase(:'space',:'card',:'category',120000,1,:'today','Passagem',null,null,null,null,:'card_goal') as card_purchase \gset
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space',:'today')->'reserves') x where x->>'id'=:'card_goal'),80000::bigint,'CT-GOAL-001 card purchase swaps reserve for card commitment');
select api.pay_card(:'space',:'card',:'bank_ledger',120000,:'today');
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space',:'today')->'reserves') x where x->>'id'=:'card_goal'),80000::bigint,'Card payment does not consume reserve twice');
select api.create_reserve(:'space',jsonb_build_object('name','Parcelas','financial_account_id',:'bank','target_amount_cents',200000)) as installment_goal \gset
select api.reserve_contribution(:'space',:'installment_goal','contribution',200000,:'today',null,null,api.preview_reserve_contribution(:'space',:'installment_goal','contribution',200000,:'today')->>'approvalToken');
select api.record_card_purchase(:'space',:'card',:'category',120000,2,:'today','Passagem parcelada',null,null,null,null,:'installment_goal') as installment_purchase \gset
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space',:'today')->'reserves') x where x->>'id'=:'installment_goal'),140000::bigint,'Only first card installment consumes reserve immediately');
select api.refund_transaction(:'space',:'installment_purchase',120000,:'today',null,'cancel_remaining');
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space',:'today')->'reserves') x where x->>'id'=:'installment_goal'),200000::bigint,'Refund restores consumed part and cancels unconsumed future part');
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space',(:'today'::date+interval '3 months')::date)->'reserves') x where x->>'id'=:'installment_goal'),200000::bigint,'Cancelled future installment never consumes reserve later');
select is((api.reserve_summary(:'space',:'today')->>'reserved_cents')::bigint,460000::bigint,'Account goals excluded from virtual reserved total');
select api.create_reserve(:'space',jsonb_build_object('name','Centavos','financial_account_id',:'bank','target_amount_cents',100)) as cents_goal \gset
select api.reserve_contribution(:'space',:'cents_goal','contribution',100,:'today',null,null,api.preview_reserve_contribution(:'space',:'cents_goal','contribution',100,:'today')->>'approvalToken');
select api.record_card_purchase(:'space',:'card',:'category',6,3,:'today','Prepara três faturas') as dummy \gset
select jsonb_agg(jsonb_build_object('ledger_account_id',ledger_account_id,'amount_cents',amount_cents,'card_statement_id',card_statement_id,'installment_number',installment_number,'installment_count',installment_count) order by line_number) as card_entries from finance.ledger_entries where ledger_transaction_id=:'dummy' and card_statement_id is not null \gset
select api.cancel_transaction(:'space',:'dummy',1,'Substituir divisão entre categorias');
select api.post_transaction(:'space',jsonb_build_object('kind','card_purchase','occurred_on',:'today','competence_month',date_trunc('month',:'today'::date)::date,'description','Compra dividida em centavos','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',3,'reserve_id',:'cents_goal'),jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',3))||:'card_entries'::jsonb)) as cents_purchase \gset
select api.refund_transaction(:'space',:'cents_purchase',3,:'today',null,'cancel_remaining');
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space',(:'today'::date+interval '4 months')::date)->'reserves') x where x->>'id'=:'cents_goal'),99::bigint,'Refund largest remainder cancels both linked future cents consistently');
select api.create_reserve(:'space',jsonb_build_object('name','Um centavo','financial_account_id',:'bank','target_amount_cents',100)) as single_cent_goal \gset
select api.reserve_contribution(:'space',:'single_cent_goal','contribution',100,:'today',null,null,api.preview_reserve_contribution(:'space',:'single_cent_goal','contribution',100,:'today')->>'approvalToken');
select api.record_card_purchase(:'space',:'card',:'category',3,3,:'today','Prepara parcelas um centavo') as dummy_single \gset
select jsonb_agg(jsonb_build_object('ledger_account_id',ledger_account_id,'amount_cents',amount_cents,'card_statement_id',card_statement_id,'installment_number',installment_number,'installment_count',installment_count) order by line_number) as single_entries from finance.ledger_entries where ledger_transaction_id=:'dummy_single' and card_statement_id is not null \gset
select api.cancel_transaction(:'space',:'dummy_single',1,'Substituir divisão entre categorias');
select api.post_transaction(:'space',jsonb_build_object('kind','card_purchase','occurred_on',:'today','competence_month',date_trunc('month',:'today'::date)::date,'description','Vínculo só no primeiro centavo','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',1,'reserve_id',:'single_cent_goal'),jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',2))||:'single_entries'::jsonb)) as single_cent_purchase \gset
select api.refund_transaction(:'space',:'single_cent_purchase',3,:'today',null,'cancel_remaining');
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space',(:'today'::date+interval '4 months')::date)->'reserves') x where x->>'id'=:'single_cent_goal'),100::bigint,'Refund never allocates linked credit to a future installment with zero linked capacity');
select api.create_reserve(:'space',jsonb_build_object('name','IPVA futuro','reserve_type','provision','financial_account_id',:'bank','target_amount_cents',10000,'target_date',(:'today'::date+interval '1 month')::date,'category_id',:'category')) as future_provision \gset
select id as future_commitment from finance.commitments where reserve_id=:'future_provision' \gset
select api.reserve_contribution(:'space',:'future_provision','contribution',10000,:'today');
select api.settle_commitment(:'space',:'future_commitment',10000,(:'today'::date+interval '1 month')::date);
set constraints all immediate;
select is((select status from finance.reserves where id=:'future_provision'),'active','Future settlement does not mark provision settled today');
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space',:'today')->'reserves') x where x->>'id'=:'future_provision'),10000::bigint,'Future settlement retains reserve money before payment date');
set constraints all deferred;
select api.create_reserve(:'space',jsonb_build_object('name','Sobra automática','reserve_type','provision','financial_account_id',:'bank','target_amount_cents',1000,'target_date','2000-01-16','category_id',:'category')) as surplus_provision \gset
select id as surplus_commitment from finance.commitments where reserve_id=:'surplus_provision' \gset
select api.reserve_contribution(:'space',:'surplus_provision','contribution',1500,'2000-01-10');
select api.settle_commitment(:'space',:'surplus_commitment',1000,'2000-01-16') as surplus_payment \gset
set constraints all immediate;
select is((select amount_cents from finance.reserve_contributions where reserve_id=:'surplus_provision' and origin='release_on_settlement' and cancelled_at is null),500::bigint,'Settled provision automatically releases remaining surplus');
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space','2000-01-15')->'reserves') x where x->>'id'=:'surplus_provision'),1500::bigint,'Historical reserve balance survives later settlement');
select api.cancel_transaction(:'space',:'surplus_payment',1,'Pagamento cancelado para teste');
select is((select (x->>'balance_cents')::bigint from jsonb_array_elements(api.reserve_summary(:'space','2000-01-16')->'reserves') x where x->>'id'=:'surplus_provision'),1500::bigint,'Cancelling settlement also cancels automatic release');
set constraints all immediate;
select * from finish();
rollback;
