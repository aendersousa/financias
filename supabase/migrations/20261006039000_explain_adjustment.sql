begin;
do $$ declare definition text; begin
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='finance.operation_requests'::regclass and conname='operation_requests_operation_check';
  alter table finance.operation_requests drop constraint operation_requests_operation_check;
  execute 'alter table finance.operation_requests add constraint operation_requests_operation_check check ('||substring(definition from 7)||' or operation = ''explain_adjustment'')';
end $$;

create function api.explain_account_adjustment(p_space uuid,p_transaction uuid,p_version integer,p_amount_cents bigint,p_category uuid default null,p_competence date default null,p_reason text default '',p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare tx finance.ledger_transactions; difference finance.ledger_entries; category finance.categories; destination uuid; competence date; signed_amount bigint; next_line smallint; before_entries jsonb; request jsonb; replay uuid;
begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request:=jsonb_build_object('transaction',p_transaction,'version',p_version,'amount_cents',p_amount_cents,'category',p_category,'competence',p_competence,'reason',p_reason);
  replay:=private.loan_request_result(p_space,p_client_uuid,'explain_adjustment',request);
  if replay is not null then return replay; end if;
  select * into tx from finance.ledger_transactions where financial_space_id=p_space and id=p_transaction for update;
  if not found then raise exception 'Transaction not found' using errcode='P0002'; end if;
  if tx.version is distinct from p_version then raise exception 'Transaction changed; reload before editing' using errcode='40001'; end if;
  if tx.kind<>'balance_adjustment' or tx.status<>'posted' then raise exception 'Posted balance adjustment required' using errcode='23514'; end if;
  select e.* into difference from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.system_role='balance_adjustment' where e.ledger_transaction_id=tx.id;
  if not found or difference.amount_cents=0 then raise exception 'Adjustment has no unidentified difference' using errcode='23514'; end if;
  if p_amount_cents is null or p_amount_cents<=0 or p_amount_cents>abs(difference.amount_cents) or nullif(trim(p_reason),'') is null then raise exception 'Explanation amount and reason required' using errcode='23514'; end if;
  competence:=coalesce(p_competence,tx.competence_month);
  if not isfinite(competence) or competence<>date_trunc('month',competence)::date then raise exception 'Competence must be a calendar month' using errcode='23514'; end if;
  if exists(select 1 from finance.period_closings c where c.financial_space_id=p_space and c.reopened_at is null and (c.month=date_trunc('month',tx.occurred_on)::date or c.month=tx.competence_month or c.month=competence or exists(select 1 from finance.ledger_entries e where e.ledger_transaction_id=tx.id and coalesce(e.competence_month,tx.competence_month)=c.month))) then raise exception 'Period is closed' using errcode='23514'; end if;
  if p_category is null then
    select id into destination from finance.ledger_accounts where financial_space_id=p_space and system_role='opening';
  else
    select * into category from finance.categories where financial_space_id=p_space and id=p_category and archived_at is null and deleted_at is null and ledger_account_id is not null;
    if not found or category.kind is distinct from (case when difference.amount_cents>0 then 'expense' else 'income' end) then raise exception 'Active category must match the adjustment direction' using errcode='23514'; end if;
    destination:=category.ledger_account_id;
  end if;
  select jsonb_agg(to_jsonb(e) order by e.line_number) into before_entries from finance.ledger_entries e where e.ledger_transaction_id=tx.id;
  select max(line_number)+1 into next_line from finance.ledger_entries where ledger_transaction_id=tx.id;
  signed_amount:=case when difference.amount_cents>0 then p_amount_cents else -p_amount_cents end;
  -- Keep the financial entry, its ID and its reconciliation metadata untouched.
  if signed_amount=difference.amount_cents then delete from finance.ledger_entries where id=difference.id;
  else update finance.ledger_entries set amount_cents=amount_cents-signed_amount,updated_at=now() where id=difference.id; end if;
  insert into finance.ledger_entries(financial_space_id,ledger_transaction_id,ledger_account_id,amount_cents,line_number,competence_month,created_by) values(p_space,tx.id,destination,signed_amount,next_line,competence,auth.uid());
  update finance.ledger_transactions set version=version+1,updated_at=now(),updated_by=auth.uid() where id=tx.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'adjustment_explained','ledger_transaction',tx.id,jsonb_build_object('transaction',to_jsonb(tx),'entries',before_entries),request);
  perform private.record_loan_request(p_space,p_client_uuid,'explain_adjustment',request,tx.id);
  return tx.id;
end;
$$;

do $$ declare definition text; begin
  definition:=pg_get_functiondef('api.transaction_detail(uuid,uuid)'::regprocedure);
  execute replace(definition,'api.transaction_detail(','private.transaction_detail_before_adjustment(');
end $$;
create or replace function api.transaction_detail(p_space uuid,p_transaction uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare detail jsonb; unidentified bigint;
begin
  detail:=private.transaction_detail_before_adjustment(p_space,p_transaction);
  select coalesce(sum(e.amount_cents),0)::bigint into unidentified from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id where e.financial_space_id=p_space and e.ledger_transaction_id=p_transaction and a.system_role='balance_adjustment';
  return detail||jsonb_build_object('unidentified_adjustment_cents',unidentified);
end;
$$;
revoke all on function private.transaction_detail_before_adjustment(uuid,uuid) from public,anon,authenticated;
revoke all on function api.explain_account_adjustment(uuid,uuid,integer,bigint,uuid,date,text,uuid) from public,anon,authenticated;
grant execute on function api.explain_account_adjustment(uuid,uuid,integer,bigint,uuid,date,text,uuid) to authenticated;
commit;
