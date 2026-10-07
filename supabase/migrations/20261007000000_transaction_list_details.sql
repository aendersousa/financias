begin;

-- Enrich the existing snapshot without changing membership checks or other fields.
do $$
declare definition text; original text := 'to_jsonb(t) order by t.occurred_on desc,t.created_at desc';
begin
  select pg_get_functiondef('api.workspace_snapshot(uuid)'::regprocedure) into definition;
  if position(original in definition) = 0 then
    raise exception 'workspace_snapshot transaction projection not found';
  end if;
  definition := replace(definition, original, $patch$
    to_jsonb(t) || jsonb_build_object(
      'amount_cents',(select coalesce(sum(e.amount_cents) filter (where e.amount_cents > 0),0)
        from finance.ledger_entries e where e.ledger_transaction_id = t.id and e.financial_space_id = p_space),
      'entries',(select coalesce(jsonb_agg(jsonb_build_object(
        'account_name',a.name,'owner_type',a.owner_type,'account_class',a.account_class,'amount_cents',e.amount_cents
      ) order by e.line_number),'[]'::jsonb)
        from finance.ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id
        where e.ledger_transaction_id = t.id and e.financial_space_id = p_space)
    ) order by t.occurred_on desc,t.created_at desc
  $patch$);
  execute definition;
end;
$$;

commit;
