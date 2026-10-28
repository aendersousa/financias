begin;
create table finance.account_balance_checks (
 id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id),financial_account_id uuid not null,
 checked_on date not null,statement_balance_cents bigint not null check(abs(statement_balance_cents::numeric) <= 9007199254740991),
 application_balance_cents bigint not null,difference_cents bigint not null,
 client_uuid uuid,created_at timestamptz not null default clock_timestamp(),created_by uuid references auth.users(id),
 unique(financial_space_id,id),unique(financial_space_id,client_uuid),foreign key(financial_space_id,financial_account_id) references finance.financial_accounts(financial_space_id,id)
);
alter table finance.account_balance_checks enable row level security;
create policy member_read on finance.account_balance_checks for select to authenticated using(private.is_member(financial_space_id));
revoke all on finance.account_balance_checks from public,anon,authenticated; grant select on finance.account_balance_checks to authenticated;
create table private.income_notification_deferrals (
 financial_space_id uuid not null,user_id uuid not null,commitment_id uuid not null,deferred_until date not null,
 primary key(financial_space_id,user_id,commitment_id),foreign key(financial_space_id,commitment_id) references finance.commitments(financial_space_id,id),foreign key(user_id) references auth.users(id)
);
revoke all on private.income_notification_deferrals from public,anon,authenticated;
-- Extend the shared UUID namespace without dropping operations from earlier modules.
do $$ declare definition text; begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='finance.operation_requests'::regclass and conname='operation_requests_operation_check';
 alter table finance.operation_requests drop constraint operation_requests_operation_check;
 execute 'alter table finance.operation_requests add constraint operation_requests_operation_check check ('||substring(definition from 7)||' or operation = ''account_balance_check'')';
end $$;
create function api.check_account_balance(p_space uuid,p_account uuid,p_on date,p_statement_balance_cents bigint,p_client_uuid uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare request jsonb; result uuid; ledger uuid; current_balance bigint; begin
 perform private.require_writer(p_space);
 request := jsonb_build_object('account',p_account,'on',p_on,'statement_balance_cents',p_statement_balance_cents);
 result := private.loan_request_result(p_space,p_client_uuid,'account_balance_check',request);
 if result is not null then return (select to_jsonb(c) from finance.account_balance_checks c where id = result); end if;
 select ledger_account_id into ledger from finance.financial_accounts where id = p_account and financial_space_id = p_space and deleted_at is null;
 if ledger is null or p_on is null or not isfinite(p_on) or p_on > private.space_today(p_space) or p_statement_balance_cents is null or abs(p_statement_balance_cents::numeric) > 9007199254740991 then raise exception 'Invalid account balance check' using errcode = '23514'; end if;
 current_balance := private.account_balance_on(p_space,ledger,p_on);
 if abs((p_statement_balance_cents::numeric-current_balance)) > 9007199254740991 then raise exception 'Balance difference exceeds safe cents' using errcode = '23514'; end if;
 insert into finance.account_balance_checks(financial_space_id,financial_account_id,checked_on,statement_balance_cents,application_balance_cents,difference_cents,client_uuid,created_by) values(p_space,p_account,p_on,p_statement_balance_cents,current_balance,p_statement_balance_cents-current_balance,p_client_uuid,auth.uid()) returning id into result;
 perform private.record_loan_request(p_space,p_client_uuid,'account_balance_check',request,result);
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'balance_checked','account_balance_check',result,request || jsonb_build_object('application_balance_cents',current_balance,'difference_cents',p_statement_balance_cents-current_balance));
 perform private.refresh_space_notifications(p_space,false);
 return (select to_jsonb(c) from finance.account_balance_checks c where id = result);
end;
$$;
create function api.defer_income_notification(p_space uuid,p_commitment uuid) returns date language plpgsql security definer set search_path = '' as $$
declare tomorrow date := private.space_today(p_space)+1; begin
 perform private.require_writer(p_space);
 if not exists(select 1 from finance.commitments c join finance.recurrence_rules r on r.id = c.recurrence_rule_id join finance.commitment_settlements s on s.id = c.id where c.id = p_commitment and c.financial_space_id = p_space and r.is_main_income and s.remaining_cents > 0 and s.settlement_status in('pending','partial')) then raise exception 'Open main income occurrence required' using errcode = '23514'; end if;
 insert into private.income_notification_deferrals(financial_space_id,user_id,commitment_id,deferred_until) values(p_space,auth.uid(),p_commitment,tomorrow) on conflict(financial_space_id,user_id,commitment_id) do update set deferred_until = excluded.deferred_until;
 update finance.notifications set read_at = coalesce(read_at,clock_timestamp()),version = version+1 where financial_space_id = p_space and user_id = auth.uid() and type = 'main_income_confirm' and source_id = p_commitment and read_at is null;
 return tomorrow;
end;
$$;
create function private.collect_extended_notifications(p_space uuid,p_user uuid,p_role text,p_day date,p_dates boolean,p_at timestamptz) returns text[] language plpgsql set search_path = '' as $$
declare states text[] := '{}'; item record; input jsonb; calculation jsonb; free bigint; horizon date; month date := date_trunc('month',p_day)::date; local_hour integer; projection_error text; begin
 select extract(hour from p_at at time zone timezone)::integer into local_hour from finance.financial_spaces where id = p_space;
 for item in select f.id,f.name,a.liquidity,private.account_balance_on(p_space,f.ledger_account_id,p_day) as balance from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.financial_space_id = p_space and f.deleted_at is null loop
  if item.balance < 0 then
   states := array_append(states,'account_negative:' || item.id::text || ':state');
   perform private.emit_notification(p_space,p_user,p_role,'account_negative','accounts','financial_account',item.id,'state','attention',item.name || case when item.liquidity = 'cash' then ' está usando saldo negativo' else ' tem saldo negativo; confira os registros' end,jsonb_build_object('balance_cents',item.balance,'liquidity',item.liquidity,'destination','accounts'),true,true);
  end if;
 end loop;
 for item in select f.id,f.name,f.last_balance_check_on,f.last_balance_check_cents,f.ledger_account_id from finance.financial_accounts f where f.financial_space_id = p_space and f.last_balance_check_on is not null and not exists(select 1 from finance.account_balance_checks c where c.financial_account_id = f.id and c.checked_on >= f.last_balance_check_on) loop
  if private.account_balance_on(p_space,item.ledger_account_id,item.last_balance_check_on) <> item.last_balance_check_cents then
   states := array_append(states,'account_divergent:' || item.id::text || ':state');
   perform private.emit_notification(p_space,p_user,p_role,'account_divergent','accounts','financial_account',item.id,'state','attention',item.name || ' diverge do saldo do extrato importado',jsonb_build_object('account_id',item.id,'difference_cents',item.last_balance_check_cents-private.account_balance_on(p_space,item.ledger_account_id,item.last_balance_check_on),'checked_on',item.last_balance_check_on,'destination','imports'),true,true);
  end if;
 end loop;
 for item in select distinct on(c.financial_account_id) c.*,f.name,f.ledger_account_id from finance.account_balance_checks c join finance.financial_accounts f on f.id = c.financial_account_id where c.financial_space_id = p_space order by c.financial_account_id,c.checked_on desc,c.created_at desc,c.id desc loop
  if private.account_balance_on(p_space,item.ledger_account_id,item.checked_on) <> item.statement_balance_cents then
   states := array_append(states,'account_divergent:' || item.id::text || ':state');
   perform private.emit_notification(p_space,p_user,p_role,'account_divergent','accounts','account_balance_check',item.id,'state','attention',item.name || ' diverge do saldo informado no extrato',jsonb_build_object('account_id',item.financial_account_id,'difference_cents',item.statement_balance_cents-private.account_balance_on(p_space,item.ledger_account_id,item.checked_on),'checked_on',item.checked_on,'destination','accounts'),true,true);
  end if;
 end loop;
 for item in select b.id,b.file_name,b.fitids_regenerated,
   exists(select 1 from finance.import_candidates c where c.import_batch_id = b.id and c.status = 'suggested') as has_suggestions,
   exists(select 1 from finance.import_candidates c where c.absent_in_import_batch_id = b.id) as has_missing
   from finance.import_batches b where b.financial_space_id = p_space and b.status <> 'undone' loop
  if item.fitids_regenerated then perform private.emit_notification(p_space,p_user,p_role,'import_identifiers_regenerated','imports','import_batch',item.id,'once','attention','O banco gerou identificadores novos; confira a importação',jsonb_build_object('file_name',item.file_name,'destination','imports')); end if;
  if item.has_suggestions then perform private.emit_notification(p_space,p_user,p_role,'import_matches_pending','imports','import_batch',item.id,'once','informational','Há correspondências no extrato para confirmar',jsonb_build_object('file_name',item.file_name,'destination','imports')); end if;
  if item.has_missing then perform private.emit_notification(p_space,p_user,p_role,'import_line_missing','imports','import_batch',item.id,'once','attention','Uma linha anterior não apareceu no novo extrato',jsonb_build_object('file_name',item.file_name,'destination','imports')); end if;
 end loop;
 input := private.funding_free_input(p_space,p_day); calculation := private.calculate_free_to_spend(input); free := (calculation#>>'{conservative,valueCents}')::bigint; horizon := (input->>'horizonEnd')::date;
 if free < 0 then
  states := array_append(states,'free_to_spend_negative:' || p_space::text || ':state');
  perform private.emit_notification(p_space,p_user,p_role,'free_to_spend_negative','planning','free_to_spend',p_space,'state','urgent','O Livre para gastar está negativo',jsonb_build_object('value_cents',free,'horizon_end',horizon,'destination','dashboard'),true,true);
 end if;
 for item in select c.id,c.title,c.effective_due_on,s.remaining_cents from finance.commitments c join finance.recurrence_rules r on r.id = c.recurrence_rule_id join finance.commitment_settlements s on s.id = c.id where c.financial_space_id = p_space and r.is_main_income and r.archived_at is null and c.direction = 'inflow' and s.remaining_cents > 0 and s.settlement_status in('pending','partial') and c.effective_due_on <= p_day loop
  if item.effective_due_on < p_day then
   states := array_append(states,'main_income_overdue:' || item.id::text || ':state');
   if p_dates and local_hour >= 8 then perform private.emit_notification(p_space,p_user,p_role,'main_income_overdue','income','commitment',item.id,'state','attention','A renda principal ainda não foi recebida integralmente',jsonb_build_object('remaining_cents',item.remaining_cents,'due_on',item.effective_due_on,'horizon_end',horizon,'destination','agenda'),true,false); end if;
  end if;
  if p_dates and local_hour >= 9 and not exists(select 1 from private.income_notification_deferrals where financial_space_id = p_space and user_id = p_user and commitment_id = item.id and deferred_until > p_day) then
   perform private.emit_notification(p_space,p_user,p_role,'main_income_confirm','income','commitment',item.id,p_day::text,'attention','Você recebeu sua renda principal?',jsonb_build_object('remaining_cents',item.remaining_cents,'due_on',item.effective_due_on,'destination','agenda'));
  end if;
 end loop;
 for item in select t.id,t.description,t.occurred_on from finance.ledger_transactions t join finance.financial_spaces s on s.id = t.financial_space_id where t.financial_space_id = p_space and t.status = 'posted' and t.occurred_on <= p_day and (t.created_at at time zone s.timezone)::date < t.occurred_on and exists(select 1 from finance.ledger_entries e where e.ledger_transaction_id = t.id and e.reconciliation_status = 'unreconciled') loop
  perform private.emit_notification(p_space,p_user,p_role,'scheduled_confirm','transactions','ledger_transaction',item.id,'once','informational','Confirme no extrato: ' || item.description,jsonb_build_object('occurred_on',item.occurred_on,'destination','transactions'));
 end loop;
 for item in select t.id,t.description,t.occurred_on,coalesce(sum(e.amount_cents) filter(where e.amount_cents > 0),0)::bigint as amount from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id = t.id where t.financial_space_id = p_space and t.status = 'posted' and t.kind = 'card_rollover' and t.occurred_on <= p_day group by t.id loop
  perform private.emit_notification(p_space,p_user,p_role,'card_balance_carried','cards','ledger_transaction',item.id,'once','attention','O saldo parcial da fatura passou para a próxima',jsonb_build_object('amount_cents',item.amount,'occurred_on',item.occurred_on,'destination','cards'));
 end loop;
 for item in select r.id,r.name,e.scheduled_for,e.shortfall_cents,e.contributed_cents from finance.reserves r join lateral(select * from finance.reserve_funding_events e where e.reserve_id = r.id and e.scheduled_for <= p_day order by e.scheduled_for desc limit 1) e on true where r.financial_space_id = p_space and r.reserve_type = 'provision' and r.status in('active','achieved') and e.shortfall_cents > 0 and e.scheduled_for < p_day loop
  states := array_append(states,'provision_funding_overdue:' || item.id::text || ':state');
  perform private.emit_notification(p_space,p_user,p_role,'provision_funding_overdue','reserves','reserve',item.id,'state','attention','A provisão ' || item.name || ' ficou com aporte pendente',jsonb_build_object('shortfall_cents',item.shortfall_cents,'scheduled_for',item.scheduled_for,'destination','reserves'),true,true);
 end loop;
 for item in with recursive coverage(parent_id,category_id) as (
  select c.id,c.id from finance.categories c where c.financial_space_id = p_space and c.kind = 'expense' and exists(select 1 from finance.categories child where child.parent_id = c.id)
  union all select p.parent_id,c.id from coverage p join finance.categories c on c.parent_id = p.category_id
 ) select p.id,p.name,coalesce(sum(e.amount_cents) filter(where e.effective_competence_month = month),0)::bigint as current_amount,
 coalesce(sum(e.amount_cents) filter(where e.effective_competence_month = (month-interval '1 month')::date),0)::bigint as prior_amount
 from coverage cv join finance.categories p on p.id = cv.parent_id join finance.categories leaf on leaf.id = cv.category_id
 left join finance.posted_ledger_entries e on e.ledger_account_id = leaf.ledger_account_id and e.occurred_on <= p_day and e.original_competence_month is null and e.reserve_id is null
 where leaf.system_role is distinct from 'financial_charges' and leaf.system_role is distinct from 'space_transfer_out' group by p.id loop
  if item.prior_amount > 0 and item.current_amount > item.prior_amount then perform private.emit_notification(p_space,p_user,p_role,'category_above_previous_month','budgets','category',item.id,month::text,'attention',item.name || ' já superou o consumo do mês anterior',jsonb_build_object('consumed_cents',item.current_amount,'previous_cents',item.prior_amount,'month',month,'destination','reports')); end if;
 end loop;
 return states;
end;
$$;
do $$ declare definition text; needle text; begin
 definition := pg_get_functiondef('private.collect_notifications(uuid,uuid,boolean,timestamptz)'::regprocedure);
 needle := 'update finance.notifications set resolved_at=';
 if position(needle in definition) = 0 then raise exception 'Extended notification resolution point not found'; end if;
 execute replace(definition,needle,'states := states || private.collect_extended_notifications(p_space,p_user,member_role,day,p_dates,p_at);
  ' || needle);
end $$;
-- A statement import can change thousands of candidates. Deferred notification
-- triggers observe the final state once per backend, statement and space.
create table private.notification_event_refreshes (
 backend_pid integer not null,financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
 transaction_number bigint not null,statement_at timestamptz not null,
 primary key(backend_pid,financial_space_id)
);
revoke all on private.notification_event_refreshes from public,anon,authenticated;
create or replace function private.notifications_after_event() returns trigger language plpgsql security definer set search_path = '' as $$
declare refreshed integer; begin
 insert into private.notification_event_refreshes(backend_pid,financial_space_id,transaction_number,statement_at) values(pg_backend_pid(),new.financial_space_id,txid_current(),statement_timestamp())
 on conflict(backend_pid,financial_space_id) do update set transaction_number = excluded.transaction_number,statement_at = excluded.statement_at
 where notification_event_refreshes.transaction_number <> excluded.transaction_number or notification_event_refreshes.statement_at <> excluded.statement_at returning backend_pid into refreshed;
 if refreshed is not null then perform private.refresh_space_notifications(new.financial_space_id); end if;
 return null;
end;
$$;
create constraint trigger notify_import_review after insert or update on finance.import_batches deferrable initially deferred for each row execute function private.notifications_after_event();
create constraint trigger notify_import_candidate after insert or update on finance.import_candidates deferrable initially deferred for each row execute function private.notifications_after_event();
create constraint trigger notify_funding_shortfall after insert on finance.reserve_funding_events deferrable initially deferred for each row execute function private.notifications_after_event();
create function api.job_daily_maintenance() returns jsonb language plpgsql security definer set search_path = '' as $$
declare recurrence jsonb; cards jsonb; provisions jsonb; funding jsonb; begin
 perform pg_advisory_xact_lock(hashtextextended('daily_maintenance',0));
 recurrence := api.job_generate_occurrences(); cards := api.job_card_cycles(); provisions := api.job_provision_settlements(); funding := api.job_reserve_funding();
 perform api.job_daily_alerts();
 return jsonb_build_object('recurrence',recurrence,'cards',cards,'provisions',provisions,'funding',funding,'notifications','refreshed');
end;
$$;
revoke all on function private.collect_extended_notifications(uuid,uuid,text,date,boolean,timestamptz),api.check_account_balance(uuid,uuid,date,bigint,uuid),api.defer_income_notification(uuid,uuid),api.job_daily_maintenance() from public,anon,authenticated;
grant execute on function api.check_account_balance(uuid,uuid,date,bigint,uuid),api.defer_income_notification(uuid,uuid) to authenticated;
grant execute on function api.job_daily_maintenance() to service_role;
commit;
