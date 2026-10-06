begin;
alter table finance.asset_valuations add column cancelled_at timestamptz,add column cancelled_by uuid references auth.users(id),add column cancellation_reason text,
  add constraint valuation_cancellation_metadata check((cancelled_at is null and cancelled_by is null and cancellation_reason is null) or (cancelled_at is not null and cancellation_reason is not null and char_length(trim(cancellation_reason)) > 0));
alter table finance.asset_valuations drop constraint asset_valuations_financial_account_id_valued_on_key;
create unique index asset_valuation_active_date on finance.asset_valuations(financial_account_id,valued_on) where cancelled_at is null;
-- Preserve previously cancelled values as history, never as an informed active position.
update finance.asset_valuations v set cancelled_at = t.cancelled_at,cancelled_by = t.cancelled_by,cancellation_reason = coalesce(nullif(trim(t.cancellation_reason),''),'Cancelamento anterior do lançamento'),version = v.version+1
  from finance.ledger_transactions t where t.id = v.ledger_transaction_id and t.status = 'cancelled';

do $$ declare definition text; needle text; begin
  -- Clone the existing audited cancellation service before adding the public guard.
  definition := pg_get_functiondef('api.cancel_transaction(uuid,uuid,integer,text)'::regprocedure);
  needle := 'api.cancel_transaction';
  if position(needle in definition) = 0 then raise exception 'Asset cancellation clone point not found'; end if;
  execute replace(definition,needle,'private.cancel_asset_transaction');
  definition := replace(definition,'perform private.require_writer(p_space);',
    'perform private.require_writer(p_space);
     if exists(select 1 from finance.asset_valuations where financial_space_id = p_space and ledger_transaction_id = p_transaction) then raise exception ''Cancel the valuation through its dedicated service'' using errcode = ''23514''; end if;');
  execute definition;

  definition := pg_get_functiondef('api.value_asset(uuid,uuid,date,bigint,uuid)'::regprocedure);
  needle := 'tx := private.replay_operation(p_space,p_client_uuid,''investment_result'',request);';
  if position(needle in definition) = 0 then raise exception 'Asset valuation replay point not found'; end if;
  definition := replace(definition,needle,needle || '
    if tx is not null then select id into valuation from finance.asset_valuations where ledger_transaction_id = tx and financial_space_id = p_space; if valuation is not null then return valuation; end if; raise exception ''Valuation receipt has no value record'' using errcode = ''23514''; end if;');
  needle := 'where financial_account_id = p_account and valued_on = p_on;';
  if position(needle in definition) = 0 then raise exception 'Active valuation selection point not found'; end if;
  execute replace(definition,needle,'where financial_account_id = p_account and valued_on = p_on and cancelled_at is null;');

  definition := pg_get_functiondef('api.preview_month_closing(uuid,date)'::regprocedure);
  needle := 'v.financial_account_id = f.id and v.valued_on =';
  if position(needle in definition) = 0 then raise exception 'Active valuation closing warning point not found'; end if;
  execute replace(definition,needle,'v.financial_account_id = f.id and v.cancelled_at is null and (v.ledger_transaction_id is null or exists(select 1 from finance.ledger_transactions vt where vt.id = v.ledger_transaction_id and vt.status = ''posted'')) and v.valued_on =');
  definition := pg_get_functiondef('api.portfolio_summary(uuid)'::regprocedure);
  needle := 'from finance.asset_valuations v where v.financial_space_id = p_space';
  if position(needle in definition) = 0 then raise exception 'Active portfolio valuation selection point not found'; end if;
  execute replace(definition,needle,needle || ' and v.cancelled_at is null and (v.ledger_transaction_id is null or exists(select 1 from finance.ledger_transactions vt where vt.id = v.ledger_transaction_id and vt.status = ''posted''))');

  definition := pg_get_functiondef('api.redeem_investment(uuid,uuid,uuid,date,bigint,bigint,bigint,uuid)'::regprocedure);
  needle := 'if remaining < 0 or remaining > before_value then';
  if position(needle in definition) = 0 then raise exception 'Partial redemption remaining position point not found'; end if;
  definition := replace(definition,needle,'if remaining is null or remaining not between 0 and 9007199254740991 or before_value not between 0 and 9007199254740991 then');
  needle := 'if principal > 0 then';
  if position(needle in definition) = 0 then raise exception 'Partial redemption principal entry point not found'; end if;
  definition := replace(definition,needle,'if principal <> 0 then');
  needle := 'principal := before_value-remaining; result := p_gross_cents-principal;';
  if position(needle in definition) = 0 then raise exception 'Partial redemption result domain point not found'; end if;
  execute replace(definition,needle,needle || '
    if abs(result::numeric) > 9007199254740991 then raise exception ''Redemption result exceeds safe cents range'' using errcode = ''23514''; end if;');

  definition := pg_get_functiondef('api.post_transaction(uuid,jsonb)'::regprocedure);
  needle := 'perform private.require_writer(p_space);';
  if position(needle in definition) = 0 then raise exception 'Dedicated asset posting guard point not found'; end if;
  execute replace(definition,needle,needle || '
    if p_payload->>''kind'' in(''investment_result'',''investment_redemption'',''loan_disbursement'',''loan_payment'') or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_payload->''entries'') = ''array'' then p_payload->''entries'' else ''[]''::jsonb end) e join finance.ledger_accounts a on a.id = (e->>''ledger_account_id'')::uuid where a.financial_space_id = p_space and (a.owner_type = ''loan'' or a.system_role = ''investment_result'')) then raise exception ''Use the dedicated financial operation'' using errcode = ''42501''; end if;');
  definition := pg_get_functiondef('api.edit_transaction(uuid,uuid,integer,jsonb,text)'::regprocedure);
  execute replace(definition,needle,needle || '
    if exists(select 1 from finance.ledger_transactions where financial_space_id = p_space and id = p_transaction and kind in(''investment_result'',''investment_redemption'',''loan_disbursement'',''loan_payment'')) or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_payload->''entries'') = ''array'' then p_payload->''entries'' else ''[]''::jsonb end) e join finance.ledger_accounts a on a.id = (e->>''ledger_account_id'')::uuid where a.financial_space_id = p_space and (a.owner_type = ''loan'' or a.system_role = ''investment_result'')) then raise exception ''Operation must be corrected through its dedicated service'' using errcode = ''23514''; end if;');
end $$;

create function api.cancel_asset_valuation(p_space uuid,p_valuation uuid,p_version integer,p_reason text) returns uuid language plpgsql security definer set search_path = '' as $$
declare valuation finance.asset_valuations; transaction_version integer; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into valuation from finance.asset_valuations where id = p_valuation and financial_space_id = p_space for update;
  if not found then raise exception 'Valuation not found' using errcode = 'P0002'; end if;
  if valuation.version is distinct from p_version then raise exception 'Valuation changed; reload before editing' using errcode = '40001'; end if;
  if valuation.cancelled_at is not null then return valuation.id; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Cancellation reason required' using errcode = '23514'; end if;
  if exists(select 1 from finance.period_closings where financial_space_id = p_space and month = date_trunc('month',valuation.valued_on)::date and reopened_at is null) then raise exception 'Period is closed' using errcode = '23514'; end if;
  if valuation.ledger_transaction_id is not null then
    select version into transaction_version from finance.ledger_transactions where id = valuation.ledger_transaction_id for update;
    perform private.cancel_asset_transaction(p_space,valuation.ledger_transaction_id,transaction_version,p_reason);
  end if;
  update finance.asset_valuations set cancelled_at = now(),cancelled_by = auth.uid(),cancellation_reason = p_reason,version = version+1 where id = valuation.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'cancelled','asset_valuation',valuation.id,to_jsonb(valuation),jsonb_build_object('reason',p_reason));
  return valuation.id;
end;
$$;
revoke all on function private.cancel_asset_transaction(uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function api.cancel_asset_valuation(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function api.cancel_asset_valuation(uuid,uuid,integer,text) to authenticated;
commit;
