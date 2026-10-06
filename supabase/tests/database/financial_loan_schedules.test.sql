begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select no_plan();
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000220','loans@test.local'),('aaaaaaaa-0000-4000-8000-000000000221','loan-viewer@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000220","role":"authenticated"}',true);
select api.create_personal_space('Cronogramas') as space \gset
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000221","role":"authenticated"}',true);
select api.create_personal_space('Outro espaço') as other_space \gset
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000220","role":"authenticated"}',true);
select api.create_financial_account(:'space','Banco','checking',10000000,'2000-01-01') as bank \gset
select api.create_category(:'space','Despesa comum','expense') as expense \gset
select ledger_account_id as expense_ledger from finance.categories where id = :'expense' \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id = :'bank' \gset
select api.create_loan(:'space','Carro','financing',4000000,'2000-01-01','Credor',null,'22222222-0000-4000-8000-000000000001') as loan \gset
select ledger_account_id as loan_ledger from finance.loans where id = :'loan' \gset
select is(api.create_loan(:'space','Carro','financing',4000000,'2000-01-01','Credor',null,'22222222-0000-4000-8000-000000000001'),:'loan'::uuid,'Loan creation retry returns the original loan');
select is((select count(*) from finance.loans where name = 'Carro'),1::bigint,'Creation retry does not create another liability');
select api.create_recurrence_rule(:'space',jsonb_build_object('title','Parcela manual','direction','outflow','unit','month','starts_on','2000-01-01','day_of_month',5,'amount_cents',115000,'counterpart_account_id',:'loan_ledger','payment_method','account','payment_financial_account_id',:'bank'))->>'id' as rule \gset
select api.create_commitment(:'space',jsonb_build_object('title','Anterior ao cronograma','direction','outflow','certainty','confirmed','amount_cents',1000,'due_on','2000-01-15','counterpart_account_id',:'loan_ledger','payment_method','account','payment_financial_account_id',:'bank')) as manual_commitment \gset
select jsonb_build_object('effective_on','2000-02-01','mode','detailed','payment_account_id',:'bank','source','creditor','monthly_interest_rate','1.3','amortization_system','price','rows',jsonb_build_array(jsonb_build_object('number',1,'due_on','2000-02-05','principal_cents',63000,'interest_cents',52000,'outstanding_after_cents',3937000),jsonb_build_object('number',2,'due_on','2000-03-05','principal_cents',3937000,'interest_cents',0,'outstanding_after_cents',0))) as schedule \gset
select api.configure_loan_schedule(:'space',:'loan',1,:'schedule','22222222-0000-4000-8000-000000000002') as version_id \gset
select is(api.configure_loan_schedule(:'space',:'loan',1,:'schedule','22222222-0000-4000-8000-000000000002'),:'version_id'::uuid,'Configuration replay precedes the now stale optimistic version');
select is((select count(*) from finance.loan_installments where loan_id = :'loan'),2::bigint,'One installment row per supplied creditor row');
select is((select count(*) from finance.operation_requests where operation = 'configure_loan_schedule'),1::bigint,'Configuration request is recorded once');
select is((select count(*) from finance.loan_installments i join finance.commitments c on c.id = i.commitment_id where i.loan_id = :'loan' and c.direction = 'outflow' and c.certainty = 'confirmed'),2::bigint,'Each installment has one confirmed outflow in Agenda');
select is((select ends_on from finance.recurrence_rules where id = :'rule'),'2000-01-31'::date,'Attaching schedule ends manual debt recurrence');
select throws_ok(format('select api.settle_commitment(%L,%L,1,%L)',:'space',:'manual_commitment','2000-02-01'),'23514','Use the dedicated loan installment operation','Older manual Agenda cannot bypass the newly attached schedule');
select throws_ok(format('select api.create_commitment(%L,%L::jsonb)',:'space',jsonb_build_object('title','Duplicada','direction','outflow','certainty','confirmed','amount_cents',1000,'due_on','2000-02-15','counterpart_account_id',:'loan_ledger','payment_method','account','payment_financial_account_id',:'bank')::text),'23514','Use the dedicated loan installment operation','New manual Agenda cannot duplicate a scheduled debt');
select throws_ok(format('select api.create_recurrence_rule(%L,%L::jsonb)',:'space',jsonb_build_object('title','Recorrência duplicada','direction','outflow','unit','month','starts_on','2000-02-01','day_of_month',5,'amount_cents',115000,'counterpart_account_id',:'loan_ledger','payment_method','account','payment_financial_account_id',:'bank')::text),'23514','Use the dedicated loan installment operation','New recurring Agenda cannot duplicate a scheduled debt');
select is((select -balance_cents from finance.account_balances where id = :'loan_ledger'),4000000::bigint,'Attaching schedule preserves initial liability');
select ledger_transaction_id as opening_transaction from finance.ledger_entries where ledger_account_id = :'loan_ledger' order by created_at limit 1 \gset
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'space',:'opening_transaction','Apagar dívida contratada'),'23514','Scheduled debt opening cannot be cancelled independently of its contract','Generic cancellation cannot remove a scheduled liability opening');
select throws_ok(format('select api.edit_transaction(%L,%L,1,%L::jsonb,%L)',:'space',:'opening_transaction',jsonb_build_object('kind','expense','occurred_on','2000-01-01','competence_month','2000-01-01','description','Remover passivo','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'expense_ledger','amount_cents',100),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-100)))::text,'Editar abertura'),'23514','Operation must be corrected through its dedicated service','Generic editing cannot replace loan opening by unrelated expense');
select is((select effective_due_on from finance.loan_installment_progress where loan_id = :'loan' and installment_number = 1),'2000-02-07'::date,'Nominal Saturday is moved to the next banking day');
select id as installment,commitment_id as commitment from finance.loan_installments where loan_id = :'loan' and installment_number = 1 \gset
select api.pay_loan_installment(:'space',:'installment','2000-02-07',null,null,'22222222-0000-4000-8000-000000000003') as payment \gset
select is((select -balance_cents from finance.account_balances where id = :'loan_ledger'),3937000::bigint,'CT-LOAN-001 detailed payment reduces debt by principal 63000');
select is((select sum(amount_cents)::bigint from finance.ledger_entries where ledger_transaction_id = :'payment' and loan_component = 'interest'),52000::bigint,'CT-LOAN-001 interest 52000 is separate from principal');
select is((select amount_cents from finance.ledger_entries where ledger_transaction_id = :'payment' and ledger_account_id = :'bank_ledger'),-115000::bigint,'Cash decreases by complete payment');
select is((select paid_cents from finance.commitment_settlements where id = :'commitment'),115000::bigint,'Principal and interest settle exactly one Agenda commitment');
select is((select principal_paid_cents from finance.loan_installment_progress where id = :'installment'),63000::bigint,'Principal progress is derived from posted components');
select is(api.pay_loan_installment(:'space',:'installment','2000-02-07',null,null,'22222222-0000-4000-8000-000000000003'),:'payment'::uuid,'Complete payment retry returns original transaction');
select throws_ok(format('select api.pay_loan_installment(%L,%L,%L,1,null,%L)',:'space',:'installment','2000-02-07','22222222-0000-4000-8000-000000000003'),'23505','Client UUID reused with different operation','Changed payment request fails UUID replay');
select api.cancel_transaction(:'space',:'payment',1,'Correção do pagamento');
select is((select remaining_cents from finance.loan_installment_progress where id = :'installment'),115000::bigint,'Cancelling payment reopens installment');
select is(api.pay_loan_installment(:'space',:'installment','2000-02-07',null,null,'22222222-0000-4000-8000-000000000003'),:'payment'::uuid,'Retry after cancellation preserves original result');
select api.settle_commitment(:'space',:'commitment',57500,'2000-02-07','partial',null,'22222222-0000-4000-8000-000000000004') as half_payment \gset
select is((select principal_paid_cents from finance.loan_installment_progress where id = :'installment'),31500::bigint,'Agenda partial payment delegates proportional principal');
select is((select interest_paid_cents from finance.loan_installment_progress where id = :'installment'),26000::bigint,'Partial interest is exact cents');
select api.pay_loan_installment(:'space',:'installment','2000-02-08') as rest_payment \gset
select is((select settlement_status from finance.loan_installment_progress where id = :'installment'),'settled','Second partial payment clears the remaining components');
select throws_ok(format('select api.cancel_commitment(%L,%L,1,%L)',:'space',:'commitment','Apagar parcela'),'23514','Replace the creditor schedule instead of cancelling its installment','Generic cancellation cannot detach installment Agenda');
select throws_ok(format('select api.loan_movement(%L,%L,%L,%L,%L,1,0)',:'space',:'loan',:'bank','2000-02-09','pay'),'23514','Use installment payment or extraordinary amortization for a scheduled loan','Generic principal payment cannot bypass installment schedule');
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space',jsonb_build_object('kind','expense','occurred_on','2000-02-09','competence_month','2000-02-01','description','Bypass','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'expense_ledger','amount_cents',1,'commitment_id',:'commitment'),jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-1)))::text),'23514','Use the dedicated loan installment operation','Expense-only generic posting cannot falsely settle a loan');
select jsonb_build_object('effective_on','2000-02-10','mode','detailed','payment_account_id',:'bank','source','creditor','rows',jsonb_build_array(jsonb_build_object('number',1,'due_on','2000-03-07','principal_cents',3000000,'interest_cents',12000,'outstanding_after_cents',937000),jsonb_build_object('number',2,'due_on','2000-04-07','principal_cents',937000,'interest_cents',1000,'outstanding_after_cents',0))) as corrected \gset
select api.configure_loan_schedule(:'space',:'loan',2,:'corrected') as corrected_version \gset
select is((select superseded_at from finance.loan_installments where id = :'installment'),null::timestamptz,'Creditor correction preserves paid installment');
select is((select count(*) from finance.loan_installments where loan_id = :'loan' and superseded_at is not null),1::bigint,'Only unpaid future row is superseded');
select is((select count(*) from finance.loan_schedule_versions where loan_id = :'loan'),2::bigint,'Creditor schedule history is retained');
select jsonb_build_object('effective_on','2000-02-11','mode','detailed','payment_account_id',:'bank','rows',jsonb_build_array(jsonb_build_object('number',1,'due_on','2000-03-07','principal_cents',2937000,'interest_cents',10000,'outstanding_after_cents',0))) as prepaid_schedule \gset
select api.prepay_loan(:'space',:'loan',3,:'bank','2000-02-11',1000000,:'prepaid_schedule','22222222-0000-4000-8000-000000000005') as prepayment \gset
select is((select -balance_cents from finance.account_balances where id = :'loan_ledger'),2937000::bigint,'Extraordinary amortization decreases principal');
select is((select count(*) from finance.ledger_entries where ledger_transaction_id = :'prepayment'),2::bigint,'Extraordinary amortization has only debt and bank, without interest');
select is(api.prepay_loan(:'space',:'loan',3,:'bank','2000-02-11',1000000,:'prepaid_schedule','22222222-0000-4000-8000-000000000005'),:'prepayment'::uuid,'Prepayment plus new schedule replays atomically');
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'space',:'prepayment','Desfazer'),'23514','Extraordinary amortization and its replacement schedule must be corrected together','Cannot cancel principal while retaining incompatible replacement schedule');
select throws_ok(format('select api.configure_loan_schedule(%L,%L,4,%L,%L)',:'space',:'loan',:'prepaid_schedule','22222222-0000-4000-8000-000000000005'),'23505','Client UUID reused with different operation','Configuration and prepayment share UUID namespace');
select api.create_loan(:'space','Simplificado','financing',4000000,'2000-01-01') as simple \gset
select ledger_account_id as simple_ledger from finance.loans where id = :'simple' \gset
select api.configure_loan_schedule(:'space',:'simple',1,jsonb_set(:'schedule'::jsonb,'{mode}','"simplified"')) as simple_version \gset
select id as simple_installment from finance.loan_installments where loan_id = :'simple' and installment_number = 1 \gset
select api.pay_loan_installment(:'space',:'simple_installment','2000-02-07') as simple_payment \gset
select is((select -balance_cents from finance.account_balances where id = :'simple_ledger'),3885000::bigint,'CT-LOAN-001 simplified payment credits full installment to liability');
select api.adjust_loan_balance(:'space',:'simple','2000-02-07',3937000,:'simple_installment','22222222-0000-4000-8000-000000000006') as adjustment \gset
select is((select -balance_cents from finance.account_balances where id = :'simple_ledger'),3937000::bigint,'CT-LOAN-001 creditor debt correction restores reported 3937000');
select is((select sum(e.amount_cents)::bigint from finance.ledger_entries e join finance.categories c on c.ledger_account_id = e.ledger_account_id where e.ledger_transaction_id = :'adjustment' and c.system_role = 'financial_charges'),52000::bigint,'CT-LOAN-001 difference is financial charges, without principal expense');
select is((select reported_outstanding_cents from finance.loan_installments where id = :'simple_installment'),3937000::bigint,'Reported debt is retained on simplified installment');
select is(api.adjust_loan_balance(:'space',:'simple','2000-02-07',3937000,:'simple_installment','22222222-0000-4000-8000-000000000006'),:'adjustment'::uuid,'Debt adjustment replay does not revalue twice');
select api.adjust_loan_balance(:'space',:'simple','2000-02-07',3937000,null,'22222222-0000-4000-8000-000000000007') as unchanged \gset
select is(:'unchanged'::uuid,:'simple'::uuid,'Zero debt difference has no ledger transaction');
select throws_ok(format('select api.create_loan(%L,%L,%L,0,null,null,null,%L)',:'space','Outra dívida','loan','22222222-0000-4000-8000-000000000007'),'23505','Client UUID reused with different operation','Zero difference reserves UUID across loan creation');
select throws_ok(format('select api.configure_loan_schedule(%L,%L,4,%L)',:'space','ffffffff-0000-4000-8000-000000000220',:'prepaid_schedule'),'23514','Loan not available','Loan schedule requires a loan in the selected financial space');
select throws_ok(format('select api.configure_loan_schedule(%L,%L,3,%L)',:'space',:'loan',:'prepaid_schedule'),'40001','Loan changed; reload before editing','A new correction rejects stale loan version');
select throws_ok(format('select api.prepay_loan(%L,%L,4,%L,%L,1,%L)',:'space',:'loan',:'bank','2000-02-11',:'prepaid_schedule'),'23514','Invalid loan schedule row','Invalid replacement schedule rolls back prepayment');
select is((select -balance_cents from finance.account_balances where id = :'loan_ledger'),2937000::bigint,'Failed prepayment leaves original debt unchanged');
select is((select count(*) from finance.loan_schedule_versions where loan_id = :'loan'),3::bigint,'Failed prepayment leaves schedule history unchanged');
select throws_ok(format('select api.archive_loan(%L,%L,4)',:'space',:'loan'),'23514','Loan still has debt or open installments','Debt cannot be archived with an open installment');
select id as final_installment from finance.loan_installments where loan_id = :'loan' and superseded_at is null and installment_number > 1 \gset
select api.pay_loan_installment(:'space',:'final_installment','2000-03-07') as final_payment \gset
set constraints all immediate;
select is((select status from finance.loans where id = :'loan'),'settled','Debt zero and no open installment derive settled loan status');
select is(api.loan_summary(:'space',:'loan')->'loans'->0->>'effective_status','settled','Read model derives settled status');
set constraints all deferred;
select api.cancel_transaction(:'space',:'final_payment',1,'Pagamento devolvido');
set constraints all immediate;
select is((select status from finance.loans where id = :'loan'),'active','Payment cancellation reopens loan status');
set constraints all deferred;
select api.pay_loan_installment(:'space',:'final_installment','2000-03-07') as replacement_payment \gset
set constraints all immediate;
set constraints all deferred;
select version as loan_version from finance.loans where id = :'loan' \gset
select api.archive_loan(:'space',:'loan',:'loan_version');
select is((select allows_posting from finance.ledger_accounts where id = :'loan_ledger'),false,'Settled loan ledger can be archived');
select throws_ok(format('select api.cancel_transaction(%L,%L,1,%L)',:'space',:'replacement_payment','Cancelar após arquivo'),'23514','Archived loan history cannot be cancelled','Archived loan cannot be silently reopened by generic cancellation');
select api.close_month(:'space','2000-01-01',true);
select api.close_month(:'space','2000-02-01',true);
select is(api.adjust_loan_balance(:'space',:'simple','2000-02-07',3937000,:'simple_installment','22222222-0000-4000-8000-000000000006'),:'adjustment'::uuid,'Debt correction replay works after month closing');
select throws_ok(format('select api.adjust_loan_balance(%L,%L,%L,3937001)',:'space',:'simple','2000-02-07'),'23514','Period is closed','New debt correction cannot change a closed month');
select is(api.configure_loan_schedule(:'space',:'loan',1,:'schedule','22222222-0000-4000-8000-000000000002'),:'version_id'::uuid,'Schedule replay works after closure and loan archival');
select throws_ok(format('select api.configure_loan_schedule(%L,%L,2,%L)',:'space',:'simple',:'schedule'),'23514','Period is closed','New schedule cannot replace commitments in a closed month');
select throws_ok(format('select api.loan_summary(%L)',:'other_space'),'42501','Financial space not available','Loan read model rejects another owner space');
create function pg_temp.overpay_with_future(p_space uuid,p_bank uuid) returns void language plpgsql set search_path = '' as $$
declare loan uuid; begin
  loan := api.create_loan(p_space,'Cronologia','loan',100,'2001-01-01');
  perform api.loan_movement(p_space,loan,p_bank,'2001-03-01','pay',60);
  perform api.loan_movement(p_space,loan,p_bank,'2001-02-01','pay',60);
  set constraints all immediate;
end;
$$;
select throws_ok(format('select pg_temp.overpay_with_future(%L,%L)',:'space',:'bank'),'23514','Loan debt cannot be negative or exceed safe cents','Future-dated principal payment cannot be ignored to overpay later');
create function pg_temp.fee_only_status(p_space uuid,p_bank uuid) returns text language plpgsql set search_path = '' as $$
declare loan uuid; installment uuid; result text; begin
  loan := api.create_loan(p_space,'Encargos finais','loan',100,'2001-01-01');
  perform api.configure_loan_schedule(p_space,loan,1,jsonb_build_object('effective_on','2001-02-01','mode','detailed','payment_account_id',p_bank,'rows',jsonb_build_array(jsonb_build_object('number',1,'due_on','2001-02-05','principal_cents',100,'interest_cents',1,'outstanding_after_cents',0),jsonb_build_object('number',2,'due_on','2001-03-05','principal_cents',0,'interest_cents',1,'outstanding_after_cents',0))));
  select id into installment from finance.loan_installments where loan_id = loan and installment_number = 1;
  perform api.pay_loan_installment(p_space,installment,'2001-02-05');
  select id into installment from finance.loan_installments where loan_id = loan and installment_number = 2;
  perform api.pay_loan_installment(p_space,installment,'2001-03-05');
  set constraints all immediate;
  select status into result from finance.loans where id = loan;
  set constraints all deferred;
  return result;
end;
$$;
select is(pg_temp.fee_only_status(:'space',:'bank'),'settled','Final interest-only installment also updates settled status');
reset role;
insert into finance.financial_space_members(financial_space_id,user_id,role) values(:'space','aaaaaaaa-0000-4000-8000-000000000221','viewer');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000221","role":"authenticated"}',true);
select is(jsonb_array_length(api.loan_summary(:'space')->'loans'),3,'Viewer can read debt and schedule progress');
select throws_ok(format('select api.pay_loan_installment(%L,%L,%L)',:'space',:'installment','2000-02-09'),'42501','No permission to write to financial space','Viewer cannot pay a loan installment');
select throws_ok(format('update finance.loan_installments set principal_cents=1 where id=%L',:'installment'),'42501',null,'Authenticated clients cannot mutate contractual rows directly');
set constraints all immediate;
select * from finish();
rollback;
