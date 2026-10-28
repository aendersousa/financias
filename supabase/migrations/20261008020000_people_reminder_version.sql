begin;

-- Update api.people_management_summary to include commitment version in reminders projection
do $$
declare
  d text;
  needle text := '''completed_at'',c.completed_at)';
  replacement text := '''completed_at'',c.completed_at,''version'',c.version)';
begin
  select pg_get_functiondef('api.people_management_summary(uuid,boolean)'::regprocedure) into d;
  if position(needle in d) > 0 then
    d := replace(d, needle, replacement);
    execute d;
  end if;
end;
$$;

-- Clean up duplicate orphan commitment and obsolete note for Aender if present
update finance.commitments
  set deleted_at = now()
  where id = 'c8f07181-c616-4ae9-a675-544a386f0510' and title ilike '%Parcela 1/1%';

update finance.people
  set notes = '📌 Shampoo e Condicionador Wella: R$ 240,00 (sem juros adicionais) | Devolução em 2 meses (2 parcelas mensais de R$ 120,00 (total R$ 240,00)).',
      version = version + 1,
      updated_at = now()
  where id = '97446bec-9820-4bd5-8d3c-413337684d4f' and notes ilike '%📌 [Empréstimo iniciado em 25/09/2026]%';

-- For Aender, since balance is 0 (all 240,00 paid), mark completed
update finance.commitments
  set completed_at = now(), version = version + 1, updated_at = now()
  where person_id = '97446bec-9820-4bd5-8d3c-413337684d4f'
    and completed_at is null
    and deleted_at is null
    and exists (
      select 1 from finance.people p
      join finance.account_balances b on b.id = p.ledger_account_id
      where p.id = '97446bec-9820-4bd5-8d3c-413337684d4f' and b.balance_cents = 0
    );

commit;

