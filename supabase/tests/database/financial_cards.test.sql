begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(17);
select is(private.effective_due_date(null,'2026-10-10'),'2026-10-13'::date,'CT-CARD-009 weekend and national holiday');
select is(private.effective_due_date(null,'2027-02-09'),'2027-02-10'::date,'CT-CARD-009 Carnaval');
select is(private.add_banking_days(null,'2026-10-09',3),'2026-10-15'::date,'CT-CARD-002 boleto release');
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000091','cards-a@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000091","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Teste cartões') as space \gset
select api.create_financial_account(:'space','Banco','checking',500000,:'today') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_category(:'space','Eletrônicos','expense') as electronics \gset
select api.create_category(:'space','Mercado','expense') as market \gset
select api.create_credit_card(:'space','Cartão A',500000,1,10,:'bank') as card \gset
select ledger_account_id as card_ledger from finance.credit_cards where id = :'card' \gset
select api.record_card_purchase(:'space',:'card',:'electronics',120000,12,:'today','TV',null,'11111111-1111-4111-8111-111111111191') as tv \gset
select api.record_card_purchase(:'space',:'card',:'market',38000,1,:'today','Mercado') as grocery \gset
select is((select count(*) from finance.ledger_entries where ledger_transaction_id = :'tv'),13::bigint,'CT-CARD-001 one consumption entry and twelve installments');
select is((select amount_cents from finance.statement_amounts where credit_card_id = :'card' and status = 'open'),48000::bigint,'CT-CARD-001 current statement is 100 plus 380');
select is((select balance_cents from finance.account_balances where id = :'card_ledger'),-158000::bigint,'CT-CARD-001 total debt includes future installments');
select is((select sum(balance_cents) from finance.account_balances where account_class = 'expense'),158000::numeric,'CT-CARD-001 total consumption recognized on purchase');
select is((select sum(balance_cents) from finance.account_balances where liquidity = 'cash'),500000::numeric,'Card purchase does not reduce cash');
select is((select free_cents from finance.card_limits where id = :'card'),342000::bigint,'INV-CARD-003 limit includes all debt');
select api.authorize_card_purchase(:'space',:'card',20000,:'today','Compra em processamento') as pending \gset
select is((select used_cents from finance.card_limits where id = :'card'),178000::bigint,'Authorization retains limit without ledger posting');
select api.record_card_purchase(:'space',:'card',:'market',20000,1,:'today','Compra confirmada',null,'22222222-2222-4222-8222-222222222291',null,:'pending') as converted \gset
select is((select used_cents from finance.card_limits where id = :'card'),178000::bigint,'Authorization conversion does not double count');
select is((select status from finance.card_authorizations where id = :'pending'),'converted','Authorization lifecycle is preserved');
select api.pay_card(:'space',:'card',:'bank_ledger',10000,:'today','pix','33333333-3333-4333-8333-333333333391') as payment \gset
select is((select remaining_cents from finance.statement_amounts where credit_card_id = :'card' and status = 'open'),58000::bigint,'Partial payment reduces remaining amount');
select is((select sum(balance_cents) from finance.account_balances where account_class = 'expense'),178000::numeric,'INV-CARD-001 payment creates no additional expense');
select is(api.pay_card(:'space',:'card',:'bank_ledger',10000,:'today','pix','33333333-3333-4333-8333-333333333391'),:'payment'::uuid,'Payment replay does not pay twice');
select api.pay_card(:'space',:'card',:'bank_ledger',10000,:'today','boleto') as boleto \gset
select is((select used_cents from finance.card_limits where id = :'card'),168000::bigint,'Boleto hold retains limit until settlement');
select is((select count(*) from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where e.ledger_account_id = :'card_ledger' and e.card_statement_id is null),0::bigint,'INV-CARD-004 every card entry has a statement');
set constraints all immediate;
select * from finish();
rollback;
