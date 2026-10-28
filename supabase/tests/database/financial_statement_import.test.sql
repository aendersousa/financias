begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
create function pg_temp.import_payload(p_name text,p_rows jsonb) returns jsonb language sql as $$
  select jsonb_build_object('format','csv','fileName',p_name||'.csv','fileSha256',encode(sha256(convert_to(p_name,'UTF8')),'hex'),'fileBytesBase64',encode(convert_to(p_name,'UTF8'),'base64'),'externalInstitution','TEST BANK','externalAccountIdentity','001-123456','periodStart','2000-10-01','periodEnd','2000-10-31','generatedOn','2000-10-31','rows',p_rows);
$$;
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000401','imports@test.local');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000401","role":"authenticated"}',true);
select api.create_personal_space('Import tests') as space \gset
select api.create_financial_account(:'space','Inter','checking',100000,'2000-01-01') as bank \gset
select ledger_account_id as bank_ledger from finance.financial_accounts where id=:'bank' \gset
select api.create_category(:'space','Cafe','expense') as category \gset
select ledger_account_id as category_ledger from finance.categories where id=:'category' \gset
select pg_temp.import_payload('cafes','[{"postedOn":"2000-10-05","amountCents":-850,"description":"CAFE"},{"postedOn":"2000-10-05","amountCents":-850,"description":"CAFE"}]') as payload \gset
select api.import_statement_read(:'space',:'bank',:'payload','aaaaaaaa-0000-4000-8000-000000000402') as first_batch \gset
select is((select count(*) from finance.ledger_transactions where financial_space_id=:'space'),1::bigint,'Reading a batch leaves every Ledger fact untouched');
select is((select lines_new from finance.import_batches where id=:'first_batch'),2,'CT-IMPORT-001 keeps both identical coffees');
select is((select identification_mode from finance.import_batches where id=:'first_batch'),'fingerprint','Missing FITIDs select one file-wide fingerprint mode');
select is((select array_agg(duplicate_ordinal order by line_number)::text from finance.import_candidates where import_batch_id=:'first_batch'),'{1,2}','Identical lines reserve multiplicity keys during reading');
select is((select external_account_last_digits from finance.financial_accounts where id=:'bank'),'3456','Only the final digits of the external account are stored');
select isnt((select external_account_fingerprint from finance.financial_accounts where id=:'bank'),'001-123456','External account identity is HMACed');
select is(api.import_original_file(:'space',:'first_batch')->>'fileBytesBase64',encode(convert_to('cafes','UTF8'),'base64'),'Original encrypted file is downloadable by a space member');
select is(api.import_statement_read(:'space',:'bank',:'payload','aaaaaaaa-0000-4000-8000-000000000402'),:'first_batch'::uuid,'Exact offline retry returns its original batch');
select throws_ok(format('select api.import_statement_read(%L,%L,%L::jsonb)',:'space',:'bank',:'payload'),'23505',null,'Same original bytes cannot produce a second active batch');
select throws_ok(format('select api.import_statement_read(%L,%L,%L::jsonb,%L)',:'space',:'bank',jsonb_set(:'payload'::jsonb,'{fileName}','"changed.csv"'),'aaaaaaaa-0000-4000-8000-000000000402'),'23505','Client UUID reused with different import','Retry UUID cannot name changed content');
select throws_ok(format('select api.import_statement_read(%L,%L,%L::jsonb)',:'space',:'bank',jsonb_set(pg_temp.import_payload('wronghash','[]'),'{fileSha256}',to_jsonb(repeat('0',64)))),'23514','Statement file hash does not match original bytes','Server verifies hash against actual bytes');
select throws_ok('select * from finance.import_files','42501','permission denied for table import_files','Encrypted original bytes are available only through the authorized RPC');
select throws_ok('select * from private.import_secrets','42501','permission denied for table import_secrets','Import encryption secrets are private');
select jsonb_agg(jsonb_build_object('candidateId',id,'action','create','counterpartAccountId',:'category_ledger') order by line_number) as decisions from finance.import_candidates where import_batch_id=:'first_batch' \gset
select api.confirm_import(:'space',:'first_batch',1,:'decisions');
select is((select balance_cents from finance.account_balances where id=:'bank_ledger'),98300::bigint,'Confirming both coffees produces two balanced expenses');
select is((select status from finance.import_batches where id=:'first_batch'),'completed','A batch completes only after review decisions are applied');
select is((select count(*) from finance.ledger_transactions where import_batch_id=:'first_batch' and source='import'),2::bigint,'Canonical postings persist import source and batch');
select is((select count(*) from finance.ledger_entries where import_candidate_id in(select id from finance.import_candidates where import_batch_id=:'first_batch') and reconciliation_status='reconciled' and reconciliation_source='import'),2::bigint,'Only the imported account entries start reconciled');
select id as first_candidate,created_transaction_id as first_tx from finance.import_candidates where import_batch_id=:'first_batch' and line_number=1 \gset
select throws_ok(format('select api.cancel_transaction(%L,%L,2,%L)',:'space',:'first_tx','Apagar cafe'),'23514','Undo reconciliation before cancelling transaction','An imported reconciliation cannot be bypassed by direct cancellation');
select api.unmatch_import(:'space',:'first_candidate',2);
select is((select status from finance.import_candidates where id=:'first_candidate'),'pending_review','Undoing reconciliation returns the same reserved candidate to review');
select api.cancel_transaction(:'space',:'first_tx',3,'Cancelar cafe conferido');
select pg_temp.import_payload('download2','[{"postedOn":"2000-10-05","amountCents":-850,"description":"CAFE PADARIA"},{"postedOn":"2000-10-05","amountCents":-850,"description":"CAFE"},{"postedOn":"2000-10-06","amountCents":-1000,"description":"LANCAMENTO NOVO"}]') as second_payload \gset
select api.import_statement_read(:'space',:'bank',:'second_payload') as second_batch \gset
select is((select lines_duplicate from finance.import_batches where id=:'second_batch'),2,'Changed descriptions and cancelled facts never evade deduplication');
select is((select lines_new from finance.import_batches where id=:'second_batch'),1,'A redownload adds only the additional stable-key line');
select version as first_version from finance.import_batches where id=:'first_batch' \gset
select api.undo_import(:'space',:'first_batch',:'first_version','Arquivo importado na conta incorreta');
select is((select balance_cents from finance.account_balances where id=:'bank_ledger'),100000::bigint,'Undo cancels the current contents of the remaining imported expense');
select is((select cancellation_kind from finance.ledger_transactions where import_batch_id=:'first_batch' and id<>:'first_tx'),'import_undone','Undo uses the canonical cancellation service with import origin');
select is((select count(*) from finance.import_candidates where import_batch_id=:'first_batch' and key_released_at is not null),2::bigint,'Undo releases both original reserved keys');
select is((select count(*) from finance.import_candidates where import_batch_id=:'second_batch' and key_reserved_at is not null),3::bigint,'Later duplicate rows inherit the released keys and await review');
select lives_ok(format('select api.import_statement_read(%L,%L,%L::jsonb)',:'space',:'bank',:'payload'),'Undo releases the file hash for a fresh reading');

-- Reliable identifiers, regenerated identifiers, mixed modes and ignored keys.
select api.create_financial_account(:'space','Beneficio','benefit',50000,'2000-01-01') as benefit \gset
select pg_temp.import_payload('fitid1','[{"postedOn":"2000-10-07","amountCents":-1234,"description":"LOJA","externalId":"bank-a"}]') as fitid_payload \gset
select api.import_statement_read(:'space',:'benefit',:'fitid_payload') as fitid_batch \gset
select is((select identification_mode from finance.import_batches where id=:'fitid_batch'),'fitid','Unique complete FITIDs reserve both FITID and fingerprint keys');
select jsonb_build_array(jsonb_build_object('candidateId',id,'action','ignore')) as ignore_decision from finance.import_candidates where import_batch_id=:'fitid_batch' \gset
select api.confirm_import(:'space',:'fitid_batch',1,:'ignore_decision');
select api.import_statement_read(:'space',:'benefit',pg_temp.import_payload('fitid2','[{"postedOn":"2000-10-07","amountCents":-1234,"description":"LOJA NOVA","externalId":"bank-b"}]')) as regenerated_batch \gset
select ok((select fitids_regenerated from finance.import_batches where id=:'regenerated_batch'),'Overlapping regenerated FITIDs are detected by stable fingerprint');
select ok((select fitids_unreliable from finance.financial_accounts where id=:'benefit'),'Regenerated FITIDs remain marked unreliable for later downloads');
select is((select status from finance.import_candidates where import_batch_id=:'regenerated_batch'),'duplicate','Ignored lines retain their key in redownloads');
select throws_ok(format('select api.import_statement_read(%L,%L,%L::jsonb)',:'space',:'benefit',jsonb_set(pg_temp.import_payload('other-account','[]'),'{externalAccountIdentity}','"999-888888"')),'23514','Este arquivo parece ser de outra conta','External account mismatch requires an explicit explanation');
select lives_ok(format('select api.import_statement_read(%L,%L,%L::jsonb)',:'space',:'benefit',pg_temp.import_payload('approved-other','[]')||'{"externalAccountIdentity":"999-888888","otherAccountReason":"Banco alterou o numero"}'),'Account identity can change with an audited reason');
select api.import_statement_read(:'space',:'bank',pg_temp.import_payload('nonposted','[{"status":"pending","postedOn":"2000-10-12","amountCents":-3000,"description":"PROCESSANDO"},{"status":"informational","description":"SALDO ANTERIOR","amountCents":0},{"status":"invalid","description":"ERRO","error":"Data ilegivel"},{"postedOn":"2000-11-01","amountCents":-4000,"description":"POSTERIOR AO ARQUIVO"}]')) as nonposted \gset
select is((select lines_pending from finance.import_batches where id=:'nonposted'),2,'Explicit pending and after-generation lines stay outside the Ledger');
select is((select count(*) from finance.import_candidates where import_batch_id=:'nonposted' and key_reserved_at is not null),0::bigint,'Pending, informational and invalid rows never reserve keys');
select api.create_financial_account(:'space','Modo do arquivo','checking',0,'2000-01-01') as mode_bank \gset
select api.import_statement_read(:'space',:'mode_bank',pg_temp.import_payload('future-no-fitid','[{"postedOn":"2000-10-07","amountCents":-100,"description":"POSTED","externalId":"reliable"},{"postedOn":"2000-11-01","amountCents":-200,"description":"PENDING NO ID"}]')) as future_mode_batch \gset
select is((select identification_mode from finance.import_batches where id=:'future_mode_batch'),'fitid','After-generation pending rows are excluded when selecting the file FITID mode');

-- CT-IMPORT-003: Agenda suggestion, bank amount, canonical settlement and undo.
select api.create_category(:'space','Energia','expense') as energy \gset
select ledger_account_id as energy_ledger from finance.categories where id=:'energy' \gset
select api.create_commitment(:'space',jsonb_build_object('kind','one_off','direction','outflow','certainty','estimated','title','Energia','category_id',:'energy','amount_cents',22000,'due_on','2000-10-13','payment_method','account','payment_financial_account_id',:'bank')) as commitment \gset
select api.import_statement_read(:'space',:'bank',pg_temp.import_payload('energy1','[{"postedOn":"2000-10-09","amountCents":-21783,"description":"DEB AUT ENERGIA"}]')) as energy_batch \gset
select id as energy_candidate from finance.import_candidates where import_batch_id=:'energy_batch' \gset
select ok(api.import_review(:'space',:'energy_batch')->'candidates'->0->'suggestions' @> jsonb_build_array(jsonb_build_object('kind','commitment','commitmentId',:'commitment'::uuid)),'Estimated Agenda item is suggested inside its asymmetric date window');
select is(api.import_review(:'space',:'energy_batch')->'candidates'->0->>'autoSelected','false','Agenda occurrences are never automatically matched');
select api.confirm_import(:'space',:'energy_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'energy_candidate','action','match_commitment','commitmentId',:'commitment','commitmentVersion',1)));
select is((select due_amount_cents from finance.commitments where id=:'commitment'),21783::bigint,'Actual bank amount replaces the estimated due through canonical settlement');
select is((select settlement_status from finance.commitment_settlements where id=:'commitment'),'settled','A 99-percent estimated settlement closes the occurrence');
select api.undo_import(:'space',:'energy_batch',2,'Desfazer teste energia estimada');
select is((select due_amount_cents from finance.commitments where id=:'commitment'),22000::bigint,'Undo restores the estimated commitment amount');
select is((select settlement_status from finance.commitment_settlements where id=:'commitment'),'pending','Undo cancels the imported settlement and reopens the Agenda occurrence');
select api.import_statement_read(:'space',:'bank',pg_temp.import_payload('energy-outside','[{"postedOn":"2000-10-19","amountCents":-21783,"description":"DEB AUT ENERGIA"}]')) as outside_batch \gset
select is(jsonb_array_length(api.import_review(:'space',:'outside_batch')->'candidates'->0->'suggestions'),0,'An estimated amount outside the asymmetric window is not proposed');
select api.settle_commitment(:'space',:'commitment',22000,'2000-10-08','automatic') as manual_energy \gset
select api.import_statement_read(:'space',:'bank',pg_temp.import_payload('energy-manual','[{"postedOn":"2000-10-09","amountCents":-21783,"description":"DEB AUT ENERGIA"}]')) as manual_batch \gset
select id as manual_candidate from finance.import_candidates where import_batch_id=:'manual_batch' \gset
select id as manual_entry from finance.ledger_entries where ledger_transaction_id=:'manual_energy' and ledger_account_id=:'bank_ledger' \gset
select api.confirm_import(:'space',:'manual_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'manual_candidate','action','match_transaction','entryId',:'manual_entry','transactionVersion',1)));
select is((select amount_cents from finance.ledger_entries where ledger_transaction_id=:'manual_energy' and ledger_account_id=:'bank_ledger'),-21783::bigint,'Existing estimated manual settlement is edited to the bank amount');
select is((select due_amount_cents from finance.commitments where id=:'commitment'),21783::bigint,'Matching an existing estimated settlement also updates its actual due amount');
select is((select count(*) from finance.ledger_transactions where import_batch_id=:'manual_batch'),0::bigint,'Matching a manual fact does not create a second transaction');
select api.annotate_transaction(:'space',:'manual_energy',3,'{"description":"Energia anotada depois"}');
select throws_ok(format('select api.undo_import(%L,%L,2,%L)',:'space',:'manual_batch','Desfazer conciliacao energia'),'40001',null,'Undo requests a choice if a preexisting transaction was edited afterwards');
select api.undo_import(:'space',:'manual_batch',2,'Restaurar energia manual',jsonb_build_object(:'manual_energy','restore'));
select is((select amount_cents from finance.ledger_entries where ledger_transaction_id=:'manual_energy' and ledger_account_id=:'bank_ledger'),-22000::bigint,'Restoring a matched manual transaction recovers its complete previous entries');
select is((select due_amount_cents from finance.commitments where id=:'commitment'),22000::bigint,'Undo of an edited manual settlement restores the original commitment due');

select jsonb_build_object('kind','expense','occurred_on','2000-10-23','competence_month','2000-10-01','description','Manual exact match','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-7000),jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',7000))) as exact_payload \gset
select api.post_transaction(:'space',:'exact_payload') as exact_tx \gset
select api.import_statement_read(:'space',:'bank',pg_temp.import_payload('ambiguous','[{"postedOn":"2000-10-23","amountCents":-7000,"description":"Manual exact match"},{"postedOn":"2000-10-23","amountCents":-7000,"description":"OTHER"}]')) as ambiguous_batch \gset
select is((api.import_review(:'space',:'ambiguous_batch')->'candidates'->0->>'autoSelected'),'false','A high match shared by another line is never preselected automatically');
select id as exact_candidate from finance.import_candidates where import_batch_id=:'ambiguous_batch' and line_number=1 \gset
select id as exact_entry from finance.ledger_entries where ledger_transaction_id=:'exact_tx' and ledger_account_id=:'bank_ledger' \gset
select api.confirm_import(:'space',:'ambiguous_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'exact_candidate','action','match_transaction','entryId',:'exact_entry','transactionVersion',1))) -> 'batch' ->> 'status';
select api.edit_transaction(:'space',:'exact_tx',2,replace(:'exact_payload','7000','7001')::jsonb||'{"acknowledge_reconciliation_change":true}','Alterar valor importado confirmado');
select is((select status from finance.import_candidates where id=:'exact_candidate'),'pending_review','Changing a reconciled amount returns its imported candidate to review');
select ok((select key_reserved_at is not null and key_released_at is null from finance.import_candidates where id=:'exact_candidate'),'Financial editing preserves the reserved deduplication key');
select is((select matched_entry_id from finance.import_candidates where id=:'exact_candidate'),null::uuid,'The stale replaced Ledger entry reference is cleared');
select version as ambiguous_version from finance.import_batches where id=:'ambiguous_batch' \gset
select api.undo_import(:'space',:'ambiguous_batch',:'ambiguous_version','Desfazer apenas conciliacao original');
select is((select amount_cents from finance.ledger_entries where ledger_transaction_id=:'exact_tx' and ledger_account_id=:'bank_ledger'),-7001::bigint,'Undo of an unchanged-value match preserves later manual financial edits');
select api.import_statement_read(:'space',:'bank',pg_temp.import_payload('closed-undo','[{"postedOn":"1999-02-05","amountCents":-777,"description":"PRE FECHAMENTO"}]')) as closed_undo_batch \gset
select jsonb_build_array(jsonb_build_object('candidateId',id,'action','create','counterpartAccountId',:'category_ledger')) as closed_undo_decision from finance.import_candidates where import_batch_id=:'closed_undo_batch' \gset
select api.confirm_import(:'space',:'closed_undo_batch',1,:'closed_undo_decision') -> 'batch' ->> 'status';
select api.close_month(:'space','1999-02-01');
select throws_ok(format('select api.undo_import(%L,%L,2,%L)',:'space',:'closed_undo_batch','Desfazer mes fechado'),'23514','Period is closed','A closed financial month rejects the complete undo operation');
select is((select count(*) from finance.ledger_entries where import_candidate_id in(select id from finance.import_candidates where import_batch_id=:'closed_undo_batch') and reconciliation_status='reconciled'),1::bigint,'Failed undo keeps its original reconciliation intact');
select is((select status from finance.import_batches where id=:'closed_undo_batch'),'completed','A failed undo keeps the batch and its keys active');
select api.import_statement_read(:'space',:'bank',pg_temp.import_payload('linked-refund','[{"postedOn":"2000-10-27","amountCents":-333,"description":"REFUNDABLE"}]')) as refund_batch \gset
select jsonb_build_array(jsonb_build_object('candidateId',id,'action','create','counterpartAccountId',:'category_ledger')) as refund_decision from finance.import_candidates where import_batch_id=:'refund_batch' \gset
select api.confirm_import(:'space',:'refund_batch',1,:'refund_decision') -> 'batch' ->> 'status';
select created_transaction_id as refunded_original from finance.import_candidates where import_batch_id=:'refund_batch' \gset
select api.refund_transaction(:'space',:'refunded_original',100,'2000-10-28',:'bank');
select throws_ok(format('select api.undo_import(%L,%L,2,%L)',:'space',:'refund_batch','Desfazer compra com estorno posterior'),'23514','Cannot undo import: later transactions are linked to imported transactions','A later linked refund prevents undoing its original import');
select is((select status from finance.ledger_transactions where id=:'refunded_original'),'posted','Blocked undo preserves the original fact used by a later refund');
select throws_ok(format('select api.import_statement_read(%L,%L,%L::jsonb)',:'space',:'bank',pg_temp.import_payload('emptybytes','[]')||jsonb_build_object('fileBytesBase64','','fileSha256',encode(sha256(''::bytea),'hex'))),'23514','Statement file must contain 1 byte to 10 MB','Empty original bytes cannot create an import attachment');
select api.import_statement_read(:'space',:'bank',pg_temp.import_payload('malformed','[{"postedOn":"2000-02-31","amountCents":-100,"description":"BAD DATE"},{"postedOn":"2000-10-01","amountCents":"12.3","description":"FLOAT"}]')) as malformed_batch \gset
select is((select lines_invalid from finance.import_batches where id=:'malformed_batch'),2,'Malformed normalized dates and decimal cents remain reviewable invalid rows');
select is((select count(*) from finance.import_candidates where import_batch_id=:'malformed_batch' and key_reserved_at is not null),0::bigint,'Malformed input never reserves a deduplication key');

-- Atomic decisions, closed months, retained origins and access boundaries.
select api.import_statement_read(:'space',:'bank',pg_temp.import_payload('atomic','[{"postedOn":"2000-10-21","amountCents":-111,"description":"A"},{"postedOn":"2000-10-22","amountCents":-222,"description":"B"}]')) as atomic_batch \gset
select jsonb_agg(jsonb_build_object('candidateId',id,'action','create','counterpartAccountId',case when line_number=1 then :'category_ledger'::uuid else gen_random_uuid() end) order by line_number) as atomic_decisions from finance.import_candidates where import_batch_id=:'atomic_batch' \gset
select throws_ok(format('select api.confirm_import(%L,%L,1,%L::jsonb)',:'space',:'atomic_batch',:'atomic_decisions'),'23514','Choose a category, person or bank counterpart','A failed decision rolls back the complete confirmation');
select is((select count(*) from finance.ledger_transactions where import_batch_id=:'atomic_batch'),0::bigint,'Atomic failure creates no partial Ledger effects');
select api.close_month(:'space','1999-01-01');
select api.import_statement_read(:'space',:'bank',pg_temp.import_payload('closed','[{"postedOn":"1999-01-15","amountCents":-100,"description":"FECHADO"}]')) as closed_batch \gset
select is((select status from finance.import_candidates where import_batch_id=:'closed_batch'),'blocked_closed_period','Closed-period lines are retained with reserved keys awaiting reopening');
select throws_ok(format('select api.import_review(%L,%L)',gen_random_uuid(),:'first_batch'),'42501','Space access denied','Read-only batch review rejects another space before reading data');
select throws_ok(format('select api.import_statement_read(%L,%L,%L::jsonb)',gen_random_uuid(),:'bank',pg_temp.import_payload('foreign','[]')),'42501','No permission to write to financial space','Foreign account requests cannot mutate a space');
select jsonb_build_object('kind','expense','occurred_on','2000-10-25','competence_month','2000-10-01','description','UUID collision','client_uuid','aaaaaaaa-0000-4000-8000-000000000402','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',:'bank_ledger','amount_cents',-100),jsonb_build_object('ledger_account_id',:'category_ledger','amount_cents',100))) as collision_payload \gset
select throws_ok(format('select api.post_transaction(%L,%L::jsonb)',:'space',:'collision_payload'),'23505','Client UUID reused with different operation','Import read UUID remains reserved against Ledger operations even after undo');
select ok(api.import_overview(:'space')->'accounts' @> jsonb_build_array(jsonb_build_object('id',:'bank'::uuid)),'Import overview exposes usable accounts with their saved profile');
select ok(api.import_overview(:'space')->'counterparts' @> jsonb_build_array(jsonb_build_object('id',:'category_ledger'::uuid)),'Review counterpart IDs refer to actual postable Ledger accounts');
select throws_ok(format('select api.import_overview(%L)',gen_random_uuid()),'42501','Space access denied','History listing checks membership before reading account metadata');
select api.create_financial_account(:'space','Conta originalmente prevista','checking',0,'2000-01-01') as predicted_bank \gset
select api.create_commitment(:'space',jsonb_build_object('kind','one_off','direction','outflow','certainty','estimated','title','Energia em outra conta','category_id',:'energy','amount_cents',11200,'due_on','2000-10-13','payment_method','account','payment_financial_account_id',:'predicted_bank')) as different_account_agenda \gset
select api.import_statement_read(:'space',:'bank',pg_temp.import_payload('different-account','[{"postedOn":"2000-10-09","amountCents":-11199,"description":"ENERGIA OUTRA CONTA"}]')) as different_account_batch \gset
select id as different_account_candidate from finance.import_candidates where import_batch_id=:'different_account_batch' \gset
select api.confirm_import(:'space',:'different_account_batch',1,jsonb_build_array(jsonb_build_object('candidateId',:'different_account_candidate','action','match_commitment','commitmentId',:'different_account_agenda','commitmentVersion',1))) -> 'batch' ->> 'status';
select is((select balance_cents from finance.account_balances where id=(select ledger_account_id from finance.financial_accounts where id=:'predicted_bank')),0::bigint,'An Agenda match uses the statement account without changing the originally planned bank');
select is((select sum(e.amount_cents) from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where t.import_batch_id=:'different_account_batch' and e.ledger_account_id=:'bank_ledger'),-11199::numeric,'The canonical settlement context posts the actual statement bank amount');
select api.undo_import(:'space',:'different_account_batch',2,'Desfazer quitação importada de outra conta');
select is((select due_amount_cents from finance.commitments where id=:'different_account_agenda'),11200::bigint,'Undo restores the original estimated due even when actual payment used another bank');
reset role;
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000405','import-member@test.local'),('aaaaaaaa-0000-4000-8000-000000000406','import-viewer@test.local');
insert into finance.financial_space_members(financial_space_id,user_id,role,status) values(:'space','aaaaaaaa-0000-4000-8000-000000000405','member','active'),(:'space','aaaaaaaa-0000-4000-8000-000000000406','viewer','active');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000405","role":"authenticated"}',true);
select throws_ok(format('select api.undo_import(%L,%L,2,%L)',:'space',:'refund_batch','Outro membro tentar desfazer lote'),'42501','Members may undo only their own imports','Members cannot undo another importer''s batch');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000406","role":"authenticated"}',true);
select ok(jsonb_array_length(api.import_overview(:'space')->'batches')>0,'Viewers may inspect the import history');
select throws_ok(format('select api.import_statement_read(%L,%L,%L::jsonb)',:'space',:'bank',pg_temp.import_payload('viewer-attempt','[]')),'42501','No permission to write to financial space','Viewers cannot reserve import keys or create attachments');
set constraints all immediate;
select * from finish();
rollback;
