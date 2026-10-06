begin;
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.refund_transaction(uuid,uuid,bigint,date,uuid,text,uuid)'::regprocedure);
  if position('rt.kind = ''refund'' and rt.status = ''posted'' and re.card_statement_id = s.id' in definition) = 0 then raise exception 'Expected refund statement calculation not found'; end if;
  definition := replace(definition,'rt.kind = ''refund'' and rt.status = ''posted'' and re.card_statement_id = s.id',
    'rt.kind in (''refund'',''card_prepayment'') and rt.status = ''posted'' and re.card_statement_id = s.id');
  execute definition;
end $$;
commit;
