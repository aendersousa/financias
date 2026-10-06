begin;
-- These services can legitimately complete without a ledger transaction.
-- Their client UUID must still be reserved, including after cancellation or closing.
create table finance.operation_requests (
  financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  client_uuid uuid not null,operation text not null check(operation in('value_asset','confirm_card_charges')),
  request jsonb not null check(jsonb_typeof(request) = 'object'),result_id uuid not null,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),
  primary key(financial_space_id,client_uuid)
);
alter table finance.operation_requests enable row level security;
create policy member_read on finance.operation_requests for select to authenticated using(private.is_member(financial_space_id));
revoke all on finance.operation_requests from public,anon,authenticated;
grant select on finance.operation_requests to authenticated;

-- Recover requests that already produced a ledger receipt. Earlier zero-difference
-- values and zero-charge confirmations did not persist a UUID and cannot be recovered.
insert into finance.operation_requests(financial_space_id,client_uuid,operation,request,result_id,created_by,created_at)
select distinct on(t.financial_space_id,t.client_uuid) t.financial_space_id,t.client_uuid,'value_asset',t.operation_receipt->'request',v.id,t.created_by,t.created_at
from finance.ledger_transactions t join finance.asset_valuations v on v.ledger_transaction_id = t.id
where t.client_uuid is not null and t.kind = 'investment_result' and t.operation_receipt->>'operation' = 'investment_result'
order by t.financial_space_id,t.client_uuid,v.created_at,v.id;
insert into finance.operation_requests(financial_space_id,client_uuid,operation,request,result_id,created_by,created_at)
select t.financial_space_id,t.client_uuid,'confirm_card_charges',t.operation_receipt->'request',t.id,t.created_by,t.created_at
from finance.ledger_transactions t where t.client_uuid is not null and t.kind = 'card_charges' and t.operation_receipt->>'operation' = 'card_charges';

create function private.protect_operation_request() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Operation request is immutable' using errcode = '23514'; end;
$$;
create trigger operation_request_immutable before update or delete on finance.operation_requests for each row execute function private.protect_operation_request();
create function private.replay_nonledger_operation(p_space uuid,p_client uuid,p_operation text,p_request jsonb) returns uuid language plpgsql stable set search_path = '' as $$
declare previous finance.operation_requests; begin
  if p_client is null then return null; end if;
  select * into previous from finance.operation_requests where financial_space_id = p_space and client_uuid = p_client;
  if not found then return null; end if;
  if previous.operation is distinct from p_operation or previous.request is distinct from p_request then raise exception 'Client UUID reused with different operation' using errcode = '23505'; end if;
  return previous.result_id;
end;
$$;

do $$ declare definition text; needle text; signature text; begin
  -- Preserve the validated service bodies, including financial integrity and receipts.
  definition := pg_get_functiondef('api.value_asset(uuid,uuid,date,bigint,uuid)'::regprocedure);
  execute replace(definition,'api.value_asset','private.value_asset_with_ledger_receipt');
  definition := pg_get_functiondef('api.confirm_card_charges(uuid,uuid,jsonb,uuid)'::regprocedure);
  execute replace(definition,'api.confirm_card_charges','private.confirm_card_charges_with_ledger_receipt');

  -- Generic postings and all other dedicated ledger services share this namespace.
  -- Wrappers register the request only after the inner service succeeds, so an
  -- initial nonzero operation can write its ledger receipt normally.
  definition := pg_get_functiondef('private.post_transaction_internal(uuid,jsonb,uuid)'::regprocedure);
  needle := 'payload_hash := sha256(convert_to(p_payload::text,''UTF8''));';
  if position(needle in definition) = 0 then raise exception 'Nonledger request writer namespace point not found'; end if;
  execute replace(definition,needle,
    'if p_payload->>''client_uuid'' is not null and exists(select 1 from finance.operation_requests where financial_space_id = p_space and client_uuid = (p_payload->>''client_uuid'')::uuid) then raise exception ''Client UUID reused with different operation'' using errcode = ''23505''; end if;
     ' || needle);
  definition := pg_get_functiondef('private.replay_operation(uuid,uuid,text,jsonb)'::regprocedure);
  needle := 'if p_client is null then return null; end if;';
  if position(needle in definition) = 0 then raise exception 'Nonledger request service namespace point not found'; end if;
  execute replace(definition,needle,needle || '
    if exists(select 1 from finance.operation_requests where financial_space_id = p_space and client_uuid = p_client) then raise exception ''Client UUID reused with different operation'' using errcode = ''23505''; end if;');
  -- Earlier services use their own replay comparisons. Reject a reserved UUID
  -- before deriving payment allocations or changing commitment amounts.
  for signature in select * from (values('api.pay_card(uuid,uuid,uuid,bigint,date,text,uuid)'),('api.refund_transaction(uuid,uuid,bigint,date,uuid,text,uuid)'),('api.settle_commitment(uuid,uuid,bigint,date,text,uuid,uuid)')) services(signature) loop
    definition := pg_get_functiondef(signature::regprocedure);
    needle := 'perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));';
    if position(needle in definition) = 0 then raise exception 'Nonledger request early namespace point not found: %',signature; end if;
    execute replace(definition,needle,needle || '
      if p_client_uuid is not null and exists(select 1 from finance.operation_requests where financial_space_id = p_space and client_uuid = p_client_uuid) then raise exception ''Client UUID reused with different operation'' using errcode = ''23505''; end if;');
  end loop;
end $$;

create or replace function api.value_asset(p_space uuid,p_account uuid,p_on date,p_value_cents bigint,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare request jsonb; result uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request := jsonb_build_object('account',p_account,'on',p_on,'value',p_value_cents);
  result := private.replay_nonledger_operation(p_space,p_client_uuid,'value_asset',request);
  if result is not null then return result; end if;
  result := private.value_asset_with_ledger_receipt(p_space,p_account,p_on,p_value_cents,p_client_uuid);
  if p_client_uuid is not null then insert into finance.operation_requests(financial_space_id,client_uuid,operation,request,result_id,created_by)
    values(p_space,p_client_uuid,'value_asset',request,result,auth.uid()); end if;
  return result;
end;
$$;
create or replace function api.confirm_card_charges(p_space uuid,p_statement uuid,p_components jsonb,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare request jsonb; result uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request := jsonb_build_object('statement',p_statement,'components',p_components);
  result := private.replay_nonledger_operation(p_space,p_client_uuid,'confirm_card_charges',request);
  if result is not null then return result; end if;
  result := private.confirm_card_charges_with_ledger_receipt(p_space,p_statement,p_components,p_client_uuid);
  if p_client_uuid is not null then insert into finance.operation_requests(financial_space_id,client_uuid,operation,request,result_id,created_by)
    values(p_space,p_client_uuid,'confirm_card_charges',request,result,auth.uid()); end if;
  return result;
end;
$$;
revoke all on function private.protect_operation_request(),private.replay_nonledger_operation(uuid,uuid,text,jsonb),private.value_asset_with_ledger_receipt(uuid,uuid,date,bigint,uuid),private.confirm_card_charges_with_ledger_receipt(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
commit;
