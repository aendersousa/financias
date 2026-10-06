begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000410','fx-integration@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000410","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Integração cambial') as space \gset
select api.create_financial_account(:'space','Banco','checking',10000000,:'today') as bank \gset
select api.create_category(:'space','Exterior','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id=:'category' \gset
select api.create_credit_card(:'space','Internacional',1000000,28,5,:'bank') as card \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','100','rate','5.4','on',:'today','category_id',:'category','card_id',:'card','description','Confirmar e estornar')) as purchase \gset
select ledger_transaction_id as transaction_id from finance.foreign_currency_purchases where id=:'purchase' \gset
select card_statement_id as statement from finance.ledger_entries where ledger_transaction_id=:'transaction_id' and card_statement_id is not null \gset
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=54000,period_start=(:'today')::date-20,period_end=(:'today')::date-2,closing_on=(:'today')::date-1,due_on=(:'today')::date+4,effective_due_on=(:'today')::date+4 where id=:'statement';
set local role authenticated;
select api.confirm_foreign_purchase(:'space',:'purchase',1,55200,:'today',1932);
select is((api.transaction_detail(:'space',:'transaction_id')->>'remaining_consumption_cents')::bigint,55200::bigint,'Details expose confirmed purchase consumption without adding separate IOF');
select lives_ok(format('select api.refund_transaction(%L,%L,55200,%L,null,''credit_open_statement'')',:'space',:'transaction_id',:'today'),'A closed purchase may refund its exact confirmed BRL total');
select is((api.transaction_detail(:'space',:'transaction_id')->>'remaining_consumption_cents')::bigint,0::bigint,'Full confirmed refund leaves no refundable purchase consumption');
select throws_ok(format('select api.refund_transaction(%L,%L,1,%L,null,''credit_open_statement'')',:'space',:'transaction_id',:'today'),'23514','Refund exceeds remaining consumption','Confirmed amount cannot be refunded twice');
-- FX installment differences must follow the correction statement due months.
select api.create_credit_card(:'space','Parcelado',1000000,28,5,:'bank') as installment_card \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','10','rate','1','on',:'today','category_id',:'category','card_id',:'installment_card','installments',3,'description','Parcelamento confirmado')) as installments \gset
select ledger_transaction_id as installment_transaction from finance.foreign_currency_purchases where id=:'installments' \gset
select card_statement_id as first_statement from finance.ledger_entries where ledger_transaction_id=:'installment_transaction' and installment_number=1 \gset
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=334 where id=:'first_statement';
set local role authenticated;
select api.confirm_foreign_purchase(:'space',:'installments',1,1002,:'today');
select confirmation_transaction_id as correction from finance.foreign_currency_purchases where id=:'installments' \gset
reset role;
select is((select array_agg((value->>'month')::date order by value->>'month')::text from jsonb_array_elements(private.report_health_expenses(:'space',:'today')) value where value->>'transaction_id'=:'correction'),(select array_agg(date_trunc('month',s.effective_due_on)::date order by s.effective_due_on)::text from finance.ledger_entries e join finance.card_statements s on s.id=e.card_statement_id where e.ledger_transaction_id=:'correction'),'FX correction enters each corrected statement due month in installment health basis');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(private.report_health_expenses(:'space',:'today')) value where value->>'transaction_id'=:'correction' and value->>'group'='installments_and_debts'),2::bigint,'FX correction remains part of installment commitments rather than ordinary variable costs');
set local role authenticated;
select lives_ok(format('select api.refund_transaction(%L,%L,1002,%L,null,''cancel_remaining'')',:'space',:'installment_transaction',:'today'),'Confirmed installment total is refundable including its FX correction');
reset role;
select is((select coalesce(jsonb_agg(jsonb_build_object('month',due_month,'amount',amount) order by due_month),'[]') from (select value->>'month' as due_month,sum((value->>'amount_cents')::bigint)::bigint amount from jsonb_array_elements(private.report_health_expenses(:'space',:'today')) value where value->>'transaction_id'=:'installment_transaction' or value->>'transaction_id'=:'correction' or exists(select 1 from finance.ledger_transactions t where t.id=(value->>'transaction_id')::uuid and t.kind='refund' and t.related_transaction_id=:'installment_transaction') group by 1 having sum((value->>'amount_cents')::bigint)<>0) q),'[]'::jsonb,'Full confirmed installment refund clears each monthly economic component exactly');
set local role authenticated;
select api.create_credit_card(:'space','Aberto',1000000,28,5,:'bank') as open_card \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','10','rate','1','on',:'today','category_id',:'category','card_id',:'open_card','installments',3,'description','Conversão aberta')) as open_purchase \gset
select ledger_transaction_id as open_transaction from finance.foreign_currency_purchases where id=:'open_purchase' \gset
select api.confirm_foreign_purchase(:'space',:'open_purchase',1,1002,:'today',20);
select is((api.transaction_detail(:'space',:'open_transaction')->>'remaining_consumption_cents')::bigint,1002::bigint,'Open edited conversion exposes final total without counting separate IOF');
select lives_ok(format('select api.refund_transaction(%L,%L,1002,%L,null,''cancel_remaining'')',:'space',:'open_transaction',:'today'),'Open edited FX installments retain ordinary refund behavior');
-- A partial refund before confirmation keeps its already recognized economic
-- months; the final refund consumes only the remaining confirmed purchase.
select api.create_credit_card(:'space','Parcial',1000000,28,5,:'bank') as partial_card \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','10','rate','1','on',:'today','category_id',:'category','card_id',:'partial_card','installments',3,'description','Parcial antes da confirmação')) as partial_purchase \gset
select ledger_transaction_id as partial_transaction from finance.foreign_currency_purchases where id=:'partial_purchase' \gset
select api.refund_transaction(:'space',:'partial_transaction',200,:'today',null,'cancel_remaining') as early_refund \gset
select card_statement_id as partial_statement from finance.ledger_entries where ledger_transaction_id=:'partial_transaction' and installment_number=1 \gset
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=267 where id=:'partial_statement';
set local role authenticated;
select api.confirm_foreign_purchase(:'space',:'partial_purchase',1,1002,:'today');
select is((api.transaction_detail(:'space',:'partial_transaction')->>'remaining_consumption_cents')::bigint,802::bigint,'Confirmed total subtracts refunds made before confirmation');
select api.refund_transaction(:'space',:'partial_transaction',300,:'today',null,'cancel_remaining','44444444-aaaa-4410-8410-444444444410') as partial_refund \gset
select is((api.transaction_detail(:'space',:'partial_transaction')->>'remaining_consumption_cents')::bigint,502::bigint,'Each later partial refund reduces the confirmed refundable balance');
select is(api.refund_transaction(:'space',:'partial_transaction',300,:'today',null,'cancel_remaining','44444444-aaaa-4410-8410-444444444410'),:'partial_refund'::uuid,'FX refunds keep the original idempotent request receipt');
select api.refund_transaction(:'space',:'partial_transaction',502,:'today',null,'cancel_remaining');
reset role;
select is((select coalesce(sum(abs(net)),0)::bigint from (select value->>'month' due_month,sum((value->>'amount_cents')::bigint)::bigint net from jsonb_array_elements(private.report_health_expenses(:'space',:'today')) value where private.is_foreign_purchase_part(:'space',:'partial_transaction',(value->>'transaction_id')::uuid) or exists(select 1 from finance.ledger_transactions r where r.id=(value->>'transaction_id')::uuid and r.kind='refund' and r.related_transaction_id=:'partial_transaction') group by 1) q),0::bigint,'Multiple partial refunds clear final economic consumption in every installment month');
set local role authenticated;
-- Confirmed reductions lower the refund cap and distribute credits by actual
-- corrected due dates, including signed economic components.
select api.create_credit_card(:'space','Redução',1000000,28,5,:'bank') as decrease_card \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','10','rate','1','on',:'today','category_id',:'category','card_id',:'decrease_card','installments',3,'description','Conversão reduzida')) as decrease_purchase \gset
select ledger_transaction_id as decrease_transaction from finance.foreign_currency_purchases where id=:'decrease_purchase' \gset
select card_statement_id as decrease_statement from finance.ledger_entries where ledger_transaction_id=:'decrease_transaction' and installment_number=1 \gset
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=334 where id=:'decrease_statement';
set local role authenticated;
select api.confirm_foreign_purchase(:'space',:'decrease_purchase',1,998,:'today');
select is((api.transaction_detail(:'space',:'decrease_transaction')->>'remaining_consumption_cents')::bigint,998::bigint,'Negative conversion difference decreases the refundable amount');
select throws_ok(format('select api.refund_transaction(%L,%L,1000,%L,null,''cancel_remaining'')',:'space',:'decrease_transaction',:'today'),'23514','Refund exceeds remaining consumption','Original estimate cannot bypass a smaller confirmed BRL total');
select api.refund_transaction(:'space',:'decrease_transaction',998,:'today',null,'cancel_remaining');
reset role;
select is((select coalesce(sum(abs(net)),0)::bigint from (select value->>'month' due_month,sum((value->>'amount_cents')::bigint)::bigint net from jsonb_array_elements(private.report_health_expenses(:'space',:'today')) value where private.is_foreign_purchase_part(:'space',:'decrease_transaction',(value->>'transaction_id')::uuid) or exists(select 1 from finance.ledger_transactions r where r.id=(value->>'transaction_id')::uuid and r.kind='refund' and r.related_transaction_id=:'decrease_transaction') group by 1) q),0::bigint,'Full refund after a decrease also clears each economic due month');
set local role authenticated;
select throws_ok(format('select private.foreign_remaining_consumption(%L,%L)',:'space',:'transaction_id'),'42501',null,'Economic lineage helper is not callable by clients');
select ok((api.transaction_detail(:'space',:'transaction_id')->'unidentified_adjustment_cents') is not null,'FX detail wrapper preserves the adjustment explanation extension');
set constraints all immediate;
select * from finish();
rollback;


