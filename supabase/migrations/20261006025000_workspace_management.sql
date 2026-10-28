begin;
alter table finance.financial_spaces add column version integer not null default 1;
alter table finance.holidays add column version integer not null default 1;

create unique index category_sibling_name on finance.categories(financial_space_id,coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(trim(name))) where archived_at is null and deleted_at is null;
-- Enforce the depth of the whole subtree, including moves of existing parents.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('private.validate_category()'::regprocedure);
  definition:=replace(definition,'depth > 1000','depth > 2');
  definition:=replace(definition,'  if new.ledger_account_id is not null then',
    '  if depth + (with recursive children(id,level) as (select new.id,1 union all select c.id,ch.level+1 from children ch join finance.categories c on c.parent_id=ch.id where c.financial_space_id=new.financial_space_id and c.deleted_at is null and c.id<>new.id) select max(level) from children)>3 then raise exception ''Category hierarchy is too deep'' using errcode=''23514''; end if;
  if new.ledger_account_id is not null then');
  execute definition;
end $$;

create function api.my_spaces() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'timezone',s.timezone,'kind',s.kind,'version',s.version,'role',m.role) order by s.created_at,s.id)
    from finance.financial_spaces s join finance.financial_space_members m on m.financial_space_id=s.id and m.user_id=auth.uid() and m.status='active' where s.archived_at is null),'[]');
end;
$$;
create function api.create_space(p_name text,p_timezone text default 'America/Sao_Paulo',p_kind text default 'personal') returns uuid language plpgsql security definer set search_path='' as $$
declare space uuid; role text; item record;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if p_kind is null or p_kind not in('personal','shared') or not exists(select 1 from pg_timezone_names where name=p_timezone) or p_name is null or char_length(trim(p_name)) not between 1 and 100 then raise exception 'Invalid space name, kind or timezone' using errcode='23514'; end if;
  insert into finance.financial_spaces(name,timezone,kind,created_by) values(trim(p_name),p_timezone,p_kind,auth.uid()) returning id into space;
  insert into finance.financial_space_members(financial_space_id,user_id,role,joined_at,created_by) values(space,auth.uid(),'owner',now(),auth.uid());
  insert into finance.space_settings(financial_space_id) values(space);
  insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,system_role,name,created_by) values
    (space,'equity','system','opening','Abertura',auth.uid()),(space,'equity','system','balance_adjustment','Ajuste de saldo',auth.uid()),(space,'equity','system','investment_result','Resultado de investimentos',auth.uid());
  -- Minimal default category model; the user's own hierarchy can be extended.
  for item in select * from (values('Encargos financeiros','expense','financial_charges',null::text),('Impostos e tarifas','expense','taxes_fees',null),('Cashback','income','cashback','cashback'),('Benefícios','income','benefits','benefit'),('Descontos obtidos','income','discounts_obtained','financial')) model(name,kind,system_role,income_class) loop
    perform api.create_category(space,item.name,item.kind,null,item.income_class);
    update finance.categories set system_role=item.system_role where financial_space_id=space and name=item.name;
  end loop;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(space,auth.uid(),'created','financial_space',space,jsonb_build_object('name',trim(p_name),'timezone',p_timezone,'kind',p_kind));
  return space;
end;
$$;
create function api.update_space(p_space uuid,p_version integer,p_name text,p_timezone text) returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.financial_spaces;
begin
  perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into previous from finance.financial_spaces where id=p_space for update;
  if previous.version<>p_version then raise exception 'Space changed; reload before editing' using errcode='40001'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 100 or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid space name or timezone' using errcode='23514'; end if;
  update finance.financial_spaces set name=trim(p_name),timezone=p_timezone,version=version+1,updated_at=now() where id=p_space;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'updated','financial_space',p_space,to_jsonb(previous),jsonb_build_object('name',trim(p_name),'timezone',p_timezone));
  return p_space;
end;
$$;
create function api.manage_financial_account(p_space uuid,p_account uuid,p_version integer,p_action text,p_changes jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.financial_accounts; account finance.ledger_accounts; new_liquidity text; new_name text; emergency boolean;
begin
  perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into previous from finance.financial_accounts where financial_space_id=p_space and id=p_account and deleted_at is null for update;
  if not found then raise exception 'Account not found' using errcode='P0002'; end if;
  if previous.version<>p_version then raise exception 'Account changed; reload before editing' using errcode='40001'; end if;
  select * into account from finance.ledger_accounts where id=previous.ledger_account_id;
  if p_action='archive' then return api.archive_financial_account(p_space,p_account,p_version); end if;
  if p_action='restore' then
    update finance.financial_accounts set archived_at=null,version=version+1,updated_at=now() where id=p_account;
    update finance.ledger_accounts set archived_at=null,allows_posting=true,updated_at=now() where id=account.id;
  elsif p_action='update' then
    if previous.archived_at is not null then raise exception 'Restore account before editing' using errcode='23514'; end if;
    new_name:=coalesce(p_changes->>'name',previous.name); new_liquidity:=coalesce(p_changes->>'liquidity',account.liquidity); emergency:=coalesce((p_changes->>'is_emergency_reserve')::boolean,previous.is_emergency_reserve);
    if not (previous.kind in('checking','payment','savings','investment') and new_liquidity in('cash','investment') or previous.kind='wallet' and new_liquidity='cash' or previous.kind='benefit' and new_liquidity='benefit' or previous.kind='property' and new_liquidity='property') or emergency and new_liquidity<>'investment' then raise exception 'Liquidity or emergency reserve is invalid for this account' using errcode='23514'; end if;
    if new_liquidity<>account.liquidity and exists(select 1 from finance.reserves r where r.financial_account_id=p_account and r.status in('active','achieved') and r.archived_at is null and (r.holding_mode='virtual' and new_liquidity<>'cash' or r.holding_mode='account' and new_liquidity<>'investment')) then raise exception 'Close or relocate active reserves before changing liquidity' using errcode='23514'; end if;
    update finance.financial_accounts set name=trim(new_name),institution_name=case when p_changes ? 'institution_name' then p_changes->>'institution_name' else institution_name end,is_emergency_reserve=emergency,version=version+1,updated_at=now() where id=p_account;
    update finance.ledger_accounts set name=trim(new_name),liquidity=new_liquidity,updated_at=now() where id=account.id;
  else raise exception 'Invalid account action' using errcode='23514'; end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),p_action,'financial_account',p_account,to_jsonb(previous),(select to_jsonb(a) from finance.financial_accounts a where id=p_account));
  return p_account;
end;
$$;
create function api.account_adjustment(p_space uuid,p_account uuid,p_on date,p_statement_balance_cents bigint,p_reason text,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare account finance.financial_accounts; adjustment uuid; current_balance bigint; difference bigint; request jsonb; replay uuid;
begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  request:=jsonb_build_object('account',p_account,'on',p_on,'balance',p_statement_balance_cents,'reason',trim(p_reason));
  replay:=private.replay_operation(p_space,p_client_uuid,'account_adjustment',request); if replay is not null then return replay; end if;
  select a.* into account from finance.financial_accounts a join finance.ledger_accounts l on l.id=a.ledger_account_id and l.liquidity='cash' where a.financial_space_id=p_space and a.id=p_account and a.archived_at is null and a.deleted_at is null;
  if not found then raise exception 'Active cash account required' using errcode='23514'; end if;
  if p_on is null or not isfinite(p_on) or p_reason is null or char_length(trim(p_reason))<5 or p_statement_balance_cents is null or abs(p_statement_balance_cents::numeric)>9007199254740991 then raise exception 'Adjustment requires a valid balance and reason' using errcode='23514'; end if;
  if exists(select 1 from finance.period_closings where financial_space_id=p_space and month=date_trunc('month',p_on)::date and reopened_at is null) then raise exception 'Period is closed' using errcode='23514'; end if;
  current_balance:=private.account_balance_on(p_space,account.ledger_account_id,p_on); difference:=p_statement_balance_cents-current_balance;
  if difference=0 then raise exception 'Account balance already matches statement' using errcode='23514'; end if;
  select id into adjustment from finance.ledger_accounts where financial_space_id=p_space and system_role='balance_adjustment';
  return private.post_transaction_internal(p_space,jsonb_build_object('kind','balance_adjustment','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description','Ajuste de saldo: '||account.name,'notes',trim(p_reason),'client_uuid',p_client_uuid,'source','system','operation_receipt',jsonb_build_object('operation','account_adjustment','request',request),'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',account.ledger_account_id,'amount_cents',difference),jsonb_build_object('ledger_account_id',adjustment,'amount_cents',-difference))),auth.uid());
end;
$$;
create function api.manage_category(p_space uuid,p_category uuid,p_version integer,p_action text,p_changes jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare previous finance.categories; ledger uuid; is_archived boolean;
begin
  perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into previous from finance.categories where id=p_category and financial_space_id=p_space and deleted_at is null for update;
  if not found then raise exception 'Category not found' using errcode='P0002'; end if;
  if previous.version<>p_version then raise exception 'Category changed; reload before editing' using errcode='40001'; end if;
  if p_action='move' then return api.move_category(p_space,p_category,(p_changes->>'parent_id')::uuid,p_version); end if;
  if p_action in('archive','restore') then
    if previous.system_role is not null then raise exception 'System category cannot be archived' using errcode='23514'; end if;
    if exists(select 1 from finance.categories where parent_id=p_category and deleted_at is null) then raise exception 'Manage child categories first' using errcode='23514'; end if;
    update finance.categories set archived_at=case when p_action='archive' then now() else null end,version=version+1,updated_at=now() where id=p_category;
    update finance.ledger_accounts set allows_posting=p_action='restore',archived_at=case when p_action='archive' then now() else null end,updated_at=now() where id=previous.ledger_account_id;
  elsif p_action='update' then
    if previous.archived_at is not null then raise exception 'Restore category before editing' using errcode='23514'; end if;
    update finance.categories set name=coalesce(trim(p_changes->>'name'),name),icon=case when p_changes ? 'icon' then p_changes->>'icon' else icon end,color=case when p_changes ? 'color' then p_changes->>'color' else color end,
      is_essential=coalesce((p_changes->>'is_essential')::boolean,is_essential),fixity=coalesce(p_changes->>'fixity',fixity),is_tax_deductible=coalesce((p_changes->>'is_tax_deductible')::boolean,is_tax_deductible),income_class=coalesce(p_changes->>'income_class',income_class),version=version+1,updated_at=now() where id=p_category;
    update finance.ledger_accounts set name=coalesce(trim(p_changes->>'name'),name),updated_at=now() where id=previous.ledger_account_id;
  else raise exception 'Invalid category action' using errcode='23514'; end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),p_action,'category',p_category,to_jsonb(previous),(select to_jsonb(c) from finance.categories c where id=p_category));
  return p_category;
end;
$$;
create function api.management_data(p_space uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode='42501'; end if;
  return jsonb_build_object('space',(select to_jsonb(s) from finance.financial_spaces s where id=p_space),'accounts',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('liquidity',l.liquidity) order by a.name),'[]') from finance.financial_accounts a join finance.ledger_accounts l on l.id=a.ledger_account_id where a.financial_space_id=p_space and a.deleted_at is null),'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]') from finance.categories c where c.financial_space_id=p_space and c.deleted_at is null),'holidays',(select coalesce(jsonb_agg(to_jsonb(h) order by holiday_on),'[]') from finance.holidays h where financial_space_id=p_space));
end;
$$;
create function api.manage_local_holiday(p_space uuid,p_on date,p_name text,p_remove boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  perform private.require_admin(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_on is null or not isfinite(p_on) or p_remove is null or not p_remove and (p_name is null or char_length(trim(p_name)) not between 1 and 100) then raise exception 'Invalid local holiday' using errcode='23514'; end if;
  if p_remove then delete from finance.holidays where financial_space_id=p_space and holiday_on=p_on returning id into result;
  else insert into finance.holidays(financial_space_id,holiday_on,name,kind) values(p_space,p_on,trim(p_name),'local') on conflict(financial_space_id,holiday_on) where financial_space_id is not null do update set name=excluded.name,version=finance.holidays.version+1 returning id into result; end if;
  if result is not null then insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),case when p_remove then 'deleted' else 'updated' end,'holiday',result,jsonb_build_object('date',p_on,'name',p_name)); end if;
  return result;
end;
$$;
-- Administration of product registrations is separate from posting permission.
do $$ declare signature text; definition text; begin
  for signature in select * from (values('api.create_financial_account(uuid,text,text,bigint,date)'),('api.archive_financial_account(uuid,uuid,integer)'),('api.create_category(uuid,text,text,uuid,text,boolean,text)'),('api.move_category(uuid,uuid,uuid,integer)'),('api.create_credit_card(uuid,text,bigint,integer,integer,uuid)'),('api.create_budget(uuid,jsonb)'),('api.set_budget_month_amount(uuid,uuid,date,bigint)'),('api.create_reserve(uuid,jsonb)'),('api.manage_reserve(uuid,uuid,integer,text,jsonb)'),('api.manage_tag(uuid,uuid,integer,text,text,uuid)')) functions(signature) loop
    definition:=pg_get_functiondef(signature::regprocedure); execute replace(definition,'perform private.require_writer(p_space);','perform private.require_admin(p_space);');
  end loop;
end $$;
revoke all on function api.my_spaces(),api.create_space(text,text,text),api.update_space(uuid,integer,text,text),api.manage_financial_account(uuid,uuid,integer,text,jsonb),api.account_adjustment(uuid,uuid,date,bigint,text,uuid),api.manage_category(uuid,uuid,integer,text,jsonb),api.management_data(uuid),api.manage_local_holiday(uuid,date,text,boolean) from public,anon,authenticated;
grant execute on function api.my_spaces(),api.create_space(text,text,text),api.update_space(uuid,integer,text,text),api.manage_financial_account(uuid,uuid,integer,text,jsonb),api.account_adjustment(uuid,uuid,date,bigint,text,uuid),api.manage_category(uuid,uuid,integer,text,jsonb),api.management_data(uuid),api.manage_local_holiday(uuid,date,text,boolean) to authenticated;
commit;
