begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select plan(12);
insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-8000-000000000201','assets@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000201","role":"authenticated"}',true);
select api.create_personal_space('Teste patrimônio') as space \gset
select api.create_financial_account(:'space','Banco','checking',0,'2000-01-01') as bank \gset
select api.create_financial_account(:'space','CDB','investment',100000,'2000-01-01') as cdb \gset
select api.redeem_investment(:'space',:'cdb',:'bank','2000-01-02',110000,1500,0,'11111111-aaaa-4111-8111-111111111201') as redemption \gset
select is((select balance_cents from finance.account_balances where id = (select ledger_account_id from finance.financial_accounts where id = :'bank')),108500::bigint,'CT-INV-001 net cash includes tax withheld');
select is((select balance_cents from finance.account_balances where id = (select ledger_account_id from finance.financial_accounts where id = :'cdb')),0::bigint,'CT-INV-001 redeemed investment position is zero');
select is((select sum(e.amount_cents) from finance.posted_ledger_entries e join finance.categories c on c.ledger_account_id = e.ledger_account_id where c.system_role = 'taxes_fees'),1500::numeric,'CT-INV-001 withheld tax is expense');
select is((select count(*) from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id where a.account_class = 'income'),0::bigint,'CT-INV-001 investment result is not income');
select is(api.redeem_investment(:'space',:'cdb',:'bank','2000-01-02',110000,1500,0,'11111111-aaaa-4111-8111-111111111201'),:'redemption'::uuid,'Redemption retry does not withdraw twice');
select api.create_financial_account(:'space','Bem','property',100000,'2000-01-01') as property \gset
select api.value_asset(:'space',:'property','2000-01-31',100000) as same_valuation \gset
select is((select ledger_transaction_id from finance.asset_valuations where id = :'same_valuation'),null::uuid,'Unchanged valuation is recorded without ledger transaction');
select api.value_asset(:'space',:'property','2000-02-28',110000) as changed_valuation \gset
select is((select balance_cents from finance.account_balances where id = (select ledger_account_id from finance.financial_accounts where id = :'property')),110000::bigint,'Valuation changes property balance against investment result');
select api.create_loan(:'space','Empréstimo pessoal','loan',0,'2000-01-01') as loan \gset
select api.loan_movement(:'space',:'loan',:'bank','2000-01-03','receive',1000000,30000) as drawdown \gset
select is((select -balance_cents from finance.account_balances where id = (select ledger_account_id from finance.loans where id = :'loan')),1000000::bigint,'Received loan creates liability for full principal');
select is((select balance_cents from finance.account_balances where id = (select ledger_account_id from finance.financial_accounts where id = :'bank')),1078500::bigint,'Received loan credits net principal after financed charges');
select api.loan_movement(:'space',:'loan',:'bank','2000-01-04','pay',100000,5000) as payment \gset
select is((select -balance_cents from finance.account_balances where id = (select ledger_account_id from finance.loans where id = :'loan')),900000::bigint,'Loan payment reduces principal only by amortization');
select throws_ok(format('select api.loan_movement(%L,%L,%L,%L,%L,900001,0)',:'space',:'loan',:'bank','2000-01-05','pay'),'23514','Principal payment exceeds debt','Loan principal cannot be overpaid');
select is((select sum(e.amount_cents) from finance.posted_ledger_entries e join finance.categories c on c.ledger_account_id = e.ledger_account_id where c.system_role = 'financial_charges'),35000::numeric,'Loan charges are recognized as expense without counting principal');
set constraints all immediate;
select * from finish();
rollback;
