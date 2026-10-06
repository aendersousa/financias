begin;
-- A service request is permanent; descriptions, notes and corrected entries are not.
alter table finance.ledger_transactions add column operation_receipt jsonb,
  add constraint valid_operation_receipt check(operation_receipt is null or
    (jsonb_typeof(operation_receipt) = 'object' and operation_receipt ?& array['operation','request'] and jsonb_typeof(operation_receipt->'operation') = 'string' and jsonb_typeof(operation_receipt->'request') = 'object'));

create function private.receipt_from_original_payload(p_payload jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare request jsonb; operation text; part jsonb; card uuid; origin uuid; amount bigint; commitment uuid; channel text; begin
  if p_payload->'operation_receipt' is not null then return p_payload->'operation_receipt'; end if;
  operation := p_payload->>'kind';
  begin request := (p_payload->>'notes')::jsonb; exception when invalid_text_representation then request := null; end;
  if operation in('card_charges','card_installment_plan','card_prepayment','investment_result','investment_redemption','loan_disbursement','loan_payment') and jsonb_typeof(request) = 'object' then
    return jsonb_build_object('operation',operation,'request',request);
  elsif operation = 'refund' and jsonb_typeof(request) = 'object' then
    return jsonb_build_object('operation','refund','request',request || jsonb_build_object('original',p_payload->'related_transaction_id','on',p_payload->'occurred_on'));
  elsif operation = 'card_payment' and p_payload->>'notes' like 'payment_channel:%' then
    channel := substring(p_payload->>'notes' from length('payment_channel:')+1);
    origin := (p_payload->'entries'->0->>'ledger_account_id')::uuid;
    amount := -(p_payload->'entries'->0->>'amount_cents')::bigint;
    -- Card ID is added by the migration from the original card ledger account.
    return jsonb_build_object('operation','card_payment','request',jsonb_build_object('origin',origin,'amount',amount,'on',p_payload->'occurred_on','channel',channel));
  elsif operation in('expense','income','card_purchase') and jsonb_typeof(request) = 'object' and request ?& array['amount_cents','mode','category'] then
    for part in select value from jsonb_array_elements(p_payload->'entries') loop
      if part->>'commitment_id' is not null then commitment := (part->>'commitment_id')::uuid; exit; end if;
    end loop;
    if commitment is not null then return jsonb_build_object('operation','commitment_settlement','request',request || jsonb_build_object('commitment',commitment,'on',p_payload->'occurred_on')); end if;
  end if;
  return null;
end;
$$;

-- The earliest creation audit preserves the original notes and entries even after edits.
-- DDL holds a table lock; only these two mutation guards are suspended for this metadata backfill.
alter table finance.ledger_transactions disable trigger protect_transaction;
alter table finance.ledger_transactions disable trigger closed_card_transaction;
with original as (
  select distinct on(t.id) t.id,t.kind,t.financial_space_id,a.after_data
  from finance.ledger_transactions t join finance.audit_logs a on a.financial_space_id = t.financial_space_id and a.entity_id = t.id
  where t.client_uuid is not null and a.entity_type = 'ledger_transaction' and a.action = 'created' and a.after_data is not null
  order by t.id,a.created_at,a.id
), receipts as (
  select o.*,private.receipt_from_original_payload(o.after_data) as receipt from original o
)
update finance.ledger_transactions t set operation_receipt = case when r.kind = 'card_payment' then
  jsonb_set(r.receipt,'{request,card}',to_jsonb((select c.id from finance.credit_cards c
    where c.financial_space_id = r.financial_space_id and exists(select 1 from jsonb_array_elements(r.after_data->'entries') e where (e->>'ledger_account_id')::uuid = c.ledger_account_id) limit 1)))
  else r.receipt end
from receipts r where t.id = r.id and r.receipt is not null;
-- Existing rows enqueue deferred integrity checks during the metadata backfill.
-- Flush them before the next ALTER TABLE; an empty verification DB hides this.
set constraints all immediate;
alter table finance.ledger_transactions enable trigger protect_transaction;
alter table finance.ledger_transactions enable trigger closed_card_transaction;
set constraints all deferred;

create function private.protect_operation_receipt() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.operation_receipt is distinct from old.operation_receipt then raise exception 'Operation receipt is immutable' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger operation_receipt_immutable before update on finance.ledger_transactions for each row execute function private.protect_operation_receipt();
create or replace function private.replay_operation(p_space uuid,p_client uuid,p_kind text,p_request jsonb) returns uuid language plpgsql stable set search_path = '' as $$
declare previous finance.ledger_transactions; begin
  if p_client is null then return null; end if;
  select * into previous from finance.ledger_transactions where financial_space_id = p_space and client_uuid = p_client;
  if not found then return null; end if;
  if previous.operation_receipt is distinct from jsonb_build_object('operation',p_kind,'request',p_request) then raise exception 'Client UUID reused with different operation' using errcode = '23505'; end if;
  return previous.id;
end;
$$;

do $$ declare definition text; signature text; operation text; needle text; replacement text; begin
  definition := pg_get_functiondef('private.post_transaction_internal(uuid,jsonb,uuid)'::regprocedure);
  needle := 'client_uuid,client_payload_hash,system_key,related_transaction_id';
  if position(needle in definition) = 0 then raise exception 'Internal writer receipt insertion point not found'; end if;
  definition := replace(definition,needle,'client_uuid,client_payload_hash,operation_receipt,system_key,related_transaction_id');
  needle := 'else payload_hash end,p_payload->>''system_key''';
  if position(needle in definition) = 0 then raise exception 'Internal writer receipt value point not found'; end if;
  execute replace(definition,needle,'else payload_hash end,p_payload->''operation_receipt'',p_payload->>''system_key''');
  definition := pg_get_functiondef('api.post_transaction(uuid,jsonb)'::regprocedure);
  execute replace(definition,'perform private.require_writer(p_space);','perform private.require_writer(p_space); if p_payload ? ''operation_receipt'' then raise exception ''Use the dedicated financial operation'' using errcode = ''42501''; end if;');

  for signature,operation in select * from (values
    ('api.confirm_card_charges(uuid,uuid,jsonb,uuid)','card_charges'),
    ('api.install_card_statement(uuid,uuid,date,bigint,integer,bigint[],uuid,uuid)','card_installment_plan'),
    ('api.prepay_card_installments(uuid,uuid,integer[],bigint,date,uuid)','card_prepayment'),
    ('api.value_asset(uuid,uuid,date,bigint,uuid)','investment_result'),
    ('api.redeem_investment(uuid,uuid,uuid,date,bigint,bigint,bigint,uuid)','investment_redemption'),
    ('api.loan_movement(uuid,uuid,uuid,date,text,bigint,bigint,uuid)',null)
  ) operations(signature,operation) loop
    definition := pg_get_functiondef(signature::regprocedure);
    needle := '''notes'',request::text,';
    if position(needle in definition) = 0 then raise exception 'Operation receipt payload point not found: %',signature; end if;
    replacement := '''notes'',request::text,''operation_receipt'',jsonb_build_object(''operation'',' || case when operation is null then 'kind' else quote_literal(operation) end || ',''request'',request),';
    execute replace(definition,needle,replacement);
  end loop;

  definition := pg_get_functiondef('api.refund_transaction(uuid,uuid,bigint,date,uuid,text,uuid)'::regprocedure);
  needle := 'original.kind <> ''refund'' or original.related_transaction_id <> p_original or original.occurred_on <> p_on or original.notes is distinct from jsonb_build_object(''destination'',p_destination_account,''model'',p_model,''amount_cents'',p_amount_cents)::text';
  if position(needle in definition) = 0 then raise exception 'Refund replay point not found'; end if;
  definition := replace(definition,needle,'original.operation_receipt is distinct from jsonb_build_object(''operation'',''refund'',''request'',jsonb_build_object(''original'',p_original,''on'',p_on,''destination'',p_destination_account,''model'',p_model,''amount_cents'',p_amount_cents))');
  needle := '''notes'',jsonb_build_object(''destination'',p_destination_account,''model'',request_model,''amount_cents'',p_amount_cents)::text,';
  if position(needle in definition) = 0 then raise exception 'Refund receipt payload point not found'; end if;
  execute replace(definition,needle,needle || '''operation_receipt'',jsonb_build_object(''operation'',''refund'',''request'',jsonb_build_object(''original'',p_original,''on'',p_on,''destination'',p_destination_account,''model'',request_model,''amount_cents'',p_amount_cents)),');

  definition := pg_get_functiondef('api.settle_commitment(uuid,uuid,bigint,date,text,uuid,uuid)'::regprocedure);
  needle := 'select t.id into tx_id from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id = t.id where t.financial_space_id = p_space and t.client_uuid = p_client_uuid and e.commitment_id = p_commitment;';
  if position(needle in definition) = 0 then raise exception 'Settlement replay query point not found'; end if;
  definition := replace(definition,needle,'select t.id into tx_id from finance.ledger_transactions t where t.financial_space_id = p_space and t.client_uuid = p_client_uuid;');
  needle := 't.id = tx_id and t.occurred_on = p_on and t.notes = jsonb_build_object(''amount_cents'',p_amount_cents,''mode'',p_mode,''category'',p_category)::text';
  if position(needle in definition) = 0 then raise exception 'Settlement replay comparison point not found'; end if;
  definition := replace(definition,needle,'t.id = tx_id and t.operation_receipt = jsonb_build_object(''operation'',''commitment_settlement'',''request'',jsonb_build_object(''commitment'',p_commitment,''on'',p_on,''amount_cents'',p_amount_cents,''mode'',p_mode,''category'',p_category))');
  needle := '''notes'',jsonb_build_object(''amount_cents'',p_amount_cents,''mode'',p_mode,''category'',p_category)::text,';
  if position(needle in definition) = 0 then raise exception 'Settlement receipt payload point not found'; end if;
  execute replace(definition,needle,needle || '''operation_receipt'',jsonb_build_object(''operation'',''commitment_settlement'',''request'',jsonb_build_object(''commitment'',p_commitment,''on'',p_on,''amount_cents'',p_amount_cents,''mode'',p_mode,''category'',p_category)),');

  definition := pg_get_functiondef('api.pay_card(uuid,uuid,uuid,bigint,date,text,uuid)'::regprocedure);
  needle := 'select * into card from finance.credit_cards where id = p_card and financial_space_id = p_space and status <> ''archived'';';
  if position(needle in definition) = 0 then raise exception 'Card payment early replay point not found'; end if;
  definition := replace(definition,needle,
    'if p_client_uuid is not null then
       select id into tx_id from finance.ledger_transactions where financial_space_id = p_space and client_uuid = p_client_uuid;
       if tx_id is not null then
         if not exists(select 1 from finance.ledger_transactions t where t.id = tx_id and t.operation_receipt = jsonb_build_object(''operation'',''card_payment'',''request'',jsonb_build_object(''card'',p_card,''origin'',p_origin_ledger,''amount'',p_amount_cents,''on'',p_on,''channel'',p_channel))) then raise exception ''Client UUID reused with different payment'' using errcode = ''23505''; end if;
         return tx_id;
       end if;
     end if;
     ' || needle);
  needle := 'if not exists(select 1 from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id = t.id where t.id = tx_id and t.kind = ''card_payment'' and t.notes = ''payment_channel:'' || p_channel and t.occurred_on = p_on and e.ledger_account_id = p_origin_ledger and e.amount_cents = -p_amount_cents) or not exists(select 1 from finance.ledger_entries where ledger_transaction_id = tx_id and ledger_account_id = card.ledger_account_id)';
  if position(needle in definition) = 0 then raise exception 'Card payment replay comparison point not found'; end if;
  definition := replace(definition,needle,'if not exists(select 1 from finance.ledger_transactions t where t.id = tx_id and t.operation_receipt = jsonb_build_object(''operation'',''card_payment'',''request'',jsonb_build_object(''card'',p_card,''origin'',p_origin_ledger,''amount'',p_amount_cents,''on'',p_on,''channel'',p_channel)))');
  needle := '''notes'',''payment_channel:'' || p_channel,';
  if position(needle in definition) = 0 then raise exception 'Card payment receipt payload point not found'; end if;
  definition := replace(definition,needle,needle || '''operation_receipt'',jsonb_build_object(''operation'',''card_payment'',''request'',jsonb_build_object(''card'',p_card,''origin'',p_origin_ledger,''amount'',p_amount_cents,''on'',p_on,''channel'',p_channel)),');
  definition := replace(definition,'tx_id := api.post_transaction(p_space,','tx_id := private.post_transaction_internal(p_space,');
  needle := '''client_uuid'',p_client_uuid,''entries'',entries));';
  if position(needle in definition) = 0 then raise exception 'Card payment internal actor point not found'; end if;
  execute replace(definition,needle,'''client_uuid'',p_client_uuid,''entries'',entries),auth.uid());');
end $$;
revoke all on function private.receipt_from_original_payload(jsonb),private.protect_operation_receipt(),private.replay_operation(uuid,uuid,text,jsonb) from public,anon,authenticated;
commit;
