begin;
-- Conversion confirmation belongs to the purchase; IOF remains a distinct
-- expense and is deliberately outside its refundable economic lineage.
create function private.is_foreign_purchase_part(p_space uuid,p_original uuid,p_transaction uuid) returns boolean language sql stable set search_path='' as $$
 select p_transaction=p_original or exists(select 1 from finance.foreign_currency_purchases f where f.financial_space_id=p_space and f.ledger_transaction_id=p_original and f.confirmation_transaction_id=p_transaction);
$$;
create function private.foreign_remaining_consumption(p_space uuid,p_original uuid) returns bigint language sql stable set search_path='' as $$
 select coalesce(sum(e.amount_cents),0)::bigint from finance.posted_ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id join finance.ledger_accounts a on a.id=e.ledger_account_id and a.account_class='expense'
 where e.financial_space_id=p_space and (private.is_foreign_purchase_part(p_space,p_original,t.id) or t.related_transaction_id=p_original and t.kind='refund');
$$;
do $$ declare definition text; needle text; refund_query text; begin
 definition:=pg_get_functiondef('api.refund_transaction(uuid,uuid,bigint,date,uuid,text,uuid)'::regprocedure);
 needle:='e.ledger_transaction_id = p_original';
 if position(needle in definition)=0 then raise exception 'FX refund purchase selection not found'; end if;
 definition:=replace(definition,needle,'private.is_foreign_purchase_part(p_space,p_original,e.ledger_transaction_id)');
 refund_query:=$query$
 select array_agg(reserve_id order by line_number),array_agg(ledger_account_id order by line_number),array_agg(amount_cents order by line_number),array_agg(competence order by line_number),sum(amount_cents)::bigint into category_reserves,category_rows,category_amounts,category_months,available from (
  select source.reserve_id,source.ledger_account_id,source.line_number,source.competence,
   (source.gross_cents+coalesce((select sum(r.amount_cents) from finance.ledger_entries r join finance.ledger_transactions rt on rt.id=r.ledger_transaction_id where rt.related_transaction_id=p_original and rt.kind='refund' and rt.status='posted' and r.ledger_account_id=source.ledger_account_id and r.reserve_id is not distinct from source.reserve_id and coalesce(r.original_competence_month,r.competence_month,rt.competence_month)=source.competence),0))::bigint as amount_cents
  from (select e.reserve_id,e.ledger_account_id,min(e.line_number) as line_number,coalesce(e.competence_month,original.competence_month) as competence,sum(e.amount_cents)::bigint as gross_cents from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.account_class='expense' join finance.ledger_transactions et on et.id=e.ledger_transaction_id and et.status='posted' where e.financial_space_id=p_space and private.is_foreign_purchase_part(p_space,p_original,e.ledger_transaction_id) group by e.reserve_id,e.ledger_account_id,coalesce(e.competence_month,original.competence_month)) source
 ) parts where amount_cents>0;
$query$;
 needle:='select array_agg\(reserve_id order by line_number\).*?\) parts where amount_cents > 0;';
 if definition!~needle then raise exception 'FX category refund aggregation not found'; end if;
 definition:=regexp_replace(definition,needle,refund_query,'s');
 -- A bank-overridden or paid closed cycle cannot receive a fresh refund.
 definition:=replace(definition,'private.ensure_card_statement(p_space,card.id,private.space_today(p_space))','private.foreign_destination(p_space,card.id,private.space_today(p_space))');
 execute definition;
 definition:=pg_get_functiondef('private.refund_within_original()'::regprocedure);
 definition:=replace(definition,'case when new.kind = ''refund'' then new.related_transaction_id else new.id end','case when new.kind = ''refund'' or new.relation_type=''fx_confirmation_of'' then new.related_transaction_id else new.id end');
 definition:=replace(definition,'case when t.kind = ''refund'' then t.related_transaction_id else t.id end','case when t.kind = ''refund'' or t.relation_type=''fx_confirmation_of'' then t.related_transaction_id else t.id end');
 needle:='e.ledger_transaction_id = original_id';
 if position(needle in definition)=0 then raise exception 'FX refundable invariant selection not found'; end if;
 definition:=replace(definition,needle,'private.is_foreign_purchase_part((select financial_space_id from finance.ledger_transactions where id=original_id),original_id,e.ledger_transaction_id) and exists(select 1 from finance.ledger_transactions source where source.id=e.ledger_transaction_id and source.status=''posted'')');
 execute definition;
 definition:=pg_get_functiondef('api.transaction_detail(uuid,uuid)'::regprocedure);
 execute replace(definition,'api.transaction_detail(','private.transaction_detail_before_fx(');
end $$;
create or replace function api.transaction_detail(p_space uuid,p_transaction uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare detail jsonb;
begin
 detail:=private.transaction_detail_before_fx(p_space,p_transaction);
 if exists(select 1 from finance.foreign_currency_purchases where financial_space_id=p_space and ledger_transaction_id=p_transaction) then detail:=detail||jsonb_build_object('remaining_consumption_cents',private.foreign_remaining_consumption(p_space,p_transaction)); end if;
 return detail;
end;
$$;
-- Keep economic correction cents in the due months of their actual card
-- entries. Generic category competence remains the default for cash and IOF.
do $$ declare definition text; needle text; fx_block text; refund_block text; begin
 definition:=pg_get_functiondef('private.report_health_expenses(uuid,date)'::regprocedure);
 definition:=replace(definition,'t.related_transaction_id,t.registration_order','t.related_transaction_id,t.relation_type,t.registration_order');
 needle:='original:=case when entry.kind=''refund'' then entry.related_transaction_id else entry.ledger_transaction_id end;';
 if position(needle in definition)=0 then raise exception 'FX health economic collection point not found'; end if;
 fx_block:=$patch$
  if entry.kind='card_correction' and entry.relation_type='fx_confirmation_of' and exists(select 1 from finance.foreign_currency_purchases f where f.financial_space_id=p_space and f.ledger_transaction_id=entry.related_transaction_id and f.confirmation_transaction_id=entry.ledger_transaction_id) and exists(select 1 from finance.ledger_entries e where e.ledger_transaction_id=entry.related_transaction_id and e.installment_count>=2) then
   select array_agg(-e.amount_cents order by e.line_number),array_agg(date_trunc('month',s.effective_due_on)::date order by e.line_number),array_agg(s.id order by e.line_number) into weights,dates,statement_ids from finance.ledger_entries e join finance.card_statements s on s.id=e.card_statement_id where e.ledger_transaction_id=entry.ledger_transaction_id;
   if (select sum(w) from unnest(weights) w)<0 then select array_agg(-w order by ordinal) into weights from unnest(weights) with ordinality q(w,ordinal); end if;
   parts:=private.divide_cents(entry.amount_cents,weights);
   for i in 1..array_length(weights,1) loop
    if parts[i]<>0 then result:=result||jsonb_build_array(jsonb_build_object('transaction_id',entry.ledger_transaction_id,'account_id',entry.ledger_account_id,'month',dates[i],'statement_id',statement_ids[i],'amount_cents',parts[i],'group','installments_and_debts','credit_cost',entry.system_role='financial_charges','original_competence_month',entry.original_competence_month)); end if;
   end loop;
   continue;
  end if;
$patch$;
 definition:=replace(definition,needle,fx_block||needle);
 -- Earlier components already include posted conversion corrections and
 -- previous refunds. Allocate a later refund over their remaining cents.
 needle:='if entry.kind=''card_prepayment'' and exists';
 if position(needle in definition)=0 then raise exception 'FX health refund allocation point not found'; end if;
 refund_block:=$patch$
  if entry.kind='refund' and coalesce(is_installment,false) and exists(select 1 from finance.foreign_currency_purchases f where f.financial_space_id=p_space and f.ledger_transaction_id=original and f.confirmation_transaction_id is not null) then
   select array_agg(amount order by due_month),array_agg(due_month order by due_month),array_agg(statement_id order by due_month) into weights,dates,statement_ids from (
    select (value->>'month')::date due_month,sum((value->>'amount_cents')::bigint)::bigint amount,(array_agg((value->>'statement_id')::uuid order by value->>'statement_id') filter(where value->>'statement_id' is not null))[1] statement_id
    from jsonb_array_elements(result) value where value->>'account_id'=entry.ledger_account_id::text and (private.is_foreign_purchase_part(p_space,original,(value->>'transaction_id')::uuid) or exists(select 1 from finance.ledger_transactions r where r.id=(value->>'transaction_id')::uuid and r.related_transaction_id=original and r.kind='refund' and r.status='posted')) group by 1 having sum((value->>'amount_cents')::bigint)<>0
   ) economic;
  end if;
$patch$;
 definition:=replace(definition,needle,refund_block||needle);
 definition:=replace(definition,'''month'',coalesce(redirected,dates[i]),''amount_cents'',parts[i]','''month'',coalesce(redirected,dates[i]),''statement_id'',statement_ids[i],''amount_cents'',parts[i]');
 execute definition;
end $$;
revoke all on function private.is_foreign_purchase_part(uuid,uuid,uuid),private.foreign_remaining_consumption(uuid,uuid),private.transaction_detail_before_fx(uuid,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
