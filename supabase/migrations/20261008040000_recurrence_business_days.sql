begin;

-- Add timing_mode to recurrence_rule_versions to support business day rules (e.g., 5º dia útil)
alter table finance.recurrence_rule_versions
  add column if not exists timing_mode text not null default 'calendar_day'
  check(timing_mode in ('calendar_day', 'business_day'));

-- Function to calculate the nth banking day of a given month
-- p_n > 0: count from start of month (e.g. 5 = 5th business day)
-- p_n < 0: count backwards from end of month (e.g. -1 = last business day)
create or replace function private.nth_banking_day(p_space uuid, p_month date, p_n integer) returns date language plpgsql set search_path = '' as $$
declare
  curr date := date_trunc('month', p_month)::date;
  month_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  count integer := 0;
begin
  if p_n is null or p_n = 0 or p_n < -31 or p_n > 31 then
    raise exception 'Invalid banking day position' using errcode = '23514';
  end if;

  if p_n > 0 then
    while curr <= month_end loop
      if private.is_banking_day(p_space, curr) then
        count := count + 1;
        if count = p_n then
          return curr;
        end if;
      end if;
      curr := curr + 1;
    end loop;
    return private.effective_due_date(p_space, month_end, 'previous');
  else
    curr := month_end;
    while curr >= date_trunc('month', p_month)::date loop
      if private.is_banking_day(p_space, curr) then
        count := count - 1;
        if count = p_n then
          return curr;
        end if;
      end if;
      curr := curr - 1;
    end loop;
    return private.effective_due_date(p_space, date_trunc('month', p_month)::date, 'next');
  end if;
end;
$$;
revoke all on function private.nth_banking_day(uuid, date, integer) from public, anon, authenticated;

-- Update private.insert_recurrence_version to persist timing_mode
create or replace function private.insert_recurrence_version(p_space uuid,p_rule uuid,p_number integer,p_period date,p_scope text,p_payload jsonb,p_actor uuid) returns uuid language plpgsql set search_path = '' as $$
declare version_id uuid; begin
  insert into finance.recurrence_rule_versions(financial_space_id,recurrence_rule_id,version_number,effective_from_period,change_scope,interval_count,day_of_month,weekday,month_of_year,business_day_adjustment,certainty,amount_cents,category_id,counterpart_account_id,payment_method,payment_financial_account_id,payment_credit_card_id,reserve_id,competence_offset_months,created_by,timing_mode)
    values(p_space,p_rule,p_number,p_period,p_scope,coalesce((p_payload->>'interval_count')::smallint,1),(p_payload->>'day_of_month')::smallint,(p_payload->>'weekday')::smallint,(p_payload->>'month_of_year')::smallint,
      coalesce(p_payload->>'business_day_adjustment','next'),coalesce(p_payload->>'certainty','confirmed'),(p_payload->>'amount_cents')::bigint,(p_payload->>'category_id')::uuid,(p_payload->>'counterpart_account_id')::uuid,p_payload->>'payment_method',
      (p_payload->>'payment_financial_account_id')::uuid,(p_payload->>'payment_credit_card_id')::uuid,(p_payload->>'reserve_id')::uuid,coalesce((p_payload->>'competence_offset_months')::smallint,0),p_actor,coalesce(p_payload->>'timing_mode','calendar_day')) returning id into version_id;
  return version_id;
end;
$$;

-- Patch private.generate_recurrence to use nth_banking_day when timing_mode = 'business_day'
do $$
declare
  d text;
  needle text := 'when ''month'' then private.clamped_day(period,version.day_of_month)';
  replacement text := 'when ''month'' then case when coalesce(version.timing_mode,''calendar_day'') = ''business_day'' then private.nth_banking_day(rule.financial_space_id,period,version.day_of_month) else private.clamped_day(period,version.day_of_month) end';
begin
  select pg_get_functiondef('private.generate_recurrence(uuid)'::regprocedure) into d;
  if position(needle in d) > 0 then
    d := replace(d, needle, replacement);
    execute d;
  end if;
end;
$$;

-- Patch api.cash_forecast to use nth_banking_day when timing_mode = 'business_day'
do $$
declare
  d text;
  needle text := 'when ''month'' then private.clamped_day(period,rule_version.day_of_month)';
  replacement text := 'when ''month'' then case when coalesce(rule_version.timing_mode,''calendar_day'') = ''business_day'' then private.nth_banking_day(p_space,period,rule_version.day_of_month) else private.clamped_day(period,rule_version.day_of_month) end';
begin
  select pg_get_functiondef('api.cash_forecast(uuid,text,date,date)'::regprocedure) into d;
  if position(needle in d) > 0 then
    d := replace(d, needle, replacement);
    execute d;
  end if;
end;
$$;

commit;
