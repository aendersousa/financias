begin;
alter table finance.credit_card_holders add column version integer not null default 1;
alter table finance.card_authorizations add column version integer not null default 1;
alter table finance.credit_cards add column opening_bank_used_cents bigint check(opening_bank_used_cents between 0 and 9007199254740991);
-- Dates stored on an existing cycle take precedence over the card's current rules.
-- Otherwise a closing-day change would create a second open cycle on the next
-- payment/purchase, replacing the transition cycle promised in 9.5.6.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('private.ensure_card_statement(uuid,uuid,date,integer)'::regprocedure);
 execute replace(definition,'private.ensure_card_statement(','private.ensure_card_statement_from_rules(');
end $$;
create or replace function private.ensure_card_statement(p_space uuid,p_card uuid,p_purchase_on date,p_offset integer default 0) returns uuid
language plpgsql set search_path='' as $$
declare card finance.credit_cards; current_statement finance.card_statements; next_statement finance.card_statements; result uuid; next_close date; idx integer;
begin
 select * into card from finance.credit_cards where id=p_card and financial_space_id=p_space;
 if not found then raise exception 'Card not found' using errcode='P0002'; end if;
 if p_purchase_on is null or not isfinite(p_purchase_on) or p_offset is null or p_offset not between 0 and 600 then raise exception 'Invalid statement date or installment offset' using errcode='23514'; end if;
 select * into current_statement from finance.card_statements where financial_space_id=p_space and credit_card_id=p_card and p_purchase_on between period_start and period_end order by case status when 'open' then 0 when 'future' then 1 else 2 end,closing_on,id limit 1;
 if not found then
  result:=private.ensure_card_statement_from_rules(p_space,p_card,p_purchase_on,0);
  select * into current_statement from finance.card_statements where id=result;
 end if;
 -- Normal monthly cycles retain the original direct generator, including gaps
 -- between historical purchases and the current cycle. Never jump across them.
 if not exists(select 1 from finance.card_statements where credit_card_id=p_card and dates_overridden)
  and current_statement.closing_on=private.clamped_day(date_trunc('month',current_statement.closing_on)::date,card.closing_day)
  and current_statement.period_start=private.clamped_day((date_trunc('month',current_statement.closing_on)-interval '1 month')::date,card.closing_day)+(case when card.closing_day_purchase_goes_next then 0 else 1 end) then
  return private.ensure_card_statement_from_rules(p_space,p_card,p_purchase_on,p_offset);
 end if;
 if p_offset>0 then
  -- Reuse a contiguous existing sequence in one query for long installment
  -- plans. A distant current cycle must not skip missing historical months.
  with following as (
   select id,closing_on,period_start,lag(closing_on,1,current_statement.closing_on) over(order by closing_on,reference_month,id) as previous_close,lag(period_end,1,current_statement.period_end) over(order by closing_on,reference_month,id) as previous_end
   from finance.card_statements where financial_space_id=p_space and credit_card_id=p_card and closing_on>current_statement.closing_on order by closing_on,reference_month,id limit p_offset
  ) select (array_agg(id order by closing_on,id))[p_offset] into result from following having count(*)=p_offset and bool_and(date_trunc('month',closing_on)<=date_trunc('month',previous_close)+interval '1 month' or period_start<=previous_end+1);
  if found then return result; end if;
  for idx in 1..p_offset loop
   select * into next_statement from finance.card_statements where financial_space_id=p_space and credit_card_id=p_card and closing_on>current_statement.closing_on order by closing_on,reference_month,id limit 1;
   if not found or date_trunc('month',next_statement.closing_on)>date_trunc('month',current_statement.closing_on)+interval '1 month' and next_statement.period_start>current_statement.period_end+1 then
    next_close:=private.clamped_day((date_trunc('month',current_statement.closing_on)+interval '1 month')::date,card.closing_day);
    result:=private.ensure_card_statement_from_rules(p_space,p_card,next_close-1,0);
    select * into next_statement from finance.card_statements where id=result;
    if next_statement.closing_on<=current_statement.closing_on then raise exception 'Statement dates must remain in chronological order' using errcode='23514'; end if;
    update finance.card_statements set period_start=current_statement.period_end+1 where id=next_statement.id;
   end if;
   current_statement:=next_statement;
  end loop;
 end if;
 return current_statement.id;
end;
$$;
revoke all on function private.ensure_card_statement_from_rules(uuid,uuid,date,integer),private.ensure_card_statement(uuid,uuid,date,integer) from public,anon,authenticated;
do $$ declare definition text; begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='finance.operation_requests'::regclass and conname='operation_requests_operation_check';
 alter table finance.operation_requests drop constraint operation_requests_operation_check;
 execute 'alter table finance.operation_requests add constraint operation_requests_operation_check check ('||substring(definition from 7)||' or operation in(''card_settings'',''card_limit'',''card_state'',''card_holder'',''card_authorization''))';
end $$;
create function private.record_card_request(p_space uuid,p_client uuid,p_operation text,p_request jsonb,p_result uuid) returns void
language plpgsql set search_path='' as $$
begin
 if p_client is not null then insert into finance.operation_requests(financial_space_id,client_uuid,operation,request,result_id,created_by) values(p_space,p_client,p_operation,p_request,p_result,auth.uid()); end if;
end;
$$;

create function api.card_management_summary(p_space uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare cards jsonb;
begin
 if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('balance_cents',b.balance_cents,'granted_cents',l.granted_cents,'used_cents',l.used_cents,'free_cents',l.free_cents,'opening_difference_cents',case when c.opening_bank_used_cents is not null then c.opening_bank_used_cents-l.used_cents end,
  'holders',coalesce((select jsonb_agg(to_jsonb(h) order by h.kind,h.name,h.id) from finance.credit_card_holders h where h.credit_card_id=c.id),'[]'),
  'limit_history',coalesce((select jsonb_agg(to_jsonb(lh) order by lh.valid_from desc,lh.id) from finance.credit_card_limits lh where lh.credit_card_id=c.id),'[]'),
  'authorizations',coalesce((select jsonb_agg(to_jsonb(a) order by a.authorized_on desc,a.id) from finance.card_authorizations a where a.credit_card_id=c.id),'[]'),
  'statements',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('remaining_cents',a.remaining_cents) order by s.reference_month,s.id) from finance.card_statements s join finance.statement_amounts a on a.id=s.id where s.credit_card_id=c.id),'[]'),
  'out_of_period_purchases',coalesce((select jsonb_agg(jsonb_build_object('transaction_id',t.id,'description',t.description,'on',t.occurred_on,'statement_id',s.id)) from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' join finance.card_statements s on s.id=e.card_statement_id where e.ledger_account_id=c.ledger_account_id and t.kind='card_purchase' and coalesce(e.installment_number,1)=1 and s.status<>'closed' and t.occurred_on not between s.period_start and s.period_end),'[]'),
  'recurrences',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title)) from finance.recurrence_rules r where r.financial_space_id=p_space and r.archived_at is null and exists(select 1 from finance.recurrence_rule_versions v where v.recurrence_rule_id=r.id and v.payment_credit_card_id=c.id and v.version_number=(select max(version_number) from finance.recurrence_rule_versions where recurrence_rule_id=r.id))),'[]'),
  'commitments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'due_on',a.effective_due_on)) from finance.commitment_settlements a join finance.commitments raw on raw.id=a.id where a.financial_space_id=p_space and raw.payment_credit_card_id=c.id and raw.cancelled_at is null and raw.deleted_at is null and a.remaining_cents>0),'[]')) order by c.name,c.id),'[]') into cards
  from finance.credit_cards c join finance.account_balances b on b.id=c.ledger_account_id join finance.card_limits l on l.id=c.id where c.financial_space_id=p_space and c.deleted_at is null;
 return jsonb_build_object('cards',cards);
end;
$$;

create function api.edit_card_statement_dates(p_space uuid,p_statement uuid,p_version integer,p_payload jsonb,p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare statement finance.card_statements; result uuid; request jsonb:=jsonb_build_object('statement',p_statement,'version',p_version,'payload',p_payload); remaining bigint; close_date date; start_date date; due date; effective date; goes_next boolean;
begin
 perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 result:=private.loan_request_result(p_space,p_client_uuid,'card_statement_dates',request); if result is not null then return result; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_payload) key where key not in('period_start','closing_on','due_on','effective_due_on')) then raise exception 'Invalid statement dates payload' using errcode='23514'; end if;
 select * into statement from finance.card_statements where financial_space_id=p_space and id=p_statement for update;
 if not found then raise exception 'Statement not found' using errcode='P0002'; end if;
 if statement.version is distinct from p_version then raise exception 'Statement changed; reload before editing' using errcode='40001'; end if;
 if exists(select 1 from finance.credit_cards where id=statement.credit_card_id and status='archived') then raise exception 'Restore card before editing' using errcode='23514'; end if;
 close_date:=coalesce((p_payload->>'closing_on')::date,statement.closing_on); start_date:=coalesce((p_payload->>'period_start')::date,statement.period_start); due:=coalesce((p_payload->>'due_on')::date,statement.due_on); effective:=coalesce((p_payload->>'effective_due_on')::date,case when due<>statement.due_on then private.effective_due_date(p_space,due) else statement.effective_due_on end);
 if not isfinite(close_date) or not isfinite(start_date) or not isfinite(due) or not isfinite(effective) or start_date>=close_date or close_date>=due or effective<due then raise exception 'Invalid statement dates' using errcode='23514'; end if;
 if statement.status='closed' and (close_date,start_date) is distinct from (statement.closing_on,statement.period_start) then raise exception 'Closed statement period is immutable' using errcode='23514'; end if;
 if statement.status<>'closed' and close_date<private.space_today(p_space) then raise exception 'Open statement cannot close in the past' using errcode='23514'; end if;
 select remaining_cents into remaining from finance.statement_amounts where id=statement.id;
 if remaining=0 and (due,effective) is distinct from (statement.due_on,statement.effective_due_on) then raise exception 'Paid statement due dates are immutable' using errcode='23514'; end if;
 select closing_day_purchase_goes_next into goes_next from finance.credit_cards where id=statement.credit_card_id;
 update finance.card_statements set period_start=start_date,closing_on=close_date,period_end=case when statement.status='closed' then statement.period_end else close_date-case when goes_next then 1 else 0 end end,due_on=due,effective_due_on=effective,reference_month=date_trunc('month',due)::date,dates_overridden=true,version=version+1,updated_at=now() where id=statement.id;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'statement_dates_changed','card_statement',statement.id,to_jsonb(statement),p_payload);
 perform private.record_card_request(p_space,p_client_uuid,'card_statement_dates',request,statement.id); return statement.id;
end;
$$;

create function api.manage_card_holder(p_space uuid,p_card uuid,p_holder uuid,p_version integer,p_action text,p_payload jsonb default '{}',p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare holder finance.credit_card_holders; result uuid; request jsonb:=jsonb_build_object('card',p_card,'holder',p_holder,'version',p_version,'action',p_action,'payload',p_payload); person uuid; holder_name text; digits text; holder_kind text;
begin
 perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 result:=private.loan_request_result(p_space,p_client_uuid,'card_holder',request); if result is not null then return result; end if;
 if not exists(select 1 from finance.credit_cards where financial_space_id=p_space and id=p_card and status<>'archived') then raise exception 'Card not available' using errcode='23514'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or p_action is null or p_action not in('create','edit','activate','deactivate') then raise exception 'Invalid holder request' using errcode='23514'; end if;
 if p_action='create' and (p_holder is not null or p_version is not null) then raise exception 'New holder cannot reuse an existing identity or version' using errcode='23514'; end if;
 if exists(select 1 from jsonb_object_keys(p_payload) key where key not in('name','kind','last_digits','person_id')) then raise exception 'Invalid holder field' using errcode='23514'; end if;
 if p_action in('activate','deactivate') and p_payload<>'{}'::jsonb then raise exception 'Holder state changes do not edit holder details' using errcode='23514'; end if;
 if p_action<>'create' then
  select * into holder from finance.credit_card_holders where financial_space_id=p_space and credit_card_id=p_card and id=p_holder for update;
  if not found then raise exception 'Holder not found' using errcode='P0002'; end if;
  if holder.version is distinct from p_version then raise exception 'Holder changed; reload before editing' using errcode='40001'; end if;
 end if;
 holder_name:=coalesce(p_payload->>'name',holder.name); holder_kind:=coalesce(p_payload->>'kind',holder.kind); digits:=case when p_payload ? 'last_digits' then nullif(p_payload->>'last_digits','') else holder.last_digits end; person:=case when p_payload ? 'person_id' then (p_payload->>'person_id')::uuid else holder.person_id end;
 if p_action in('create','edit') and (holder_name is null or holder_kind is null or char_length(trim(holder_name)) not between 1 and 100 or holder_kind not in('main','additional','virtual') or digits is not null and digits!~'^[0-9]{4}$') then raise exception 'Invalid holder name, kind or last digits' using errcode='23514'; end if;
 if person is not null and not exists(select 1 from finance.people where financial_space_id=p_space and id=person and deleted_at is null) then raise exception 'Holder person not in this space' using errcode='23514'; end if;
 if holder_kind='main' and p_action in('create','edit') and exists(select 1 from finance.credit_card_holders where credit_card_id=p_card and kind='main' and id is distinct from p_holder) then raise exception 'Card already has a main holder' using errcode='23514'; end if;
 if p_action='create' then insert into finance.credit_card_holders(financial_space_id,credit_card_id,name,kind,last_digits,person_id,created_by) values(p_space,p_card,trim(holder_name),holder_kind,digits,person,auth.uid()) returning id into result;
 else
  if holder.kind='main' and (p_action='deactivate' or p_action='edit' and holder_kind<>'main') then raise exception 'Main holder must remain available' using errcode='23514'; end if;
  update finance.credit_card_holders set name=trim(holder_name),kind=holder_kind,last_digits=digits,person_id=person,is_active=case when p_action='deactivate' then false when p_action='activate' then true else is_active end,version=version+1,updated_at=now() where id=holder.id;
  result:=holder.id;
 end if;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'holder_'||p_action,'credit_card_holder',result,case when holder.id is not null then to_jsonb(holder) end,p_payload);
 perform private.record_card_request(p_space,p_client_uuid,'card_holder',request,result); return result;
end;
$$;

create function api.manage_card_authorization(p_space uuid,p_card uuid,p_authorization uuid,p_version integer,p_action text,p_payload jsonb default '{}',p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare auth_row finance.card_authorizations; result uuid; request jsonb:=jsonb_build_object('card',p_card,'authorization',p_authorization,'version',p_version,'action',p_action,'payload',p_payload); on_day date; expires date; amount bigint; auth_description text;
begin
 perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 result:=private.loan_request_result(p_space,p_client_uuid,'card_authorization',request); if result is not null then return result; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or p_action is null or p_action not in('create','edit','cancel') then raise exception 'Invalid authorization request' using errcode='23514'; end if;
 if p_action='create' and (p_authorization is not null or p_version is not null) then raise exception 'New authorization cannot reuse an existing identity or version' using errcode='23514'; end if;
 if exists(select 1 from jsonb_object_keys(p_payload) key where key not in('on','expires_on','amount_cents','description')) then raise exception 'Invalid authorization field' using errcode='23514'; end if;
 if p_action='cancel' and p_payload<>'{}'::jsonb then raise exception 'Cancelling an authorization does not edit its details' using errcode='23514'; end if;
 if not exists(select 1 from finance.credit_cards where financial_space_id=p_space and id=p_card and status<>'archived' and (p_action<>'create' or status='active')) then raise exception 'Card not available for authorization' using errcode='23514'; end if;
 if p_action<>'create' then
  select * into auth_row from finance.card_authorizations where financial_space_id=p_space and credit_card_id=p_card and id=p_authorization for update;
  if not found or auth_row.kind<>'purchase' or auth_row.status<>'pending' then raise exception 'Pending purchase authorization required' using errcode='23514'; end if;
  if auth_row.version is distinct from p_version then raise exception 'Authorization changed; reload before editing' using errcode='40001'; end if;
 end if;
 on_day:=coalesce((p_payload->>'on')::date,auth_row.authorized_on,private.space_today(p_space)); expires:=coalesce((p_payload->>'expires_on')::date,auth_row.expires_on,on_day+30); amount:=coalesce((p_payload->>'amount_cents')::bigint,auth_row.amount_cents); auth_description:=coalesce(p_payload->>'description',auth_row.description);
 if p_action in('create','edit') and (on_day is null or not isfinite(on_day) or not isfinite(expires) or expires<on_day or amount is null or amount not between 1 and 9007199254740991 or auth_description is null or char_length(trim(auth_description)) not between 1 and 200) then raise exception 'Invalid authorization amount or dates' using errcode='23514'; end if;
 if p_action='create' then insert into finance.card_authorizations(financial_space_id,credit_card_id,kind,authorized_on,amount_cents,description,expires_on,created_by) values(p_space,p_card,'purchase',on_day,amount,trim(auth_description),expires,auth.uid()) returning id into result;
 else update finance.card_authorizations set authorized_on=on_day,amount_cents=amount,description=auth_description,expires_on=expires,status=case when p_action='cancel' then 'cancelled' else status end,resolved_at=case when p_action='cancel' then now() else resolved_at end,version=version+1,updated_at=now() where id=auth_row.id; result:=auth_row.id; end if;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'authorization_'||p_action,'card_authorization',result,case when auth_row.id is not null then to_jsonb(auth_row) end,p_payload);
 perform private.record_card_request(p_space,p_client_uuid,'card_authorization',request,result); return result;
end;
$$;

create function api.manage_card(p_space uuid,p_card uuid,p_version integer,p_action text,p_payload jsonb default '{}',p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare card finance.credit_cards; result uuid; operation text:=case p_action when 'settings' then 'card_settings' when 'limit' then 'card_limit' else 'card_state' end; request jsonb:=jsonb_build_object('card',p_card,'version',p_version,'action',p_action,'payload',p_payload); balance bigint; previous_close date; next_close date; due date; statement record; idx integer; schedule jsonb:='[]'; item jsonb; account uuid; new_close integer; new_due integer; goes_next boolean; limit_amount bigint; valid_from date;
begin
 perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 result:=private.loan_request_result(p_space,p_client_uuid,operation,request); if result is not null then return result; end if;
 if p_action is null or p_action not in('settings','limit','cancel','reactivate','archive','restore') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid card request' using errcode='23514'; end if;
 select * into card from finance.credit_cards where financial_space_id=p_space and id=p_card and deleted_at is null for update;
 if not found then raise exception 'Card not found' using errcode='P0002'; end if;
 if card.version is distinct from p_version then raise exception 'Card changed; reload before editing' using errcode='40001'; end if;
 if card.status='archived' and p_action<>'restore' then raise exception 'Restore card before editing' using errcode='23514'; end if;
 if p_action='settings' then
  if exists(select 1 from jsonb_object_keys(p_payload) key where key not in('name','issuer_name','brand','last_digits','closing_day','due_day','closing_day_purchase_goes_next','installment_remainder','default_payment_financial_account_id','default_refund_model','limit_release_days_pix','limit_release_days_debit','limit_release_days_boleto','revolving_interest_monthly_percent','late_fee_percent','late_interest_monthly_percent')) then raise exception 'Invalid card settings field' using errcode='23514'; end if;
  if nullif(p_payload->>'last_digits','') is not null and p_payload->>'last_digits'!~'^[0-9]{4}$' then raise exception 'Only the last four card digits may be stored' using errcode='23514'; end if;
  if p_payload ? 'name' and coalesce(char_length(trim(p_payload->>'name')),0) not between 1 and 100 then raise exception 'Card name must contain one to one hundred characters' using errcode='23514'; end if;
  account:=case when p_payload ? 'default_payment_financial_account_id' then (p_payload->>'default_payment_financial_account_id')::uuid else card.default_payment_financial_account_id end;
  if account is not null and not exists(select 1 from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id where f.id=account and f.financial_space_id=p_space and f.archived_at is null and f.deleted_at is null and a.liquidity in('cash','investment')) then raise exception 'Default payment account not available' using errcode='23514'; end if;
  new_close:=coalesce((p_payload->>'closing_day')::integer,card.closing_day); new_due:=coalesce((p_payload->>'due_day')::integer,card.due_day); goes_next:=coalesce((p_payload->>'closing_day_purchase_goes_next')::boolean,card.closing_day_purchase_goes_next);
  if new_close not between 1 and 31 or new_due not between 1 and 31 then raise exception 'Card dates must be between one and thirty-one' using errcode='23514'; end if;
  if (new_close,new_due,goes_next) is distinct from (card.closing_day,card.due_day,card.closing_day_purchase_goes_next) then
   previous_close:=null;
   for statement in select * from finance.card_statements where credit_card_id=card.id and status<>'closed' order by reference_month,id loop
    if statement.dates_overridden then previous_close:=statement.closing_on; continue; end if;
    if previous_close is null then next_close:=private.clamped_day(date_trunc('month',statement.closing_on)::date,new_close); if next_close<statement.closing_on then next_close:=private.clamped_day((date_trunc('month',statement.closing_on)+interval '1 month')::date,new_close); end if;
    else next_close:=private.clamped_day((date_trunc('month',previous_close)+interval '1 month')::date,new_close); end if;
    due:=private.clamped_day(date_trunc('month',next_close)::date,new_due); if due<=next_close then due:=private.clamped_day((date_trunc('month',next_close)+interval '1 month')::date,new_due); end if;
    if exists(select 1 from finance.card_statements s where s.credit_card_id=card.id and s.status='closed' and s.reference_month=date_trunc('month',due)::date) then raise exception 'New dates collide with a closed statement; review statement dates' using errcode='23514'; end if;
    schedule:=schedule||jsonb_build_array(jsonb_build_object('id',statement.id,'reference_month',date_trunc('month',due)::date,'period_start',case when previous_close is null then statement.period_start else previous_close+case when goes_next then 0 else 1 end end,'period_end',next_close-case when goes_next then 1 else 0 end,'closing_on',next_close,'due_on',due,'effective_due_on',private.effective_due_date(p_space,due))); previous_close:=next_close;
   end loop;
   idx:=0; for item in select value from jsonb_array_elements(schedule) loop idx:=idx+1; update finance.card_statements set reference_month=(date '0100-01-01'+make_interval(months=>idx))::date where id=(item->>'id')::uuid; end loop;
   for item in select value from jsonb_array_elements(schedule) loop update finance.card_statements set reference_month=(item->>'reference_month')::date,period_start=(item->>'period_start')::date,period_end=(item->>'period_end')::date,closing_on=(item->>'closing_on')::date,due_on=(item->>'due_on')::date,effective_due_on=(item->>'effective_due_on')::date,dates_overridden=false,version=version+1,updated_at=now() where id=(item->>'id')::uuid; end loop;
  end if;
  update finance.credit_cards set name=coalesce(p_payload->>'name',name),issuer_name=case when p_payload ? 'issuer_name' then p_payload->>'issuer_name' else issuer_name end,brand=case when p_payload ? 'brand' then p_payload->>'brand' else brand end,last_digits=case when p_payload ? 'last_digits' then nullif(p_payload->>'last_digits','') else last_digits end,closing_day=new_close,due_day=new_due,closing_day_purchase_goes_next=goes_next,installment_remainder=coalesce(p_payload->>'installment_remainder',installment_remainder),default_payment_financial_account_id=account,default_refund_model=coalesce(p_payload->>'default_refund_model',default_refund_model),limit_release_days_pix=coalesce((p_payload->>'limit_release_days_pix')::smallint,limit_release_days_pix),limit_release_days_debit=coalesce((p_payload->>'limit_release_days_debit')::smallint,limit_release_days_debit),limit_release_days_boleto=coalesce((p_payload->>'limit_release_days_boleto')::smallint,limit_release_days_boleto),revolving_interest_monthly_percent=case when p_payload ? 'revolving_interest_monthly_percent' then (p_payload->>'revolving_interest_monthly_percent')::numeric else revolving_interest_monthly_percent end,late_fee_percent=coalesce((p_payload->>'late_fee_percent')::numeric,late_fee_percent),late_interest_monthly_percent=coalesce((p_payload->>'late_interest_monthly_percent')::numeric,late_interest_monthly_percent),version=version+1,updated_at=now() where id=card.id;
  if exists(select 1 from finance.credit_cards where id=card.id and (revolving_interest_monthly_percent<0 or late_fee_percent<0 or late_interest_monthly_percent<0 or revolving_interest_monthly_percent::text in('NaN','Infinity','-Infinity') or late_fee_percent::text in('NaN','Infinity','-Infinity') or late_interest_monthly_percent::text in('NaN','Infinity','-Infinity'))) then raise exception 'Card rates must be finite and nonnegative' using errcode='23514'; end if;
  update finance.ledger_accounts set name=coalesce(p_payload->>'name',name),updated_at=now() where id=card.ledger_account_id;
 elsif p_action='limit' then
  if exists(select 1 from jsonb_object_keys(p_payload) key where key not in('amount_cents','valid_from','reason')) then raise exception 'Invalid limit field' using errcode='23514'; end if;
  limit_amount:=(p_payload->>'amount_cents')::bigint; valid_from:=(p_payload->>'valid_from')::date;
  if limit_amount is null or limit_amount not between 0 and 9007199254740991 or valid_from is null or not isfinite(valid_from) or coalesce(char_length(trim(p_payload->>'reason')),0)<10 then raise exception 'Limit requires value, date and reason of at least ten characters' using errcode='23514'; end if;
  if exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',valid_from)::date and reopened_at is null) then raise exception 'Limit reference month is closed' using errcode='23514'; end if;
  insert into finance.credit_card_limits(financial_space_id,credit_card_id,limit_cents,valid_from,reason,created_by) values(p_space,p_card,limit_amount,valid_from,trim(p_payload->>'reason'),auth.uid()); update finance.credit_cards set version=version+1,updated_at=now() where id=card.id;
 else
  if exists(select 1 from jsonb_object_keys(p_payload) key where key<>'reason') then raise exception 'Invalid card state field' using errcode='23514'; end if;
  if p_action='cancel' and card.status<>'active' or p_action='reactivate' and card.status<>'cancelled' or p_action='archive' and card.status<>'cancelled' or p_action='restore' and card.status<>'archived' then raise exception 'Invalid card lifecycle transition' using errcode='23514'; end if;
  if p_action='archive' then
   balance:=private.account_balance_on(p_space,card.ledger_account_id,private.space_today(p_space));
   if balance<>0 or exists(select 1 from finance.posted_ledger_entries e join finance.card_statements s on s.id=e.card_statement_id where e.ledger_account_id=card.ledger_account_id and s.status='future') or exists(select 1 from finance.posted_ledger_entries e where e.ledger_account_id=card.ledger_account_id and e.occurred_on>private.space_today(p_space)) or exists(select 1 from finance.card_authorizations where credit_card_id=card.id and status='pending') or exists(select 1 from finance.commitments c join finance.commitment_settlements a on a.id=c.id where c.payment_credit_card_id=card.id and c.deleted_at is null and c.cancelled_at is null and a.remaining_cents>0) or exists(select 1 from finance.recurrence_rules r join finance.recurrence_rule_versions v on v.recurrence_rule_id=r.id where r.financial_space_id=p_space and r.archived_at is null and (r.ends_on is null or r.ends_on>=private.space_today(p_space)) and v.version_number=(select max(version_number) from finance.recurrence_rule_versions where recurrence_rule_id=r.id) and v.payment_credit_card_id=card.id) then raise exception 'Card still has balance, future entries, authorizations or payment plans' using errcode='23514'; end if;
  end if;
  update finance.credit_cards set status=case p_action when 'cancel' then 'cancelled' when 'reactivate' then 'active' when 'archive' then 'archived' else 'cancelled' end,cancelled_on=case when p_action='reactivate' then null else coalesce(cancelled_on,private.space_today(p_space)) end,archived_at=case when p_action='archive' then now() else null end,version=version+1,updated_at=now() where id=card.id;
  update finance.ledger_accounts set allows_posting=p_action<>'archive',archived_at=case when p_action='archive' then now() else null end,updated_at=now() where id=card.ledger_account_id;
 end if;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'card_'||p_action,'credit_card',card.id,to_jsonb(card),p_payload||jsonb_build_object('statement_dates',schedule));
 perform private.record_card_request(p_space,p_client_uuid,operation,request,card.id); return card.id;
end;
$$;

create function api.configure_card_opening(p_space uuid,p_card uuid,p_on date,p_payload jsonb,p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare card finance.credit_cards; result uuid; request jsonb:=jsonb_build_object('card',p_card,'on',p_on,'payload',p_payload); statement_id uuid; statement finance.card_statements; item jsonb; amount bigint; equity uuid; open_reference date; tx uuid; due date; close_date date; start_date date;
begin
 perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 result:=private.loan_request_result(p_space,p_client_uuid,'card_opening',request); if result is not null then return result; end if;
 if p_on is null or not isfinite(p_on) or p_on>private.space_today(p_space) or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(coalesce(p_payload->'closed_statements','[]'))<>'array' or jsonb_typeof(coalesce(p_payload->'installments','[]'))<>'array' then raise exception 'Invalid card opening date or details' using errcode='23514'; end if;
 if exists(select 1 from jsonb_object_keys(p_payload) key where key not in('closed_statements','open_amount_cents','installments','bank_used_cents')) then raise exception 'Invalid card opening field' using errcode='23514'; end if;
 if exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',p_on)::date and reopened_at is null) then raise exception 'Card opening month is closed' using errcode='23514'; end if;
 select * into card from finance.credit_cards where financial_space_id=p_space and id=p_card and status='active' and started_on is null for update;
 if not found or exists(select 1 from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id and t.status='posted' where e.ledger_account_id=card.ledger_account_id) then raise exception 'Opening setup requires an unused active card' using errcode='23514'; end if;
 select id into equity from finance.ledger_accounts where financial_space_id=p_space and system_role='opening';
 statement_id:=private.ensure_card_statement(p_space,p_card,p_on); select * into statement from finance.card_statements where id=statement_id; open_reference:=statement.reference_month;
 for item in select value from jsonb_array_elements(coalesce(p_payload->'closed_statements','[]')) loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) key where key not in('period_start','closing_on','due_on','effective_due_on','amount_cents')) then raise exception 'Invalid closed opening statement field' using errcode='23514'; end if;
  due:=(item->>'due_on')::date; close_date:=(item->>'closing_on')::date; start_date:=(item->>'period_start')::date; amount:=(item->>'amount_cents')::bigint;
  if due is null or close_date is null or start_date is null or not isfinite(due) or not isfinite(close_date) or not isfinite(start_date) or close_date>p_on or start_date>=close_date or due<=close_date or amount is null or amount not between 1 and 9007199254740991 then raise exception 'Closed opening statement needs dates and a positive remaining balance' using errcode='23514'; end if;
  if exists(select 1 from finance.card_statements where credit_card_id=p_card and reference_month=date_trunc('month',due)::date) then raise exception 'Opening statement reference already exists' using errcode='23514'; end if;
  insert into finance.card_statements(financial_space_id,credit_card_id,reference_month,period_start,period_end,closing_on,due_on,effective_due_on,status,closed_at,closing_amount_cents,created_by) values(p_space,p_card,date_trunc('month',due)::date,start_date,close_date-case when card.closing_day_purchase_goes_next then 1 else 0 end,close_date,due,coalesce((item->>'effective_due_on')::date,private.effective_due_date(p_space,due)),'closed',now(),amount,auth.uid()) returning id into statement_id;
  perform private.post_transaction_internal(p_space,jsonb_build_object('kind','opening','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description','Saldo inicial: fatura '||to_char(due,'MM/YYYY'),'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',equity,'amount_cents',amount),jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-amount,'card_statement_id',statement_id))),auth.uid());
 end loop;
 amount:=coalesce((p_payload->>'open_amount_cents')::bigint,0);
 if amount<0 or amount>9007199254740991 then raise exception 'Open statement balance cannot be negative' using errcode='23514'; end if;
 if amount>0 then
  select id into statement_id from finance.card_statements where credit_card_id=p_card and reference_month=open_reference;
  perform private.post_transaction_internal(p_space,jsonb_build_object('kind','opening','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description','Saldo inicial: fatura aberta','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',equity,'amount_cents',amount),jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-amount,'card_statement_id',statement_id))),auth.uid());
 end if;
 for item in select value from jsonb_array_elements(coalesce(p_payload->'installments','[]')) loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) key where key not in('from','count','amount_cents','description')) then raise exception 'Invalid ongoing installment field' using errcode='23514'; end if;
  statement_id:=private.ensure_card_statement(p_space,p_card,p_on,1);
  perform private.open_card_remaining_installments(p_space,p_card,statement_id,(item->>'from')::integer,(item->>'count')::integer,(item->>'amount_cents')::bigint,item->>'description',p_on,false);
 end loop;
 update finance.credit_cards set started_on=p_on,opening_bank_used_cents=(p_payload->>'bank_used_cents')::bigint,version=version+1,updated_at=now() where id=p_card;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'card_opening_configured','credit_card',p_card,request);
 perform private.record_card_request(p_space,p_client_uuid,'card_opening',request,p_card); return p_card;
end;
$$;

-- Add this operation without erasing namespaces introduced by other modules.
do $$ declare definition text; begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='finance.operation_requests'::regclass and conname='operation_requests_operation_check';
 alter table finance.operation_requests drop constraint operation_requests_operation_check;
 execute 'alter table finance.operation_requests add constraint operation_requests_operation_check check ('||substring(definition from 7)||' or operation in(''card_opening'',''card_statement_dates''))';
end $$;

create function private.card_management_versions() returns trigger language plpgsql set search_path='' as $$
begin
 if new.version=old.version then new.version:=old.version+1; end if;
 return new;
end;
$$;
create trigger card_authorization_version before update on finance.card_authorizations for each row execute function private.card_management_versions();
-- Pending authorizations created before cancellation can still convert.
do $$ declare definition text; needle text; begin
 definition:=pg_get_functiondef('api.record_card_purchase(uuid,uuid,uuid,bigint,integer,date,text,uuid,uuid,bigint,uuid,uuid)'::regprocedure);
 needle:='and status = ''active''';
 if position(needle in definition)=0 then raise exception 'Card purchase lifecycle guard not found'; end if;
 execute replace(definition,needle,'and (status = ''active'' or status = ''cancelled'' and p_authorization is not null and exists(select 1 from finance.card_authorizations pending where pending.id=p_authorization and pending.credit_card_id=p_card and pending.financial_space_id=p_space and pending.kind=''purchase'' and pending.status=''pending'' and pending.authorized_on<=cancelled_on))');
end $$;

revoke all on function private.card_management_versions() from public,anon,authenticated;
revoke all on function api.configure_card_opening(uuid,uuid,date,jsonb,uuid) from public,anon,authenticated;
grant execute on function api.configure_card_opening(uuid,uuid,date,jsonb,uuid) to authenticated;
revoke all on function api.edit_card_statement_dates(uuid,uuid,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function api.edit_card_statement_dates(uuid,uuid,integer,jsonb,uuid) to authenticated;
revoke all on function private.record_card_request(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function api.card_management_summary(uuid),api.manage_card_holder(uuid,uuid,uuid,integer,text,jsonb,uuid),api.manage_card_authorization(uuid,uuid,uuid,integer,text,jsonb,uuid),api.manage_card(uuid,uuid,integer,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function api.card_management_summary(uuid),api.manage_card_holder(uuid,uuid,uuid,integer,text,jsonb,uuid),api.manage_card_authorization(uuid,uuid,uuid,integer,text,jsonb,uuid),api.manage_card(uuid,uuid,integer,text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
