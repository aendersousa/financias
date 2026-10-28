begin;
-- Recovery is a read model. Choosing a local queued item never edits or cancels
-- the server fact, including when the original fact has since been corrected.
create function private.queue_payload_summary(p_space uuid,p_payload jsonb) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('kind',p_payload->>'kind','description',p_payload->>'description','occurredOn',p_payload->>'occurred_on',
   'amountCents',case when p_payload->>'kind' in('expense','income','card_purchase') then
     (select sum(abs((part->>'amount_cents')::bigint)) from jsonb_array_elements(p_payload->'entries') part join finance.ledger_accounts a on a.id=(part->>'ledger_account_id')::uuid and a.financial_space_id=p_space where a.account_class in('expense','income')) end,
   'entries',coalesce((select jsonb_agg(jsonb_build_object('name',a.name,'amountCents',(part->>'amount_cents')::bigint,'accountClass',a.account_class,'ledgerAccountId',a.id,'categoryId',c.id,'accountId',f.id,'cardId',card.id) order by ord)
     from jsonb_array_elements(p_payload->'entries') with ordinality parts(part,ord)
     join finance.ledger_accounts a on a.id=(part->>'ledger_account_id')::uuid and a.financial_space_id=p_space
     left join finance.categories c on c.ledger_account_id=a.id and c.financial_space_id=p_space
     left join finance.financial_accounts f on f.ledger_account_id=a.id and f.financial_space_id=p_space
     left join finance.credit_cards card on card.ledger_account_id=a.id and card.financial_space_id=p_space),'[]'::jsonb))
$$;

create function api.queue_conflict_summary(p_space uuid,p_client_uuid uuid,p_content jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tx finance.ledger_transactions; original jsonb; current_payload jsonb; expected jsonb; amount bigint; sign int; operation text; matches boolean:=false; category_ledger uuid; card_ledger uuid;
begin
 if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
 if p_client_uuid is null or jsonb_typeof(p_content) is distinct from 'object' or octet_length(p_content::text)>20000
   or p_content->>'kind' is null or p_content->>'kind' not in('expense','income','card_purchase')
   or jsonb_typeof(p_content->'amountCents') is distinct from 'number' or (p_content->>'amountCents')::numeric not between 1 and 9007199254740991
   or (p_content->>'amountCents')::numeric<>trunc((p_content->>'amountCents')::numeric)
   or coalesce(p_content->>'occurredOn','') !~ '^\d{4}-\d{2}-\d{2}$' or not isfinite((p_content->>'occurredOn')::date)
   or jsonb_typeof(p_content->'description') is distinct from 'string' or char_length(p_content->>'description')>100
   or p_content->>'categoryId' is null or p_content->>'categoryLedgerId' is null then raise exception 'Invalid queued entry' using errcode='23514'; end if;
 amount:=(p_content->>'amountCents')::bigint;
 select * into tx from finance.ledger_transactions where financial_space_id=p_space and client_uuid=p_client_uuid;
 select r.operation into operation from finance.operation_requests r where financial_space_id=p_space and client_uuid=p_client_uuid;
 if operation is null and exists(select 1 from finance.import_batches where financial_space_id=p_space and client_uuid=p_client_uuid) then operation:='import_statement_read'; end if;
 if tx.id is null then return jsonb_build_object('comparison',case when operation is null then 'missing' else 'operation' end,'server',null,'original',null,'reservedOperation',operation); end if;
 select after_data into original from finance.audit_logs where financial_space_id=p_space and entity_type='ledger_transaction' and entity_id=tx.id and action='created' order by created_at,id limit 1;
 if p_content->>'kind'<>'card_purchase' then
   if p_content->>'accountLedgerId' is null then raise exception 'Queued account required' using errcode='23514'; end if;
   sign:=case when p_content->>'kind'='income' then -1 else 1 end;
   expected:=jsonb_build_object('kind',p_content->>'kind','occurred_on',p_content->>'occurredOn','competence_month',left(p_content->>'occurredOn',7)||'-01',
     'description',coalesce(nullif(p_content->>'description',''),case when sign=1 then 'Despesa rápida' else 'Receita rápida' end),'client_uuid',p_client_uuid,
     'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',p_content->>'categoryLedgerId','amount_cents',sign*amount),jsonb_build_object('ledger_account_id',p_content->>'accountLedgerId','amount_cents',-sign*amount)));
   matches:=tx.client_payload_hash=sha256(convert_to(expected::text,'UTF8'));
 else
   -- A card statement is derived by the server. Compare the immutable original
   -- request rather than deriving a different statement after closing/date edits.
   select ledger_account_id into category_ledger from finance.categories where financial_space_id=p_space and id=(p_content->>'categoryId')::uuid;
   select ledger_account_id into card_ledger from finance.credit_cards where financial_space_id=p_space and id=(p_content->>'cardId')::uuid;
   matches:=original->>'kind'='card_purchase' and original->>'occurred_on'=p_content->>'occurredOn'
     and original->>'description'=coalesce(nullif(p_content->>'description',''),'Compra rápida') and original->>'card_holder_id' is null
     and jsonb_array_length(original->'entries')=2 and original->>'reserve_id' is null
     and exists(select 1 from jsonb_array_elements(original->'entries') part where (part->>'ledger_account_id')::uuid=category_ledger and (part->>'amount_cents')::bigint=amount)
     and exists(select 1 from jsonb_array_elements(original->'entries') part where (part->>'ledger_account_id')::uuid=card_ledger and (part->>'amount_cents')::bigint=-amount and part->>'installment_number' is null and part->>'installment_count' is null);
 end if;
 current_payload:=to_jsonb(tx)||jsonb_build_object('entries',(select jsonb_agg(to_jsonb(e) order by line_number) from finance.ledger_entries e where e.ledger_transaction_id=tx.id));
 return jsonb_build_object('comparison',case when operation is not null or tx.kind not in('expense','income','card_purchase') or tx.operation_receipt is not null then 'operation' when coalesce(matches,false) then 'same' else 'different' end,
   'server',private.queue_payload_summary(p_space,current_payload)||jsonb_build_object('id',tx.id,'status',tx.status,'version',tx.version),
   'original',case when original is not null then private.queue_payload_summary(p_space,original) end,'reservedOperation',coalesce(operation,tx.operation_receipt->>'operation'));
end;
$$;

-- Revoked access to the original space does not prevent recovery in another
-- space where the same user still has permission to write.
create function api.queue_reassignment_options(p_space uuid,p_kind text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_writer(p_space);
 if p_kind is null or p_kind not in('expense','income','card_purchase') then raise exception 'Invalid queued entry kind' using errcode='23514'; end if;
 return jsonb_build_object('space',(select jsonb_build_object('id',id,'name',name,'today',private.space_today(id),'timezone',timezone) from finance.financial_spaces where id=p_space),
   'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'ledgerAccountId',f.ledger_account_id) order by f.name,f.id) from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id where f.financial_space_id=p_space and f.archived_at is null and f.deleted_at is null and a.liquidity in('cash','benefit')),'[]'::jsonb),
   'cards',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from finance.credit_cards where financial_space_id=p_space and status='active'),'[]'::jsonb),
   'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'ledgerAccountId',ledger_account_id) order by name,id) from finance.categories where financial_space_id=p_space and kind=case when p_kind='income' then 'income' else 'expense' end and ledger_account_id is not null and archived_at is null and deleted_at is null),'[]'::jsonb));
end;
$$;
revoke all on function private.queue_payload_summary(uuid,jsonb),api.queue_conflict_summary(uuid,uuid,jsonb),api.queue_reassignment_options(uuid,text) from public,anon,authenticated;
grant execute on function api.queue_conflict_summary(uuid,uuid,jsonb),api.queue_reassignment_options(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
