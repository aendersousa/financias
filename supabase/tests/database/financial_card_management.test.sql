begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000411','card-management@test.local'),('aaaaaaaa-0000-4000-8000-000000000412','card-outsider@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000411","role":"authenticated"}',true);
select (now() at time zone 'America/Sao_Paulo')::date as today \gset
select api.create_personal_space('Gestão cartões') as space \gset
select api.create_financial_account(:'space','Banco','checking',1000000,:'today') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','TV','expense') as category \gset
select api.create_credit_card(:'space','Cartão',500000,1,10,:'bank') as card \gset
select ledger_account_id as card_ledger from finance.credit_cards where id=:'card' \gset
select api.create_person(:'space','Adicional') as person \gset
select api.manage_card_holder(:'space',:'card',null,null,'create',jsonb_build_object('name','Adicional','kind','additional','last_digits','1234','person_id',:'person'),'11111111-aaaa-4111-8111-111111111411') as holder \gset
select is(api.manage_card_holder(:'space',:'card',null,null,'create',jsonb_build_object('name','Adicional','kind','additional','last_digits','1234','person_id',:'person'),'11111111-aaaa-4111-8111-111111111411'),:'holder'::uuid,'Holder creation replays same UUID without duplicates');
select throws_ok(format('select api.manage_card_holder(%L,%L,null,null,''create'',''{"name":"Segundo","kind":"main"}'')',:'space',:'card'),'23514','Card already has a main holder','Additional main holder rejected');
select api.record_card_purchase(:'space',:'card',:'category',120000,12,:'today','Compra do adicional',:'holder') as purchase \gset
select api.manage_card_holder(:'space',:'card',:'holder',1,'deactivate');
select is((select card_holder_id from finance.ledger_transactions where id=:'purchase'),:'holder'::uuid,'Holder deactivation preserves purchase history');
select throws_ok(format('select api.record_card_purchase(%L,%L,%L,100,1,%L,''Portador desativado'',%L)',:'space',:'card',:'category',:'today',:'holder'),'23514','Active card holder not found','Deactivated holder cannot make new purchase');
select throws_ok(format('select api.manage_card_holder(%L,%L,%L,1,''activate'')',:'space',:'card',:'holder'),'40001','Holder changed; reload before editing','Holder version prevents lost updates');
select array_agg(e.card_statement_id order by e.line_number) as original_statement_ids from finance.ledger_entries e where e.ledger_transaction_id=:'purchase' and e.card_statement_id is not null \gset
select period_start as original_start,(date_trunc('month',closing_on)::date+10) as expected_close,(date_trunc('month',closing_on)::date+19) as expected_due from finance.card_statements where credit_card_id=:'card' and status='open' \gset
select api.manage_card(:'space',:'card',1,'settings','{"closing_day":11,"due_day":20,"installment_remainder":"last","limit_release_days_pix":1}');
select is((select array_agg(e.card_statement_id order by e.line_number)::text from finance.ledger_entries e where e.ledger_transaction_id=:'purchase' and e.card_statement_id is not null),:'original_statement_ids','Changing card dates preserves each installment statement ID');
select is((select closing_on from finance.card_statements where credit_card_id=:'card' and status='open'),:'expected_close'::date,'CT-CARD-010 open cycle closes on next occurrence of new closing day');
select is((select period_start from finance.card_statements where credit_card_id=:'card' and status='open'),:'original_start'::date,'Open cycle keeps its previous start through transition');
select is((select due_on from finance.card_statements where credit_card_id=:'card' and status='open'),:'expected_due'::date,'Transition statement adopts new due day');
select is((select sum(amount_cents)::bigint from finance.posted_ledger_entries where ledger_account_id=:'card_ledger'),-120000::bigint,'Date changes never change debt');
select throws_ok(format('select api.manage_card(%L,%L,1,''settings'',''{"name":"Lost update"}'')',:'space',:'card'),'40001','Card changed; reload before editing','Card settings use optimistic version');
select api.manage_card(:'space',:'card',2,'limit',jsonb_build_object('amount_cents',600000,'valid_from',(:'today')::date+1,'reason','Aumento confirmado pelo banco'),'22222222-aaaa-4222-8222-222222222411');
select is((select granted_cents from finance.card_limits where id=:'card'),500000::bigint,'Future limit does not overwrite current granted limit');
select is((select count(*) from finance.credit_card_limits where credit_card_id=:'card'),2::bigint,'Limit change adds immutable dated history');
select is(api.manage_card(:'space',:'card',2,'limit',jsonb_build_object('amount_cents',600000,'valid_from',(:'today')::date+1,'reason','Aumento confirmado pelo banco'),'22222222-aaaa-4222-8222-222222222411'),:'card'::uuid,'Limit UUID replay ignores later card version safely');
select throws_ok(format('select api.manage_card(%L,%L,3,''settings'',''{"last_digits":"1234567812345678"}'')',:'space',:'card'),'23514',null,'Full card number is rejected instead of stored');
select api.manage_card_authorization(:'space',:'card',null,null,'create',jsonb_build_object('on',:'today','amount_cents',50000,'description','Hotel'),'33333333-aaaa-4333-8333-333333333411') as authorization \gset
select is((select used_cents from finance.card_limits where id=:'card'),170000::bigint,'Authorization retains limit without posting expense');
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space'),2::bigint,'Holder, settings, limit and authorization write no financial transactions');
select api.manage_card_authorization(:'space',:'card',:'authorization',1,'edit',jsonb_build_object('amount_cents',45000,'expires_on',(:'today')::date+10));
select is((select used_cents from finance.card_limits where id=:'card'),165000::bigint,'Authorization amount may be corrected before conversion');
select throws_ok(format('select api.manage_card_authorization(%L,%L,%L,1,''cancel'')',:'space',:'card',:'authorization'),'40001','Authorization changed; reload before editing','Authorization optimistic version detects competing edit');
select api.manage_card(:'space',:'card',3,'cancel');
select throws_ok(format('select api.record_card_purchase(%L,%L,%L,100,1,%L,''Compra nova'')',:'space',:'card',:'category',:'today'),'23514',null,'Cancelled card rejects new purchases');
select api.record_card_purchase(:'space',:'card',:'category',43780,1,:'today','Hotel confirmado',null,null,null,:'authorization') as converted \gset
select is((select status from finance.card_authorizations where id=:'authorization'),'converted','Pending purchase authorization may still convert after cancellation');
select is((select used_cents from finance.card_limits where id=:'card'),163780::bigint,'Conversion replaces authorization by actual purchase value once');
select api.pay_card(:'space',:'card',:'bank_ledger',10000,:'today');
select is((select count(*) from finance.card_statements where credit_card_id=:'card' and status='open'),1::bigint,'Payment after rule change never regenerates a second open cycle');
select is((select closing_on from finance.card_statements where credit_card_id=:'card' and status='open'),:'expected_close'::date,'Payment preserves the bank transition dates');
select lives_ok(format('select api.card_management_summary(%L)',:'space'),'Cancelled card remains available for payments and read history');
select throws_ok(format('select api.manage_card(%L,%L,4,''archive'')',:'space',:'card'),'23514','Card still has balance, future entries, authorizations or payment plans','Cannot archive indebted card');
select api.create_credit_card(:'space','Cartão vazio',100000,1,10,:'bank') as empty \gset
select api.manage_card(:'space',:'empty',1,'cancel');
select api.manage_card(:'space',:'empty',2,'archive');
select is((select status from finance.credit_cards where id=:'empty'),'archived','Cancelled empty card may be archived');
select is((select allows_posting from finance.ledger_accounts where id=(select ledger_account_id from finance.credit_cards where id=:'empty')),false,'Archive disables ledger posting');
select api.manage_card(:'space',:'empty',3,'restore');
select is((select status from finance.credit_cards where id=:'empty'),'cancelled','Restore returns card to cancelled state');
select api.manage_card(:'space',:'empty',4,'reactivate');
select is((select status from finance.credit_cards where id=:'empty'),'active','Cancelled card can be reactivated with audit');
select throws_ok(format('select api.manage_card(%L,%L,5,null)',:'space',:'empty'),'23514','Invalid card request','Null lifecycle action cannot implicitly cancel');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000412","role":"authenticated"}',true);
select throws_ok(format('select api.card_management_summary(%L)',:'space'),'42501','Space permission required','Other tenant cannot read management data');
select throws_ok(format('select api.manage_card(%L,%L,5,''cancel'')',:'space',:'empty'),'42501',null,'Other tenant cannot change card state');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000411","role":"authenticated"}',true);
select api.create_credit_card(:'space','Cartão em andamento',500000,1,10,:'bank') as ongoing \gset
select jsonb_build_object('closed_statements',jsonb_build_array(jsonb_build_object('period_start',(date_trunc('month',(:'today')::date)-interval '1 month')::date,'closing_on',date_trunc('month',(:'today')::date)::date,'due_on',date_trunc('month',(:'today')::date)::date+9,'amount_cents',158000)),'open_amount_cents',42000,'bank_used_cents',445000,'installments',jsonb_build_array(jsonb_build_object('description','Geladeira antiga','from',4,'count',10,'amount_cents',35000))) as opening_payload \gset
select api.configure_card_opening(:'space',:'ongoing',:'today',:'opening_payload','44444444-aaaa-4444-8444-444444444411');
select is((select used_cents from finance.card_limits where id=:'ongoing'),445000::bigint,'CT-CARD-008 opening reconciles closed, open and ongoing installments');
select is((select coalesce(sum(amount_cents),0)::bigint from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.account_class='expense' where e.ledger_transaction_id in(select t.id from finance.ledger_transactions t join finance.ledger_entries card_entry on card_entry.ledger_transaction_id=t.id join finance.credit_cards c on c.ledger_account_id=card_entry.ledger_account_id where c.id=:'ongoing')),0::bigint,'Ongoing card opening creates no expenses');
select is(api.configure_card_opening(:'space',:'ongoing',:'today',:'opening_payload','44444444-aaaa-4444-8444-444444444411'),:'ongoing'::uuid,'Opening setup retries do not double debt');
select throws_ok(format('select api.configure_card_opening(%L,%L,%L,''{}'')',:'space',:'ongoing',:'today'),'23514','Opening setup requires an unused active card','Second opening setup without original UUID is rejected');

-- Metadata writes reserve the same per-space UUID namespace as financial writes.
select throws_ok(format('select api.manage_card_holder(%L,%L,null,null,''create'',''{"name":"Outro","kind":"additional"}'',''11111111-aaaa-4111-8111-111111111411'')',:'space',:'card'),'23505','Client UUID reused with different operation','Holder UUID cannot silently change its canonical request');
select id as main_holder from finance.credit_card_holders where credit_card_id=:'empty' and kind='main' \gset
select throws_ok(format('select api.manage_card_holder(%L,%L,%L,null,''create'',''{"name":"Duplicado","kind":"main"}'')',:'space',:'empty',:'main_holder'),'23514','New holder cannot reuse an existing identity or version','Create cannot bypass unique main holder using an existing identity');
select throws_ok(format('select api.manage_card_holder(%L,%L,%L,2,''activate'',''{"kind":"main"}'')',:'space',:'card',:'holder'),'23514','Holder state changes do not edit holder details','Activating a holder cannot secretly turn it into another main holder');
select api.record_card_purchase(:'space',:'empty',:'category',100,1,:'today','UUID financeiro',p_client_uuid=>'55555555-aaaa-4555-8555-555555555411') as uuid_purchase \gset
select throws_ok(format('select api.manage_card_holder(%L,%L,null,null,''create'',''{"name":"UUID duplicado","kind":"additional"}'',''55555555-aaaa-4555-8555-555555555411'')',:'space',:'empty'),'23505','Client UUID reused with different operation','Financial UUID cannot be reused for card metadata');
select throws_ok(format('select api.record_card_purchase(%L,%L,%L,100,1,%L,''UUID não financeiro'',p_client_uuid=>''11111111-aaaa-4111-8111-111111111411'')',:'space',:'empty',:'category',:'today'),'23505','Client UUID reused with different operation','Card metadata UUID cannot be reused for a financial transaction');
select api.manage_card_authorization(:'space',:'empty',null,null,'create',jsonb_build_object('amount_cents',1000,'description','Autorização nova','on',:'today'),'66666666-aaaa-4666-8666-666666666411') as new_authorization \gset
select throws_ok(format('select api.manage_card_authorization(%L,%L,%L,1,''cancel'',''{"amount_cents":1}'')',:'space',:'empty',:'new_authorization'),'23514','Cancelling an authorization does not edit its details','Cancellation cannot alter authorization history');
select api.manage_card_authorization(:'space',:'empty',:'new_authorization',1,'cancel');
select is(api.manage_card_authorization(:'space',:'empty',null,null,'create',jsonb_build_object('amount_cents',1000,'description','Autorização nova','on',:'today'),'66666666-aaaa-4666-8666-666666666411'),:'new_authorization'::uuid,'Cancelled authorization still replays its original creation');
select throws_ok(format('select api.manage_card(%L,%L,5,''settings'',''{"late_fee_percent":"NaN"}'')',:'space',:'empty'),'23514','Card rates must be finite and nonnegative','NaN rates cannot enter charge estimates');
select throws_ok(format('select api.manage_card(%L,%L,5,''settings'',''{"name":"   "}'')',:'space',:'empty'),'23514','Card name must contain one to one hundred characters','Whitespace-only card name rejected');

-- Date overrides protect manual bank dates, closed cycles and zero-balance due dates.
select id as open_stmt,version as open_version,closing_on as open_close,due_on as open_due from finance.card_statements where credit_card_id=:'card' and status='open' \gset
select api.edit_card_statement_dates(:'space',:'open_stmt',:'open_version',jsonb_build_object('closing_on',(:'open_close')::date+1),'77777777-aaaa-4777-8777-777777777411');
select is((select dates_overridden from finance.card_statements where id=:'open_stmt'),true,'Statement dates record a manual override');
select is(api.edit_card_statement_dates(:'space',:'open_stmt',:'open_version',jsonb_build_object('closing_on',(:'open_close')::date+1),'77777777-aaaa-4777-8777-777777777411'),:'open_stmt'::uuid,'Manual statement date retry returns original result after version changes');
select throws_ok(format('select api.edit_card_statement_dates(%L,%L,%L,''{}'')',:'space',:'open_stmt',:'open_version'),'40001','Statement changed; reload before editing','Statement dates use optimistic concurrency');
select api.manage_card(:'space',:'card',4,'settings','{"closing_day":13,"due_day":25}');
select is((select closing_on from finance.card_statements where id=:'open_stmt'),(:'open_close')::date+1,'Changing card rules preserves manually overridden closing dates');
select is((select due_on from finance.card_statements where id=:'open_stmt'),:'open_due'::date,'Changing card rules preserves manually overridden due dates');
select array_agg(id order by closing_on,reference_month,id) as expected_purchase_statements from (select id,closing_on,reference_month from finance.card_statements where credit_card_id=:'card' and closing_on>=(select closing_on from finance.card_statements where id=:'open_stmt') order by closing_on,reference_month,id limit 6) s \gset
select api.manage_card(:'space',:'card',5,'reactivate');
select api.record_card_purchase(:'space',:'card',:'category',6000,6,:'today','Compra depois das novas datas') as transition_purchase \gset
select is((select array_agg(e.card_statement_id order by e.installment_number)::text from finance.ledger_entries e where e.ledger_transaction_id=:'transition_purchase' and e.card_statement_id is not null),:'expected_purchase_statements','New purchase follows the existing overridden cycle and its next five statements');
select is((select count(*) from finance.card_statements where credit_card_id=:'card' and status='open'),1::bigint,'New purchase does not replace the overridden transition cycle');
select id as closed_stmt,version as closed_version,closing_on as closed_close,due_on as closed_due from finance.card_statements where credit_card_id=:'ongoing' and status='closed' \gset
select throws_ok(format('select api.edit_card_statement_dates(%L,%L,%L,%L)',:'space',:'closed_stmt',:'closed_version',jsonb_build_object('closing_on',(:'closed_close')::date+1)),'23514','Closed statement period is immutable','Closed statement period cannot be changed');
select lives_ok(format('select api.edit_card_statement_dates(%L,%L,%L,%L)',:'space',:'closed_stmt',:'closed_version',jsonb_build_object('due_on',(:'closed_due')::date+1)),'Unpaid closed statement may have bank due dates corrected');
select api.create_credit_card(:'space','Sem dívida',100000,1,10,:'bank') as no_debt \gset
select id as no_debt_stmt,version as no_debt_version,due_on as no_debt_due from finance.card_statements where credit_card_id=:'no_debt' and status='open' \gset
select throws_ok(format('select api.edit_card_statement_dates(%L,%L,%L,%L)',:'space',:'no_debt_stmt',:'no_debt_version',jsonb_build_object('due_on',(:'no_debt_due')::date+1)),'23514','Paid statement due dates are immutable','Zero remaining balance protects nominal and effective due dates');

-- Members may record pending purchases; card administration is owner/admin only.
reset role;
insert into finance.financial_space_members(financial_space_id,user_id,role,status) values(:'space','aaaaaaaa-0000-4000-8000-000000000412','member','active');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000412","role":"authenticated"}',true);
select lives_ok(format('select api.card_management_summary(%L)',:'space'),'Member may view complete card management history');
select throws_ok(format('select api.manage_card(%L,%L,5,''settings'',''{"name":"Sem permissão"}'')',:'space',:'empty'),'42501','Administrator permission required','Member cannot configure card');
select throws_ok(format('select api.manage_card_holder(%L,%L,null,null,''create'',''{"name":"Não","kind":"additional"}'')',:'space',:'empty'),'42501','Administrator permission required','Member cannot administer card holders');
select throws_ok(format('select api.edit_card_statement_dates(%L,%L,1,''{}'')',:'space',:'no_debt_stmt'),'42501','Administrator permission required','Member cannot configure statement dates');
select throws_ok(format('select api.configure_card_opening(%L,%L,%L,''{}'')',:'space',:'no_debt',:'today'),'42501','Administrator permission required','Member cannot configure the initial card setup');
select lives_ok(format('select api.manage_card_authorization(%L,%L,null,null,''create'',%L)',:'space',:'empty',jsonb_build_object('on',:'today','amount_cents',500,'description','Compra por membro')),'Member may record a pending purchase authorization');
reset role;
update finance.financial_space_members set role='viewer' where financial_space_id=:'space' and user_id='aaaaaaaa-0000-4000-8000-000000000412';
set local role authenticated;
select throws_ok(format('select api.manage_card_authorization(%L,%L,null,null,''create'',%L)',:'space',:'empty',jsonb_build_object('on',:'today','amount_cents',500,'description','Não permitido')),'42501','No permission to write to financial space','Viewer cannot record authorization');
select lives_ok(format('select api.card_management_summary(%L)',:'space'),'Viewer may read card management history');
select throws_ok(format('update finance.credit_card_holders set name=''Invasão'' where id=%L',:'holder'),'42501',null,'Readonly RLS tables cannot bypass administrative RPCs');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000411","role":"authenticated"}',true);
select api.create_credit_card(:'space','Abertura protegida',100000,1,10,:'bank') as closed_opening \gset
select api.close_month(:'space','2000-01-01');
select throws_ok(format('select api.configure_card_opening(%L,%L,''2000-01-01'',''{}'',''88888888-aaaa-4888-8888-888888888411'')',:'space',:'closed_opening'),'23514','Card opening month is closed','Zero-debt setup still respects closed financial month');
set constraints all immediate;
select * from finish();
rollback;
