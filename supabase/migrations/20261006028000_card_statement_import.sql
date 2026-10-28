begin;
alter table finance.credit_cards add column external_institution text,add column external_account_fingerprint text,add column external_account_last_digits text,add column import_profile jsonb,add column fitids_unreliable boolean not null default false;
alter table finance.import_batches alter column financial_account_id drop not null,add column credit_card_id uuid,add column card_statement_id uuid,add column retained_transactions jsonb not null default '[]',
  add constraint import_one_target check(num_nonnulls(financial_account_id,credit_card_id)=1),
  add constraint import_card_same_space foreign key(financial_space_id,credit_card_id) references finance.credit_cards(financial_space_id,id),add constraint import_statement_same_space foreign key(financial_space_id,card_statement_id) references finance.card_statements(financial_space_id,id);
alter table finance.import_candidates add column card_statement_id uuid,add column fingerprint_statement_id uuid,add column installment_number smallint,add column installment_count smallint,add column original_purchase_on date,
  add column card_authorization_id uuid,add column opening_coverage boolean not null default false,
  add constraint import_row_card_statement foreign key(financial_space_id,card_statement_id) references finance.card_statements(financial_space_id,id),add constraint import_row_original_statement foreign key(financial_space_id,fingerprint_statement_id) references finance.card_statements(financial_space_id,id),
  add constraint import_row_authorization foreign key(financial_space_id,card_authorization_id) references finance.card_authorizations(financial_space_id,id),add constraint import_row_installment check(num_nulls(installment_number,installment_count) in(0,2) and (installment_number is null or installment_number between 1 and installment_count and installment_count between 2 and 600));
alter table private.import_context alter column account_id drop not null,add column candidate_id uuid;
create table finance.import_authorization_effects(
  financial_space_id uuid not null,import_batch_id uuid not null,authorization_id uuid not null,before_data jsonb,after_data jsonb not null,created_here boolean not null default false,
  primary key(import_batch_id,authorization_id),foreign key(financial_space_id,import_batch_id) references finance.import_batches(financial_space_id,id),foreign key(financial_space_id,authorization_id) references finance.card_authorizations(financial_space_id,id)
);
alter table finance.import_authorization_effects enable row level security;
create policy member_read on finance.import_authorization_effects for select to authenticated using(private.is_member(financial_space_id));
revoke all on finance.import_authorization_effects from public,anon,authenticated;grant select on finance.import_authorization_effects to authenticated;

create function private.import_card_statement(p_space uuid,p_card uuid,p_month date) returns uuid language plpgsql set search_path='' as $$
declare card finance.credit_cards;close_month date;purchase_on date;begin
  select * into card from finance.credit_cards where id=p_card and financial_space_id=p_space;
  if not found or p_month is null or extract(day from p_month)<>1 then raise exception 'Choose a valid card statement month' using errcode='23514';end if;
  close_month:=case when card.due_day>card.closing_day then p_month else (p_month-interval '1 month')::date end;
  purchase_on:=private.clamped_day((close_month-interval '1 month')::date,card.closing_day)+case when card.closing_day_purchase_goes_next then 0 else 1 end;
  return private.ensure_card_statement(p_space,p_card,purchase_on);
end $$;
create function private.import_row_fingerprint(p_row jsonb,p_card boolean) returns text language sql immutable set search_path='' as $$
 select case when p_card then coalesce(p_row->>'cardStatementId','')||':' else '' end||(p_row->>'postedOn')||':'||(p_row->>'amountCents')||case when p_card then ':'||coalesce(p_row->>'installmentNumber','') else '' end;
$$;
create function private.import_purchase_date(p_candidate finance.import_candidates) returns date language sql stable set search_path='' as $$
  select coalesce(p_candidate.original_purchase_on,case when p_candidate.installment_number is not null then least(p_candidate.posted_on,private.clamped_day((date_trunc('month',s.closing_on)-make_interval(months=>p_candidate.installment_number-1))::date,extract(day from s.closing_on)::integer)) else p_candidate.posted_on end) from finance.card_statements s where s.id=p_candidate.card_statement_id;
$$;

-- The same file-wide FITID/fingerprint algorithm covers both target kinds.
-- Only target validation, metadata and stable card fields differ.
do $$ declare def text;needle text;replacement text;begin
  def:=pg_get_functiondef('api.import_statement_read(uuid,uuid,jsonb,uuid)'::regprocedure);
  def:=replace(def,'declare account finance.financial_accounts;','declare card finance.credit_cards;is_card boolean:=false;assigned_statement uuid;account finance.financial_accounts;');
  needle:='if not found then raise exception ''Active financial account not found; card imports are not supported yet'' using errcode=''P0002'';end if;';
  if position(needle in def)=0 then raise exception 'Card import target adaptation point missing';end if;
  replacement:='if not found then
    select * into card from finance.credit_cards where id=p_account and financial_space_id=p_space and status=''active'' and deleted_at is null for update;
    if not found then raise exception ''Active bank, benefit account or card not found'' using errcode=''P0002'';end if;
    is_card:=true;account.id:=card.id;account.ledger_account_id:=card.ledger_account_id;account.name:=card.name;account.fitids_unreliable:=card.fitids_unreliable;account.external_account_fingerprint:=card.external_account_fingerprint;
  end if;';def:=replace(def,needle,replacement);
  def:=replace(def,'if ledger.liquidity not in(''cash'',''benefit'') then','if not is_card and ledger.liquidity not in(''cash'',''benefit'') then');
  def:=replace(def,'if p_payload->>''accountType''=''card'' then raise exception ''Card statement imports are not supported yet'' using errcode=''23514'';end if;',
    'if not is_card and p_payload->>''accountType''=''card'' then raise exception ''This file belongs to a card; choose its card account'' using errcode=''23514'';end if;
     if is_card and p_payload->>''accountType''=''bank'' and p_payload->>''format''=''ofx'' then raise exception ''This file belongs to a bank account; choose its bank account'' using errcode=''23514'';end if;');
  def:=replace(def,'update finance.financial_accounts set external_institution=', 'if is_card then update finance.credit_cards set external_institution=institution,external_account_fingerprint=identity_hash,external_account_last_digits=right(regexp_replace(identity,''[^0-9]'','''',''g''),4),updated_at=now(),version=version+1 where id=card.id;else update finance.financial_accounts set external_institution=');
  def:=replace(def,'where id=account.id;'||chr(10)||'  end if;','where id=account.id;end if;'||chr(10)||'  end if;');
  def:=replace(def,'if p_payload ? ''profile'' then update finance.financial_accounts set import_profile=p_payload->''profile'',updated_at=now() where id=account.id;end if;',
    'if p_payload ? ''profile'' then if is_card then update finance.credit_cards set import_profile=p_payload->''profile'',updated_at=now() where id=card.id;else update finance.financial_accounts set import_profile=p_payload->''profile'',updated_at=now() where id=account.id;end if;end if;');
  needle:='mode:=case when not account.fitids_unreliable';
  replacement:='if is_card then
    if p_payload->>''cardStatementId'' is not null then select id into assigned_statement from finance.card_statements where id=(p_payload->>''cardStatementId'')::uuid and credit_card_id=card.id and financial_space_id=p_space;if not found then raise exception ''Statement belongs to another card or space'' using errcode=''23514'';end if;
    elsif p_payload->>''referenceMonth'' is not null then assigned_statement:=private.import_card_statement(p_space,card.id,(p_payload->>''referenceMonth'')::date);end if;
    for row in select value from jsonb_array_elements(read_rows) loop
      if row->>''postedOn'' is not null then
        if row->>''cardStatementId'' is not null then if not exists(select 1 from finance.card_statements where id=(row->>''cardStatementId'')::uuid and credit_card_id=card.id and financial_space_id=p_space) then raise exception ''Statement belongs to another card or space'' using errcode=''23514'';end if;
        else row:=row||jsonb_build_object(''cardStatementId'',coalesce(assigned_statement,private.ensure_card_statement(p_space,card.id,(row->>''postedOn'')::date)));end if;
        if row->>''installmentNumber'' is not null and ((row->>''installmentNumber'')::integer<1 or (row->>''installmentNumber'')::integer>(row->>''installmentCount'')::integer or (row->>''installmentCount'')::integer not between 2 and 600) then raise exception ''Invalid installment marker'' using errcode=''23514'';end if;
      end if;
      lines:=lines+1;groups:=jsonb_set(groups,array[lines::text],row);
    end loop;
    select coalesce(jsonb_agg(value order by key::integer),''[]'') into read_rows from jsonb_each(groups);groups:=''{}'';lines:=0;
  end if;
  mode:=case when not account.fitids_unreliable';
  if position(needle in def)=0 then raise exception 'Card import normalization adaptation point missing';end if;def:=replace(def,needle,replacement);
  def:=replace(def,'old.fingerprint_key=(x->>''postedOn'')||'':''||(x->>''amountCents'')','old.fingerprint_key=private.import_row_fingerprint(x,is_card)');
  def:=replace(def,'update finance.financial_accounts set fitids_unreliable=true where id=account.id;', 'if is_card then update finance.credit_cards set fitids_unreliable=true where id=card.id;else update finance.financial_accounts set fitids_unreliable=true where id=account.id;end if;');
  def:=replace(def,'financial_account_id,ledger_account_id,attachment_id','financial_account_id,credit_card_id,card_statement_id,ledger_account_id,attachment_id');
  def:=replace(def,'values(p_space,account.id,account.ledger_account_id,attachment','values(p_space,case when not is_card then account.id end,case when is_card then card.id end,assigned_statement,account.ledger_account_id,attachment');
  def:=replace(def,'fp:=day::text||'':''||cents::text;','fp:=private.import_row_fingerprint(row,is_card);');
  def:=replace(def,'error,fingerprint_key,duplicate_ordinal','error,card_statement_id,fingerprint_statement_id,installment_number,installment_count,original_purchase_on,fingerprint_key,duplicate_ordinal');
  def:=replace(def,'row->>''error'',fp,ord,','row->>''error'',(row->>''cardStatementId'')::uuid,(row->>''cardStatementId'')::uuid,(row->>''installmentNumber'')::smallint,(row->>''installmentCount'')::smallint,(row->>''originalPurchaseOn'')::date,fp,ord,');
  def:=replace(def,'old.import_batch_id<>batch.id and old.key_reserved_at','old.import_batch_id<>batch.id and (not is_card or assigned_statement is null or old.fingerprint_statement_id=assigned_statement) and old.key_reserved_at');
  def:=replace(def,'perform private.import_refresh_batch(batch.id);','if is_card then perform private.import_card_authorizations(p_space,batch.id);end if;perform private.import_refresh_batch(batch.id);');
  execute def;
end $$;

create function private.import_authorization_snapshot(p_space uuid,p_batch uuid,p_auth uuid,p_before jsonb,p_created boolean default false) returns void language sql set search_path='' as $$
  insert into finance.import_authorization_effects(financial_space_id,import_batch_id,authorization_id,before_data,after_data,created_here)
    select p_space,p_batch,id,p_before,to_jsonb(a),p_created from finance.card_authorizations a where id=p_auth
    on conflict(import_batch_id,authorization_id) do update set after_data=excluded.after_data;
$$;
create function private.import_card_authorizations(p_space uuid,p_batch uuid) returns void language plpgsql set search_path='' as $$
declare batch finance.import_batches;c finance.import_candidates;a finance.card_authorizations;ord integer;authid uuid;begin
  select * into batch from finance.import_batches where id=p_batch and financial_space_id=p_space;
  for c in select * from finance.import_candidates where import_batch_id=batch.id and status='pending_authorization' and amount_cents<0 order by line_number loop
    select count(*) into ord from finance.import_candidates where import_batch_id=batch.id and status='pending_authorization' and posted_on=c.posted_on and amount_cents=c.amount_cents and line_number<=c.line_number;
    select older.* into a from finance.card_authorizations older where older.financial_space_id=p_space and older.credit_card_id=batch.credit_card_id and older.kind='purchase' and older.source='import' and older.status='pending' and older.authorized_on=c.posted_on and older.amount_cents=abs(c.amount_cents)
      and not exists(select 1 from finance.import_candidates present where present.import_batch_id=batch.id and present.card_authorization_id=older.id) order by older.created_at,older.id limit 1;
    if found then
      authid:=a.id;update finance.card_authorizations set description=c.description,updated_at=now() where id=a.id;perform private.import_authorization_snapshot(p_space,batch.id,a.id,to_jsonb(a));
    else
      authid:=api.authorize_card_purchase(p_space,batch.credit_card_id,abs(c.amount_cents),c.posted_on,c.description);
      update finance.card_authorizations set source='import',expires_on=null where id=authid;perform private.import_authorization_snapshot(p_space,batch.id,authid,null,true);
    end if;
    update finance.import_candidates set card_authorization_id=authid where id=c.id;
  end loop;
  for a in select * from finance.card_authorizations where financial_space_id=p_space and credit_card_id=batch.credit_card_id and kind='purchase' and source='import' and status='pending' and authorized_on between batch.period_start and batch.period_end
    and not exists(select 1 from finance.import_candidates present where present.import_batch_id=batch.id and present.card_authorization_id=finance.card_authorizations.id) loop
    update finance.card_authorizations set status='cancelled',resolved_at=now(),updated_at=now() where id=a.id;perform private.import_authorization_snapshot(p_space,batch.id,a.id,to_jsonb(a));
  end loop;
end $$;

do $$ declare def text;begin
  def:=pg_get_functiondef('private.import_suggestions(uuid,uuid)'::regprocedure);execute replace(def,'private.import_suggestions','private.import_bank_suggestions');
end $$;
create or replace function private.import_suggestions(p_space uuid,p_candidate uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare c finance.import_candidates;card finance.credit_cards;matches jsonb;coverage bigint;begin
  select * into c from finance.import_candidates where id=p_candidate and financial_space_id=p_space;
  select cc.* into card from finance.import_batches b join finance.credit_cards cc on cc.id=b.credit_card_id where b.id=c.import_batch_id;
  if not found then return private.import_bank_suggestions(p_space,p_candidate);end if;
  if c.key_reserved_at is null or c.status not in('pending_review','suggested','blocked_closed_period') then return '[]';end if;
  if c.installment_number is null or c.installment_number=1 then
    select coalesce(jsonb_agg(jsonb_build_object('kind','transaction','entryId',e.id,'transactionId',t.id,'transactionVersion',t.version,'description',t.description,'amountCents',e.amount_cents,'on',t.occurred_on,'confidence',case when abs(t.occurred_on-c.posted_on)<=3 and (t.occurred_on=c.posted_on or private.import_normalize_description(t.description)=c.normalized_description) then 'high' else 'medium' end) order by abs(t.occurred_on-c.posted_on),t.registration_order),'[]') into matches
      from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where e.financial_space_id=p_space and e.ledger_account_id=c.ledger_account_id and t.status='posted' and e.reconciliation_status<>'reconciled' and e.amount_cents=c.amount_cents and abs(t.occurred_on-c.posted_on)<=7 and (e.installment_number is null or e.installment_number=1)
        and not c.rejected_matches @> jsonb_build_array(jsonb_build_object('kind','transaction','id',e.id));
    if jsonb_array_length(matches)>0 then return matches;end if;
  end if;
  if c.installment_number is not null then
    select coalesce(jsonb_agg(jsonb_build_object('kind','installment','entryId',e.id,'transactionId',t.id,'transactionVersion',t.version,'description',t.description,'amountCents',e.amount_cents,'on',t.occurred_on,'statementId',e.card_statement_id,'confidence',case when e.card_statement_id=c.card_statement_id and e.amount_cents=c.amount_cents then 'high' else 'medium' end,'canReassign',old.status<>'closed' and fresh.status<>'closed') order by (e.card_statement_id=c.card_statement_id) desc,abs(t.occurred_on-c.posted_on),t.registration_order),'[]') into matches
      from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id join finance.card_statements old on old.id=e.card_statement_id join finance.card_statements fresh on fresh.id=c.card_statement_id where e.financial_space_id=p_space and e.ledger_account_id=c.ledger_account_id and t.status='posted' and e.reconciliation_status<>'reconciled' and e.installment_number=c.installment_number and e.installment_count=c.installment_count and abs(e.amount_cents-c.amount_cents)<=1
        and not c.rejected_matches @> jsonb_build_array(jsonb_build_object('kind','installment','id',e.id));
    if jsonb_array_length(matches)>0 then return matches;end if;
  end if;
  if card.started_on is not null and private.import_purchase_date(c)<card.started_on then
    select coalesce(-sum(e.amount_cents),0)::bigint into coverage from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where t.status='posted' and t.kind='opening' and e.card_statement_id=c.card_statement_id and e.installment_number is null;
    if coverage>0 then return jsonb_build_array(jsonb_build_object('kind','opening_coverage','statementId',c.card_statement_id,'description','Coberta pelo saldo inicial da fatura','amountCents',c.amount_cents,'on',c.posted_on,'confidence','medium','openingAmountCents',coverage));end if;
  end if;
  return '[]';
end $$;

create function private.import_card_finish_created(p_space uuid,p_batch uuid,p_candidate uuid,p_transaction uuid) returns void language plpgsql set search_path='' as $$
declare candidate finance.import_candidates;entries jsonb;v integer;first_entry uuid;total bigint;begin
  select * into candidate from finance.import_candidates where id=p_candidate;
  select sum(amount_cents)::bigint,min(id::text)::uuid into total,first_entry from finance.ledger_entries where ledger_transaction_id=p_transaction and ledger_account_id=candidate.ledger_account_id;
  if total is distinct from candidate.amount_cents then raise exception 'Card operation does not match the imported amount' using errcode='23514';end if;
  select jsonb_agg(to_jsonb(e)) into entries from finance.ledger_entries e where ledger_transaction_id=p_transaction and ledger_account_id=candidate.ledger_account_id;
  update finance.ledger_entries set reconciliation_status='reconciled',reconciliation_source='import',reconciled_at=now(),import_candidate_id=candidate.id,updated_at=now() where ledger_transaction_id=p_transaction and ledger_account_id=candidate.ledger_account_id;
  update finance.ledger_transactions set version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_transaction returning version into v;
  update finance.import_candidates set status='created',created_transaction_id=p_transaction,matched_transaction_id=p_transaction,matched_entry_id=first_entry,applied_version=v where id=p_candidate;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'import_card_operation_reconciled','ledger_transaction',p_transaction,entries,jsonb_build_object('batch_id',p_batch,'candidate_id',p_candidate));
end $$;

create function private.open_card_remaining_installments(p_space uuid,p_card uuid,p_statement uuid,p_from integer,p_count integer,p_amount_cents bigint,p_description text,p_on date,p_skip_current boolean default false) returns uuid language plpgsql set search_path='' as $$
declare card finance.credit_cards;statement finance.card_statements;first integer;idx integer;opening uuid;statement_id uuid;entries jsonb;total numeric;begin
  select * into card from finance.credit_cards where id=p_card and financial_space_id=p_space and status='active';
  select * into statement from finance.card_statements where id=p_statement and financial_space_id=p_space and credit_card_id=card.id;
  if card.id is null or statement.id is null or p_on is null or p_from is null or p_count is null or p_from not between 1 and p_count or p_count not between 2 and 600 or p_amount_cents is null or p_amount_cents not between 1 and 9007199254740991 then raise exception 'Invalid ongoing card installment opening' using errcode='23514';end if;
  first:=p_from+case when p_skip_current then 1 else 0 end;if first>p_count then return null;end if;
  total:=p_amount_cents::numeric*(p_count-first+1);if total>9007199254740991 then raise exception 'Ongoing installments exceed safe cents range' using errcode='23514';end if;
  select id into opening from finance.ledger_accounts where financial_space_id=p_space and system_role='opening';
  entries:=jsonb_build_array(jsonb_build_object('ledger_account_id',opening,'amount_cents',total::bigint));
  for idx in first..p_count loop
    statement_id:=private.import_card_statement(p_space,card.id,(statement.reference_month+make_interval(months=>idx-p_from))::date);
    entries:=entries||jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-p_amount_cents,'card_statement_id',statement_id,'installment_number',idx,'installment_count',p_count));
  end loop;
  return private.post_transaction_internal(p_space,jsonb_build_object('kind','opening','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',left(p_description,200),'entries',entries),auth.uid());
end $$;

create function private.import_card_apply(p_space uuid,p_batch uuid,p_candidate uuid,p_decision jsonb) returns void language plpgsql set search_path='' as $$
declare batch finance.import_batches;c finance.import_candidates;card finance.credit_cards;category finance.categories;tx finance.ledger_transactions;entry finance.ledger_entries;other_entry finance.ledger_entries;statement finance.card_statements;entries jsonb;prior_entries jsonb;part jsonb;txid uuid;entryid uuid;v integer;idx integer;first integer;last integer;total bigint;amount bigint;current_month date;ondate date;opening uuid;coverage bigint;auth finance.card_authorizations;kind text;futureparts bigint[];
begin
  select * into batch from finance.import_batches where id=p_batch;select * into c from finance.import_candidates where id=p_candidate;select * into card from finance.credit_cards where id=batch.credit_card_id;
  select * into statement from finance.card_statements where id=c.card_statement_id;
  if p_decision->>'action'='card_payment' then
    if c.amount_cents<=0 then raise exception 'Card payment requires a positive imported amount' using errcode='23514';end if;
    txid:=api.pay_card(p_space,card.id,(p_decision->>'originAccountId')::uuid,c.amount_cents,c.posted_on,coalesce(p_decision->>'channel','pix'),null);
    perform private.import_card_finish_created(p_space,batch.id,c.id,txid);return;
  elsif p_decision->>'action'='card_refund' then
    if c.amount_cents<=0 or not exists(select 1 from finance.ledger_entries where ledger_transaction_id=(p_decision->>'originalTransactionId')::uuid and ledger_account_id=card.ledger_account_id) then raise exception 'Choose a purchase from this card for the imported refund' using errcode='23514';end if;
    txid:=api.refund_transaction(p_space,(p_decision->>'originalTransactionId')::uuid,c.amount_cents,c.posted_on,null,coalesce(p_decision->>'refundModel','credit_open_statement'),null);
    perform private.import_card_finish_created(p_space,batch.id,c.id,txid);return;
  elsif p_decision->>'action'='card_charges' then
    if c.amount_cents>=0 then raise exception 'Card charges require a negative imported amount' using errcode='23514';end if;
    opening:=private.ensure_system_category(p_space,'financial_charges');
    txid:=private.post_transaction_internal(p_space,jsonb_build_object('kind','card_charges','occurred_on',c.posted_on,'competence_month',date_trunc('month',c.posted_on)::date,'description',left(c.description,200),'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',opening,'amount_cents',-c.amount_cents),jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',c.amount_cents,'card_statement_id',statement.id))),auth.uid());
    perform private.import_card_finish_created(p_space,batch.id,c.id,txid);return;
  end if;
  if p_decision->>'action' in('match_installment','match_transaction') then
    select e.* into entry from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where e.id=(p_decision->>'entryId')::uuid and e.financial_space_id=p_space and e.ledger_account_id=card.ledger_account_id and e.reconciliation_status<>'reconciled' and t.status='posted';
    if not found then raise exception 'Matching card entry is unavailable' using errcode='23514';end if;
    select * into tx from finance.ledger_transactions where id=entry.ledger_transaction_id for update;
    if tx.version is distinct from (p_decision->>'transactionVersion')::integer then raise exception 'Transaction changed; reload before matching' using errcode='40001';end if;
    if p_decision->>'action'='match_installment' and (entry.installment_number is distinct from c.installment_number or entry.installment_count is distinct from c.installment_count or abs(entry.amount_cents-c.amount_cents)>1) then raise exception 'Installment marker or amount does not match' using errcode='23514';end if;
    if p_decision->>'action'='match_transaction' and (entry.amount_cents<>c.amount_cents or abs(tx.occurred_on-c.posted_on)>7 and not coalesce((p_decision->>'manual')::boolean,false)) then raise exception 'Card correspondence is outside the matching rules' using errcode='23514';end if;
    select jsonb_agg(to_jsonb(e) order by line_number) into prior_entries from finance.ledger_entries e where ledger_transaction_id=tx.id;
    if entry.card_statement_id<>c.card_statement_id or entry.amount_cents<>c.amount_cents then
      if statement.status='closed' or exists(select 1 from finance.card_statements where id=entry.card_statement_id and status='closed') then raise exception 'Closed card statements cannot be reassigned or edited; create a manual correction' using errcode='23514';end if;
      if entry.amount_cents<>c.amount_cents then
        select e.* into other_entry from finance.ledger_entries e join finance.card_statements s on s.id=e.card_statement_id where e.ledger_transaction_id=tx.id and e.id<>entry.id and e.ledger_account_id=card.ledger_account_id and s.status<>'closed' and e.reconciliation_status<>'reconciled' and e.amount_cents+(entry.amount_cents-c.amount_cents)<0 order by e.installment_number desc limit 1;
        if not found then raise exception 'No open installment can receive the remaining cent; correct the divergence manually' using errcode='23514';end if;
      end if;
      entries:='[]';for part in select value from jsonb_array_elements(prior_entries) order by (value->>'line_number')::integer loop
        if (part->>'id')::uuid=entry.id then part:=part||jsonb_build_object('amount_cents',c.amount_cents,'card_statement_id',c.card_statement_id);
        elsif (part->>'id')::uuid=other_entry.id then part:=part||jsonb_build_object('amount_cents',other_entry.amount_cents+entry.amount_cents-c.amount_cents);end if;
        entries:=entries||jsonb_build_array(part);
      end loop;
      perform api.edit_transaction(p_space,tx.id,tx.version,to_jsonb(tx)||jsonb_build_object('entries',entries,'acknowledge_reconciliation_change',true),'Conciliação da parcela, lote '||batch.id);
      update finance.import_candidates set before_transaction=to_jsonb(tx),before_entries=prior_entries where id=c.id;
      select id into entryid from finance.ledger_entries where ledger_transaction_id=tx.id and line_number=entry.line_number;
    else entryid:=entry.id;end if;
    v:=private.import_reconcile(p_space,c.id,entryid);
    insert into finance.import_transaction_effects(financial_space_id,import_batch_id,ledger_transaction_id,before_transaction,before_entries,applied_version)
      values(p_space,batch.id,tx.id,case when entry.card_statement_id<>c.card_statement_id or entry.amount_cents<>c.amount_cents then to_jsonb(tx) end,case when entry.card_statement_id<>c.card_statement_id or entry.amount_cents<>c.amount_cents then prior_entries end,v)
      on conflict(import_batch_id,ledger_transaction_id) do update set before_transaction=coalesce(finance.import_transaction_effects.before_transaction,excluded.before_transaction),before_entries=coalesce(finance.import_transaction_effects.before_entries,excluded.before_entries),applied_version=excluded.applied_version;
    update finance.import_candidates set status='matched',matched_entry_id=entryid,matched_transaction_id=tx.id,applied_version=v where id=c.id;return;
  end if;
  select coalesce(-sum(e.amount_cents),0)::bigint into coverage from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where t.status='posted' and t.kind='opening' and e.card_statement_id=c.card_statement_id and e.installment_number is null and card.started_on is not null and private.import_purchase_date(c)<card.started_on;
  if p_decision->>'action'='opening_coverage' then
    if coverage<=0 then raise exception 'This statement line is not covered by card opening' using errcode='23514';end if;
    update finance.import_candidates set status='matched',opening_coverage=true where id=c.id;return;
  end if;
  if c.amount_cents>=0 then raise exception 'Choose card payment or refund correspondence for a positive card line' using errcode='23514';end if;
  if p_decision->>'action'='opening_installments' then
    if card.started_on is null or private.import_purchase_date(c)>=card.started_on or c.installment_number is null then raise exception 'Only an old installment purchase can be registered against opening' using errcode='23514';end if;
    txid:=private.open_card_remaining_installments(p_space,card.id,statement.id,c.installment_number,c.installment_count,abs(c.amount_cents),c.description,card.started_on,coverage>0);
    if txid is null then update finance.import_candidates set status='matched',opening_coverage=true where id=c.id;return;end if;
    select id into entryid from finance.ledger_entries where ledger_transaction_id=txid and card_statement_id=c.card_statement_id and installment_number=c.installment_number;
    if entryid is not null then v:=private.import_reconcile(p_space,c.id,entryid);else v:=1;end if;
    update finance.import_candidates set status='created',created_transaction_id=txid,matched_transaction_id=txid,matched_entry_id=entryid,applied_version=v,opening_coverage=coverage>0 where id=c.id;return;
  elsif p_decision->>'action'='create' then
    if c.installment_number is not null and c.installment_number>1 and (p_decision->>'purchaseOn' is null or p_decision->>'totalCents' is null) then raise exception 'Choose old installment opening or provide the full original purchase date and total' using errcode='23514';end if;
    select cat.* into category from finance.categories cat where cat.financial_space_id=p_space and (cat.id=(p_decision->>'categoryId')::uuid or cat.ledger_account_id=(p_decision->>'counterpartAccountId')::uuid) and cat.kind='expense' and cat.ledger_account_id is not null and cat.archived_at is null and cat.deleted_at is null;
    if not found then raise exception 'Choose a postable expense category for the card purchase' using errcode='23514';end if;
    first:=1;last:=coalesce(c.installment_count,1);total:=coalesce((p_decision->>'totalCents')::bigint,(abs(c.amount_cents)::numeric*last)::bigint);ondate:=coalesce((p_decision->>'purchaseOn')::date,c.original_purchase_on,c.posted_on);kind:='card_purchase';
    if card.started_on is not null and ondate<card.started_on then raise exception 'Purchase predates card usage; register the remaining installments against opening' using errcode='23514';end if;
    futureparts:=private.divide_cents(total,array_fill(1::bigint,array[last]),case when card.installment_remainder='last' then array(select n from generate_series(1,last) n order by n desc) else array(select n from generate_series(1,last) n) end);
    if -futureparts[coalesce(c.installment_number,1)]<>c.amount_cents then raise exception 'Original purchase total does not match the imported installment' using errcode='23514';end if;
    entries:=jsonb_build_array(jsonb_build_object('ledger_account_id',category.ledger_account_id,'amount_cents',total));
    for idx in first..last loop
      txid:=private.import_card_statement(p_space,card.id,(statement.reference_month+make_interval(months=>idx-coalesce(c.installment_number,1)))::date);
      entries:=entries||jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-futureparts[idx],'card_statement_id',txid,'installment_number',case when last>1 then idx end,'installment_count',case when last>1 then last end));
    end loop;
  else raise exception 'Unsupported card import decision' using errcode='23514';end if;
  update private.import_context set candidate_id=c.id where backend_pid=pg_backend_pid() and transaction_number=txid_current();
  txid:=private.post_transaction_internal(p_space,jsonb_build_object('kind',kind,'occurred_on',ondate,'competence_month',date_trunc('month',ondate)::date,'description',left(c.description,200),'entries',entries),auth.uid());
  select id into entryid from finance.ledger_entries where ledger_transaction_id=txid and card_statement_id=c.card_statement_id and (c.installment_number is null or installment_number=c.installment_number);
  if entryid is not null then v:=private.import_reconcile(p_space,c.id,entryid);else v:=1;end if;
  update finance.import_candidates set status='created',created_transaction_id=txid,matched_transaction_id=txid,matched_entry_id=entryid,applied_version=v,opening_coverage=coverage>0 where id=c.id;
  if p_decision->>'authorizationId' is not null then
    select * into auth from finance.card_authorizations where id=(p_decision->>'authorizationId')::uuid and credit_card_id=card.id and financial_space_id=p_space and status='pending' for update;
    if not found or c.posted_on not between auth.authorized_on and auth.authorized_on+7 then raise exception 'Pending authorization correspondence is unavailable' using errcode='23514';end if;
    update finance.card_authorizations set status='converted',converted_transaction_id=txid,resolved_at=now(),updated_at=now() where id=auth.id;perform private.import_authorization_snapshot(p_space,batch.id,auth.id,to_jsonb(auth));
  end if;
  update private.import_context set candidate_id=null where backend_pid=pg_backend_pid() and transaction_number=txid_current();
end $$;

create function private.import_card_undo_authorizations(p_space uuid,p_batch uuid) returns void language plpgsql set search_path='' as $$
declare effect finance.import_authorization_effects;auth finance.card_authorizations;begin
  for effect in select * from finance.import_authorization_effects where financial_space_id=p_space and import_batch_id=p_batch loop
    select * into auth from finance.card_authorizations where id=effect.authorization_id for update;
    if auth.status='converted' and exists(select 1 from finance.ledger_transactions where id=auth.converted_transaction_id and status='posted' and import_batch_id is distinct from p_batch) then raise exception 'Cannot undo authorization while a later purchase is linked to it' using errcode='23514';end if;
    if effect.created_here then update finance.card_authorizations set status='cancelled',converted_transaction_id=null,resolved_at=now(),updated_at=now() where id=auth.id;
    else
      update finance.card_authorizations set status=effect.before_data->>'status',description=effect.before_data->>'description',amount_cents=(effect.before_data->>'amount_cents')::bigint,converted_transaction_id=(effect.before_data->>'converted_transaction_id')::uuid,resolved_at=(effect.before_data->>'resolved_at')::timestamptz,expires_on=(effect.before_data->>'expires_on')::date,updated_at=now() where id=auth.id;
    end if;
    insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'import_authorization_restored','card_authorization',auth.id,to_jsonb(auth),jsonb_build_object('batch_id',p_batch));
  end loop;
end $$;

do $$ declare def text;needle text;begin
  def:=pg_get_functiondef('private.validate_card_entry()'::regprocedure);
  needle:='if statement.status = ''closed'' and tx.kind not in';
  if position(needle in def)=0 then raise exception 'Card import closed statement guard point missing';end if;
  execute replace(def,needle,'if statement.status = ''closed'' and not exists(select 1 from private.import_context context join finance.import_candidates candidate on candidate.id=context.candidate_id where context.backend_pid=pg_backend_pid() and context.transaction_number=txid_current() and context.mode=''confirm'' and candidate.ledger_account_id=new.ledger_account_id and tx.import_batch_id=context.batch_id and tx.kind=''card_purchase'') and tx.kind not in');
  def:=pg_get_functiondef('api.confirm_import(uuid,uuid,integer,jsonb)'::regprocedure);
  def:=replace(def,'if not exists(select 1 from finance.financial_accounts where id=batch.financial_account_id and archived_at is null and deleted_at is null) then',
    'if not exists(select 1 from finance.financial_accounts where id=batch.financial_account_id and archived_at is null and deleted_at is null) and not exists(select 1 from finance.credit_cards where id=batch.credit_card_id and status=''active'' and deleted_at is null) then');
  def:=replace(def,'insert into private.import_context values(','insert into private.import_context(backend_pid,transaction_number,batch_id,account_id,mode) values(');
  def:=replace(def,'part:=jsonb_build_object(''kind'',''transaction'',''id'',(decision->>''entryId'')::uuid);','part:=jsonb_build_object(''kind'',coalesce(decision->>''matchKind'',''transaction''),''id'',(decision->>''entryId'')::uuid);');
  needle:='if decision->>''action''=''match_transaction'' then';
  def:=replace(def,needle,'if batch.credit_card_id is not null then perform private.import_card_apply(p_space,batch.id,c.id,decision);continue;end if;'||needle);
  def:=replace(def,'if batch.balance_on is not null then update finance.financial_accounts',
    'if batch.card_statement_id is not null and batch.statement_balance_cents is not null then update finance.card_statements set bank_total_cents=abs(batch.statement_balance_cents) where id=batch.card_statement_id;end if;
     if batch.balance_on is not null then update finance.financial_accounts');execute def;
  def:=pg_get_functiondef('api.undo_import(uuid,uuid,integer,text,jsonb)'::regprocedure);
  def:=replace(def,'insert into private.import_context values(','insert into private.import_context(backend_pid,transaction_number,batch_id,account_id,mode) values(');
  needle:='for tx in select * from finance.ledger_transactions where import_batch_id=batch.id order by created_at,id loop';
  def:=replace(def,needle,'update finance.import_batches set retained_transactions=coalesce((select jsonb_agg(jsonb_build_object(''transactionId'',t.id,''description'',t.description,''reason'',''Partida em fatura fechada: exige correção manual'')) from finance.ledger_transactions t where t.financial_space_id=p_space and t.status=''posted'' and (t.import_batch_id=batch.id or exists(select 1 from finance.import_transaction_effects efx where efx.import_batch_id=batch.id and efx.ledger_transaction_id=t.id and efx.before_transaction is not null)) and exists(select 1 from finance.ledger_entries e join finance.card_statements s on s.id=e.card_statement_id where e.ledger_transaction_id=t.id and s.status=''closed'') and (t.kind not in(''card_payment'',''card_installment_plan'') or t.kind=''card_installment_plan'' and exists(select 1 from finance.ledger_entries e join finance.card_statements s on s.id=e.card_statement_id where e.ledger_transaction_id=t.id and s.status=''closed'' and e.amount_cents<0))),''[]'') where id=batch.id;
     select * into batch from finance.import_batches where id=batch.id;
     for tx in select * from finance.ledger_transactions where import_batch_id=batch.id and not batch.retained_transactions @> jsonb_build_array(jsonb_build_object(''transactionId'',id)) order by created_at,id loop');
  needle:='where effects.import_batch_id=batch.id and t.status=''posted'' order by';
  def:=replace(def,needle,'where effects.import_batch_id=batch.id and t.status=''posted'' and not batch.retained_transactions @> jsonb_build_array(jsonb_build_object(''transactionId'',t.id)) order by');
  needle:='update finance.import_candidates set status=''undone'',key_released_at=';
  def:=replace(def,needle,'if batch.retained_transactions @> jsonb_build_array(jsonb_build_object(''transactionId'',coalesce(c.created_transaction_id,c.matched_transaction_id))) then continue;end if;
     update finance.import_candidates set status=''undone'',key_released_at=');
  needle:='if batch.before_balance_check is not null then';
  def:=replace(def,needle,'perform private.import_card_undo_authorizations(p_space,batch.id);'||needle);execute def;
end $$;

do $$ declare def text;begin
  def:=pg_get_functiondef('api.import_overview(uuid)'::regprocedure);
  execute replace(def,'api.import_overview','private.import_bank_overview');
  def:=pg_get_functiondef('api.import_review(uuid,uuid)'::regprocedure);
  execute replace(def,'api.import_review','private.import_basic_review');
end $$;
create or replace function api.import_overview(p_space uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;cards jsonb;batches jsonb;begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501';end if;
  result:=private.import_bank_overview(p_space);
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'liquidity','card','accountType','card','importProfile',c.import_profile,'fitidsUnreliable',c.fitids_unreliable,'institution',c.external_institution,'lastDigits',c.external_account_last_digits,'statements',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'referenceMonth',s.reference_month,'status',s.status) order by s.reference_month desc) from finance.card_statements s where s.credit_card_id=c.id),'[]')) order by c.name),'[]') into cards from finance.credit_cards c where c.financial_space_id=p_space and c.status='active' and c.deleted_at is null;
  select coalesce(jsonb_agg((to_jsonb(b)-'request_hash'-'before_balance_check')||jsonb_build_object('accountName',coalesce(f.name,c.name),'canUndo',b.status<>'undone' and exists(select 1 from finance.financial_space_members m where m.financial_space_id=p_space and m.user_id=auth.uid() and m.status='active' and (m.role in('owner','admin') or m.role='member' and b.created_by=auth.uid()))) order by b.created_at desc,b.id desc),'[]') into batches
    from finance.import_batches b left join finance.financial_accounts f on f.id=b.financial_account_id left join finance.credit_cards c on c.id=b.credit_card_id where b.financial_space_id=p_space;
  return result||jsonb_build_object('accounts',result->'accounts'||cards,'batches',batches);
end $$;
create or replace function api.import_review(p_space uuid,p_batch uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;batch finance.import_batches;bal bigint;opening_amount bigint;import_sum bigint;authorizations jsonb;begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501';end if;
  result:=private.import_basic_review(p_space,p_batch);select * into batch from finance.import_batches where id=p_batch and financial_space_id=p_space;
  if batch.credit_card_id is null then return result;end if;
  if batch.card_statement_id is not null then
    select coalesce(-sum(e.amount_cents),0)::bigint into bal from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where e.card_statement_id=batch.card_statement_id and t.status='posted' and t.kind not in('card_payment','card_rollover','card_credit_carry','card_installment_plan');
    result:=result||jsonb_build_object('balanceCheck',case when batch.statement_balance_cents is not null then jsonb_build_object('on',batch.balance_on,'statementCents',abs(batch.statement_balance_cents),'ledgerCents',bal,'differenceCents',abs(batch.statement_balance_cents)-bal,'matches',abs(batch.statement_balance_cents)=bal) end);
    select coalesce(-sum(e.amount_cents),0)::bigint into opening_amount from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where e.card_statement_id=batch.card_statement_id and t.status='posted' and t.kind='opening' and e.installment_number is null;
    select coalesce(-sum(amount_cents),0)::bigint into import_sum from finance.import_candidates where import_batch_id=batch.id and posted_on<(select started_on from finance.credit_cards where id=batch.credit_card_id) and amount_cents<0 and status not in('invalid','informational','pending_authorization');
    if opening_amount>0 then result:=result||jsonb_build_object('openingCoverage',jsonb_build_object('openingCents',opening_amount,'importedCents',import_sum,'differenceCents',opening_amount-import_sum));end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'description',a.description,'amountCents',a.amount_cents,'on',a.authorized_on)),'[]') into authorizations from finance.card_authorizations a where a.credit_card_id=batch.credit_card_id and a.kind='purchase' and a.status='pending';
  return result||jsonb_build_object('pendingAuthorizations',authorizations,'retainedTransactions',batch.retained_transactions);
end $$;

revoke all on function private.import_card_statement(uuid,uuid,date),private.import_row_fingerprint(jsonb,boolean),private.import_purchase_date(finance.import_candidates),private.import_authorization_snapshot(uuid,uuid,uuid,jsonb,boolean),private.import_card_authorizations(uuid,uuid),private.import_bank_suggestions(uuid,uuid),private.import_card_finish_created(uuid,uuid,uuid,uuid),private.open_card_remaining_installments(uuid,uuid,uuid,integer,integer,bigint,text,date,boolean),private.import_card_apply(uuid,uuid,uuid,jsonb),private.import_card_undo_authorizations(uuid,uuid),private.import_bank_overview(uuid),private.import_basic_review(uuid,uuid) from public,anon,authenticated;
commit;
