begin;
alter table finance.people add column version integer not null default 1,add column opening_on date;
do $$ declare definition text; begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='finance.operation_requests'::regclass and conname='operation_requests_operation_check';
 alter table finance.operation_requests drop constraint operation_requests_operation_check;
 execute 'alter table finance.operation_requests add constraint operation_requests_operation_check check ('||substring(definition from 7)||' or operation = ''person_management'')';
end $$;

create function private.ensure_default_space_categories(p_space uuid) returns void language plpgsql set search_path='' as $$
declare item record; category finance.categories; category_id uuid; chosen_name text; suffix integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 for item in select * from (values('Encargos financeiros','expense','financial_charges',null::text),('Impostos e tarifas','expense','taxes_fees',null),('Cashback','income','cashback','cashback'),('Benefícios','income','benefits','benefit'),('Descontos obtidos','income','discounts_obtained','financial')) model(name,kind,system_role,income_class) loop
  if exists(select 1 from finance.categories where financial_space_id=p_space and system_role=item.system_role) then continue; end if;
  select * into category from finance.categories where financial_space_id=p_space and parent_id is null and lower(trim(name))=lower(item.name) and archived_at is null and deleted_at is null;
  if found and category.kind=item.kind and category.system_role is null and category.ledger_account_id is not null then
   update finance.categories set system_role=item.system_role,income_class=case when item.kind='income' then item.income_class else income_class end,version=version+1,updated_at=now() where id=category.id;
   category_id:=category.id;
  else
   chosen_name:=item.name; suffix:=0;
   while exists(select 1 from finance.categories where financial_space_id=p_space and parent_id is null and lower(trim(name))=lower(chosen_name) and archived_at is null and deleted_at is null) loop
    suffix:=suffix+1; chosen_name:=item.name||' (sistema '||suffix||')';
   end loop;
   category_id:=api.create_category(p_space,chosen_name,item.kind,null,item.income_class);
   update finance.categories set system_role=item.system_role where id=category_id;
  end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'default_role_initialized','category',category_id,jsonb_build_object('system_role',item.system_role));
 end loop;
end;
$$;
create function api.initialize_space_defaults(p_space uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin(p_space);
 perform private.ensure_default_space_categories(p_space);
 return p_space;
end;
$$;
-- The initial personal workspace and explicitly created workspaces share the
-- same model. Existing renamed roles are kept; only missing roles are seeded.
create or replace function api.create_personal_space(p_name text default 'Pessoal') returns uuid language plpgsql security definer set search_path='' as $$
declare space uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select s.id into space from finance.financial_spaces s join finance.financial_space_members m on m.financial_space_id=s.id and m.user_id=auth.uid() and m.status='active' and m.role in('owner','admin') where s.created_by=auth.uid() and s.kind='personal' and s.archived_at is null order by s.created_at,s.id limit 1;
 if space is null then return api.create_space(p_name,'America/Sao_Paulo','personal'); end if;
 perform private.ensure_default_space_categories(space); return space;
end;
$$;

create function api.manage_person(p_space uuid,p_person uuid,p_version integer,p_action text,p_changes jsonb default '{}',p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.people; result uuid; ledger uuid; opening uuid; amount bigint; on_day date; person_nickname text; person_notes text; current_balance numeric; total_balance numeric; request jsonb:=jsonb_build_object('person',p_person,'version',p_version,'action',p_action,'changes',p_changes);
begin
 perform private.require_writer(p_space);
 result:=private.loan_request_result(p_space,p_client_uuid,'person_management',request); if result is not null then return result; end if;
 if p_action is null or p_action not in('create','update','opening','archive','restore','delete') or jsonb_typeof(p_changes) is distinct from 'object' then raise exception 'Invalid person request' using errcode='23514'; end if;
 if p_action='create' then
  if p_person is not null or p_version is not null or exists(select 1 from jsonb_object_keys(p_changes) key where key not in('nickname','notes')) then raise exception 'Person creation accepts nickname and notes only' using errcode='23514'; end if;
  person_nickname:=trim(p_changes->>'nickname'); person_notes:=p_changes->>'notes';
  if person_nickname is null or char_length(person_nickname) not between 1 and 100 or char_length(person_notes)>2000 then raise exception 'Invalid person nickname or notes' using errcode='23514'; end if;
  insert into finance.ledger_accounts(financial_space_id,account_class,liquidity,owner_type,name,created_by) values(p_space,'asset','person','person',person_nickname,auth.uid()) returning id into ledger;
  insert into finance.people(financial_space_id,ledger_account_id,nickname,notes,created_by) values(p_space,ledger,person_nickname,person_notes,auth.uid()) returning id into result;
 else
  select * into previous from finance.people where financial_space_id=p_space and id=p_person and deleted_at is null for update;
  if not found then raise exception 'Person not found' using errcode='P0002'; end if;
  if previous.version is distinct from p_version then raise exception 'Person changed; reload before editing' using errcode='40001'; end if;
  result:=previous.id; ledger:=previous.ledger_account_id;
  if previous.archived_at is not null and p_action not in('restore','delete') then raise exception 'Restore person before editing' using errcode='23514'; end if;
  if p_action='update' then
   if exists(select 1 from jsonb_object_keys(p_changes) key where key not in('nickname','notes')) then raise exception 'Person editing accepts nickname and notes only' using errcode='23514'; end if;
   person_nickname:=case when p_changes ? 'nickname' then trim(p_changes->>'nickname') else previous.nickname end; person_notes:=case when p_changes ? 'notes' then p_changes->>'notes' else previous.notes end;
   if person_nickname is null or char_length(person_nickname) not between 1 and 100 or char_length(person_notes)>2000 then raise exception 'Invalid person nickname or notes' using errcode='23514'; end if;
   update finance.people set nickname=person_nickname,notes=person_notes,version=version+1,updated_at=now() where id=result;
   update finance.ledger_accounts set name=person_nickname,updated_at=now() where id=ledger;
  elsif p_action='opening' then
   if exists(select 1 from jsonb_object_keys(p_changes) key where key not in('balance_cents','on')) then raise exception 'Invalid person opening fields' using errcode='23514'; end if;
   amount:=(p_changes->>'balance_cents')::bigint; on_day:=(p_changes->>'on')::date;
   if amount is null or abs(amount::numeric)>9007199254740991 or on_day is null or not isfinite(on_day) or on_day>private.space_today(p_space) then raise exception 'Invalid person opening balance or date' using errcode='23514'; end if;
   if previous.kind<>'contact' or previous.opening_on is not null or exists(select 1 from finance.ledger_entries where ledger_account_id=ledger) then raise exception 'Person opening requires an unused contact' using errcode='23514'; end if;
   if exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',on_day)::date and reopened_at is null) then raise exception 'Person opening month is closed' using errcode='23514'; end if;
   if amount<>0 then
    select id into opening from finance.ledger_accounts where financial_space_id=p_space and system_role='opening';
    perform private.post_transaction_internal(p_space,jsonb_build_object('kind','opening','occurred_on',on_day,'competence_month',date_trunc('month',on_day)::date,'description','Saldo inicial: '||previous.nickname,'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',ledger,'amount_cents',amount),jsonb_build_object('ledger_account_id',opening,'amount_cents',-amount))),auth.uid());
   end if;
   update finance.people set opening_on=on_day,version=version+1,updated_at=now() where id=result;
  else
   if p_changes<>'{}'::jsonb then raise exception 'Person state changes do not edit contact details' using errcode='23514'; end if;
   if p_action='restore' then
    if previous.archived_at is null then raise exception 'Person is not archived' using errcode='23514'; end if;
    update finance.people set archived_at=null,version=version+1,updated_at=now() where id=result;
    update finance.ledger_accounts set archived_at=null,allows_posting=true,updated_at=now() where id=ledger;
   elsif p_action='archive' then
    if exists(select 1 from finance.financial_space_members where person_id=result and status='active') then raise exception 'Active member person cannot be archived' using errcode='23514'; end if;
    select coalesce(sum(amount_cents) filter(where occurred_on<=private.space_today(p_space)),0),coalesce(sum(amount_cents),0) into current_balance,total_balance from finance.posted_ledger_entries where ledger_account_id=ledger;
    if current_balance<>0 or total_balance<>0 then raise exception 'Person balance including scheduled entries must be zero' using errcode='23514'; end if;
    update finance.people set archived_at=now(),version=version+1,updated_at=now() where id=result;
    update finance.ledger_accounts set archived_at=now(),allows_posting=false,updated_at=now() where id=ledger;
   else
    if previous.kind<>'contact' or previous.linked_user_id is not null or previous.linked_financial_space_id is not null or exists(select 1 from finance.ledger_entries where ledger_account_id=ledger) or exists(select 1 from finance.commitments where person_id=result or counterpart_account_id=ledger) or exists(select 1 from finance.recurrence_rule_versions where counterpart_account_id=ledger) or exists(select 1 from finance.credit_card_holders where person_id=result) or exists(select 1 from finance.financial_space_members where person_id=result) or exists(select 1 from finance.categories where member_person_id=result) then raise exception 'Only unused and unlinked contacts may be deleted' using errcode='23514'; end if;
    update finance.people set deleted_at=now(),version=version+1,updated_at=now() where id=result;
    update finance.ledger_accounts set archived_at=coalesce(archived_at,now()),allows_posting=false,updated_at=now() where id=ledger;
   end if;
  end if;
 end if;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),p_action,'person',result,case when previous.id is not null then to_jsonb(previous) end,(select to_jsonb(p) from finance.people p where id=result));
 perform private.record_loan_request(p_space,p_client_uuid,'person_management',request,result); return result;
end;
$$;
create or replace function api.create_person(p_space uuid,p_nickname text,p_notes text default null) returns uuid language plpgsql security definer set search_path='' as $$
begin
 return api.manage_person(p_space,null,null,'create',jsonb_build_object('nickname',p_nickname,'notes',p_notes),null);
end;
$$;
create function private.person_versions() returns trigger language plpgsql set search_path='' as $$ begin if new.version=old.version then new.version:=old.version+1; end if; return new; end $$;
create trigger person_versions before update on finance.people for each row execute function private.person_versions();
-- Archiving preserves existing reminders, but does not permit new links to an
-- inactive contact. Completing an existing reminder remains available.
do $$ declare definition text; needle text:='  if new.kind <> ''reminder'' then'; begin
 definition:=pg_get_functiondef('private.validate_commitment()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Commitment validation guard not found'; end if;
 execute replace(definition,needle,'  if new.kind = ''reminder'' and (tg_op = ''INSERT'' or new.person_id is distinct from old.person_id) and not exists(select 1 from finance.people where id=new.person_id and financial_space_id=new.financial_space_id and archived_at is null and deleted_at is null) then raise exception ''Active person required for a new reminder'' using errcode=''23514''; end if;'||chr(10)||needle);
end $$;

create function api.people_management_summary(p_space uuid,p_include_archived boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare people jsonb;
begin
 if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('balance_cents',b.balance_cents,'scheduled_balance_cents',coalesce((select sum(amount_cents) from finance.posted_ledger_entries where ledger_account_id=p.ledger_account_id and occurred_on>private.space_today(p_space)),0),'reminders',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'due_on',c.effective_due_on,'completed_at',c.completed_at) order by c.effective_due_on,c.id) from finance.commitments c where c.person_id=p.id and c.deleted_at is null and c.cancelled_at is null),'[]')) order by p.nickname,p.id),'[]') into people from finance.people p join finance.account_balances b on b.id=p.ledger_account_id where p.financial_space_id=p_space and p.deleted_at is null and (p_include_archived or p.archived_at is null);
 return jsonb_build_object('people',people,'receivable_cents',coalesce((select sum(greatest((value->>'balance_cents')::bigint,0)) from jsonb_array_elements(people)),0),'payable_cents',coalesce((select sum(greatest(-(value->>'balance_cents')::bigint,0)) from jsonb_array_elements(people)),0));
end;
$$;
create function api.person_detail(p_space uuid,p_person uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare person finance.people; movements jsonb; reminders jsonb;
begin
 if not private.is_member(p_space) then raise exception 'Space permission required' using errcode='42501'; end if;
 select * into person from finance.people where financial_space_id=p_space and id=p_person and deleted_at is null;
 if not found then raise exception 'Person not found' using errcode='P0002'; end if;
 with grouped as (select t.id,t.occurred_on,t.created_at,t.description,t.kind,t.status,sum(e.amount_cents)::bigint as person_amount_cents from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id where e.ledger_account_id=person.ledger_account_id group by t.id),history as (select g.*,sum(case when status='posted' then person_amount_cents else 0 end) over(order by occurred_on,created_at,id rows unbounded preceding) as running_balance_cents from grouped g),recent as (select * from history order by occurred_on desc,created_at desc,id desc limit 200)
 select coalesce(jsonb_agg(to_jsonb(r) order by occurred_on desc,created_at desc,id desc),'[]') into movements from recent r;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.effective_due_on,c.id),'[]') into reminders from finance.commitments c where c.financial_space_id=p_space and c.person_id=person.id and c.deleted_at is null and c.cancelled_at is null;
 return jsonb_build_object('person',to_jsonb(person),'balance_cents',private.account_balance_on(p_space,person.ledger_account_id,private.space_today(p_space)),'movements',movements,'reminders',reminders);
end;
$$;
revoke all on function private.ensure_default_space_categories(uuid),private.person_versions() from public,anon,authenticated;
revoke all on function api.initialize_space_defaults(uuid) from public,anon,authenticated;
grant execute on function api.initialize_space_defaults(uuid) to authenticated;
revoke all on function api.manage_person(uuid,uuid,integer,text,jsonb,uuid),api.people_management_summary(uuid,boolean),api.person_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function api.manage_person(uuid,uuid,integer,text,jsonb,uuid),api.people_management_summary(uuid,boolean),api.person_detail(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
