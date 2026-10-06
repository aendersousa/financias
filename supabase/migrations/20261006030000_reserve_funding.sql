begin;
create table finance.reserve_funding_events (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id),reserve_id uuid not null,
  scheduled_for date not null,occurred_on date not null,suggested_cents bigint not null check(suggested_cents>=0),contributed_cents bigint not null check(contributed_cents>=0),shortfall_cents bigint not null check(shortfall_cents>=0),
  contribution_id uuid,origin text not null check(origin in('automatic','confirmed','dismissed')),created_at timestamptz not null default now(),created_by uuid references auth.users(id),
  unique(reserve_id,scheduled_for),foreign key(financial_space_id,reserve_id) references finance.reserves(financial_space_id,id),foreign key(financial_space_id,contribution_id) references finance.reserve_contributions(financial_space_id,id)
);
alter table finance.reserve_funding_events enable row level security;
create policy member_read on finance.reserve_funding_events for select to authenticated using(private.is_member(financial_space_id));
revoke all on finance.reserve_funding_events from public,anon,authenticated;
grant select on finance.reserve_funding_events to authenticated;

-- The service job uses the same canonical read model without impersonating a user.
-- This private clone is never granted to API clients.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('api.free_to_spend_input(uuid,date)'::regprocedure);
  definition:=replace(definition,'api.free_to_spend_input','private.funding_free_input');
  definition:=replace(definition,'if not private.is_member(p_space) then raise exception ''Space permission required'' using errcode=''42501''; end if;','null;');
  execute definition;
  definition:=pg_get_functiondef('private.budget_month_summary_live(uuid,date)'::regprocedure);
  execute replace(definition,'if not private.is_member(p_space) then raise exception ''Space access denied'' using errcode = ''42501''; end if;','null;');
end $$;

create function private.reserve_funding_dates(p_space uuid,p_created date,p_target date) returns jsonb language plpgsql stable set search_path='' as $$
declare rule finance.recurrence_rules; version finance.recurrence_rule_versions; settings finance.space_settings; period date; nominal date; effective date; last_on date; next_on date; dates date[]:='{}'; distance integer; steps integer:=0; overridden date; immediate boolean;
begin
  select * into settings from finance.space_settings where financial_space_id=p_space;
  select * into rule from finance.recurrence_rules where financial_space_id=p_space and is_main_income and archived_at is null and starts_on<=greatest(p_target,p_created) and (ends_on is null or ends_on>=p_created) order by starts_on desc limit 1;
  if rule.id is null then
    period:=(date_trunc('month',p_created)-interval '1 month')::date;
    while period<=(date_trunc('month',greatest(p_target,p_created))+interval '1 month')::date loop
      effective:=private.clamped_day(period,settings.fallback_cycle_day);
      dates:=array_append(dates,effective); period:=(period+interval '1 month')::date;
    end loop;
  else
    period:=private.recurrence_period(rule.starts_on,rule.unit);
    while period<=(greatest(p_target,p_created)+interval '14 months')::date loop
      select * into version from finance.recurrence_rule_versions where recurrence_rule_id=rule.id and effective_from_period<=period order by version_number desc limit 1;
      if found then
        nominal:=case rule.unit when 'week' then period+version.weekday-1 when 'month' then private.clamped_day(period,version.day_of_month) else private.clamped_day(make_date(extract(year from period)::int,version.month_of_year,1),version.day_of_month) end;
        distance:=case rule.unit when 'week' then (period-version.effective_from_period)/7 when 'month' then (extract(year from period)::int-extract(year from version.effective_from_period)::int)*12+extract(month from period)::int-extract(month from version.effective_from_period)::int else extract(year from period)::int-extract(year from version.effective_from_period)::int end;
        if distance%version.interval_count=0 and nominal>=rule.starts_on and (rule.ends_on is null or nominal<=rule.ends_on) then
          effective:=private.effective_due_date(p_space,nominal,version.business_day_adjustment);
          select c.effective_due_on into overridden from finance.commitments c where c.recurrence_rule_id=rule.id and c.period_key=period and c.deleted_at is null and c.cancelled_at is null;
          dates:=array_append(dates,coalesce(overridden,effective));
        end if;
      end if;
      period:=case rule.unit when 'week' then period+7 when 'month' then (period+interval '1 month')::date else (period+interval '1 year')::date end;
      steps:=steps+1; if steps>20000 then raise exception 'Income calendar exceeds supported planning range' using errcode='23514'; end if;
    end loop;
    -- Before a newly configured income begins, the fallback defines the creation cycle.
    if not exists(select 1 from unnest(dates) d where d<=p_created) then dates:=array_append(dates,private.clamped_day((date_trunc('month',p_created)-interval '1 month')::date,settings.fallback_cycle_day)); end if;
  end if;
  select max(d) filter(where d<=p_created),min(d) filter(where d>p_created) into last_on,next_on from unnest(dates) d;
  if next_on is null then
    next_on:=private.clamped_day((date_trunc('month',p_created)+interval '1 month')::date,settings.fallback_cycle_day); dates:=array_append(dates,next_on);
  end if;
  immediate:=p_created<p_target and p_created-last_on<=floor((next_on-last_on)::numeric/2);
  if immediate then dates:=array_append(dates,p_created); end if;
  return jsonb_build_object('dates',coalesce((select jsonb_agg(d order by d) from(select distinct d from unnest(dates) d where d>=p_created and d<p_target) unique_dates),'[]'),'immediate',immediate,'lastOn',last_on,'nextOn',next_on,'incomeRuleId',rule.id);
end;
$$;
create function private.reserve_funding_plan(p_space uuid,p_reserve uuid,p_on date,p_scheduled date default null) returns jsonb language plpgsql stable set search_path='' as $$
declare reserve finance.reserves; created date; target date; dates jsonb; targets jsonb; item jsonb; balance bigint; cumulative bigint:=0; count_dates int; need bigint; suggestion bigint:=0; overdue bigint:=0; detail jsonb:='[]'; projection jsonb; capacity bigint; goals bigint;
begin
  select * into reserve from finance.reserves where financial_space_id=p_space and id=p_reserve;
  if not found then raise exception 'Reserve not found' using errcode='P0002'; end if;
  created:=(reserve.created_at at time zone (select timezone from finance.financial_spaces where id=p_space))::date;
  balance:=(private.reserve_balance(p_space,p_reserve,p_on)->>'balance_cents')::bigint;
  if reserve.reserve_type='provision' then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'dueOn',effective_due_on,'remainingCents',remaining_cents) order by effective_due_on,id),'[]'),max(effective_due_on) into targets,target from finance.commitment_settlements where financial_space_id=p_space and reserve_id=p_reserve and settlement_status in('pending','partial');
  elsif reserve.target_date is not null then targets:=jsonb_build_array(jsonb_build_object('dueOn',reserve.target_date,'remainingCents',reserve.target_amount_cents)); target:=reserve.target_date;
  else targets:='[]'; end if;
  if target is null then return jsonb_build_object('reserveId',p_reserve,'on',p_on,'suggestedCents',null,'contributionCents',null,'dates','[]'::jsonb,'targets','[]'::jsonb,'behindSchedule',false); end if;
  dates:=private.reserve_funding_dates(p_space,created,target);
  for item in select value from jsonb_array_elements(targets) loop
    cumulative:=cumulative+(item->>'remainingCents')::bigint;
    select count(*) into count_dates from jsonb_array_elements_text(dates->'dates') d where d::date>=coalesce(p_scheduled,p_on) and d::date<(item->>'dueOn')::date and not exists(select 1 from finance.reserve_funding_events e where e.reserve_id=p_reserve and e.scheduled_for=d::date);
    need:=greatest(0,cumulative-balance);
    if count_dates=0 then overdue:=greatest(overdue,need); else suggestion:=greatest(suggestion,ceil(need::numeric/count_dates)::bigint); end if;
    detail:=detail||jsonb_build_array(item||jsonb_build_object('cumulativeRemainingCents',cumulative,'remainingDates',count_dates,'suggestedCents',case when count_dates>0 then ceil(need::numeric/count_dates)::bigint else 0 end));
  end loop;
  projection:=private.calculate_free_to_spend(private.funding_free_input(p_space,p_on));
  select coalesce(sum((private.reserve_balance(p_space,r.id,p_on)->>'balance_cents')::bigint),0) into goals from finance.reserves r where r.financial_space_id=p_space and r.holding_mode='virtual' and r.reserve_type='goal' and r.status in('active','achieved') and r.archived_at is null;
  capacity:=greatest(0,(projection#>>'{conservative,valueCents}')::bigint+(select minimum_safety_reserve_cents from finance.space_settings where financial_space_id=p_space)+goals);
  return jsonb_build_object('reserveId',p_reserve,'on',p_on,'suggestedCents',suggestion,'contributionCents',case when reserve.reserve_type='provision' then least(suggestion,capacity) else suggestion end,'capacityCents',capacity,'capacityShortfallCents',case when reserve.reserve_type='provision' then greatest(0,suggestion-capacity) else 0 end,'overdueCents',overdue,'behindSchedule',overdue>0 or reserve.reserve_type='provision' and suggestion>capacity,'balanceCents',balance,'dates',dates->'dates','immediate',dates->'immediate','incomeRuleId',dates->'incomeRuleId','targets',detail);
end;
$$;
create function private.process_reserve_funding(p_space uuid,p_on date) returns integer language plpgsql set search_path='' as $$
declare reserve finance.reserves; dates jsonb; scheduled date; actual date; income_rule uuid; contribution uuid; plan jsonb; count_events int:=0; amount bigint; title text; member record;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_on>private.space_today(p_space) then return 0; end if;
  for reserve in select * from finance.reserves where financial_space_id=p_space and holding_mode='virtual' and status in('active','achieved') and archived_at is null and contribution_mode='automatic' and target_date is not null order by priority desc,target_date,id for update loop
    dates:=private.reserve_funding_dates(p_space,(reserve.created_at at time zone(select timezone from finance.financial_spaces where id=p_space))::date,reserve.target_date); income_rule:=(dates->>'incomeRuleId')::uuid;
    for scheduled in select d::date from jsonb_array_elements_text(dates->'dates') d where d::date<=p_on and not exists(select 1 from finance.reserve_funding_events where reserve_id=reserve.id and scheduled_for=d::date) order by d::date loop
      actual:=scheduled;
      if income_rule is not null and scheduled<>(reserve.created_at at time zone(select timezone from finance.financial_spaces where id=p_space))::date then
        select max(t.occurred_on) into actual from finance.commitments c join finance.commitment_settlements s on s.id=c.id join finance.ledger_entries e on e.commitment_id=c.id join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' where c.recurrence_rule_id=income_rule and c.effective_due_on=scheduled and s.settlement_status='settled';
        if actual is null or actual>p_on then continue; end if;
      end if;
      if exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',actual)::date and reopened_at is null) then continue; end if;
      plan:=private.reserve_funding_plan(p_space,reserve.id,actual,scheduled); amount:=coalesce((plan->>'contributionCents')::bigint,0); contribution:=null;
      if amount>0 then
        insert into finance.reserve_contributions(financial_space_id,reserve_id,kind,origin,amount_cents,occurred_on,note) values(p_space,reserve.id,'contribution','automatic',amount,actual,'Aporte do ciclo '||scheduled::text) returning id into contribution;
        update finance.reserves set version=version+1,updated_at=now() where id=reserve.id;
      end if;
      insert into finance.reserve_funding_events(financial_space_id,reserve_id,scheduled_for,occurred_on,suggested_cents,contributed_cents,shortfall_cents,contribution_id,origin) values(p_space,reserve.id,scheduled,actual,coalesce((plan->>'suggestedCents')::bigint,0),amount,coalesce((plan->>'capacityShortfallCents')::bigint,0),contribution,'automatic');
      insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'reserve_funding_processed','reserve',reserve.id,plan||jsonb_build_object('scheduled_for',scheduled,'occurred_on',actual));
      if coalesce((plan->>'capacityShortfallCents')::bigint,0)>0 then
        for member in select user_id,role from finance.financial_space_members where financial_space_id=p_space and status='active' loop perform private.emit_notification(p_space,member.user_id,member.role,'provision_behind','reserves','reserve',reserve.id,scheduled::text,'attention','Provisão atrasada: '||reserve.name,plan); end loop;
      end if;
      count_events:=count_events+1;
    end loop;
  end loop;
  return count_events;
end;
$$;
create function api.reserve_funding_summary(p_space uuid,p_on date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
  if p_on is not null and not isfinite(p_on) then raise exception 'Projection date must be finite' using errcode='23514'; end if;
  return jsonb_build_object('plans',coalesce((select jsonb_agg(private.reserve_funding_plan(p_space,id,coalesce(p_on,private.space_today(p_space))) order by priority desc,target_date,id) from finance.reserves where financial_space_id=p_space and status in('active','achieved') and holding_mode='virtual' and archived_at is null),'[]'),'events',coalesce((select jsonb_agg(to_jsonb(e) order by scheduled_for desc) from finance.reserve_funding_events e where financial_space_id=p_space),'[]'));
end;
$$;
create function api.configure_reserve_plan(p_space uuid,p_reserve uuid,p_version integer,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.reserves; quota jsonb; paid bigint; commitment finance.commitments; total bigint:=0; last_due date; title text;
begin
  perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into previous from finance.reserves where financial_space_id=p_space and id=p_reserve and status in('active','achieved') for update;
  if not found then raise exception 'Active reserve required' using errcode='23514'; end if;
  if previous.version is distinct from p_version then raise exception 'Reserve changed; reload before editing' using errcode='40001'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_payload) key where key not in('contribution_mode','priority','alert_thresholds','is_emergency_reserve','quotas')) then raise exception 'Invalid reserve plan fields' using errcode='23514'; end if;
  if p_payload ? 'quotas' then
    if previous.reserve_type<>'provision' or jsonb_typeof(p_payload->'quotas') is distinct from 'array' or jsonb_array_length(p_payload->'quotas') not between 1 and 600 then raise exception 'Provide provision quotas' using errcode='23514'; end if;
    if exists(select 1 from finance.commitment_settlements where reserve_id=p_reserve and paid_cents<>0) then raise exception 'Cancel linked settlements before changing provision quotas' using errcode='23514'; end if;
    for commitment in select * from finance.commitments where reserve_id=p_reserve and cancelled_at is null and deleted_at is null for update loop
      if exists(select 1 from finance.period_closings where financial_space_id=p_space and month=commitment.competence_month and reopened_at is null) then raise exception 'Period is closed' using errcode='23514'; end if;
    end loop;
    update finance.commitments set cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason='Cotas substituídas pelo novo plano',version=version+1,updated_at=now() where reserve_id=p_reserve and cancelled_at is null and deleted_at is null;
    for quota in select value from jsonb_array_elements(p_payload->'quotas') loop
      if (quota->>'due_on')::date is null or not isfinite((quota->>'due_on')::date) or (quota->>'amount_cents')::bigint is null or (quota->>'amount_cents')::bigint not between 1 and 9007199254740991 then raise exception 'Invalid provision quota' using errcode='23514'; end if;
      if exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',(quota->>'due_on')::date)::date and reopened_at is null) then raise exception 'Period is closed' using errcode='23514'; end if;
      total:=total+(quota->>'amount_cents')::bigint; last_due:=greatest(last_due,(quota->>'due_on')::date);
      perform api.create_commitment(p_space,jsonb_build_object('title',coalesce(nullif(trim(quota->>'title'),''),previous.name),'direction','outflow','certainty','confirmed','amount_cents',(quota->>'amount_cents')::bigint,'due_on',quota->>'due_on','category_id',previous.category_id,'payment_method','account','payment_financial_account_id',previous.financial_account_id,'reserve_id',p_reserve));
    end loop;
  end if;
  if p_payload ? 'alert_thresholds' and (jsonb_typeof(p_payload->'alert_thresholds') is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(p_payload->'alert_thresholds') threshold where threshold::int not between 1 and 100)) then raise exception 'Alert thresholds must be percentages from 1 to 100' using errcode='23514'; end if;
  update finance.reserves set contribution_mode=coalesce(p_payload->>'contribution_mode',contribution_mode),priority=coalesce((p_payload->>'priority')::smallint,priority),is_emergency_reserve=coalesce((p_payload->>'is_emergency_reserve')::boolean,is_emergency_reserve),alert_thresholds=case when p_payload ? 'alert_thresholds' then array(select distinct value::smallint from jsonb_array_elements_text(p_payload->'alert_thresholds') order by value::smallint) else alert_thresholds end,target_amount_cents=case when p_payload ? 'quotas' then total else target_amount_cents end,target_date=case when p_payload ? 'quotas' then last_due else target_date end,version=version+1,updated_at=now() where id=p_reserve;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'reserve_plan_changed','reserve',p_reserve,to_jsonb(previous),p_payload);
  perform private.process_reserve_funding(p_space,private.space_today(p_space));
  return p_reserve;
end;
$$;
create function api.process_reserve_funding(p_space uuid) returns integer language plpgsql security definer set search_path='' as $$
begin perform private.require_admin(p_space); return private.process_reserve_funding(p_space,private.space_today(p_space)); end;
$$;
create function api.confirm_reserve_funding(p_space uuid,p_reserve uuid,p_scheduled date,p_amount_cents bigint,p_dismiss boolean default false,p_on date default null,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare reserve finance.reserves; previous finance.reserve_funding_events; dates jsonb; actual date:=coalesce(p_on,private.space_today(p_space)); plan jsonb; contribution uuid; result uuid;
begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into previous from finance.reserve_funding_events where reserve_id=p_reserve and scheduled_for=p_scheduled;
  if found then
    if previous.financial_space_id is distinct from p_space or previous.occurred_on is distinct from actual or previous.contributed_cents is distinct from p_amount_cents or previous.origin is distinct from (case when p_dismiss then 'dismissed' else 'confirmed' end) then raise exception 'Contribution date already processed with different instructions' using errcode='23505'; end if;
    return previous.id;
  end if;
  select * into reserve from finance.reserves where financial_space_id=p_space and id=p_reserve and status in('active','achieved') and holding_mode='virtual' and contribution_mode='manual' for update;
  if not found then raise exception 'Active manual virtual reserve required' using errcode='23514'; end if;
  if p_scheduled is null or actual is null or not isfinite(actual) or not isfinite(p_scheduled) or p_scheduled>actual or actual>private.space_today(p_space) or p_dismiss is null or p_amount_cents is null or p_amount_cents not between 0 and 9007199254740991 or (p_dismiss and p_amount_cents<>0) or (not p_dismiss and p_amount_cents=0) then raise exception 'Invalid manual funding instruction' using errcode='23514'; end if;
  dates:=private.reserve_funding_dates(p_space,(reserve.created_at at time zone(select timezone from finance.financial_spaces where id=p_space))::date,reserve.target_date);
  if not exists(select 1 from jsonb_array_elements_text(dates->'dates') d where d::date=p_scheduled) then raise exception 'Choose a scheduled contribution date' using errcode='23514'; end if;
  if exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',actual)::date and reopened_at is null) then raise exception 'Period is closed' using errcode='23514'; end if;
  plan:=private.reserve_funding_plan(p_space,p_reserve,actual,p_scheduled);
  if not p_dismiss then contribution:=api.reserve_contribution(p_space,p_reserve,'contribution',p_amount_cents,actual,'Confirmação do aporte de '||p_scheduled::text,p_client_uuid); end if;
  insert into finance.reserve_funding_events(financial_space_id,reserve_id,scheduled_for,occurred_on,suggested_cents,contributed_cents,shortfall_cents,contribution_id,origin,created_by) values(p_space,p_reserve,p_scheduled,actual,coalesce((plan->>'suggestedCents')::bigint,0),p_amount_cents,greatest(0,coalesce((plan->>'suggestedCents')::bigint,0)-p_amount_cents),contribution,case when p_dismiss then 'dismissed' else 'confirmed' end,auth.uid()) returning id into result;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'reserve_funding_confirmed','reserve_funding_event',result,jsonb_build_object('reserve',p_reserve,'scheduled_for',p_scheduled,'amount_cents',p_amount_cents,'dismissed',p_dismiss));
  return result;
end;
$$;
create function api.job_reserve_funding() returns jsonb language plpgsql security definer set search_path='' as $$
declare space record; events int:=0;
begin
  for space in select id from finance.financial_spaces where archived_at is null order by id loop events:=events+private.process_reserve_funding(space.id,private.space_today(space.id)); end loop;
  return jsonb_build_object('events',events);
end;
$$;
do $$ declare definition text; begin
  definition:=pg_get_functiondef('api.create_reserve(uuid,jsonb)'::regprocedure);
  definition:=replace(definition,'''manual'',coalesce((p_payload->>''is_emergency_reserve'')::boolean,false)',
    'coalesce(p_payload->>''contribution_mode'',''manual''),coalesce((p_payload->>''is_emergency_reserve'')::boolean,false)');
  definition:=replace(definition,'return result;','perform private.process_reserve_funding(p_space,private.space_today(p_space)); return result;');
  execute definition;
  definition:=pg_get_functiondef('api.settle_commitment(uuid,uuid,bigint,date,text,uuid,uuid)'::regprocedure);
  definition:=replace(definition,'return tx_id;','perform private.process_reserve_funding(p_space,p_on); return tx_id;');
  execute definition;
end $$;
revoke all on function private.funding_free_input(uuid,date),private.reserve_funding_dates(uuid,date,date),private.reserve_funding_plan(uuid,uuid,date,date),private.process_reserve_funding(uuid,date),api.reserve_funding_summary(uuid,date),api.configure_reserve_plan(uuid,uuid,integer,jsonb),api.process_reserve_funding(uuid),api.confirm_reserve_funding(uuid,uuid,date,bigint,boolean,date,uuid),api.job_reserve_funding() from public,anon,authenticated;
grant execute on function api.reserve_funding_summary(uuid,date),api.configure_reserve_plan(uuid,uuid,integer,jsonb),api.process_reserve_funding(uuid),api.confirm_reserve_funding(uuid,uuid,date,bigint,boolean,date,uuid) to authenticated;
grant execute on function api.job_reserve_funding() to service_role;
commit;
