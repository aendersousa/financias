begin;
do $$ declare definition text; begin
  definition:=pg_get_functiondef('api.record_card_purchase(uuid,uuid,uuid,bigint,integer,date,text,uuid,uuid,bigint,uuid)'::regprocedure);
  definition:=replace(definition,'p_authorization uuid DEFAULT NULL::uuid)','p_authorization uuid DEFAULT NULL::uuid, p_reserve uuid DEFAULT NULL::uuid)');
  definition:=replace(definition,'''ledger_account_id'',category.ledger_account_id,''amount_cents'',p_cash_price_cents','''ledger_account_id'',category.ledger_account_id,''reserve_id'',p_reserve,''amount_cents'',p_cash_price_cents');
  execute definition;
end $$;
drop function api.record_card_purchase(uuid,uuid,uuid,bigint,integer,date,text,uuid,uuid,bigint,uuid);
revoke all on function api.record_card_purchase(uuid,uuid,uuid,bigint,integer,date,text,uuid,uuid,bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function api.record_card_purchase(uuid,uuid,uuid,bigint,integer,date,text,uuid,uuid,bigint,uuid,uuid) to authenticated;
commit;
