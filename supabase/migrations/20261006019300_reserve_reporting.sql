begin;
do $$ declare definition text; begin
  definition:=pg_get_functiondef('api.reserve_summary(uuid,date)'::regprocedure);
  definition:=replace(definition,'api.reserve_summary','private.reserve_summary_internal');
  definition:=replace(definition,'if not private.is_member(p_space) then raise exception ''Space permission required'' using errcode=''42501''; end if;','');
  execute definition;
  definition:=pg_get_functiondef('private.month_controls(uuid,date)'::regprocedure);
  definition:=replace(definition,'''budgets'',private.budget_month_summary_live(p_space,p_month)','''budgets'',private.budget_month_summary_live(p_space,p_month),
    ''reserves'',private.reserve_summary_internal(p_space,(p_month+interval ''1 month''-interval ''1 day'')::date)');
  execute definition;
end $$;
revoke all on function private.reserve_summary_internal(uuid,date) from public,anon,authenticated;
commit;
