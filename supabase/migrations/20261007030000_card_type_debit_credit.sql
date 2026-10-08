begin;

-- Add card_type to finance.credit_cards and public.credit_cards
alter table finance.credit_cards
  add column if not exists card_type text not null default 'both' check(card_type in ('both','credit','debit'));

alter table public.credit_cards
  add column if not exists tipo_cartao text not null default 'both' check(tipo_cartao in ('both','credit','debit'));

-- Update finance.card_limits view to include card_type
create or replace view finance.card_limits with(security_invoker = true) as
select c.id,c.financial_space_id,c.name,c.status,b.balance_cents,
  coalesce(l.limit_cents,0)::bigint as granted_cents,
  (-b.balance_cents + coalesce(h.pending_cents,0))::bigint as used_cents,
  (coalesce(l.limit_cents,0) + b.balance_cents - coalesce(h.pending_cents,0))::bigint as free_cents,
  c.card_type
from finance.credit_cards c join finance.financial_spaces sp on sp.id = c.financial_space_id join finance.account_balances b on b.id = c.ledger_account_id
left join lateral(select limit_cents from finance.credit_card_limits where credit_card_id = c.id and valid_from <= (now() at time zone sp.timezone)::date order by valid_from desc limit 1) l on true
left join lateral(select sum(a.amount_cents) as pending_cents from finance.card_authorizations a left join finance.ledger_transactions t on t.id = a.payment_transaction_id
  where a.credit_card_id = c.id and a.status = 'pending' and a.authorized_on <= (now() at time zone sp.timezone)::date and
    ((a.kind = 'purchase' and (a.expires_on is null or a.expires_on >= (now() at time zone sp.timezone)::date)) or (a.kind = 'payment_hold' and t.status = 'posted' and a.release_on > (now() at time zone sp.timezone)::date))) h on true;

-- Update api.create_credit_card to accept p_card_type
drop function if exists api.create_credit_card(uuid,text,bigint,integer,integer,uuid);

create or replace function api.create_credit_card(
  p_space uuid,
  p_name text,
  p_limit_cents bigint,
  p_closing_day integer,
  p_due_day integer,
  p_payment_account uuid default null,
  p_card_type text default 'both'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare card_id uuid; ledger_id uuid; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_card_type is null or p_card_type not in ('both','credit','debit') then
    raise exception 'Invalid card type' using errcode = '23514';
  end if;
  insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,name,created_by)
    values(p_space,'liability','credit_card',p_name,auth.uid()) returning id into ledger_id;
  insert into finance.credit_cards(financial_space_id,ledger_account_id,name,closing_day,due_day,default_payment_financial_account_id,card_type,created_by)
    values(p_space,ledger_id,p_name,p_closing_day,p_due_day,p_payment_account,p_card_type,auth.uid()) returning id into card_id;
  insert into finance.credit_card_limits(financial_space_id,credit_card_id,limit_cents,valid_from,created_by)
    values(p_space,card_id,p_limit_cents,private.space_today(p_space),auth.uid());
  insert into finance.credit_card_holders(financial_space_id,credit_card_id,name,kind,created_by)
    values(p_space,card_id,'Titular','main',auth.uid());
  perform private.ensure_card_statement(p_space,card_id,private.space_today(p_space));
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data)
    values(p_space,auth.uid(),'created','credit_card',card_id,jsonb_build_object('name',p_name,'limit_cents',p_limit_cents,'card_type',p_card_type));
  return card_id;
end;
$$;

revoke all on function api.create_credit_card(uuid,text,bigint,integer,integer,uuid,text) from public,anon,authenticated;
grant execute on function api.create_credit_card(uuid,text,bigint,integer,integer,uuid,text) to authenticated;

-- Update api.manage_card to allow 'card_type' in settings payload
create or replace function api.manage_card(p_space uuid,p_card uuid,p_version integer,p_action text,p_payload jsonb default '{}',p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare card finance.credit_cards; result uuid; operation text:=case p_action when 'settings' then 'card_settings' when 'limit' then 'card_limit' else 'card_state' end; request jsonb:=jsonb_build_object('card',p_card,'version',p_version,'action',p_action,'payload',p_payload); balance bigint; previous_close date; next_close date; due date; statement record; idx integer; schedule jsonb:='[]'; item jsonb; account uuid; new_close integer; new_due integer; goes_next boolean; limit_amount bigint; valid_from date; new_card_type text;
begin
 perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 result:=private.loan_request_result(p_space,p_client_uuid,operation,request); if result is not null then return result; end if;
 if p_action is null or p_action not in('settings','limit','cancel','reactivate','archive','restore') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid card request' using errcode='23514'; end if;
 select * into card from finance.credit_cards where financial_space_id=p_space and id=p_card and deleted_at is null for update;
 if not found then raise exception 'Card not found' using errcode='P0002'; end if;
 if card.version is distinct from p_version then raise exception 'Card changed; reload before editing' using errcode='40001'; end if;
 if card.status='archived' and p_action<>'restore' then raise exception 'Restore card before editing' using errcode='23514'; end if;
 if p_action='settings' then
  if exists(select 1 from jsonb_object_keys(p_payload) key where key not in('name','issuer_name','brand','last_digits','closing_day','due_day','closing_day_purchase_goes_next','installment_remainder','default_payment_financial_account_id','default_refund_model','limit_release_days_pix','limit_release_days_debit','limit_release_days_boleto','revolving_interest_monthly_percent','late_fee_percent','late_interest_monthly_percent','card_type')) then raise exception 'Invalid card settings field' using errcode='23514'; end if;
  if nullif(p_payload->>'last_digits','') is not null and p_payload->>'last_digits'!~'^[0-9]{4}$' then raise exception 'Only the last four card digits may be stored' using errcode='23514'; end if;
  if p_payload ? 'name' and coalesce(char_length(trim(p_payload->>'name')),0) not between 1 and 100 then raise exception 'Card name must contain one to one hundred characters' using errcode='23514'; end if;
  if p_payload ? 'card_type' and p_payload->>'card_type' not in ('both','credit','debit') then raise exception 'Invalid card type' using errcode='23514'; end if;
  new_card_type:=coalesce(p_payload->>'card_type',card.card_type);
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
  update finance.credit_cards set name=coalesce(p_payload->>'name',name),card_type=new_card_type,issuer_name=case when p_payload ? 'issuer_name' then p_payload->>'issuer_name' else issuer_name end,brand=case when p_payload ? 'brand' then p_payload->>'brand' else brand end,last_digits=case when p_payload ? 'last_digits' then nullif(p_payload->>'last_digits','') else last_digits end,closing_day=new_close,due_day=new_due,closing_day_purchase_goes_next=goes_next,installment_remainder=coalesce(p_payload->>'installment_remainder',installment_remainder),default_payment_financial_account_id=account,default_refund_model=coalesce(p_payload->>'default_refund_model',default_refund_model),limit_release_days_pix=coalesce((p_payload->>'limit_release_days_pix')::smallint,limit_release_days_pix),limit_release_days_debit=coalesce((p_payload->>'limit_release_days_debit')::smallint,limit_release_days_debit),limit_release_days_boleto=coalesce((p_payload->>'limit_release_days_boleto')::smallint,limit_release_days_boleto),revolving_interest_monthly_percent=case when p_payload ? 'revolving_interest_monthly_percent' then (p_payload->>'revolving_interest_monthly_percent')::numeric else revolving_interest_monthly_percent end,late_fee_percent=coalesce((p_payload->>'late_fee_percent')::numeric,late_fee_percent),late_interest_monthly_percent=coalesce((p_payload->>'late_interest_monthly_percent')::numeric,late_interest_monthly_percent),version=version+1,updated_at=now() where id=card.id;
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

commit;

