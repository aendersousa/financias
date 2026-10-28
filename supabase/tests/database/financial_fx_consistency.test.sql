begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000420','fx-consistency@test.local'),('aaaaaaaa-0000-4000-8000-000000000421','fx-consistency-other@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000420","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Consistência cambial') as space \gset
select api.create_financial_account(:'space','Banco','checking',10000000,:'today') as bank \gset
select api.create_category(:'space','Exterior','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id=:'category' \gset
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','USD','original_amount','10','brl_cents',1000,'on',:'today','category_id',:'category','account_id',:'bank','description','Compra confirmada corrigida','confirmed',true,'iof_cents',35)) as purchase \gset
select ledger_transaction_id as transaction_id,iof_transaction_id as iof_transaction from finance.foreign_currency_purchases where id=:'purchase' \gset
select api.edit_transaction(:'space',:'transaction_id',1,(select to_jsonb(t)||jsonb_build_object('entries',(select jsonb_agg(to_jsonb(e)||jsonb_build_object('amount_cents',case when e.amount_cents>0 then 2000 else -2000 end) order by e.line_number) from finance.ledger_entries e where e.ledger_transaction_id=t.id)) from finance.ledger_transactions t where t.id=:'transaction_id'),'Correção manual depois da confirmação');
select (select value from jsonb_array_elements(api.foreign_currency_summary(:'space')->'purchases') value where value->>'id'=:'purchase') as purchase_summary \gset
select is((:'purchase_summary'::jsonb->>'current_brl_cents')::bigint,2000::bigint,'Summary uses actual purchase cents after an ordinary manual correction');
select is((:'purchase_summary'::jsonb->>'recorded_brl_cents')::bigint,1000::bigint,'Original confirmed conversion total remains an immutable historical receipt');
select ok((:'purchase_summary'::jsonb->>'changed_after_conversion')::boolean,'UI can explain that a later correction differs from the recorded conversion');
select is((:'purchase_summary'::jsonb->>'exchange_rate')::numeric,1::numeric,'Correcting ledger amount never silently recalculates the confirmed exchange rate');
select is(:'purchase_summary'::jsonb->>'conversion_status','confirmed','Manual correction does not revert confirmed conversion to estimated');
select api.refund_transaction(:'space',:'transaction_id',500,:'today',:'bank');
select is((select (value->>'current_brl_cents')::bigint from jsonb_array_elements(api.foreign_currency_summary(:'space')->'purchases') value where value->>'id'=:'purchase'),2000::bigint,'Refund is a separate economic reversal and does not rewrite purchase price');
select is((api.transaction_detail(:'space',:'transaction_id')->>'remaining_consumption_cents')::bigint,1500::bigint,'Refundable remainder independently reflects the current price minus refunds');
select api.edit_transaction(:'space',:'iof_transaction',1,(select to_jsonb(t)||jsonb_build_object('entries',(select jsonb_agg(to_jsonb(e)||jsonb_build_object('amount_cents',case when e.amount_cents>0 then 40 else -40 end) order by e.line_number) from finance.ledger_entries e where e.ledger_transaction_id=t.id)) from finance.ledger_transactions t where t.id=:'iof_transaction'),'Correção do IOF no extrato');
select is((select (value->>'iof_cents')::bigint from jsonb_array_elements(api.foreign_currency_summary(:'space')->'purchases') value where value->>'id'=:'purchase'),40::bigint,'IOF summary also follows a corrected separate IOF transaction');
select api.cancel_transaction(:'space',:'iof_transaction',2,'IOF cancelado pelo banco');
select is((select (value->>'iof_cents')::bigint from jsonb_array_elements(api.foreign_currency_summary(:'space')->'purchases') value where value->>'id'=:'purchase'),0::bigint,'Cancelled IOF disappears from actual BRL amounts while history remains');
-- Cancelling the purchase leaves a separately charged IOF intact.
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','EUR','original_amount','10','brl_cents',1000,'on',:'today','category_id',:'category','account_id',:'bank','description','Compra cancelada, IOF cobrado','confirmed',true,'iof_cents',35)) as cancelled_purchase \gset
select ledger_transaction_id as cancelled_transaction from finance.foreign_currency_purchases where id=:'cancelled_purchase' \gset
select api.cancel_transaction(:'space',:'cancelled_transaction',1,'Compra cancelada, imposto continua cobrado');
select (select value from jsonb_array_elements(api.foreign_currency_summary(:'space')->'purchases') value where value->>'id'=:'cancelled_purchase') as cancelled_summary \gset
select is((:'cancelled_summary'::jsonb->>'current_brl_cents')::bigint,0::bigint,'A cancelled purchase never displays an active BRL purchase amount');
select is((:'cancelled_summary'::jsonb->>'recorded_brl_cents')::bigint,1000::bigint,'Cancelled purchase retains its recorded conversion receipt');
select is((:'cancelled_summary'::jsonb->>'iof_cents')::bigint,35::bigint,'Purchase cancellation never silently cancels a distinct charged IOF');
-- A posted conversion difference cannot be orphaned from its original source.
select api.record_foreign_purchase(:'space',jsonb_build_object('currency','GBP','original_amount','10','rate','1','on','2000-01-02','category_id',:'category','account_id',:'bank','description','Ajuste ligado protegido','iof_cents',40)) as adjusted_purchase \gset
select ledger_transaction_id as adjusted_transaction,iof_transaction_id as adjusted_iof from finance.foreign_currency_purchases where id=:'adjusted_purchase' \gset
select api.close_month(:'space','2000-01-01',true);

-- Cash IOF correction is always a linked adjustment; use it to test dependency.
select api.confirm_foreign_purchase(:'space',:'adjusted_purchase',1,1100,:'today',30);
select id as iof_correction from finance.ledger_transactions where related_transaction_id=:'adjusted_iof' and relation_type='fx_confirmation_of' \gset
select api.reopen_month(:'space','2000-01-01','Reabrir para teste de cancelamento ligado');
select confirmation_transaction_id as purchase_correction from finance.foreign_currency_purchases where id=:'adjusted_purchase' \gset
set constraints all immediate;
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'space',:'adjusted_transaction','Cancelar compra original antes do ajuste'),'23514','Cancel the foreign conversion adjustment before its original purchase','Conversion adjustment cannot remain active after its source purchase is cancelled');
select api.cancel_transaction(:'space',:'purchase_correction',1,'Cancelar diferença cambial antes da compra');
select is((select (value->>'current_brl_cents')::bigint from jsonb_array_elements(api.foreign_currency_summary(:'space')->'purchases') value where value->>'id'=:'adjusted_purchase'),1000::bigint,'Cancelling a later conversion adjustment restores actual original purchase cents');
select is((select (value->>'recorded_brl_cents')::bigint from jsonb_array_elements(api.foreign_currency_summary(:'space')->'purchases') value where value->>'id'=:'adjusted_purchase'),1100::bigint,'Cancelling a correction does not erase what the earlier conversion confirmed');
select api.cancel_transaction(:'space',:'adjusted_transaction',1,'Cancelar compra depois de cancelar diferença');
select is((select (value->>'iof_cents')::bigint from jsonb_array_elements(api.foreign_currency_summary(:'space')->'purchases') value where value->>'id'=:'adjusted_purchase'),30::bigint,'IOF and its correction remain distinct after purchase cancellation');
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'space',:'adjusted_iof','Cancelar IOF original antes do ajuste'),'23514','Cancel the IOF adjustment before its original transaction','IOF adjustment cannot remain active after its original is cancelled');
select api.cancel_transaction(:'space',:'iof_correction',1,'Cancelar ajuste do IOF antes do original');
select api.cancel_transaction(:'space',:'adjusted_iof',1,'Cancelar cobrança de IOF inteira');
select is((select (value->>'iof_cents')::bigint from jsonb_array_elements(api.foreign_currency_summary(:'space')->'purchases') value where value->>'id'=:'adjusted_purchase'),0::bigint,'Cancelling both IOF source and adjustment leaves zero actual IOF without negative residue');
select ok((select exists(select 1 from jsonb_array_elements(value->'events') event where event->>'action'='edited') from jsonb_array_elements(api.foreign_currency_summary(:'space')->'purchases') value where value->>'id'=:'purchase'),'Currency history includes the audited later ordinary ledger correction');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000421","role":"authenticated"}',true);
select throws_ok(format('select api.foreign_currency_summary(%L)',:'space'),'42501','Space permission required','Canonical summary still rejects other tenants');
select throws_ok(format('select private.foreign_purchase_amount(%L,%L)',:'space',:'transaction_id'),'42501',null,'Read helpers are revoked from clients');
select * from finish();
rollback;

