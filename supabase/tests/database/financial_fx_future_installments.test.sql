begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000440','fx-future@test.local'),('aaaaaaaa-0000-4000-8000-000000000441','fx-outsider@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000440","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Parcelas com conversão confirmada') as space \gset
select api.create_financial_account(:'space','Banco','checking',10000000,:'today') as bank \gset
select api.create_category(:'space','Exterior','expense') as category \gset
select api.create_credit_card(:'space','Parcelado',1000000,28,5,:'bank') as card \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','10','rate','1','on',:'today','category_id',:'category','card_id',:'card','installments',3,'iof_cents',30,'description','Confirmar centavos das parcelas')) as purchase \gset
select ledger_transaction_id as transaction_id,iof_transaction_id as iof_original from finance.foreign_currency_purchases where id=:'purchase' \gset
select card_statement_id as first_statement from finance.ledger_entries where ledger_transaction_id=:'transaction_id' and installment_number=1 \gset
select card_statement_id as second_statement from finance.ledger_entries where ledger_transaction_id=:'transaction_id' and installment_number=2 \gset
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=364 where id=:'first_statement';
set local role authenticated;
select api.confirm_foreign_purchase(:'space',:'purchase',1,1002,:'today',40);
select confirmation_transaction_id as correction from finance.foreign_currency_purchases where id=:'purchase' \gset
select id as correction_entry from finance.ledger_entries where ledger_transaction_id=:'correction' and card_statement_id=:'second_statement' \gset
select e.id as iof_entry,t.id as iof_correction from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where t.related_transaction_id=:'iof_original' and t.relation_type='fx_confirmation_of' and e.card_statement_id is not null \gset
select is((api.financial_health(:'space',:'today')#>>'{future_installments,total_cents}')::bigint,668::bigint,'Future installments include both confirmed FX cents, without separate IOF');
select is((api.reports_summary(:'space',date_trunc('month',(:'today')::date)::date)#>>'{future_installments,total_cents}')::bigint,668::bigint,'Reports expose the same canonical confirmed future installment total');
select is((api.dashboard_summary(:'space')#>>'{future_installments,total_cents}')::bigint,668::bigint,'Dashboard includes confirmed future installment corrections');
select ok(not exists(select 1 from jsonb_array_elements(api.financial_health(:'space',:'today')#>'{future_installments,items}') where value->>'source_id'<>:'transaction_id'),'Correction composition preserves the original purchase filter identity');
reset role;
select is((private.report_card_part(:'space',:'correction_entry')->0->>'installment')::boolean,true,'Linked conversion correction inherits original installment classification');
select is(private.report_card_part(:'space',:'correction_entry')->0->>'source_id',:'transaction_id','Conversion correction preserves original transaction lineage');
select is((private.report_card_part(:'space',:'iof_entry')->0->>'installment')::boolean,false,'Separate IOF correction is never classified as a purchase installment');
select is(private.report_card_part(:'space',:'iof_entry')->0->>'source_id',:'iof_correction','IOF keeps its independent composition identity');
set local role authenticated;
select api.refund_transaction(:'space',:'transaction_id',2,:'today',null,'cancel_remaining');
select is((api.financial_health(:'space',:'today')#>>'{future_installments,total_cents}')::bigint,666::bigint,'Partial refund reduces the two unbilled confirmed installments by exact allocation');
select api.refund_transaction(:'space',:'transaction_id',1000,:'today',null,'cancel_remaining');
select is((api.financial_health(:'space',:'today')#>>'{future_installments,total_cents}')::bigint,0::bigint,'Full confirmed refund leaves no FX installment residue');
select is(api.financial_health(:'space',:'today')#>'{future_installments,items}','[]'::jsonb,'Excess refund credit is not a negative future installment of the completed purchase');
-- A reduction can move a closed first-part difference into the next open
-- statement; signed corrections remain in that statement's composition.
select api.create_credit_card(:'space','Conversão reduzida',1000000,28,5,:'bank') as decrease_card \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','10','rate','1','on',:'today','category_id',:'category','card_id',:'decrease_card','installments',3,'description','Redução confirmada')) as decrease_purchase \gset
select ledger_transaction_id as decrease_transaction from finance.foreign_currency_purchases where id=:'decrease_purchase' \gset
select card_statement_id as decrease_first from finance.ledger_entries where ledger_transaction_id=:'decrease_transaction' and installment_number=1 \gset
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=334 where id=:'decrease_first';
set local role authenticated;
select api.confirm_foreign_purchase(:'space',:'decrease_purchase',1,998,:'today');
select is((api.financial_health(:'space',:'today')#>>'{future_installments,total_cents}')::bigint,665::bigint,'Confirmed reduction decreases future obligations by its signed correction');
select is((select sum((value->>'amount_cents')::bigint)::bigint from jsonb_array_elements(api.financial_health(:'space',:'today')#>'{future_installments,items}') where value->>'card_id'=:'decrease_card'),665::bigint,'Prior refunded card credit cannot reduce another card installment obligation');
select api.refund_transaction(:'space',:'decrease_transaction',998,:'today',null,'cancel_remaining');
select is((api.financial_health(:'space',:'today')#>>'{future_installments,total_cents}')::bigint,0::bigint,'Full refund clears reduced confirmed future installments');
-- Ordinary edits of an open conversion already have installment metadata.
select api.create_credit_card(:'space','Conversão aberta',1000000,28,5,:'bank') as open_card \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','10','rate','1','on',:'today','category_id',:'category','card_id',:'open_card','installments',3,'description','Confirmação aberta')) as open_purchase \gset
select ledger_transaction_id as open_transaction from finance.foreign_currency_purchases where id=:'open_purchase' \gset
select api.confirm_foreign_purchase(:'space',:'open_purchase',1,1002,:'today',20);
select is((api.financial_health(:'space',:'today')#>>'{future_installments,total_cents}')::bigint,668::bigint,'Open conversion keeps its existing canonical future allocation');
select api.prepay_card_installments(:'space',:'open_transaction',array[3],0,:'today');
select is((api.financial_health(:'space',:'today')#>>'{future_installments,total_cents}')::bigint,334::bigint,'Prepayment removes a confirmed installment from future totals once');
select api.refund_transaction(:'space',:'open_transaction',1002,:'today',null,'cancel_remaining');
select is((api.financial_health(:'space',:'today')#>>'{future_installments,total_cents}')::bigint,0::bigint,'Refund after prepayment leaves no future confirmed debt');
-- A one-time closed purchase may have an FX difference in a future statement,
-- but that does not turn it into an installment series.
select api.create_credit_card(:'space','Compra única',1000000,28,5,:'bank') as single_card \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','10','rate','1','on',:'today','category_id',:'category','card_id',:'single_card','description','Compra sem parcelas')) as single_purchase \gset
select ledger_transaction_id as single_transaction from finance.foreign_currency_purchases where id=:'single_purchase' \gset
select card_statement_id as single_statement from finance.ledger_entries where ledger_transaction_id=:'single_transaction' and card_statement_id is not null \gset
reset role;
update finance.card_statements set status='closed',closed_at=now(),closing_amount_cents=1000 where id=:'single_statement';
set local role authenticated;
select api.confirm_foreign_purchase(:'space',:'single_purchase',1,1002,:'today',35);
select is((api.financial_health(:'space',:'today')#>>'{future_installments,total_cents}')::bigint,0::bigint,'FX correction of a one-time purchase is excluded from installment totals');
select throws_ok(format('select private.report_card_part(%L,%L)',:'space',:'correction_entry'),'42501',null,'Composition helper remains unavailable to authenticated clients');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000441","role":"authenticated"}',true);
select throws_ok(format('select api.financial_health(%L,%L)',:'space',:'today'),'42501','Space permission required','Canonical future summary remains scoped to active space members');
set constraints all immediate;
select * from finish();
rollback;
