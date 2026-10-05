begin;
create function private.recheck_category_budgets() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Validate the resulting tree at commit time, including category moves and
  -- essential flag changes. No budget values or versions are modified.
  update finance.budgets set id = id where financial_space_id = coalesce(new.financial_space_id,old.financial_space_id);
  return null;
end;
$$;
create constraint trigger category_budgets_valid after insert or update or delete on finance.categories deferrable initially deferred for each row execute function private.recheck_category_budgets();
revoke all on function private.recheck_category_budgets() from public,anon,authenticated;
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.budget_month_summary(uuid,date)'::regprocedure);
  definition := replace(definition,'where e.effective_competence_month = p_month','where c.system_role is distinct from ''financial_charges'' and e.effective_competence_month = p_month');
  definition := replace(definition,'where c.financial_space_id = p_space and c.competence_month = p_month',
    'where c.category_id not in(select id from finance.categories where financial_space_id = p_space and system_role = ''financial_charges'') and c.financial_space_id = p_space and c.competence_month = p_month');
  execute definition;
end $$;
commit;
