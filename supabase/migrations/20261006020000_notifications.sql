begin;
create table finance.notifications (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,type text not null,
  severity text not null check(severity in('urgent','attention','informational')),source_type text not null,source_id uuid not null,
  dedup_key text not null,state_key text,title text not null,payload jsonb not null default '{}' check(jsonb_typeof(payload)='object'),
  read_at timestamptz,archived_at timestamptz,resolved_at timestamptz,version integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  unique(user_id,financial_space_id,dedup_key)
);
create index notifications_inbox on finance.notifications(user_id,financial_space_id,created_at desc);
alter table finance.notifications enable row level security;
create policy own_member_read on finance.notifications for select to authenticated using(user_id=auth.uid() and private.is_member(financial_space_id));
revoke all on finance.notifications from public,anon,authenticated;
grant select on finance.notifications to authenticated;

-- Threshold observations survive reads, archives and refunds. A jump to 100%
-- marks the lower budget thresholds as crossed without creating extra alerts.
create table private.notification_crossings (
  user_id uuid not null references auth.users(id) on delete cascade,financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  type text not null,source_id uuid not null,period date not null,threshold smallint not null,
  created_at timestamptz not null default clock_timestamp(),primary key(user_id,financial_space_id,type,source_id,period,threshold)
);
create table private.notification_states (
  user_id uuid not null references auth.users(id) on delete cascade,financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  state_key text not null,active boolean not null default true,generation integer not null default 1,
  primary key(user_id,financial_space_id,state_key)
);
revoke all on private.notification_crossings,private.notification_states from public,anon,authenticated;

create function private.notification_enabled(p_user uuid,p_role text,p_type text,p_category text,p_severity text) returns boolean language sql stable set search_path='' as $$
  select case when p_role='viewer' then coalesce(s.notification_preferences->p_type,s.notification_preferences->p_category,'false'::jsonb)='true'::jsonb
    when p_severity='urgent' then true
    else coalesce(s.notification_preferences->p_type,s.notification_preferences->p_category,'true'::jsonb)<>'false'::jsonb end
  from (select 1) anchor left join finance.user_settings s on s.user_id=p_user;
$$;
create function private.emit_notification(p_space uuid,p_user uuid,p_role text,p_type text,p_category text,p_source_type text,p_source uuid,p_key text,p_severity text,p_title text,p_payload jsonb,p_state boolean default false,p_reissue boolean default true) returns void language plpgsql set search_path='' as $$
declare generation integer; request_key text:=p_type||':'||p_source::text||':'||p_key; begin
  if p_state then
    insert into private.notification_states(user_id,financial_space_id,state_key) values(p_user,p_space,request_key)
      on conflict(user_id,financial_space_id,state_key) do update set generation=notification_states.generation+case when notification_states.active then 0 else 1 end,active=true
      returning notification_states.generation into generation;
  end if;
  if not private.notification_enabled(p_user,p_role,p_type,p_category,p_severity) then return; end if;
  insert into finance.notifications(financial_space_id,user_id,type,severity,source_type,source_id,dedup_key,state_key,title,payload)
    values(p_space,p_user,p_type,p_severity,p_source_type,p_source,request_key||case when p_state and p_reissue then ':'||generation::text else '' end,case when p_state then request_key end,p_title,p_payload)
    on conflict(user_id,financial_space_id,dedup_key) do nothing;
end;
$$;

create function private.collect_notifications(p_space uuid,p_user uuid,p_dates boolean default true,p_at timestamptz default clock_timestamp()) returns void language plpgsql set search_path='' as $$
declare member_role text; day date; month date; dated boolean; item record; budget jsonb; reserve record; reserve_amount bigint; budget_amount bigint; consumed bigint;
  threshold smallint; crossed smallint; highest smallint; states text[]:='{}'; label text; total_reserved bigint:=0; cash bigint;
begin
  select m.role,s.timezone into member_role,label from finance.financial_space_members m join finance.financial_spaces s on s.id=m.financial_space_id where m.financial_space_id=p_space and m.user_id=p_user and m.status='active' and s.archived_at is null;
  if not found then return; end if;
  day:=(p_at at time zone label)::date; month:=date_trunc('month',day)::date; dated:=p_dates and extract(hour from p_at at time zone label)>=8;
  for item in
    select case when c.effective_due_on<day then 'agenda_overdue' when c.effective_due_on=day then 'agenda_due_today' else 'agenda_due_tomorrow' end as type,
      'agenda'::text as category,'commitment'::text as source_type,c.id as source_id,case when c.effective_due_on<day then 'once' else c.effective_due_on::text end as key,
      case when c.effective_due_on<day then 'urgent' else 'attention' end as severity,
      c.title||case when c.effective_due_on<day then ' está atrasada' when c.effective_due_on=day then ' vence hoje' else ' vence amanhã' end as title,
      jsonb_build_object('title',c.title,'due_on',c.effective_due_on,'remaining_cents',c.remaining_cents) as payload,c.effective_due_on<day as state,false as reissue
      from finance.commitment_settlements c where (dated or c.effective_due_on<day) and c.financial_space_id=p_space and c.direction='outflow' and c.settlement_status in('pending','partial') and c.remaining_cents>0 and c.effective_due_on<=day+1
    union all
    select case when s.effective_due_on<day then 'statement_overdue' when s.effective_due_on=day then 'statement_due_today' else 'statement_due_tomorrow' end,
      'cards','card_statement',s.id,case when s.effective_due_on<day then 'once' else s.effective_due_on::text end,case when s.effective_due_on<day then 'urgent' else 'attention' end,
      'Fatura de '||c.name||case when s.effective_due_on<day then ' está atrasada' when s.effective_due_on=day then ' vence hoje' else ' vence amanhã' end,
      jsonb_build_object('title',c.name,'due_on',s.effective_due_on,'remaining_cents',s.remaining_cents),s.effective_due_on<day,false
      from finance.statement_amounts s join finance.credit_cards c on c.id=s.credit_card_id where (dated or s.effective_due_on<day) and s.financial_space_id=p_space and c.status<>'archived' and s.remaining_cents>0 and s.effective_due_on<=day+1
    union all
    select 'statement_closes_today','cards','card_statement',s.id,s.closing_on::text,'informational','Fatura de '||c.name||' fecha hoje',jsonb_build_object('title',c.name,'closing_on',s.closing_on,'amount_cents',a.amount_cents,'purchases_go_next',c.closing_day_purchase_goes_next),false,false
      from finance.card_statements s join finance.credit_cards c on c.id=s.credit_card_id join finance.statement_amounts a on a.id=s.id where dated and s.financial_space_id=p_space and c.status='active' and s.status<>'future' and s.closing_on=day
    union all
    select 'card_charges','cards','card_statement',s.id,'state','attention','Confirme os encargos de '||c.name,jsonb_build_object('title',c.name,'reference_month',s.reference_month),true,true
      from finance.card_statements s join finance.credit_cards c on c.id=s.credit_card_id where s.financial_space_id=p_space and c.status<>'archived' and s.charges_to_confirm
    union all
    select 'card_installment_required','cards','card_statement',s.id,'state','urgent','Saldo de '||c.name||' precisa ser parcelado',jsonb_build_object('title',c.name,'reference_month',s.reference_month),true,true
      from finance.card_statements s join finance.credit_cards c on c.id=s.credit_card_id where s.financial_space_id=p_space and c.status<>'archived' and s.balance_to_install
  loop
    if item.state then states:=array_append(states,item.type||':'||item.source_id::text||':'||item.key); end if;
    if dated or item.type not in('agenda_overdue','statement_overdue') then perform private.emit_notification(p_space,p_user,member_role,item.type,item.category,item.source_type,item.source_id,item.key,item.severity,item.title,item.payload,item.state,item.reissue); end if;
  end loop;

  for budget in select value from jsonb_array_elements(private.budget_month_summary_live(p_space,month)) loop
    budget_amount:=(budget->>'amount_cents')::bigint; consumed:=(budget->>'consumed_cents')::bigint; highest:=null;
    foreach threshold in array array[80,90,100]::smallint[] loop
      if consumed>0 and (budget_amount=0 or consumed::numeric*100>=budget_amount::numeric*threshold) then
        crossed:=null;
        insert into private.notification_crossings(user_id,financial_space_id,type,source_id,period,threshold) values(p_user,p_space,'budget_threshold',(budget->>'id')::uuid,month,threshold) on conflict do nothing returning notification_crossings.threshold into crossed;
        if crossed is not null then highest:=threshold; end if;
      end if;
    end loop;
    if highest is not null then
      select c.name into label from finance.categories c where c.id=(budget->>'category_id')::uuid;
      perform private.emit_notification(p_space,p_user,member_role,'budget_threshold','budgets','budget',(budget->>'id')::uuid,month::text||':'||highest::text,'attention',label||': orçamento atingiu '||highest::text||'%',jsonb_build_object('title',label,'month',month,'threshold',highest,'consumed_cents',consumed,'amount_cents',budget_amount));
    end if;
  end loop;
  for reserve in select * from finance.reserves where financial_space_id=p_space and archived_at is null and status in('active','achieved') loop
    reserve_amount:=(private.reserve_balance(p_space,reserve.id,day)->>'balance_cents')::bigint;
    if reserve.holding_mode='virtual' then total_reserved:=total_reserved+reserve_amount; end if;
    if reserve.reserve_type='goal' then
      foreach threshold in array reserve.alert_thresholds loop
        if threshold between 1 and 100 and reserve_amount::numeric*100>=reserve.target_amount_cents::numeric*threshold then
          crossed:=null;
          insert into private.notification_crossings(user_id,financial_space_id,type,source_id,period,threshold) values(p_user,p_space,'goal_threshold',reserve.id,'0001-01-01',threshold) on conflict do nothing returning notification_crossings.threshold into crossed;
          if crossed is not null then perform private.emit_notification(p_space,p_user,member_role,'goal_threshold','goals','reserve',reserve.id,threshold::text,'informational',reserve.name||' atingiu '||threshold::text||'%',jsonb_build_object('title',reserve.name,'threshold',threshold,'balance_cents',reserve_amount,'target_cents',reserve.target_amount_cents)); end if;
        end if;
      end loop;
    end if;
  end loop;
  for item in select f.id,f.name,private.account_balance_on(p_space,f.ledger_account_id,day) as cash,
    (select coalesce(sum((private.reserve_balance(p_space,r.id,day)->>'balance_cents')::bigint),0) from finance.reserves r where r.financial_account_id=f.id and r.holding_mode='virtual' and r.status in('active','achieved') and r.archived_at is null) as reserved,
    (select coalesce(jsonb_agg(r.name order by r.name),'[]') from finance.reserves r where r.financial_account_id=f.id and r.holding_mode='virtual' and r.status in('active','achieved') and r.archived_at is null) as names
    from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id where f.financial_space_id=p_space and a.liquidity='cash' and f.deleted_at is null
  loop
    if item.reserved>0 and item.reserved>item.cash then
      states:=array_append(states,'reserve_uncovered:'||item.id::text||':state');
      perform private.emit_notification(p_space,p_user,member_role,'reserve_uncovered','reserves','financial_account',item.id,'state','urgent','Reservas sem cobertura em '||item.name,jsonb_build_object('title',item.name,'uncovered_cents',item.reserved-item.cash,'reserves',item.names),true);
    end if;
  end loop;
  select coalesce(sum(b.balance_cents),0) into cash from finance.account_balances b where b.financial_space_id=p_space and b.liquidity='cash';
  if total_reserved>0 and total_reserved>cash then
    states:=array_append(states,'reserve_uncovered:'||p_space::text||':state');
    perform private.emit_notification(p_space,p_user,member_role,'reserve_uncovered','reserves','financial_space',p_space,'state','urgent','As reservas superam o saldo em contas',jsonb_build_object('uncovered_cents',total_reserved-cash),true);
  end if;
  update finance.notifications set resolved_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 where user_id=p_user and financial_space_id=p_space and state_key is not null and resolved_at is null and not(state_key=any(states));
  update private.notification_states set active=false where user_id=p_user and financial_space_id=p_space and active and not(state_key=any(states));
end;
$$;
create function private.refresh_space_notifications(p_space uuid,p_dates boolean default false) returns void language plpgsql set search_path='' as $$
declare member record; begin
  perform pg_advisory_xact_lock(hashtextextended('notifications:'||p_space::text,0));
  for member in select user_id from finance.financial_space_members where financial_space_id=p_space and status='active' order by user_id loop perform private.collect_notifications(p_space,member.user_id,p_dates); end loop;
end;
$$;
create function private.notifications_after_event() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.refresh_space_notifications(new.financial_space_id); return null; end;
$$;
create constraint trigger notify_ledger after insert or update on finance.ledger_transactions deferrable initially deferred for each row execute function private.notifications_after_event();
create constraint trigger notify_reserve after insert or update on finance.reserves deferrable initially deferred for each row execute function private.notifications_after_event();
create constraint trigger notify_contribution after insert or update on finance.reserve_contributions deferrable initially deferred for each row execute function private.notifications_after_event();
create constraint trigger notify_budget after insert or update on finance.budgets deferrable initially deferred for each row execute function private.notifications_after_event();
create constraint trigger notify_budget_override after insert or update on finance.budget_month_overrides deferrable initially deferred for each row execute function private.notifications_after_event();
create constraint trigger notify_card_statement after insert or update on finance.card_statements deferrable initially deferred for each row execute function private.notifications_after_event();

create function api.daily_alerts(p_space uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('notifications:'||p_space::text,0));
  perform private.collect_notifications(p_space,auth.uid());
  select jsonb_build_object('notifications',coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id),'[]'),
    'unread_count',count(*) filter(where n.read_at is null and n.archived_at is null and n.resolved_at is null)) into result from finance.notifications n where n.financial_space_id=p_space and n.user_id=auth.uid();
  return result;
end;
$$;
create function api.manage_notification(p_space uuid,p_notification uuid,p_version integer,p_action text) returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.notifications; begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('notifications:'||p_space::text,0));
  select * into previous from finance.notifications where id=p_notification and financial_space_id=p_space and user_id=auth.uid() for update;
  if not found then raise exception 'Notification not found' using errcode='P0002'; end if;
  if previous.version is distinct from p_version then raise exception 'Notification changed; reload before editing' using errcode='40001'; end if;
  if p_action='read' then update finance.notifications set read_at=coalesce(read_at,clock_timestamp()),version=version+1,updated_at=clock_timestamp() where id=p_notification and read_at is null;
  elsif p_action='unread' then update finance.notifications set read_at=null,version=version+1,updated_at=clock_timestamp() where id=p_notification and read_at is not null;
  elsif p_action='archive' then update finance.notifications set archived_at=coalesce(archived_at,clock_timestamp()),version=version+1,updated_at=clock_timestamp() where id=p_notification and archived_at is null;
  elsif p_action='restore' then update finance.notifications set archived_at=null,version=version+1,updated_at=clock_timestamp() where id=p_notification and archived_at is not null;
  else raise exception 'Unknown notification action' using errcode='23514'; end if;
  return previous.id;
end;
$$;
create function api.read_notifications(p_space uuid,p_versions jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare item record; total integer:=0; begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_versions) is distinct from 'array' or jsonb_array_length(p_versions)>10000 or (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_versions)) then raise exception 'Invalid notification versions' using errcode='23514'; end if;
  for item in select (value->>'id')::uuid as id,(value->>'version')::integer as version from jsonb_array_elements(p_versions) order by 1 loop
    perform api.manage_notification(p_space,item.id,item.version,'read'); total:=total+1;
  end loop;
  return total;
end;
$$;
create function api.job_daily_alerts(p_space uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare space record; begin
  for space in select id from finance.financial_spaces where archived_at is null and (p_space is null or id=p_space) order by id loop perform private.refresh_space_notifications(space.id,true); end loop;
end;
$$;
revoke all on function private.notification_enabled(uuid,text,text,text,text),private.emit_notification(uuid,uuid,text,text,text,text,uuid,text,text,text,jsonb,boolean,boolean),private.collect_notifications(uuid,uuid,boolean,timestamptz),private.refresh_space_notifications(uuid,boolean),private.notifications_after_event() from public,anon,authenticated;
revoke all on function api.daily_alerts(uuid),api.manage_notification(uuid,uuid,integer,text),api.read_notifications(uuid,jsonb),api.job_daily_alerts(uuid) from public,anon,authenticated;
grant execute on function api.daily_alerts(uuid),api.manage_notification(uuid,uuid,integer,text),api.read_notifications(uuid,jsonb) to authenticated;
grant execute on function api.job_daily_alerts(uuid) to service_role;
commit;
