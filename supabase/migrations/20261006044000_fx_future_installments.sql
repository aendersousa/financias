begin;
-- A confirmed conversion difference retains the economic purchase lineage.
-- Inherit its installment classification and filter identity, while IOF stays
-- a separate expense even when both transactions use the same FX relation.
create or replace function private.report_card_part(p_space uuid,p_entry uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare entry finance.ledger_entries; tx finance.ledger_transactions; weights bigint[]; accounts uuid[]; parts bigint[]; before_parts bigint[]; total bigint; previous bigint; sum_weights bigint; result jsonb:='[]'; i integer; source uuid; installment boolean;
begin
 select * into entry from finance.ledger_entries where id=p_entry and financial_space_id=p_space;
 select * into tx from finance.ledger_transactions where id=entry.ledger_transaction_id;
 source:=case when tx.kind='refund' or tx.relation_type='fx_confirmation_of' and exists(select 1 from finance.foreign_currency_purchases f where f.financial_space_id=p_space and f.ledger_transaction_id=tx.related_transaction_id and f.confirmation_transaction_id=tx.id) then tx.related_transaction_id else tx.id end;
 select coalesce(bool_or(installment_count>=2),false) into installment from finance.ledger_entries where financial_space_id=p_space and ledger_transaction_id=source;
 select array_agg(e.amount_cents order by e.line_number),array_agg(e.ledger_account_id order by e.line_number),sum(e.amount_cents)::bigint into weights,accounts,sum_weights
  from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id
  where e.ledger_transaction_id=tx.id and e.card_statement_id is null and a.liquidity is distinct from 'cash';
 total:=-entry.amount_cents;
 if weights is null or sum_weights=0 then return jsonb_build_array(jsonb_build_object('account_id',null,'source_id',source,'priority',2,'installment',installment,'amount_cents',total)); end if;
 if sum_weights<0 then select array_agg(-w order by ordinal) into weights from unnest(weights) with ordinality q(w,ordinal); end if;
 select coalesce(-sum(amount_cents),0)::bigint into previous from finance.ledger_entries where ledger_transaction_id=tx.id and card_statement_id is not null and line_number<entry.line_number;
 parts:=private.divide_cents(previous+total,weights); before_parts:=private.divide_cents(previous,weights);
 for i in 1..array_length(weights,1) loop
  result:=result||jsonb_build_array(jsonb_build_object('account_id',accounts[i],'source_id',source,'priority',2,'installment',installment,'amount_cents',parts[i]-before_parts[i]));
 end loop;
 return private.report_merge('[]',result);
end;
$$;
-- A refund credit beyond a remaining installment does not pay installments of
-- another purchase or card. Preserve signed category composition only while
-- that purchase has a positive installment in this statement.
do $$ declare definition text; needle text; replacement text; begin
 definition:=pg_get_functiondef('private.report_future_installments(uuid,date,numeric)'::regprocedure);
 needle:='for item in select value from jsonb_array_elements(composition) where (value->>''priority'')::integer=2 and (value->>''installment'')::boolean loop';
 if position(needle in definition)=0 then raise exception 'Future installment composition selection not found'; end if;
 replacement:=$query$for item in
  with selected as(select value from jsonb_array_elements(composition) where (value->>'priority')::integer=2 and (value->>'installment')::boolean),
  positive_sources as(select value->>'source_id' as source_id from selected group by value->>'source_id' having sum((value->>'amount_cents')::bigint)>0)
  select selected.value from selected join positive_sources on selected.value->>'source_id' is not distinct from positive_sources.source_id
 loop$query$;
 execute replace(definition,needle,replacement);
end $$;
revoke all on function private.report_card_part(uuid,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
