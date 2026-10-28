begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.card_import_payload(p_name text,p_rows jsonb,p_reference date default null) returns jsonb language sql as $$
 select jsonb_build_object('format','ofx','accountType','card','fileName',p_name||'.ofx','fileSha256',encode(sha256(convert_to(p_name,'UTF8')),'hex'),'fileBytesBase64',encode(convert_to(p_name,'UTF8'),'base64'),'externalInstitution','CARD BANK','externalAccountIdentity','1111-2222-3333-4444','generatedOn','2026-10-31','periodStart','2026-10-01','periodEnd','2026-10-31','referenceMonth',p_reference,'rows',p_rows);
$$;
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000441','card-import@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000441","role":"authenticated"}',true);
select api.create_personal_space('Card imports') as space \gset
select api.create_credit_card(:'space','Cartao A',500000,1,10) as card \gset
select ledger_account_id as card_ledger from finance.credit_cards where id=:'card' \gset
select api.create_category(:'space','Hospedagem','expense') as hotel_category \gset
select ledger_account_id as hotel_ledger from finance.categories where id=:'hotel_category' \gset
select api.import_statement_read(:'space',:'card',pg_temp.card_import_payload('hotel-pending','[{"postedOn":"2026-10-05","amountCents":-50000,"description":"HOTEL MAR AZUL","status":"pending"}]','2026-11-01')) as pending_batch \gset
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space'),0::bigint,'CT-IMPORT-002 pending hotel changes no Ledger balance');
select is((select used_cents from finance.card_limits where id=:'card'),50000::bigint,'Pending imported hotel uses the card limit exactly once');
select is((select free_cents from finance.card_limits where id=:'card'),450000::bigint,'Pending hotel leaves 4500 available');
select api.import_statement_read(:'space',:'card',pg_temp.card_import_payload('hotel-pending-redownload','[{"postedOn":"2026-10-05","amountCents":-50000,"description":"HOTEL MAR AZUL LTDA","status":"pending"}]','2026-11-01')) as pending_redownload \gset
select is((select count(*) from finance.card_authorizations where credit_card_id=:'card' and status='pending'),1::bigint,'A repeated pending row updates its prior authorization');
select api.import_statement_read(:'space',:'card',pg_temp.card_import_payload('hotel-posted','[{"postedOn":"2026-10-06","amountCents":-43780,"description":"HOTEL MAR AZUL LTDA","externalId":"hotel-final"}]','2026-11-01')) as posted_batch \gset
select is((select used_cents from finance.card_limits where id=:'card'),0::bigint,'Reading the posted extract releases the absent pending authorization before confirmation');
select id as posted_candidate from finance.import_candidates where import_batch_id=:'posted_batch' \gset
select api.confirm_import(:'space',:'posted_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'posted_candidate','action','create','counterpartAccountId',:'hotel_ledger'))) -> 'batch' ->> 'status';
select is((select amount_cents from finance.ledger_entries where import_candidate_id=:'posted_candidate'),-43780::bigint,'Posted hotel uses the actual bank amount');
select is((select balance_cents from finance.account_balances where id=:'hotel_ledger'),43780::bigint,'Actual purchase records exactly its expense consumption');
select is((select used_cents from finance.card_limits where id=:'card'),43780::bigint,'CT-IMPORT-002 never double-counts posted hotel plus pending authorization');
select api.undo_import(:'space',:'posted_batch',2,'Desfazer hotel para conferir');
select is((select used_cents from finance.card_limits where id=:'card'),50000::bigint,'Undo cancels the actual purchase and reopens its prior hotel authorization');

select api.create_category(:'space','Eletronicos','expense') as electronic_category \gset
select api.record_card_purchase(:'space',:'card',:'electronic_category',120000,12,'2026-10-05','TV') as tv \gset
select api.import_statement_read(:'space',:'card',pg_temp.card_import_payload('tv-parcel3','[{"postedOn":"2026-10-05","amountCents":-10000,"description":"LOJA TV PARC 03/12","installmentNumber":3,"installmentCount":12,"externalId":"tv3"}]','2027-01-01')) as parcel_batch \gset
select id as parcel_candidate from finance.import_candidates where import_batch_id=:'parcel_batch' \gset
select api.import_review(:'space',:'parcel_batch')->'candidates'->0->'suggestions' as parcel_suggestions \gset
select ok(:'parcel_suggestions'::jsonb @> jsonb_build_array(jsonb_build_object('kind','installment','confidence','high')),'CT-IMPORT-004 future installment is suggested with its exact marker and statement');
select (:'parcel_suggestions'::jsonb->0->>'entryId') as installment_entry \gset
select api.confirm_import(:'space',:'parcel_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'parcel_candidate','action','match_installment','entryId',:'installment_entry','transactionVersion',1))) -> 'batch' ->> 'status';
select is((select count(*) from finance.ledger_transactions where import_batch_id=:'parcel_batch'),0::bigint,'Matching a programmed installment creates no new debt or consumption');
select is((select reconciliation_status from finance.ledger_entries where id=:'installment_entry'),'reconciled','Only the matching card installment is reconciled');
select api.import_statement_read(:'space',:'card',pg_temp.card_import_payload('tv-parcel4','[{"postedOn":"2026-10-05","amountCents":-10000,"description":"LOJA TV PARC 04/12","installmentNumber":4,"installmentCount":12,"externalId":"tv4"}]','2027-02-01')) as parcel4_batch \gset
select is((select lines_new from finance.import_batches where id=:'parcel4_batch'),1,'Next installment uses a distinct statement-and-marker fingerprint');
select api.undo_import(:'space',:'parcel_batch',2,'Desfazer apenas a conciliacao da parcela');
select is((select reconciliation_status from finance.ledger_entries where id=:'installment_entry'),'unreconciled','Undo installment reconciliation preserves the original programmed purchase');

select api.create_credit_card(:'space','Cartao antigo',500000,1,10) as old_card \gset
reset role;
update finance.credit_cards set started_on='2026-10-06' where id=:'old_card';
set local role authenticated;
select api.import_statement_read(:'space',:'old_card',pg_temp.card_import_payload('old-sofa','[{"postedOn":"2026-07-05","amountCents":-25000,"description":"SOFA PARC 03/12","installmentNumber":3,"installmentCount":12}]','2026-11-01')) as sofa_batch \gset
select id as sofa_candidate from finance.import_candidates where import_batch_id=:'sofa_batch' \gset
select api.confirm_import(:'space',:'sofa_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'sofa_candidate','action','opening_installments'))) -> 'batch' ->> 'status';
select is((select count(*) from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where t.import_batch_id=:'sofa_batch' and e.installment_number is not null),10::bigint,'CT-IMPORT-004 old installment opening registers only installments three through twelve');
select is((select sum(e.amount_cents) from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id join finance.ledger_accounts a on a.id=e.ledger_account_id where t.import_batch_id=:'sofa_batch' and a.system_role='opening'),250000::numeric,'Old sofa is balanced against opening equity without expense consumption');
select is((select count(*) from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id join finance.ledger_accounts a on a.id=e.ledger_account_id where t.import_batch_id=:'sofa_batch' and a.account_class='expense'),0::bigint,'Registering old installments does not create current consumption');
select api.create_credit_card(:'space','Abertura agregada',500000,1,10) as covered_card \gset
reset role;
update finance.credit_cards set started_on='2026-10-06' where id=:'covered_card';
set local role authenticated;
select api.open_card_balance(:'space',:'covered_card','2026-11-01',50000,'2026-10-06');
select api.import_statement_read(:'space',:'covered_card',pg_temp.card_import_payload('covered','[{"postedOn":"2026-07-05","amountCents":-25000,"description":"SOFA ANTIGO"},{"postedOn":"2026-08-05","amountCents":-25000,"description":"MESA ANTIGA"}]','2026-11-01')) as covered_batch \gset
select jsonb_agg(jsonb_build_object('candidateId',id,'action','opening_coverage')) as coverage_decisions from finance.import_candidates where import_batch_id=:'covered_batch' \gset
select api.confirm_import(:'space',:'covered_batch',1,:'coverage_decisions') -> 'batch' ->> 'status';
select is((select count(*) from finance.ledger_transactions where import_batch_id=:'covered_batch'),0::bigint,'Several pre-start lines covered by one aggregate opening never produce purchases');
select is(api.import_review(:'space',:'covered_batch')->'openingCoverage'->>'differenceCents','0','Aggregate opening discrepancy is calculated from imported lines');
select api.import_statement_read(:'space',:'card',pg_temp.card_import_payload('tv-cent','[{"postedOn":"2026-10-05","amountCents":-9999,"description":"LOJA TV PARC 03/12","installmentNumber":3,"installmentCount":12}]','2027-01-01')) as cent_batch \gset
select id as cent_candidate from finance.import_candidates where import_batch_id=:'cent_batch' \gset
select id as cent_entry from finance.ledger_entries where ledger_transaction_id=:'tv' and installment_number=3 \gset
select version as tv_version from finance.ledger_transactions where id=:'tv' \gset
select api.confirm_import(:'space',:'cent_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'cent_candidate','action','match_installment','entryId',:'cent_entry','transactionVersion',:'tv_version'::integer))) -> 'batch' ->> 'status';
select is((select sum(amount_cents) from finance.ledger_entries where ledger_transaction_id=:'tv' and installment_number is not null),-120000::numeric,'Moving the remaining cent among open installments preserves the whole purchase total');
select is((select amount_cents from finance.ledger_entries where ledger_transaction_id=:'tv' and installment_number=3),-9999::bigint,'The reconciled installment receives the imported one-cent position');
select api.undo_import(:'space',:'cent_batch',2,'Restaurar a posição anterior do centavo');
select is((select amount_cents from finance.ledger_entries where ledger_transaction_id=:'tv' and installment_number=3),-10000::bigint,'Undo restores the complete installment distribution');
select api.create_credit_card(:'space','Fatura fechada',100000,1,10) as closed_card \gset
select api.import_statement_read(:'space',:'closed_card',pg_temp.card_import_payload('closed-purchase','[{"postedOn":"2026-08-05","amountCents":-12345,"description":"COMPRA ANTIGA LANCADA","externalId":"closed-p1"}]','2026-09-01')) as closed_batch \gset
select id as closed_candidate from finance.import_candidates where import_batch_id=:'closed_batch' \gset
select api.confirm_import(:'space',:'closed_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'closed_candidate','action','create','counterpartAccountId',:'hotel_ledger'))) -> 'batch' ->> 'status';
select is((select status from finance.card_statements where id=(select card_statement_id from finance.import_candidates where id=:'closed_candidate')),'closed','The imported new fact may belong to an already closed statement');
select api.undo_import(:'space',:'closed_batch',2,'Desfazer lote com compra retida');
select is((select status from finance.ledger_transactions where id=(select created_transaction_id from finance.import_candidates where id=:'closed_candidate')),'posted','Undo retains a purchase with closed statement entries');
select is((select status from finance.import_batches where id=:'closed_batch'),'undone','A retained transaction does not prevent the batch from reaching undone');
select ok((select key_reserved_at is not null and key_released_at is null from finance.import_candidates where id=:'closed_candidate'),'The retained purchase keeps its deduplication keys reserved');
select is(jsonb_array_length(api.import_review(:'space',:'closed_batch')->'retainedTransactions'),1,'Review lists the retained purchase requiring manual correction');
select api.import_statement_read(:'space',:'closed_card',pg_temp.card_import_payload('closed-redownload','[{"postedOn":"2026-08-05","amountCents":-12345,"description":"COMPRA ANTIGA OUTRO TEXTO","externalId":"closed-p1"}]','2026-09-01')) as retained_redownload \gset
select is((select lines_duplicate from finance.import_batches where id=:'retained_redownload'),1,'Reimport does not duplicate a retained purchase after the batch was undone');
select api.import_statement_read(:'space',:'covered_card',pg_temp.card_import_payload('covered-sofa-installments','[{"postedOn":"2026-07-05","amountCents":-25000,"description":"SOFA PARC 03/12","installmentNumber":3,"installmentCount":12}]','2026-11-01')) as covered_sofa_batch \gset
select id as covered_sofa_candidate from finance.import_candidates where import_batch_id=:'covered_sofa_batch' \gset
select api.confirm_import(:'space',:'covered_sofa_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'covered_sofa_candidate','action','opening_installments'))) -> 'batch' ->> 'status';
select is((select count(*) from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where t.import_batch_id=:'covered_sofa_batch' and e.installment_number is not null),9::bigint,'An aggregate-covered old installment generates only installments four through twelve');
select is((select min(e.installment_number) from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where t.import_batch_id=:'covered_sofa_batch' and e.installment_number is not null),4::smallint,'The installment already covered by opening is not recreated');
select ok(api.import_overview(:'space')->'accounts' @> jsonb_build_array(jsonb_build_object('id',:'card'::uuid,'accountType','card')),'Import overview exposes active card targets and their statement choices');
select api.create_financial_account(:'space','Banco pagamento','checking',100000,'2000-01-01') as payment_bank \gset
select ledger_account_id as payment_ledger from finance.financial_accounts where id=:'payment_bank' \gset
select api.import_statement_read(:'space',:'card',pg_temp.card_import_payload('payment','[{"postedOn":"2026-10-06","amountCents":10000,"description":"PAGAMENTO FATURA"}]','2026-11-01')) as payment_batch \gset
select id as payment_candidate from finance.import_candidates where import_batch_id=:'payment_batch' \gset
select api.confirm_import(:'space',:'payment_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'payment_candidate','action','card_payment','originAccountId',:'payment_ledger'))) -> 'batch' ->> 'status';
select is((select balance_cents from finance.account_balances where id=:'payment_ledger'),90000::bigint,'Imported card payment uses the canonical allocation and chosen bank');
select is((select reconciliation_status from finance.ledger_entries where ledger_transaction_id=(select created_transaction_id from finance.import_candidates where id=:'payment_candidate') and ledger_account_id=:'payment_ledger'),'unreconciled','Importing a card payment reconciles only the card side, leaving its bank for the bank statement');
select api.undo_import(:'space',:'payment_batch',2,'Cancelar pagamento importado');
select is((select balance_cents from finance.account_balances where id=:'payment_ledger'),100000::bigint,'Undo payment restores cash via the canonical cancellation service');
select api.import_statement_read(:'space',:'card',pg_temp.card_import_payload('refund','[{"postedOn":"2026-10-06","amountCents":30000,"description":"ESTORNO TV"}]','2026-11-01')) as refund_batch \gset
select id as refund_candidate from finance.import_candidates where import_batch_id=:'refund_batch' \gset
select api.confirm_import(:'space',:'refund_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'refund_candidate','action','card_refund','originalTransactionId',:'tv'))) -> 'batch' ->> 'status';
select is((select kind from finance.ledger_transactions where id=(select created_transaction_id from finance.import_candidates where id=:'refund_candidate')),'refund','Imported positive refund uses the dedicated original-purchase service');
select is((select related_transaction_id from finance.ledger_transactions where id=(select created_transaction_id from finance.import_candidates where id=:'refund_candidate')),:'tv'::uuid,'Imported refund retains its actual original purchase relation');
select api.undo_import(:'space',:'refund_batch',2,'Cancelar estorno importado');
select api.create_credit_card(:'space','Compra descoberta depois',500000,1,10) as discovered_card \gset
reset role;
update finance.credit_cards set started_on='2026-10-01' where id=:'discovered_card';
set local role authenticated;
select api.import_statement_read(:'space',:'discovered_card',pg_temp.card_import_payload('new-discovered-parc3','[{"postedOn":"2026-10-06","amountCents":-10000,"description":"NOVA TV PARC 03/12","installmentNumber":3,"installmentCount":12}]','2027-01-01')) as discovered_batch \gset
select id as discovered_candidate from finance.import_candidates where import_batch_id=:'discovered_batch' \gset
select api.confirm_import(:'space',:'discovered_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'discovered_candidate','action','create','counterpartAccountId',:'hotel_ledger','purchaseOn','2026-10-06','totalCents',120000))) -> 'batch' ->> 'status';
select is((select count(*) from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where t.import_batch_id=:'discovered_batch' and installment_number is not null),12::bigint,'A newly discovered installment purchase uses all original purchase installments');
select is((select s.reference_month from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id join finance.card_statements s on s.id=e.card_statement_id where t.import_batch_id=:'discovered_batch' and installment_number=1),'2026-11-01'::date,'The invoice of imported installment three anchors the earlier installment months');
select is((select amount_cents from finance.ledger_entries where import_candidate_id=:'discovered_candidate'),-10000::bigint,'The imported installment is reconciled to its own marker within the complete purchase');
select api.import_statement_read(:'space',:'old_card',pg_temp.card_import_payload('fallback-ongoing','[{"postedOn":"2026-10-31","amountCents":-26000,"description":"OUTRO PARC 03/12","installmentNumber":3,"installmentCount":12}]','2026-11-01')) as fallback_batch \gset
select id as fallback_candidate from finance.import_candidates where import_batch_id=:'fallback_batch' \gset
select api.confirm_import(:'space',:'fallback_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'fallback_candidate','action','opening_installments'))) -> 'batch' ->> 'status';
select is((select kind from finance.ledger_transactions where id=(select created_transaction_id from finance.import_candidates where id=:'fallback_candidate')),'opening','Without an original date, a pre-start installment uses statement closing minus k-minus-one months');
set constraints all immediate;
select * from finish();
rollback;
