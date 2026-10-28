begin;
create function private.foreign_purchase_amount(p_space uuid,p_original uuid) returns bigint language sql stable set search_path='' as $$
 select coalesce(sum(e.amount_cents),0)::bigint from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.account_class='expense' where e.financial_space_id=p_space and private.is_foreign_purchase_part(p_space,p_original,e.ledger_transaction_id);
$$;
create function private.foreign_iof_amount(p_space uuid,p_original uuid) returns bigint language sql stable set search_path='' as $$
 select coalesce(sum(e.amount_cents),0)::bigint from finance.posted_ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id and a.account_class='expense' join finance.ledger_transactions t on t.id=e.ledger_transaction_id where e.financial_space_id=p_space and (t.id=p_original or t.related_transaction_id=p_original and t.relation_type='fx_confirmation_of');
$$;
-- The recorded conversion and exchange rate are historical metadata. Current
-- BRL presentation follows posted ledger amounts, including ordinary manual
-- corrections, without folding separate refunds or IOF into purchase price.
do $$ declare definition text; needle text; event_query text; begin
 definition:=pg_get_functiondef('api.foreign_currency_summary(uuid)'::regprocedure);
 needle:='''exchange_rate'',f.exchange_rate::text';
 if position(needle in definition)=0 then raise exception 'FX summary conversion metadata point not found'; end if;
 definition:=replace(definition,needle,'''current_brl_cents'',private.foreign_purchase_amount(p_space,t.id),''recorded_brl_cents'',f.current_brl_cents,''changed_after_conversion'',t.status=''posted'' and private.foreign_purchase_amount(p_space,t.id)<>f.current_brl_cents,'||needle);
 needle:='''iof_cents'',coalesce\(\(select sum\(e.amount_cents\)::bigint.*?\),0\),';
 if definition!~needle then raise exception 'FX summary separate IOF point not found'; end if;
 definition:=regexp_replace(definition,needle,'''iof_cents'',private.foreign_iof_amount(p_space,f.iof_transaction_id),','s');
 event_query:=$events$
   'events',coalesce((select jsonb_agg(jsonb_build_object('action',a.action,'at',a.created_at,'entity_type',a.entity_type,'entity_id',a.entity_id) order by a.created_at,a.id) from finance.audit_logs a where a.financial_space_id=p_space and (a.entity_id=f.id and a.entity_type='foreign_currency_purchase' or a.entity_type='ledger_transaction' and a.action in('edited','cancelled') and (a.entity_id in(f.ledger_transaction_id,f.confirmation_transaction_id,f.iof_transaction_id) or exists(select 1 from finance.ledger_transactions iof_adjustment where iof_adjustment.id=a.entity_id and iof_adjustment.related_transaction_id=f.iof_transaction_id and iof_adjustment.relation_type='fx_confirmation_of')))),'[]')
$events$;
 needle:='''events'',coalesce\(\(select jsonb_agg\(jsonb_build_object\(''action'',a.action,''at'',a.created_at\).*?\),''\[\]''\)';
 if definition!~needle then raise exception 'FX summary audit history point not found'; end if;
 definition:=regexp_replace(definition,needle,event_query,'s');
 execute definition;
end $$;
create function private.foreign_source_dependencies() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from finance.foreign_currency_purchases f join finance.ledger_transactions original on original.id=f.ledger_transaction_id join finance.ledger_transactions adjustment on adjustment.id=f.confirmation_transaction_id where f.financial_space_id=new.financial_space_id and (original.id=new.id or adjustment.id=new.id) and adjustment.status='posted' and original.status<>'posted') then raise exception 'Cancel the foreign conversion adjustment before its original purchase' using errcode='23514'; end if;
 if exists(select 1 from finance.foreign_currency_purchases f join finance.ledger_transactions original on original.id=f.iof_transaction_id join finance.ledger_transactions adjustment on adjustment.related_transaction_id=original.id and adjustment.relation_type='fx_confirmation_of' where f.financial_space_id=new.financial_space_id and (original.id=new.id or adjustment.id=new.id) and adjustment.status='posted' and original.status<>'posted') then raise exception 'Cancel the IOF adjustment before its original transaction' using errcode='23514'; end if;
 return null;
end;
$$;
create constraint trigger foreign_currency_dependencies after insert or update on finance.ledger_transactions deferrable initially deferred for each row execute function private.foreign_source_dependencies();
revoke all on function private.foreign_purchase_amount(uuid,uuid),private.foreign_iof_amount(uuid,uuid),private.foreign_source_dependencies() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
