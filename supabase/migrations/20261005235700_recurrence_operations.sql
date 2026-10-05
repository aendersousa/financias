begin;
alter table finance.commitments add constraint commitment_title_length check(char_length(title) between 1 and 200);
alter table finance.recurrence_rules add constraint rule_title_length check(char_length(title) between 1 and 200);
create function private.recurrence_period(p_on date,p_unit text) returns date language sql immutable set search_path = '' as $$
  select date_trunc(p_unit,p_on)::date;
$$;
create function private.validate_recurrence_version() returns trigger language plpgsql set search_path = '' as $$
declare rule finance.recurrence_rules; begin
  if tg_op <> 'INSERT' then raise exception 'Recurrence versions are immutable' using errcode = '23514'; end if;
  select * into rule from finance.recurrence_rules where id = new.recurrence_rule_id;
  if (rule.unit = 'week' and new.weekday is null) or (rule.unit in ('month','year') and new.day_of_month is null) or (rule.unit = 'year' and new.month_of_year is null) then raise exception 'Recurrence anchor is required' using errcode = '23514'; end if;
  if new.effective_from_period <> private.recurrence_period(new.effective_from_period,rule.unit) then raise exception 'Version must begin on a nominal period boundary' using errcode = '23514'; end if;
  if rule.direction = 'outflow' and (new.certainty = 'conditional' or new.business_day_adjustment = 'previous') then raise exception 'Outflow cannot be conditional or adjusted to previous banking day' using errcode = '23514'; end if;
  if rule.direction = 'inflow' and new.payment_method <> 'account' then raise exception 'Recurring income must use an account' using errcode = '23514'; end if;
  if exists(select 1 from finance.ledger_accounts where id = new.counterpart_account_id and (owner_type = 'credit_card' or liquidity in ('cash','benefit','person'))) then raise exception 'Card statements cannot be recurring commitments' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger recurrence_version_valid before insert or update or delete on finance.recurrence_rule_versions for each row execute function private.validate_recurrence_version();
create function private.validate_recurrence_rule() returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.financial_space_id::text,0));
  if tg_op = 'UPDATE' and (new.direction <> old.direction or new.unit <> old.unit) then raise exception 'Recurrence direction and unit are immutable' using errcode = '23514'; end if;
  if new.is_main_income and new.archived_at is null and exists(select 1 from finance.recurrence_rules r where r.financial_space_id = new.financial_space_id and r.id <> new.id and r.is_main_income and r.archived_at is null and daterange(r.starts_on,r.ends_on,'[]') && daterange(new.starts_on,new.ends_on,'[]')) then raise exception 'Main income periods cannot overlap' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger recurrence_rule_valid before insert or update on finance.recurrence_rules for each row execute function private.validate_recurrence_rule();

create function private.generate_recurrence(p_rule uuid) returns jsonb language plpgsql set search_path = '' as $$
declare rule finance.recurrence_rules; version finance.recurrence_rule_versions; occurrence finance.commitments; period date; first_period date; horizon date; nominal date; distance integer; touched boolean; paid bigint; creates boolean;
  created_count integer := 0; updated_count integer := 0; preserved_count integer := 0; removed_count integer := 0; steps integer := 0;
begin
  select * into rule from finance.recurrence_rules where id = p_rule;
  if not found or rule.archived_at is not null then return '{}'::jsonb; end if;
  perform pg_advisory_xact_lock(hashtextextended(rule.financial_space_id::text,0));
  first_period := private.recurrence_period(rule.starts_on,rule.unit); period := first_period;
  horizon := (date_trunc('month',private.space_today(rule.financial_space_id))+interval '13 months - 1 day')::date;
  loop
    exit when period > greatest(horizon,coalesce(rule.generated_through,horizon));
    select * into version from finance.recurrence_rule_versions where recurrence_rule_id = rule.id and effective_from_period <= period order by version_number desc limit 1;
    if found then
      nominal := case rule.unit when 'week' then period+version.weekday-1 when 'month' then private.clamped_day(period,version.day_of_month) else private.clamped_day(make_date(extract(year from period)::integer,version.month_of_year,1),version.day_of_month) end;
      distance := case rule.unit when 'week' then (period-version.effective_from_period)/7 when 'month' then (extract(year from period)::integer-extract(year from version.effective_from_period)::integer)*12+extract(month from period)::integer-extract(month from version.effective_from_period)::integer else extract(year from period)::integer-extract(year from version.effective_from_period)::integer end;
      creates := distance % version.interval_count = 0 and nominal >= rule.starts_on and (rule.ends_on is null or nominal <= rule.ends_on);
      select * into occurrence from finance.commitments where recurrence_rule_id = rule.id and period_key = period and deleted_at is null;
      if found then
        touched := occurrence.user_modified_at is not null or occurrence.notes is not null or occurrence.cancelled_at is not null or exists(select 1 from finance.ledger_entries where commitment_id = occurrence.id);
        if touched then
          if rule.ends_on is not null and occurrence.nominal_due_on > rule.ends_on and occurrence.cancelled_at is null then
            select paid_cents into paid from finance.commitment_settlements where id = occurrence.id;
            if paid = 0 then
              update finance.commitments set cancelled_at = now(),cancellation_reason = 'Regra encerrada',version = commitments.version+1,updated_at = now() where id = occurrence.id;
              insert into finance.audit_logs(financial_space_id,action,entity_type,entity_id,before_data,after_data) values(rule.financial_space_id,'cancelled','commitment',occurrence.id,to_jsonb(occurrence),jsonb_build_object('reason','Regra encerrada'));
            end if;
          end if;
          preserved_count := preserved_count+1;
        elsif not creates then
          update finance.commitments set deleted_at = now(),version = commitments.version+1,updated_at = now() where id = occurrence.id;
          removed_count := removed_count+1;
          insert into finance.audit_logs(financial_space_id,action,entity_type,entity_id,before_data) values(rule.financial_space_id,'generation_removed','commitment',occurrence.id,to_jsonb(occurrence));
        elsif occurrence.recurrence_rule_version_id <> version.id or occurrence.nominal_due_on <> nominal then
          update finance.commitments set title = rule.title,certainty = version.certainty,due_amount_cents = version.amount_cents,estimated_amount_cents = version.amount_cents,category_id = version.category_id,counterpart_account_id = version.counterpart_account_id,
            nominal_due_on = nominal,effective_due_on = case when effective_due_on_overridden then effective_due_on else private.effective_due_date(rule.financial_space_id,nominal,version.business_day_adjustment) end,
            competence_month = (date_trunc('month',nominal)+make_interval(months => version.competence_offset_months))::date,payment_method = version.payment_method,payment_financial_account_id = version.payment_financial_account_id,payment_credit_card_id = version.payment_credit_card_id,
            reserve_id = version.reserve_id,recurrence_rule_version_id = version.id,version = commitments.version+1,updated_at = now() where id = occurrence.id;
          updated_count := updated_count+1;
          insert into finance.audit_logs(financial_space_id,action,entity_type,entity_id,before_data,after_data) values(rule.financial_space_id,'generation_updated','commitment',occurrence.id,to_jsonb(occurrence),jsonb_build_object('rule_version_id',version.id));
        end if;
      elsif creates then
        insert into finance.commitments(financial_space_id,kind,direction,certainty,title,category_id,counterpart_account_id,due_amount_cents,estimated_amount_cents,nominal_due_on,effective_due_on,competence_month,payment_method,payment_financial_account_id,payment_credit_card_id,recurrence_rule_id,recurrence_rule_version_id,period_key,reserve_id)
          values(rule.financial_space_id,'occurrence',rule.direction,version.certainty,rule.title,version.category_id,version.counterpart_account_id,version.amount_cents,version.amount_cents,nominal,private.effective_due_date(rule.financial_space_id,nominal,version.business_day_adjustment),
            (date_trunc('month',nominal)+make_interval(months => version.competence_offset_months))::date,version.payment_method,version.payment_financial_account_id,version.payment_credit_card_id,rule.id,version.id,period,version.reserve_id) returning * into occurrence;
        created_count := created_count+1;
        insert into finance.audit_logs(financial_space_id,action,entity_type,entity_id,after_data) values(rule.financial_space_id,'generation_created','commitment',occurrence.id,to_jsonb(occurrence));
      end if;
    end if;
    period := case rule.unit when 'week' then period+7 when 'month' then (period+interval '1 month')::date else (period+interval '1 year')::date end;
    steps := steps+1;
    if steps > 10000 then raise exception 'Recurrence history exceeds supported generation window' using errcode = '23514'; end if;
  end loop;
  update finance.recurrence_rules set generated_through = horizon,updated_at = now() where id = rule.id;
  return jsonb_build_object('created',created_count,'updated',updated_count,'preserved',preserved_count,'removed',removed_count);
end;
$$;
create function private.insert_recurrence_version(p_space uuid,p_rule uuid,p_number integer,p_period date,p_scope text,p_payload jsonb,p_actor uuid) returns uuid language plpgsql set search_path = '' as $$
declare version_id uuid; begin
  insert into finance.recurrence_rule_versions(financial_space_id,recurrence_rule_id,version_number,effective_from_period,change_scope,interval_count,day_of_month,weekday,month_of_year,business_day_adjustment,certainty,amount_cents,category_id,counterpart_account_id,payment_method,payment_financial_account_id,payment_credit_card_id,reserve_id,competence_offset_months,created_by)
    values(p_space,p_rule,p_number,p_period,p_scope,coalesce((p_payload->>'interval_count')::smallint,1),(p_payload->>'day_of_month')::smallint,(p_payload->>'weekday')::smallint,(p_payload->>'month_of_year')::smallint,
      coalesce(p_payload->>'business_day_adjustment','next'),coalesce(p_payload->>'certainty','confirmed'),(p_payload->>'amount_cents')::bigint,(p_payload->>'category_id')::uuid,(p_payload->>'counterpart_account_id')::uuid,p_payload->>'payment_method',
      (p_payload->>'payment_financial_account_id')::uuid,(p_payload->>'payment_credit_card_id')::uuid,(p_payload->>'reserve_id')::uuid,coalesce((p_payload->>'competence_offset_months')::smallint,0),p_actor) returning id into version_id;
  return version_id;
end;
$$;
create function api.create_recurrence_rule(p_space uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare rule_id uuid; start_on date := coalesce((p_payload->>'starts_on')::date,private.space_today(p_space)); unit text := coalesce(p_payload->>'unit','month'); version_id uuid; result jsonb; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  insert into finance.recurrence_rules(financial_space_id,direction,unit,title,is_main_income,is_subscription,starts_on,ends_on,created_by)
    values(p_space,p_payload->>'direction',unit,p_payload->>'title',coalesce((p_payload->>'is_main_income')::boolean,false),coalesce((p_payload->>'is_subscription')::boolean,false),start_on,(p_payload->>'ends_on')::date,auth.uid()) returning id into rule_id;
  version_id := private.insert_recurrence_version(p_space,rule_id,1,private.recurrence_period(start_on,unit),'initial',p_payload,auth.uid());
  result := private.generate_recurrence(rule_id);
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','recurrence_rule',rule_id,p_payload);
  return result || jsonb_build_object('id',rule_id,'version_id',version_id);
end;
$$;
create function api.change_recurrence_rule(p_space uuid,p_rule uuid,p_version integer,p_from_period date,p_scope text,p_changes jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare rule finance.recurrence_rules; previous finance.recurrence_rule_versions; period date; next_number integer; version_id uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into rule from finance.recurrence_rules where id = p_rule and financial_space_id = p_space for update;
  if not found then raise exception 'Recurrence rule not found' using errcode = 'P0002'; end if;
  if rule.version <> p_version then raise exception 'Rule changed; reload before editing' using errcode = '40001'; end if;
  if p_scope not in ('this_and_following','entire_series') then raise exception 'Invalid recurrence change scope' using errcode = '23514'; end if;
  period := private.recurrence_period(case when p_scope = 'entire_series' then rule.starts_on else p_from_period end,rule.unit);
  select min(c.period_key) into period from finance.commitments c join finance.commitment_settlements s on s.id = c.id where c.recurrence_rule_id = rule.id and c.period_key >= period and s.settlement_status in ('pending','partial');
  if period is null then period := private.recurrence_period(coalesce(rule.generated_through,private.space_today(p_space))+1,rule.unit); end if;
  select * into previous from finance.recurrence_rule_versions where recurrence_rule_id = rule.id and effective_from_period <= period order by version_number desc limit 1;
  select max(version_number)+1 into next_number from finance.recurrence_rule_versions where recurrence_rule_id = rule.id;
  version_id := private.insert_recurrence_version(p_space,rule.id,next_number,period,p_scope,to_jsonb(previous)||p_changes,auth.uid());
  update finance.recurrence_rules set version = version+1,updated_at = now() where id = rule.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'version_created','recurrence_rule',rule.id,to_jsonb(previous),jsonb_build_object('version_id',version_id,'changes',p_changes));
  return private.generate_recurrence(rule.id) || jsonb_build_object('version_id',version_id);
end;
$$;
create function api.end_recurrence_rule(p_space uuid,p_rule uuid,p_version integer,p_ends_on date) returns jsonb language plpgsql security definer set search_path = '' as $$
declare rule finance.recurrence_rules; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into rule from finance.recurrence_rules where id = p_rule and financial_space_id = p_space for update;
  if not found then raise exception 'Recurrence rule not found' using errcode = 'P0002'; end if;
  if rule.version <> p_version then raise exception 'Rule changed; reload before editing' using errcode = '40001'; end if;
  update finance.recurrence_rules set ends_on = p_ends_on,version = version+1,updated_at = now() where id = rule.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'ended','recurrence_rule',rule.id,to_jsonb(rule),jsonb_build_object('ends_on',p_ends_on));
  return private.generate_recurrence(rule.id);
end;
$$;
create function api.job_generate_occurrences() returns jsonb language plpgsql security definer set search_path = '' as $$
declare rule record; count integer := 0; begin
  for rule in select id from finance.recurrence_rules where archived_at is null order by financial_space_id,id loop perform private.generate_recurrence(rule.id); count := count+1; end loop;
  return jsonb_build_object('rules',count);
end;
$$;
revoke all on function private.recurrence_period(date,text),private.validate_recurrence_version(),private.validate_recurrence_rule(),private.generate_recurrence(uuid),private.insert_recurrence_version(uuid,uuid,integer,date,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function api.create_recurrence_rule(uuid,jsonb),api.change_recurrence_rule(uuid,uuid,integer,date,text,jsonb),api.end_recurrence_rule(uuid,uuid,integer,date),api.job_generate_occurrences() from public,anon,authenticated;
grant execute on function api.create_recurrence_rule(uuid,jsonb),api.change_recurrence_rule(uuid,uuid,integer,date,text,jsonb),api.end_recurrence_rule(uuid,uuid,integer,date) to authenticated;
grant execute on function api.job_generate_occurrences() to service_role;
commit;
