begin;
create sequence finance.planning_event_order;
alter table finance.ledger_transactions add column registration_order bigint not null default nextval('finance.planning_event_order');
alter table finance.reserve_contributions add column registration_order bigint not null default nextval('finance.planning_event_order');
alter table finance.reserves add column terminal_on date,add column terminal_at timestamptz,add column terminal_order bigint;
alter table finance.reserve_contributions add column client_uuid uuid;
create unique index reserve_contribution_request on finance.reserve_contributions(financial_space_id,client_uuid) where client_uuid is not null;

create function private.validate_reserve() returns trigger language plpgsql set search_path = '' as $$
declare liquidity text; begin
  select a.liquidity into liquidity from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id where f.id=new.financial_account_id and f.financial_space_id=new.financial_space_id and f.archived_at is null and f.deleted_at is null;
  if liquidity is null or (new.holding_mode='virtual' and liquidity<>'cash') or (new.holding_mode='account' and liquidity<>'investment') then raise exception 'Choose cash for a virtual reserve or investment for an account goal' using errcode='23514'; end if;
  if new.reserve_type='provision' and (new.target_amount_cents is null or new.target_date is null or new.category_id is null) then raise exception 'Provision requires amount, due date and category' using errcode='23514'; end if;
  if new.reserve_type='goal' and new.target_amount_cents is null then raise exception 'Goal requires a target amount' using errcode='23514'; end if;
  if new.category_id is not null and not exists(select 1 from finance.categories where id=new.category_id and financial_space_id=new.financial_space_id and kind='expense' and ledger_account_id is not null and archived_at is null and deleted_at is null) then raise exception 'Provision requires an expense leaf category' using errcode='23514'; end if;
  if tg_op='UPDATE' and (new.reserve_type,new.holding_mode) is distinct from (old.reserve_type,old.holding_mode) then raise exception 'Reserve type and holding mode are immutable' using errcode='23514'; end if;
  if new.is_emergency_reserve and new.reserve_type<>'goal' then raise exception 'Only goals may be marked as emergency reserve' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger reserve_valid before insert or update on finance.reserves for each row execute function private.validate_reserve();
-- Preserve historical links, but forbid creating new links to terminal reserves.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('private.validate_commitment_entry()'::regprocedure);
  definition:=replace(definition,'if new.reserve_id is not null then','if new.reserve_id is not null then
    if (tg_op=''INSERT'' or new.reserve_id is distinct from old.reserve_id) and new.amount_cents>0 and not exists(select 1 from finance.reserves where id=new.reserve_id and financial_space_id=new.financial_space_id and status in (''active'',''achieved'') and archived_at is null) then raise exception ''Reserve is not active'' using errcode=''23514''; end if;');
  execute definition;
  definition:=pg_get_functiondef('private.validate_commitment()'::regprocedure);
  definition:=replace(definition,'if new.kind <> ''reminder'' then','if new.reserve_id is not null and (tg_op=''INSERT'' or new.reserve_id is distinct from old.reserve_id) and not exists(select 1 from finance.reserves where id=new.reserve_id and financial_space_id=new.financial_space_id and status in (''active'',''achieved'') and archived_at is null) then raise exception ''Reserve is not active'' using errcode=''23514''; end if;
  if new.kind <> ''reminder'' then');
  execute definition;
end $$;

-- One event per contribution, consumption installment or refund. Payment entries
-- never carry reserve_id. Future card credits remove unconsumed installments.
create function private.reserve_refund_allocations(p_refund uuid,p_expense_entry uuid) returns jsonb language plpgsql stable set search_path = '' as $$
declare refund finance.ledger_transactions; expense finance.ledger_entries; original finance.ledger_transactions; card_part record; previous record; weights bigint[]; original_allocations bigint[]; capacities bigint[]:='{}'; statements uuid[]:='{}'; allocations bigint[]; linked_amount bigint; used_capacity bigint; credit bigint; consume_on date; ordinal integer:=0; result jsonb:='{}'; i integer; total bigint;
begin
  select * into refund from finance.ledger_transactions where id=p_refund;
  select * into expense from finance.ledger_entries where id=p_expense_entry and ledger_transaction_id=p_refund;
  select * into original from finance.ledger_transactions where id=refund.related_transaction_id;
  if expense.reserve_id is null or expense.amount_cents>=0 then return result; end if;
  select sum(e.amount_cents)::bigint into linked_amount from finance.ledger_entries e where e.ledger_transaction_id=original.id and e.ledger_account_id=expense.ledger_account_id and e.reserve_id=expense.reserve_id and e.amount_cents>0;
  select array_agg(-e.amount_cents order by e.line_number) into weights from finance.ledger_entries e where e.ledger_transaction_id=original.id and e.card_statement_id is not null and e.amount_cents<0;
  if weights is null or linked_amount is null then return result; end if;
  original_allocations:=private.divide_cents(linked_amount,weights);
  for card_part in select e.*,s.period_start from finance.ledger_entries e join finance.card_statements s on s.id=e.card_statement_id where e.ledger_transaction_id=original.id and e.amount_cents<0 order by e.line_number loop
    ordinal:=ordinal+1;
    consume_on:=case when ordinal=1 then original.occurred_on else greatest(original.occurred_on,card_part.period_start) end;
    select least(consume_on,min(t.occurred_on)) into consume_on from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id=t.id where t.related_transaction_id=original.id and t.kind='card_prepayment' and t.status='posted' and e.card_statement_id=card_part.card_statement_id and e.amount_cents>0 and (t.occurred_on,t.registration_order)<=(refund.occurred_on,refund.registration_order);
    if consume_on<=refund.occurred_on then continue; end if;
    used_capacity:=0;
    for previous in select t.id,e.id as expense_id from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id=t.id where t.related_transaction_id=original.id and t.kind='refund' and t.status='posted' and e.reserve_id=expense.reserve_id and e.ledger_account_id=expense.ledger_account_id and e.amount_cents<0 and (t.occurred_on,t.registration_order)<(refund.occurred_on,refund.registration_order) loop
      used_capacity:=used_capacity+coalesce((private.reserve_refund_allocations(previous.id,previous.expense_id)->>card_part.card_statement_id::text)::bigint,0);
    end loop;
    select coalesce(sum(e.amount_cents),0)::bigint into credit from finance.ledger_entries e where e.ledger_transaction_id=p_refund and e.card_statement_id=card_part.card_statement_id and e.amount_cents>0;
    statements:=array_append(statements,card_part.card_statement_id);
    capacities:=array_append(capacities,least(credit,greatest(0,original_allocations[ordinal]-used_capacity)));
  end loop;
  select coalesce(sum(x),0)::bigint into total from unnest(capacities) x;
  if total=0 then return result; end if;
  allocations:=private.divide_cents(least(-expense.amount_cents,total),capacities);
  for i in 1..array_length(capacities,1) loop result:=jsonb_set(result,array[statements[i]::text],to_jsonb(allocations[i]),true); end loop;
  return result;
end;
$$;
create function private.reserve_ledger_events(p_space uuid,p_reserve uuid,p_until date)
returns table(event_id uuid,occurred_on date,registered_at timestamptz,registration_order bigint,event_kind text,amount_cents bigint,original_id uuid)
language plpgsql stable set search_path = '' as $$
declare item record; card_part record; refund_part record; weights bigint[]; allocations bigint[]; ordinal integer; consume_on date; reduction bigint; future_credit bigint; total_refund bigint; linked_refund bigint;
begin
  return query select c.id,c.occurred_on,c.created_at,c.registration_order,c.kind,c.amount_cents,null::uuid from finance.reserve_contributions c where c.financial_space_id=p_space and c.reserve_id=p_reserve and c.cancelled_at is null and c.occurred_on<=p_until;
  return query select r.id,r.terminal_on,r.terminal_at,r.terminal_order,'terminal_release'::text,0::bigint,null::uuid from finance.reserves r where r.id=p_reserve and r.financial_space_id=p_space and r.terminal_on<=p_until and r.status in('closed','settled');
  for item in select e.*,(select sum(grouped.amount_cents)::bigint from finance.ledger_entries grouped where grouped.ledger_transaction_id=e.ledger_transaction_id and grouped.ledger_account_id=e.ledger_account_id and grouped.reserve_id=e.reserve_id and grouped.amount_cents>0) as linked_amount,t.occurred_on as tx_on,t.created_at as tx_at,t.registration_order as tx_order from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where e.financial_space_id=p_space and e.reserve_id=p_reserve and e.amount_cents>0 and t.status='posted' and e.line_number=(select min(first.line_number) from finance.ledger_entries first where first.ledger_transaction_id=e.ledger_transaction_id and first.ledger_account_id=e.ledger_account_id and first.reserve_id=e.reserve_id and first.amount_cents>0) order by t.occurred_on,t.registration_order,e.line_number loop
    select array_agg(-e.amount_cents order by e.line_number) into weights from finance.ledger_entries e where e.ledger_transaction_id=item.ledger_transaction_id and e.card_statement_id is not null and e.amount_cents<0;
    if weights is null then
      if item.tx_on<=p_until then return query select item.id,item.tx_on,item.tx_at,item.tx_order,'consume'::text,item.linked_amount,item.ledger_transaction_id; end if;
    else
      allocations:=private.divide_cents(item.linked_amount,weights); ordinal:=0;
      for card_part in select e.*,s.period_start from finance.ledger_entries e join finance.card_statements s on s.id=e.card_statement_id where e.ledger_transaction_id=item.ledger_transaction_id and e.amount_cents<0 order by e.line_number loop
        ordinal:=ordinal+1;
        consume_on:=case when ordinal=1 then item.tx_on else greatest(item.tx_on,card_part.period_start) end;
        -- An anticipation brings the selected debt into the open statement now.
        select least(consume_on,min(t.occurred_on)) into consume_on from finance.ledger_transactions t join finance.ledger_entries e on e.ledger_transaction_id=t.id where t.related_transaction_id=item.ledger_transaction_id and t.kind='card_prepayment' and t.status='posted' and e.card_statement_id=card_part.card_statement_id and e.amount_cents>0;
        reduction:=0;
        for refund_part in select t.id,t.occurred_on from finance.ledger_transactions t where t.related_transaction_id=item.ledger_transaction_id and t.kind='refund' and t.status='posted' and t.occurred_on<=consume_on and t.occurred_on<=p_until loop
          -- A credit arriving on/before the consumption date cancels that future
          -- share; the first installment already consumed on the purchase date.
          if consume_on>item.tx_on then
            select coalesce(sum(coalesce((private.reserve_refund_allocations(refund_part.id,e.id)->>card_part.card_statement_id::text)::bigint,0)),0)::bigint into future_credit from finance.ledger_entries e where e.ledger_transaction_id=refund_part.id and e.reserve_id=p_reserve and e.ledger_account_id=item.ledger_account_id and e.amount_cents<0;
            reduction:=reduction+future_credit;
          end if;
        end loop;
        if consume_on<=p_until and allocations[ordinal]>reduction then return query select card_part.id,consume_on,item.tx_at,item.tx_order,'consume'::text,allocations[ordinal]-reduction,item.ledger_transaction_id; end if;
      end loop;
    end if;
  end loop;
  for item in select e.*,t.occurred_on as tx_on,t.created_at as tx_at,t.registration_order as tx_order,t.related_transaction_id from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where e.financial_space_id=p_space and e.reserve_id=p_reserve and e.amount_cents<0 and t.kind='refund' and t.status='posted' and t.occurred_on<=p_until loop
    select coalesce(-sum(e.amount_cents),0)::bigint into total_refund from finance.ledger_entries e join finance.ledger_accounts a on a.id=e.ledger_account_id where e.ledger_transaction_id=item.ledger_transaction_id and a.account_class='expense';
    select coalesce(sum(value::bigint),0)::bigint into future_credit from jsonb_each_text(private.reserve_refund_allocations(item.ledger_transaction_id,item.id));
    reduction:=future_credit;
    if -item.amount_cents>reduction then return query select item.id,item.tx_on,item.tx_at,item.tx_order,'refund'::text,-item.amount_cents-reduction,item.related_transaction_id; end if;
  end loop;
end;
$$;

create function private.reserve_balance(p_space uuid,p_reserve uuid,p_on date) returns jsonb language plpgsql stable set search_path = '' as $$
declare reserve finance.reserves; event record; balance bigint:=0; before_balance bigint; used bigint; common bigint; restored bigint; actual bigint; history jsonb:='[]'; tracker jsonb:='{}'; key text; state jsonb; amount_requested bigint; amount_used bigint; returned_common bigint; returned_reserve bigint; release_shortfall bigint:=0;
begin
  select * into reserve from finance.reserves where id=p_reserve and financial_space_id=p_space;
  if not found then raise exception 'Reserve not found' using errcode='P0002'; end if;
  if reserve.holding_mode='account' then return jsonb_build_object('balance_cents',greatest(0,private.account_balance_on(p_space,(select ledger_account_id from finance.financial_accounts where id=reserve.financial_account_id),p_on)),'events','[]'::jsonb,'release_shortfall_cents',0); end if;
  for event in select * from private.reserve_ledger_events(p_space,p_reserve,p_on) order by occurred_on,registration_order,event_id loop
    before_balance:=balance; used:=0; common:=0; restored:=0; actual:=event.amount_cents;
    key:=coalesce(event.original_id::text,'none'); state:=coalesce(tracker->key,'{}');
    amount_requested:=coalesce((state->>'requested')::bigint,0); amount_used:=coalesce((state->>'used')::bigint,0); returned_common:=coalesce((state->>'returned_common')::bigint,0); returned_reserve:=coalesce((state->>'returned_reserve')::bigint,0);
    if event.event_kind='contribution' then balance:=balance+actual;
    elsif event.event_kind='release' then actual:=least(balance,actual); balance:=balance-actual; release_shortfall:=release_shortfall+event.amount_cents-actual;
    elsif event.event_kind='terminal_release' then actual:=balance; balance:=0;
    elsif event.event_kind='consume' then used:=least(balance,actual); common:=actual-used; balance:=balance-used; amount_requested:=amount_requested+actual; amount_used:=amount_used+used;
    elsif event.event_kind='refund' then
      common:=least(actual,greatest(0,amount_requested-amount_used-returned_common)); returned_common:=returned_common+common;
      if reserve.terminal_on is null or (event.occurred_on,event.registration_order)<(reserve.terminal_on,reserve.terminal_order) then restored:=least(actual-common,greatest(0,amount_used-returned_reserve)); end if;
      returned_reserve:=returned_reserve+restored; balance:=balance+restored;
    end if;
    if event.original_id is not null then tracker:=jsonb_set(tracker,array[key],jsonb_build_object('requested',amount_requested,'used',amount_used,'returned_common',returned_common,'returned_reserve',returned_reserve),true); end if;
    history:=history||jsonb_build_array(jsonb_build_object('id',event.event_id,'on',event.occurred_on,'kind',event.event_kind,'amount_cents',event.amount_cents,'actual_cents',actual,'consumed_cents',used,'common_cents',common,'restored_cents',restored,'balance_cents',balance,'transaction_id',event.original_id));
  end loop;
  return jsonb_build_object('balance_cents',balance,'events',history,'release_shortfall_cents',release_shortfall);
end;
$$;

create function api.create_reserve(p_space uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; reserve_type text:=coalesce(p_payload->>'reserve_type','goal'); begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if char_length(trim(coalesce(p_payload->>'name','')))=0 then raise exception 'Reserve name required' using errcode='23514'; end if;
  insert into finance.reserves(financial_space_id,reserve_type,name,holding_mode,financial_account_id,target_amount_cents,target_date,category_id,contribution_mode,is_emergency_reserve,created_by)
    values(p_space,reserve_type,p_payload->>'name',coalesce(p_payload->>'holding_mode','virtual'),(p_payload->>'financial_account_id')::uuid,(p_payload->>'target_amount_cents')::bigint,(p_payload->>'target_date')::date,(p_payload->>'category_id')::uuid,'manual',coalesce((p_payload->>'is_emergency_reserve')::boolean,false),auth.uid()) returning id into result;
  if reserve_type='provision' then perform api.create_commitment(p_space,jsonb_build_object('title',p_payload->>'name','direction','outflow','certainty','confirmed','amount_cents',(p_payload->>'target_amount_cents')::bigint,'due_on',p_payload->>'target_date','category_id',p_payload->>'category_id','payment_method','account','payment_financial_account_id',p_payload->>'financial_account_id','reserve_id',result)); end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','reserve',result,p_payload);
  return result;
end;
$$;
create function api.reserve_contribution(p_space uuid,p_reserve uuid,p_kind text,p_amount_cents bigint,p_on date,p_note text default null,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare reserve finance.reserves; existing finance.reserve_contributions; result uuid; balance bigint; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_kind is null or p_kind not in('contribution','release') or p_amount_cents is null or p_amount_cents<1 or p_amount_cents>9007199254740991 or p_on is null then raise exception 'Invalid reserve contribution' using errcode='23514'; end if;
  if p_client_uuid is not null then
    select * into existing from finance.reserve_contributions where financial_space_id=p_space and client_uuid=p_client_uuid;
    if found then
      if (existing.reserve_id,existing.kind,existing.amount_cents,existing.occurred_on,existing.note) is distinct from (p_reserve,p_kind,p_amount_cents,p_on,p_note) then raise exception 'Client UUID reused with different reserve contribution' using errcode='23505'; end if;
      return existing.id;
    end if;
  end if;
  select * into reserve from finance.reserves where id=p_reserve and financial_space_id=p_space for update;
  if not found or reserve.status not in('active','achieved') or reserve.holding_mode<>'virtual' then raise exception 'Active virtual reserve required' using errcode='23514'; end if;
  if exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',p_on)::date and reopened_at is null) then raise exception 'Period is closed' using errcode='23514'; end if;
  balance:=(private.reserve_balance(p_space,p_reserve,p_on)->>'balance_cents')::bigint;
  if p_kind='release' and p_amount_cents>balance then raise exception 'Release exceeds reserve balance' using errcode='23514'; end if;
  insert into finance.reserve_contributions(financial_space_id,reserve_id,kind,origin,amount_cents,occurred_on,note,client_uuid,created_by) values(p_space,p_reserve,p_kind,'manual',p_amount_cents,p_on,p_note,p_client_uuid,auth.uid()) returning id into result;
  update finance.reserves set version=version+1,updated_at=now() where id=p_reserve;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),p_kind,'reserve_contribution',result,jsonb_build_object('reserve',p_reserve,'amount_cents',p_amount_cents,'on',p_on));
  return result;
end;
$$;
create function api.manage_reserve(p_space uuid,p_reserve uuid,p_version integer,p_action text,p_payload jsonb default '{}') returns uuid language plpgsql security definer set search_path = '' as $$
declare reserve finance.reserves; balance bigint; ending date:=coalesce((p_payload->>'on')::date,private.space_today(p_space)); begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into reserve from finance.reserves where id=p_reserve and financial_space_id=p_space for update;
  if not found then raise exception 'Reserve not found' using errcode='P0002'; end if;
  if reserve.version is distinct from p_version then raise exception 'Reserve changed; reload before editing' using errcode='40001'; end if;
  if reserve.status not in('active','achieved') then raise exception 'Reserve is terminal' using errcode='23514'; end if;
  if p_action='update' then
    if p_payload ? 'target_amount_cents' and reserve.reserve_type='provision' then raise exception 'Change the linked commitment amount together with the provision' using errcode='0A000'; end if;
    update finance.reserves set name=coalesce(nullif(trim(p_payload->>'name'),''),name),financial_account_id=coalesce((p_payload->>'financial_account_id')::uuid,financial_account_id),target_amount_cents=coalesce((p_payload->>'target_amount_cents')::bigint,target_amount_cents),target_date=case when p_payload ? 'target_date' then (p_payload->>'target_date')::date else target_date end,version=version+1,updated_at=now() where id=p_reserve;
  elsif p_action='close' then
    if exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',ending)::date and reopened_at is null) then raise exception 'Period is closed' using errcode='23514'; end if;
    if ending>private.space_today(p_space) then raise exception 'Cannot close a reserve in the future' using errcode='23514'; end if;
    if exists(select 1 from finance.reserve_contributions where reserve_id=p_reserve and cancelled_at is null and occurred_on>ending) then raise exception 'Resolve future contributions before closing the reserve' using errcode='23514'; end if;
    if reserve.reserve_type='provision' and exists(select 1 from finance.commitment_settlements where reserve_id=p_reserve and settlement_status in('pending','partial')) then raise exception 'Resolve linked commitments before closing the provision' using errcode='23514'; end if;
    balance:=(private.reserve_balance(p_space,p_reserve,ending)->>'balance_cents')::bigint;
    if reserve.holding_mode='virtual' and balance>0 then insert into finance.reserve_contributions(financial_space_id,reserve_id,kind,origin,amount_cents,occurred_on,note,created_by) values(p_space,p_reserve,'release','manual',balance,ending,'Encerramento da reserva',auth.uid()); end if;
    update finance.reserves set status='closed',terminal_on=ending,terminal_at=clock_timestamp(),terminal_order=nextval('finance.planning_event_order'),version=version+1,updated_at=now() where id=p_reserve;
  else raise exception 'Unknown reserve action' using errcode='23514'; end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),p_action,'reserve',p_reserve,to_jsonb(reserve),p_payload);
  return p_reserve;
end;
$$;
create function api.reserve_summary(p_space uuid,p_on date default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare day date:=coalesce(p_on,private.space_today(p_space)); result jsonb; begin
  if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)||private.reserve_balance(p_space,r.id,day)||jsonb_build_object('account_name',f.name,'status',case when r.terminal_on>day then 'active' else r.status end,'progress_status',case when r.status in('closed','settled') and r.terminal_on<=day then r.status when (private.reserve_balance(p_space,r.id,day)->>'balance_cents')::bigint>=r.target_amount_cents then 'achieved' else 'active' end) order by r.created_at,r.id),'[]') into result from finance.reserves r join finance.financial_accounts f on f.id=r.financial_account_id where r.financial_space_id=p_space and r.archived_at is null;
  return jsonb_build_object('on',day,'reserves',result,'reserved_cents',coalesce((select sum((x->>'balance_cents')::bigint) from jsonb_array_elements(result) x where x->>'holding_mode'='virtual' and x->>'status' in('active','achieved')),0),'uncovered_accounts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'uncovered_cents',a.reserved-a.cash)) from (select f.id,f.name,sum((x->>'balance_cents')::bigint) as reserved,private.account_balance_on(p_space,f.ledger_account_id,day) as cash from jsonb_array_elements(result) x join finance.financial_accounts f on f.id=(x->>'financial_account_id')::uuid where x->>'holding_mode'='virtual' and x->>'status' in('active','achieved') group by f.id) a where a.reserved>a.cash),'[]'));
end;
$$;

-- Refund category allocation retains the original reserve instead of silently
-- treating a linked purchase's refund as ordinary unreserved money.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('api.refund_transaction(uuid,uuid,bigint,date,uuid,text,uuid)'::regprocedure);
  definition:=replace(definition,'category_rows uuid[];','category_rows uuid[]; category_reserves uuid[];');
  definition:=replace(definition,'array_agg(ledger_account_id order by line_number),','array_agg(reserve_id order by line_number),array_agg(ledger_account_id order by line_number),');
  definition:=replace(definition,'into category_rows,','into category_reserves,category_rows,');
  definition:=replace(definition,'select e.ledger_account_id,min(e.line_number)','select e.reserve_id,e.ledger_account_id,min(e.line_number)');
  definition:=replace(definition,'r.ledger_account_id = e.ledger_account_id),0)','r.ledger_account_id = e.ledger_account_id and r.reserve_id is not distinct from e.reserve_id and coalesce(r.original_competence_month,r.competence_month,rt.competence_month)=coalesce(e.competence_month,original.competence_month)),0)');
  definition:=replace(definition,'group by e.ledger_account_id,coalesce(e.competence_month,original.competence_month)','group by e.reserve_id,e.ledger_account_id,e.competence_month');
  definition:=replace(definition,'''ledger_account_id'',category_rows[idx],''amount_cents''','''ledger_account_id'',category_rows[idx],''reserve_id'',category_reserves[idx],''amount_cents''');
  execute definition;
  definition:=pg_get_functiondef('api.settle_commitment(uuid,uuid,bigint,date,text,uuid,uuid)'::regprocedure);
  definition:=replace(definition,'''reserve_id'',commitment.reserve_id','''reserve_id'',case when counterpart.account_class=''expense'' or counterpart.liquidity=''property'' then commitment.reserve_id end');
  execute definition;
end $$;
revoke all on function private.validate_reserve(),private.reserve_refund_allocations(uuid,uuid),private.reserve_ledger_events(uuid,uuid,date),private.reserve_balance(uuid,uuid,date) from public,anon,authenticated;
revoke all on function api.create_reserve(uuid,jsonb),api.reserve_contribution(uuid,uuid,text,bigint,date,text,uuid),api.manage_reserve(uuid,uuid,integer,text,jsonb),api.reserve_summary(uuid,date) from public,anon,authenticated;
grant execute on function api.create_reserve(uuid,jsonb),api.reserve_contribution(uuid,uuid,text,bigint,date,text,uuid),api.manage_reserve(uuid,uuid,integer,text,jsonb),api.reserve_summary(uuid,date) to authenticated;
commit;
