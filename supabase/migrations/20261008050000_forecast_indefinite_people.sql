begin;
-- A reminder for periodic interest is not a maturity date for the principal.
do $migration$
declare definition text; old_fragment text; new_fragment text;
begin
  select pg_get_functiondef('api.cash_forecast(uuid,text,date,date)'::regprocedure) into definition;
  old_fragment := '    amount:=(item->>''balanceCents'')::bigint;';
  new_fragment := $patch$    -- Use the latest saved agreement; prior agreements remain in the notes.
    if exists (
      select 1 from finance.people p
      cross join lateral (select string_to_array(coalesce(p.notes,''),'[Empréstimo') as blocks) agreement
      where p.id=(item->>'id')::uuid and p.financial_space_id=p_space
        and agreement.blocks[cardinality(agreement.blocks)] ~* '(prazo indefinido|data indefinida|sem data final)'
    ) then continue; end if;
    amount:=(item->>'balanceCents')::bigint;$patch$;
  if position('Use the latest saved agreement' in definition)>0 then return; end if;
  if position(old_fragment in definition)=0 then raise exception 'Forecast function changed; review before patching'; end if;
  execute replace(definition,old_fragment,new_fragment);
end;
$migration$;
commit;
