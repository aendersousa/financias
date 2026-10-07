begin;
do $$
declare definition text;
begin
  select pg_get_functiondef('api.save_entry_model(uuid,text,jsonb,uuid,integer,uuid)'::regprocedure) into definition;
  definition:=replace(definition,'''cardId'',''amountCents''','''cardId'',''amountCents'',''paymentMethod''');
  execute definition;
end;
$$;
commit;
