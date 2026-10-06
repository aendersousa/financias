begin;
-- An offline quick entry uses the space timezone, never the device timezone.
do $$
declare definition text;
begin
  select pg_get_functiondef('api.workspace_snapshot(uuid)'::regprocedure) into definition;
  definition:=replace(definition,'''today'',private.space_today(s.id)','''today'',private.space_today(s.id),''timezone'',s.timezone');
  definition:=replace(definition,'return result;',$patch$
  result:=result||jsonb_build_object('totals',jsonb_build_object(
    'cash_cents',(select coalesce(sum((a->>'balance_cents')::bigint),0) from jsonb_array_elements(result->'accounts') a where a->>'liquidity'='cash'),
    'benefit_cents',(select coalesce(sum((a->>'balance_cents')::bigint),0) from jsonb_array_elements(result->'accounts') a where a->>'liquidity'='benefit'),
    'investment_cents',(select coalesce(sum((a->>'balance_cents')::bigint),0) from jsonb_array_elements(result->'accounts') a where a->>'liquidity'='investment'),
    'property_cents',(select coalesce(sum((a->>'balance_cents')::bigint),0) from jsonb_array_elements(result->'accounts') a where a->>'liquidity'='property'),
    'card_used_cents',(select coalesce(sum((c->>'used_cents')::bigint),0) from jsonb_array_elements(result->'cards') c),
    'commitment_outflows_cents',(select coalesce(sum((c->>'remaining_cents')::bigint),0) from jsonb_array_elements(result->'commitments') c where c->>'direction'='outflow' and c->>'settlement_status' in('pending','partial'))
  ));
  return result;
  $patch$);
  execute definition;
end;
$$;
commit;
