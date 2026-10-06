begin;
-- Section 29: invitations never persist their bearer token; the two journals of
-- a space transfer remain independent, balanced and scoped by composite FKs.
alter table finance.financial_space_members add column version integer not null default 1,
 add column person_id uuid,add column invited_nickname text,add column invitation_expires_at timestamptz,add column invitation_revoked_at timestamptz,
 add constraint member_person foreign key(financial_space_id,person_id) references finance.people(financial_space_id,id);
create unique index member_invitation_hash on finance.financial_space_members(invitation_token_hash) where invitation_token_hash is not null;
create unique index member_pending_email on finance.financial_space_members(financial_space_id,lower(invited_email)) where status = 'invited';
create unique index person_linked_member on finance.people(financial_space_id,linked_user_id) where linked_user_id is not null and kind in('member','former_member');
alter table finance.categories drop constraint categories_system_role_check;
alter table finance.categories add constraint categories_system_role_check check(system_role in('financial_charges','taxes_fees','cashback','benefits','discounts_obtained','space_transfer_out','space_contribution_in')),
 add column target_financial_space_id uuid references finance.financial_spaces(id),add column member_person_id uuid,
 add constraint contribution_person foreign key(financial_space_id,member_person_id) references finance.people(financial_space_id,id),
 add constraint sharing_role_refs check((system_role is not distinct from 'space_transfer_out') = (target_financial_space_id is not null) and (system_role is not distinct from 'space_contribution_in') = (member_person_id is not null) and target_financial_space_id is distinct from financial_space_id);
drop index finance.category_system_role;
create unique index category_system_role on finance.categories(financial_space_id,system_role) where system_role in('financial_charges','taxes_fees','cashback','benefits','discounts_obtained');
create unique index category_space_target on finance.categories(financial_space_id,target_financial_space_id) where system_role = 'space_transfer_out';
create unique index category_member_contribution on finance.categories(financial_space_id,member_person_id) where system_role = 'space_contribution_in';

create table finance.space_split_versions (
 id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id),
 version_number integer not null check(version_number > 0),effective_on date not null,
 mode text not null check(mode in('equal','percentage')),weights jsonb not null check(jsonb_typeof(weights) = 'array'),
 created_at timestamptz not null default clock_timestamp(),created_by uuid references auth.users(id),
 unique(financial_space_id,id),unique(financial_space_id,version_number)
);
alter table finance.financial_spaces add column split_version integer not null default 0;
create table finance.space_split_closures (
 id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id),
 member_id uuid not null,closed_through date not null,settlement_cents bigint not null,
 ledger_transaction_id uuid,calculation jsonb not null,created_at timestamptz not null default clock_timestamp(),created_by uuid references auth.users(id),
 unique(financial_space_id,id),unique(member_id),
 foreign key(financial_space_id,member_id) references finance.financial_space_members(financial_space_id,id),
 foreign key(financial_space_id,ledger_transaction_id) references finance.ledger_transactions(financial_space_id,id)
);
create table finance.space_transfer_pairs (
 id uuid primary key default gen_random_uuid(),origin_space_id uuid not null references finance.financial_spaces(id),destination_space_id uuid not null references finance.financial_spaces(id),
 origin_account_id uuid,origin_credit_card_id uuid,destination_account_id uuid,destination_category_id uuid,origin_transaction_id uuid not null,destination_transaction_id uuid not null,
 kind text not null check(kind in('contribution','withdrawal','debt_settlement','personal_expense')),
 occurred_on date not null,competence_month date not null,amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),
 version integer not null default 1,cancelled_at timestamptz,cancellation_reason text,
 request jsonb not null,created_at timestamptz not null default clock_timestamp(),created_by uuid references auth.users(id),
 check(origin_space_id <> destination_space_id),check((cancelled_at is null) = (cancellation_reason is null)),
 check(num_nonnulls(origin_account_id,origin_credit_card_id) = 1),check(kind = 'personal_expense' or origin_credit_card_id is null and destination_account_id is not null),check((kind = 'personal_expense') = (destination_category_id is not null)),
 unique(origin_transaction_id),unique(destination_transaction_id),
 foreign key(origin_space_id,origin_account_id) references finance.financial_accounts(financial_space_id,id),
 foreign key(origin_space_id,origin_credit_card_id) references finance.credit_cards(financial_space_id,id),
 foreign key(destination_space_id,destination_account_id) references finance.financial_accounts(financial_space_id,id),
 foreign key(destination_space_id,destination_category_id) references finance.categories(financial_space_id,id),
 foreign key(origin_space_id,origin_transaction_id) references finance.ledger_transactions(financial_space_id,id),
 foreign key(destination_space_id,destination_transaction_id) references finance.ledger_transactions(financial_space_id,id)
);
alter table finance.ledger_transactions add column space_transfer_id uuid references finance.space_transfer_pairs(id) deferrable initially deferred;
do $$ declare t text; begin
 foreach t in array array['space_split_versions','space_split_closures'] loop
  execute format('alter table finance.%I enable row level security',t);
  execute format('create policy member_read on finance.%I for select to authenticated using(private.is_member(financial_space_id))',t);
  execute format('revoke all on finance.%I from public,anon,authenticated',t); execute format('grant select on finance.%I to authenticated',t);
 end loop;
end $$;
alter table finance.space_transfer_pairs enable row level security;
create policy both_spaces_read on finance.space_transfer_pairs for select to authenticated using(private.is_member(origin_space_id) and private.is_member(destination_space_id));
revoke all on finance.space_transfer_pairs from public,anon,authenticated; grant select on finance.space_transfer_pairs to authenticated;
create function private.protect_split_history() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Space division history is immutable' using errcode = '23514'; end;
$$;
create trigger split_version_immutable before update or delete on finance.space_split_versions for each row execute function private.protect_split_history();
create trigger split_closure_immutable before update or delete on finance.space_split_closures for each row execute function private.protect_split_history();

create function private.lock_spaces(p_first uuid,p_second uuid) returns void language plpgsql set search_path = '' as $$
declare space uuid; begin
 for space in select distinct id from unnest(array[p_first,p_second]) id where id is not null order by id loop perform pg_advisory_xact_lock(hashtextextended(space::text,0)); end loop;
end;
$$;
-- Revocation and financial writes use the same lock. A queued writer cannot
-- pass authorization, wait for a removal, then write with obsolete membership.
do $$ declare definition text; signature text; begin
 foreach signature in array array['private.require_writer(uuid)','private.require_admin(uuid)'] loop
  definition := pg_get_functiondef(signature::regprocedure);
  execute replace(definition,'begin','begin perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));');
 end loop;
end $$;
create function private.require_owner(p_space uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 if not exists(select 1 from finance.financial_space_members where financial_space_id = p_space and user_id = auth.uid() and status = 'active' and role = 'owner') then raise exception 'Owner permission required' using errcode = '42501'; end if;
end;
$$;
create function private.ensure_member_objects(p_space uuid,p_user uuid,p_nickname text default null) returns uuid language plpgsql set search_path = '' as $$
declare person uuid; ledger uuid; chosen_nickname text; category_name text; begin
 select id into person from finance.people where financial_space_id = p_space and linked_user_id = p_user and kind in('member','former_member');
 chosen_nickname := coalesce(nullif(trim(p_nickname),''),(select split_part(email,'@',1) from auth.users where id = p_user),'Membro'); chosen_nickname := left(chosen_nickname,100);
 if person is null then
  insert into finance.ledger_accounts(financial_space_id,account_class,liquidity,owner_type,name,created_by) values(p_space,'asset','person','person',chosen_nickname,auth.uid()) returning id into ledger;
  insert into finance.people(financial_space_id,ledger_account_id,nickname,kind,linked_user_id,created_by) values(p_space,ledger,chosen_nickname,'member',p_user,auth.uid()) returning id into person;
 else update finance.people set kind = 'member',nickname = chosen_nickname,archived_at = null,updated_at = now() where id = person; end if;
 if not exists(select 1 from finance.categories where financial_space_id = p_space and member_person_id = person and system_role = 'space_contribution_in') then
  category_name := left('Aporte de ' || chosen_nickname,100);
  if exists(select 1 from finance.categories where financial_space_id = p_space and parent_id is null and lower(trim(name)) = lower(category_name) and archived_at is null and deleted_at is null) then category_name := left(category_name,89) || ' · ' || left(p_user::text,8); end if;
  insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,name,created_by) values(p_space,'income','category',category_name,auth.uid()) returning id into ledger;
  insert into finance.categories(financial_space_id,ledger_account_id,kind,name,income_class,system_role,member_person_id,created_by) values(p_space,ledger,'income',category_name,'extraordinary','space_contribution_in',person,auth.uid());
 end if;
 update finance.financial_space_members set person_id = person where financial_space_id = p_space and user_id = p_user and status = 'active' and person_id is distinct from person;
 return person;
end;
$$;
create function private.member_activation_objects() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.status = 'active' and new.person_id is null and exists(select 1 from finance.financial_spaces where id = new.financial_space_id and kind = 'shared') then perform private.ensure_member_objects(new.financial_space_id,new.user_id,new.invited_nickname); end if;
 return null;
end;
$$;
create trigger member_activation_objects after insert or update on finance.financial_space_members for each row execute function private.member_activation_objects();
do $$ declare existing_member record; begin
 for existing_member in select m.* from finance.financial_space_members m join finance.financial_spaces s on s.id = m.financial_space_id where m.status = 'active' and s.kind = 'shared' loop perform private.ensure_member_objects(existing_member.financial_space_id,existing_member.user_id); end loop;
end $$;
create function private.notify_membership(p_space uuid,p_member uuid,p_action text) returns void language plpgsql set search_path = '' as $$
declare recipient record; begin
 for recipient in select * from finance.financial_space_members where financial_space_id = p_space and status = 'active' loop
  perform private.emit_notification(p_space,recipient.user_id,recipient.role,'membership_changed','sharing','space_member',p_member,p_action || ':' || (select version::text from finance.financial_space_members where id = p_member),'informational','Membros ou permissões do espaço foram atualizados',jsonb_build_object('member_id',p_member,'action',p_action));
 end loop;
end;
$$;
create function api.invite_space_member(p_space uuid,p_email text,p_role text,p_nickname text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare token text; hash text; member uuid; expires timestamptz := clock_timestamp()+interval '7 days'; inviter_role text; begin
 perform private.require_admin(p_space);
 select role into inviter_role from finance.financial_space_members where financial_space_id = p_space and user_id = auth.uid() and status = 'active';
 if not exists(select 1 from finance.financial_spaces where id = p_space and kind = 'shared' and archived_at is null) then raise exception 'Invitations require an active shared space' using errcode = '23514'; end if;
 p_email := lower(trim(p_email));
 if p_email is null or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or p_role is null or p_role not in('owner','admin','member','viewer') or p_role = 'owner' and inviter_role <> 'owner' then raise exception 'Invalid invitation email or role' using errcode = '23514'; end if;
 if exists(select 1 from finance.financial_space_members m join auth.users u on u.id = m.user_id where m.financial_space_id = p_space and m.status = 'active' and lower(u.email) = p_email) then raise exception 'User is already a member' using errcode = '23514'; end if;
 if inviter_role <> 'owner' and exists(select 1 from finance.financial_space_members where financial_space_id = p_space and status = 'invited' and role = 'owner' and lower(invited_email) = p_email) then raise exception 'Owner permission required' using errcode = '42501'; end if;
 update finance.financial_space_members set status = 'left',invitation_revoked_at = clock_timestamp(),version = version+1,updated_at = now() where financial_space_id = p_space and status = 'invited' and lower(invited_email) = p_email;
 token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''); hash := encode(sha256(convert_to(token,'UTF8')),'hex');
 insert into finance.financial_space_members(financial_space_id,role,status,invited_email,invited_nickname,invitation_token_hash,invitation_expires_at,created_by) values(p_space,p_role,'invited',p_email,left(nullif(trim(p_nickname),''),100),hash,expires,auth.uid()) returning id into member;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'invited','space_member',member,jsonb_build_object('email',p_email,'role',p_role,'expires_at',expires,'nickname',p_nickname));
 return jsonb_build_object('id',member,'token',token,'expires_at',expires,'email',p_email,'role',p_role,'version',1);
end;
$$;
create function api.accept_space_invitation(p_token text) returns uuid language plpgsql security definer set search_path = '' as $$
declare member finance.financial_space_members; email text; begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
 select * into member from finance.financial_space_members where invitation_token_hash = encode(sha256(convert_to(coalesce(p_token,''),'UTF8')),'hex');
 if not found then raise exception 'Invitation is invalid or expired' using errcode = '23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(member.financial_space_id::text,0));
 select * into member from finance.financial_space_members where id = member.id for update;
 if member.invitation_revoked_at is not null or member.invitation_expires_at <= clock_timestamp() or not exists(select 1 from finance.financial_spaces where id = member.financial_space_id and archived_at is null) then raise exception 'Invitation is invalid or expired' using errcode = '23514'; end if;
 select lower(u.email) into email from auth.users u where u.id = auth.uid();
 if member.status = 'active' then raise exception 'Invitation has already been used' using errcode = '23514'; end if;
 if member.status <> 'invited' or email is null or email is distinct from lower(member.invited_email) then raise exception 'Invitation belongs to another email' using errcode = '42501'; end if;
 if exists(select 1 from finance.financial_space_members where financial_space_id = member.financial_space_id and user_id = auth.uid() and status = 'active') then raise exception 'User is already a member' using errcode = '23514'; end if;
 update finance.financial_space_members set user_id = auth.uid(),status = 'active',invited_email = null,joined_at = clock_timestamp(),version = version+1,updated_at = now() where id = member.id;
 perform private.ensure_member_objects(member.financial_space_id,auth.uid(),member.invited_nickname);
 perform private.insert_split_version(member.financial_space_id,private.space_today(member.financial_space_id),'equal',null);
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(member.financial_space_id,auth.uid(),'accepted','space_member',member.id,jsonb_build_object('role',member.role,'user_id',auth.uid()));
 perform private.notify_membership(member.financial_space_id,member.id,'accepted');
 return member.financial_space_id;
end;
$$;
create function api.revoke_space_invitation(p_space uuid,p_invitation uuid,p_version integer) returns uuid language plpgsql security definer set search_path = '' as $$
declare member finance.financial_space_members; begin
 perform private.require_admin(p_space);
 select * into member from finance.financial_space_members where financial_space_id = p_space and id = p_invitation for update;
 if not found or member.status <> 'invited' then raise exception 'Pending invitation not found' using errcode = 'P0002'; end if;
 if member.version is distinct from p_version then raise exception 'Invitation changed; reload before editing' using errcode = '40001'; end if;
 if member.role = 'owner' then perform private.require_owner(p_space); end if;
 update finance.financial_space_members set status = 'left',invitation_revoked_at = clock_timestamp(),version = version+1,updated_at = now() where id = member.id;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'invitation_revoked','space_member',member.id,jsonb_build_object('role',member.role));
 return member.id;
end;
$$;

-- Remaining paired financial and division APIs are declared below before grants.
create function private.ensure_space_category(p_space uuid,p_target uuid) returns uuid language plpgsql set search_path = '' as $$
declare category uuid; ledger uuid; label text; begin
 select ledger_account_id into category from finance.categories where financial_space_id = p_space and system_role = 'space_transfer_out' and target_financial_space_id = p_target;
 if category is not null then return category; end if;
 select left('Repasse ao espaço ' || name,100) into label from finance.financial_spaces where id = p_target;
 if label is null or p_space = p_target then raise exception 'Invalid target space' using errcode = '23514'; end if;
 if exists(select 1 from finance.categories where financial_space_id = p_space and parent_id is null and lower(trim(name)) = lower(label) and archived_at is null and deleted_at is null) then label := left(label,89) || ' · ' || left(p_target::text,8); end if;
 insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,name,created_by) values(p_space,'expense','category',label,auth.uid()) returning id into ledger;
 insert into finance.categories(financial_space_id,ledger_account_id,kind,name,fixity,system_role,target_financial_space_id,created_by) values(p_space,ledger,'expense',label,'variable','space_transfer_out',p_target,auth.uid());
 return ledger;
end;
$$;
create function private.ensure_space_person(p_space uuid,p_target uuid) returns uuid language plpgsql set search_path = '' as $$
declare person uuid; ledger uuid; label text; begin
 select ledger_account_id into person from finance.people where financial_space_id = p_space and linked_financial_space_id = p_target and kind = 'space' and deleted_at is null;
 if person is not null then return person; end if;
 select left('Espaço ' || name,100) into label from finance.financial_spaces where id = p_target;
 insert into finance.ledger_accounts(financial_space_id,account_class,liquidity,owner_type,name,created_by) values(p_space,'asset','person','person',label,auth.uid()) returning id into ledger;
 insert into finance.people(financial_space_id,ledger_account_id,nickname,kind,linked_financial_space_id,created_by) values(p_space,ledger,label,'space',p_target,auth.uid());
 return ledger;
end;
$$;
create function private.space_transfer_payloads(p_origin uuid,p_destination uuid,p_origin_account uuid,p_destination_account uuid,p_on date,p_amount bigint,p_kind text,p_member_user uuid,p_pair uuid,p_receipt jsonb default null,p_client uuid default null) returns jsonb language plpgsql set search_path = '' as $$
declare origin_ledger uuid; destination_ledger uuid; origin_counterpart uuid; destination_counterpart uuid; member_person uuid; origin_debt bigint; destination_debt bigint; sign integer := 1; begin
 if p_origin is null or p_destination is null or p_origin = p_destination or p_on is null or not isfinite(p_on) or p_amount is null or p_amount not between 1 and 9007199254740991 or p_kind is null or p_kind not in('contribution','withdrawal','debt_settlement') then raise exception 'Invalid space transfer' using errcode = '23514'; end if;
 select f.ledger_account_id into origin_ledger from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.id = p_origin_account and f.financial_space_id = p_origin and f.archived_at is null and f.deleted_at is null and a.liquidity = 'cash' and a.allows_posting;
 select f.ledger_account_id into destination_ledger from finance.financial_accounts f join finance.ledger_accounts a on a.id = f.ledger_account_id where f.id = p_destination_account and f.financial_space_id = p_destination and f.archived_at is null and f.deleted_at is null and a.liquidity = 'cash' and a.allows_posting;
 if origin_ledger is null or destination_ledger is null then raise exception 'Active cash accounts required in both spaces' using errcode = '23514'; end if;
 if p_kind = 'withdrawal' then sign := -1; end if;
 select id into member_person from finance.people where financial_space_id = p_destination and linked_user_id = p_member_user and kind in('member','former_member');
 if member_person is null then member_person := private.ensure_member_objects(p_destination,p_member_user); end if;
 if p_kind = 'debt_settlement' then
  origin_counterpart := private.ensure_space_person(p_origin,p_destination);
  select ledger_account_id into destination_counterpart from finance.people where id = member_person;
  origin_debt := private.account_balance_on(p_origin,origin_counterpart,p_on)-coalesce((select sum(e.amount_cents)::bigint from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where t.space_transfer_id = p_pair and t.status = 'posted' and t.occurred_on <= p_on and e.ledger_account_id = origin_counterpart),0);
  destination_debt := private.account_balance_on(p_destination,destination_counterpart,p_on)-coalesce((select sum(e.amount_cents)::bigint from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id where t.space_transfer_id = p_pair and t.status = 'posted' and t.occurred_on <= p_on and e.ledger_account_id = destination_counterpart),0);
  sign := case when origin_debt > 0 then -1 else 1 end;
  -- A payment can only reduce the opposing person balances, not create a loan.
  if origin_debt = 0 or destination_debt = 0 or origin_debt*sign >= 0 or destination_debt*sign <= 0 or p_amount > abs(origin_debt) or p_amount > abs(destination_debt) then raise exception 'Transfer exceeds matching member debt' using errcode = '23514'; end if;
 else
  origin_counterpart := private.ensure_space_category(p_origin,p_destination);
  select ledger_account_id into destination_counterpart from finance.categories where financial_space_id = p_destination and member_person_id = member_person and system_role = 'space_contribution_in';
 end if;
 return jsonb_build_object('origin',jsonb_build_object('kind','space_transfer','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',case when sign = 1 then 'Repasse entre espaços' else 'Retirada entre espaços' end,'space_transfer_id',p_pair,'operation_receipt',p_receipt,'client_uuid',p_client,
   'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',origin_ledger,'amount_cents',-sign*p_amount),jsonb_build_object('ledger_account_id',origin_counterpart,'amount_cents',sign*p_amount))),
  'destination',jsonb_build_object('kind','space_transfer','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',case when sign = 1 then 'Aporte entre espaços' else 'Retirada entre espaços' end,'space_transfer_id',p_pair,'operation_receipt',p_receipt,'client_uuid',p_client,
   'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',destination_ledger,'amount_cents',sign*p_amount),jsonb_build_object('ledger_account_id',destination_counterpart,'amount_cents',-sign*p_amount))));
end;
$$;
create function api.create_space_transfer(p_origin_space uuid,p_destination_space uuid,p_origin_account uuid,p_destination_account uuid,p_on date,p_amount_cents bigint,p_mode text default 'contribution',p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare request jsonb; origin_tx uuid; destination_tx uuid; pair uuid := gen_random_uuid(); payloads jsonb; begin
 perform private.lock_spaces(p_origin_space,p_destination_space); perform private.require_writer(p_origin_space); perform private.require_writer(p_destination_space);
 request := jsonb_build_object('origin_space',p_origin_space,'destination_space',p_destination_space,'origin_account',p_origin_account,'destination_account',p_destination_account,'on',p_on,'amount_cents',p_amount_cents,'mode',p_mode);
 origin_tx := private.replay_operation(p_origin_space,p_client_uuid,'space_transfer',request);
 destination_tx := private.replay_operation(p_destination_space,p_client_uuid,'space_transfer',request);
 if origin_tx is not null or destination_tx is not null then
  select id into pair from finance.space_transfer_pairs where origin_transaction_id = origin_tx and destination_transaction_id = destination_tx;
  if pair is null then raise exception 'Space transfer receipt has no matching pair' using errcode = '23514'; end if;
  return pair;
 end if;
 payloads := private.space_transfer_payloads(p_origin_space,p_destination_space,p_origin_account,p_destination_account,p_on,p_amount_cents,p_mode,auth.uid(),pair,jsonb_build_object('operation','space_transfer','request',request),p_client_uuid);
 origin_tx := private.post_transaction_internal(p_origin_space,payloads->'origin',auth.uid());
 destination_tx := private.post_transaction_internal(p_destination_space,payloads->'destination',auth.uid());
 insert into finance.space_transfer_pairs(id,origin_space_id,destination_space_id,origin_account_id,destination_account_id,origin_transaction_id,destination_transaction_id,kind,occurred_on,competence_month,amount_cents,request,created_by) values(pair,p_origin_space,p_destination_space,p_origin_account,p_destination_account,origin_tx,destination_tx,p_mode,p_on,date_trunc('month',p_on)::date,p_amount_cents,request,auth.uid());
 return pair;
end;
$$;
create function api.cancel_space_transfer(p_transfer uuid,p_version integer,p_reason text) returns uuid language plpgsql security definer set search_path = '' as $$
declare pair finance.space_transfer_pairs; origin_version integer; destination_version integer; begin
 select * into pair from finance.space_transfer_pairs where id = p_transfer;
 if not found then raise exception 'Space transfer not found' using errcode = 'P0002'; end if;
 perform private.lock_spaces(pair.origin_space_id,pair.destination_space_id); perform private.require_writer(pair.origin_space_id); perform private.require_writer(pair.destination_space_id);
 select * into pair from finance.space_transfer_pairs where id = p_transfer for update;
 if pair.version is distinct from p_version then raise exception 'Space transfer changed; reload before editing' using errcode = '40001'; end if;
 if pair.cancelled_at is not null then return pair.id; end if;
 select version into origin_version from finance.ledger_transactions where id = pair.origin_transaction_id;
 select version into destination_version from finance.ledger_transactions where id = pair.destination_transaction_id;
 perform private.cancel_space_transaction(pair.origin_space_id,pair.origin_transaction_id,origin_version,p_reason);
 perform private.cancel_space_transaction(pair.destination_space_id,pair.destination_transaction_id,destination_version,p_reason);
 update finance.space_transfer_pairs set cancelled_at = clock_timestamp(),cancellation_reason = p_reason,version = version+1 where id = pair.id;
 return pair.id;
end;
$$;
create function api.edit_space_transfer(p_transfer uuid,p_version integer,p_on date,p_amount_cents bigint,p_reason text,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare pair finance.space_transfer_pairs; origin_version integer; destination_version integer; payloads jsonb; request jsonb; replay uuid; other_replay uuid; payer uuid; space_person uuid; member_ledger uuid; statement uuid; category uuid; origin_kind text; begin
 select * into pair from finance.space_transfer_pairs where id = p_transfer;
 if not found then raise exception 'Space transfer not found' using errcode = 'P0002'; end if;
 perform private.lock_spaces(pair.origin_space_id,pair.destination_space_id); perform private.require_writer(pair.origin_space_id); perform private.require_writer(pair.destination_space_id);
 request := jsonb_build_object('transfer',p_transfer,'version',p_version,'on',p_on,'amount_cents',p_amount_cents,'reason',trim(p_reason));
 replay := private.loan_request_result(pair.origin_space_id,p_client_uuid,'edit_space_transfer',request);
 other_replay := private.loan_request_result(pair.destination_space_id,p_client_uuid,'edit_space_transfer',request);
 if replay is not null or other_replay is not null then
  if replay is distinct from other_replay then raise exception 'Paired edit receipt has no matching request' using errcode = '23514'; end if;
  return replay;
 end if;
 select * into pair from finance.space_transfer_pairs where id = p_transfer for update;
 if pair.version is distinct from p_version then raise exception 'Space transfer changed; reload before editing' using errcode = '40001'; end if;
 if pair.cancelled_at is not null then raise exception 'Space transfer cannot be edited' using errcode = '23514'; end if;
 if pair.kind = 'personal_expense' then
  if p_on is null or not isfinite(p_on) or p_amount_cents is null or p_amount_cents not between 1 and 9007199254740991 then raise exception 'Invalid personally paid shared expense' using errcode = '23514'; end if;
  select ledger_account_id into payer from finance.financial_accounts where id = pair.origin_account_id;
  if pair.origin_credit_card_id is not null then
   select ledger_account_id into payer from finance.credit_cards where id = pair.origin_credit_card_id;
   statement := private.ensure_card_statement(pair.origin_space_id,pair.origin_credit_card_id,p_on);
  end if;
  select ledger_account_id into space_person from finance.people where financial_space_id = pair.origin_space_id and kind = 'space' and linked_financial_space_id = pair.destination_space_id;
  select ledger_account_id into member_ledger from finance.people where financial_space_id = pair.destination_space_id and linked_user_id = pair.created_by and kind in('member','former_member');
  select ledger_account_id into category from finance.categories where id = pair.destination_category_id;
  select kind into origin_kind from finance.ledger_transactions where id = pair.origin_transaction_id;
  payloads := jsonb_build_object('origin',jsonb_build_object('kind',origin_kind,'occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',pair.request->>'description','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',space_person,'amount_cents',p_amount_cents),jsonb_build_object('ledger_account_id',payer,'amount_cents',-p_amount_cents,'card_statement_id',statement))),
   'destination',jsonb_build_object('kind','space_transfer','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',pair.request->>'description','entries',jsonb_build_array(jsonb_build_object('ledger_account_id',category,'amount_cents',p_amount_cents),jsonb_build_object('ledger_account_id',member_ledger,'amount_cents',-p_amount_cents))));
 else payloads := private.space_transfer_payloads(pair.origin_space_id,pair.destination_space_id,pair.origin_account_id,pair.destination_account_id,p_on,p_amount_cents,pair.kind,pair.created_by,pair.id); end if;
 select version into origin_version from finance.ledger_transactions where id = pair.origin_transaction_id;
 select version into destination_version from finance.ledger_transactions where id = pair.destination_transaction_id;
 perform private.edit_space_transaction(pair.origin_space_id,pair.origin_transaction_id,origin_version,payloads->'origin',p_reason);
 perform private.edit_space_transaction(pair.destination_space_id,pair.destination_transaction_id,destination_version,payloads->'destination',p_reason);
 update finance.space_transfer_pairs set occurred_on = p_on,competence_month = date_trunc('month',p_on)::date,amount_cents = p_amount_cents,version = version+1 where id = pair.id;
 perform private.record_loan_request(pair.origin_space_id,p_client_uuid,'edit_space_transfer',request,pair.id);
 perform private.record_loan_request(pair.destination_space_id,p_client_uuid,'edit_space_transfer',request,pair.id);
 return pair.id;
end;
$$;

create function private.insert_split_version(p_space uuid,p_effective_on date,p_mode text,p_weights jsonb) returns uuid language plpgsql set search_path = '' as $$
declare weights jsonb; count_members integer; total numeric; result uuid; number integer; begin
 if p_effective_on is null or not isfinite(p_effective_on) or p_mode is null or p_mode not in('equal','percentage') then raise exception 'Invalid space division rule' using errcode = '23514'; end if;
 select count(*) into count_members from finance.financial_space_members where financial_space_id = p_space and status = 'active';
 if count_members = 0 then raise exception 'Division requires active members' using errcode = '23514'; end if;
 if p_mode = 'equal' then
  select jsonb_agg(jsonb_build_object('member_id',id,'weight',1) order by id) into weights from finance.financial_space_members where financial_space_id = p_space and status = 'active';
 else
  if jsonb_typeof(p_weights) is distinct from 'array' or jsonb_array_length(p_weights) <> count_members or exists(select 1 from jsonb_array_elements(p_weights) w where w->>'member_id' is null or w->>'weight' is null or w->>'weight' !~ '^[0-9]+$' or (w->>'weight')::numeric not between 0 and 1000000 or not exists(select 1 from finance.financial_space_members where financial_space_id = p_space and id = (w->>'member_id')::uuid and status = 'active')) or
    (select count(distinct w->>'member_id') from jsonb_array_elements(p_weights) w) <> count_members then raise exception 'Percentage weights require each active member exactly once' using errcode = '23514'; end if;
  select sum((w->>'weight')::numeric),jsonb_agg(jsonb_build_object('member_id',(w->>'member_id')::uuid,'weight',(w->>'weight')::bigint) order by w->>'member_id') into total,weights from jsonb_array_elements(p_weights) w;
  if total <> 1000000 then raise exception 'Percentage weights must sum to 100 percent' using errcode = '23514'; end if;
 end if;
 update finance.financial_spaces set split_version = split_version+1 where id = p_space returning split_version into number;
 insert into finance.space_split_versions(financial_space_id,version_number,effective_on,mode,weights,created_by) values(p_space,number,p_effective_on,p_mode,weights,auth.uid()) returning id into result;
 return result;
end;
$$;
create function api.configure_space_split(p_space uuid,p_version integer,p_effective_on date,p_mode text,p_weights jsonb default null,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare request jsonb; result uuid; begin
 perform private.require_admin(p_space);
 request := jsonb_build_object('version',p_version,'effective_on',p_effective_on,'mode',p_mode,'weights',p_weights);
 result := private.loan_request_result(p_space,p_client_uuid,'configure_space_split',request); if result is not null then return result; end if;
 if not exists(select 1 from finance.financial_spaces where id = p_space and kind = 'shared' and split_version = p_version) then raise exception 'Division changed; reload before editing' using errcode = '40001'; end if;
 if exists(select 1 from finance.period_closings where financial_space_id = p_space and reopened_at is null and month >= date_trunc('month',p_effective_on)::date) or exists(select 1 from finance.space_split_closures where financial_space_id = p_space and closed_through >= p_effective_on) then raise exception 'Division period is already closed' using errcode = '23514'; end if;
 if p_mode = 'equal' and p_weights is not null then raise exception 'Equal division does not accept percentage weights' using errcode = '23514'; end if;
 result := private.insert_split_version(p_space,p_effective_on,p_mode,p_weights);
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'division_configured','space_split_version',result,request);
 perform private.record_loan_request(p_space,p_client_uuid,'configure_space_split',request,result);
 return result;
end;
$$;
create function private.split_weights_on(p_space uuid,p_on date) returns jsonb language plpgsql stable set search_path = '' as $$
declare weights jsonb; begin
 select v.weights into weights from finance.space_split_versions v where v.financial_space_id = p_space and v.effective_on <= p_on order by v.effective_on desc,v.version_number desc limit 1;
 if weights is null then
  select jsonb_agg(jsonb_build_object('member_id',m.id,'weight',1) order by m.id) into weights from finance.financial_space_members m join finance.financial_spaces s on s.id = m.financial_space_id where m.financial_space_id = p_space and m.user_id is not null and m.joined_at is not null and (m.joined_at at time zone s.timezone)::date <= p_on and (m.left_at is null or (m.left_at at time zone s.timezone)::date >= p_on);
 end if;
 if weights is null then raise exception 'No division rule covers this transaction date' using errcode = '23514'; end if;
 return weights;
end;
$$;
create function private.split_state_add(p_state jsonb,p_member uuid,p_key text,p_value bigint) returns jsonb language plpgsql immutable set search_path = '' as $$
declare current_value bigint; begin
 current_value := coalesce((p_state->p_member::text->>p_key)::bigint,0);
 if abs((current_value::numeric+p_value)) > 9007199254740991 then raise exception 'Division exceeds safe cents' using errcode = '23514'; end if;
 return jsonb_set(p_state,array[p_member::text],coalesce(p_state->p_member::text,'{}'::jsonb) || jsonb_build_object(p_key,current_value+p_value),true);
end;
$$;
create function private.calculate_member_settlement(p_space uuid,p_from date,p_to date) returns jsonb language plpgsql stable set search_path = '' as $$
declare start_on date := p_from; checkpoint finance.space_split_closures; state jsonb := '{}'; carry jsonb; member record; item record; weights jsonb; ids uuid[]; amounts bigint[]; parts bigint[]; i integer; contribution bigint; settle_carry bigint; carry_value bigint; cost bigint := 0; contributions bigint := 0; surplus bigint; result jsonb := '[]'; settlement bigint; begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to < p_from then raise exception 'Invalid settlement period' using errcode = '23514'; end if;
 select * into checkpoint from finance.space_split_closures where financial_space_id = p_space and closed_through <= p_to order by closed_through desc,created_at desc,id desc limit 1;
 if checkpoint.id is not null then
  start_on := greatest(p_from,checkpoint.closed_through+1);
  for carry in select value from jsonb_array_elements(checkpoint.calculation->'carry_forward') loop
   state := private.split_state_add(state,(carry->>'member_id')::uuid,'carry_in_cents',(carry->>'amount_cents')::bigint);
   state := private.split_state_add(state,(carry->>'member_id')::uuid,'carry_remaining_cents',(carry->>'amount_cents')::bigint);
  end loop;
 end if;
 -- Current period cash contributions first discharge carried claims of the
 -- opposite sign. Only their excess participates in this segment's division.
 for item in select e.*,c.member_person_id,m.id as member_id,t.occurred_on,t.registration_order from finance.ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id join finance.categories c on c.ledger_account_id = e.ledger_account_id join lateral(select fm.id,fm.status from finance.financial_space_members fm join finance.financial_spaces fs on fs.id = fm.financial_space_id where fm.person_id = c.member_person_id and (fm.joined_at at time zone fs.timezone)::date <= t.occurred_on and (fm.left_at is null or (fm.left_at at time zone fs.timezone)::date >= t.occurred_on) order by fm.joined_at desc limit 1) m on true
   where e.financial_space_id = p_space and t.status = 'posted' and t.kind <> 'member_exit' and c.system_role = 'space_contribution_in' and t.occurred_on between start_on and p_to and m.status in('active','left')
   order by t.occurred_on,t.registration_order,e.line_number loop
  contribution := -item.amount_cents; carry_value := coalesce((state->item.member_id::text->>'carry_remaining_cents')::bigint,0); settle_carry := 0;
  if contribution*sign(carry_value) < 0 then settle_carry := least(abs(contribution),abs(carry_value))*sign(contribution); end if;
  state := private.split_state_add(state,item.member_id,'carry_remaining_cents',settle_carry);
  state := private.split_state_add(state,item.member_id,'carry_settled_cents',-settle_carry);
  state := private.split_state_add(state,item.member_id,'contribution_cents',contribution-settle_carry);
  contributions := contributions+contribution-settle_carry;
 end loop;
 -- Expense minus non-contribution income, by competence, allocated using the
 -- immutable rule that was effective on the actual transaction date.
 for item in select e.amount_cents,t.occurred_on from finance.posted_ledger_entries e join finance.ledger_transactions t on t.id = e.ledger_transaction_id join finance.categories c on c.ledger_account_id = e.ledger_account_id
   where e.financial_space_id = p_space and c.system_role is distinct from 'space_contribution_in' and e.effective_competence_month between date_trunc('month',start_on)::date and date_trunc('month',p_to)::date and
     (start_on = date_trunc('month',start_on)::date or t.occurred_on >= start_on) and (p_to = (date_trunc('month',p_to)+interval '1 month - 1 day')::date or t.occurred_on <= p_to) and t.kind <> 'member_exit' order by t.occurred_on,t.registration_order,e.line_number loop
  weights := private.split_weights_on(p_space,item.occurred_on);
  select array_agg((w->>'member_id')::uuid order by ordinal),array_agg((w->>'weight')::bigint order by ordinal) into ids,amounts from jsonb_array_elements(weights) with ordinality q(w,ordinal);
  parts := private.divide_cents(item.amount_cents,amounts); cost := cost+item.amount_cents;
  for i in 1..array_length(ids,1) loop state := private.split_state_add(state,ids[i],'share_cents',parts[i]); end loop;
 end loop;
 surplus := contributions-cost;
 weights := private.split_weights_on(p_space,p_to);
 select array_agg((w->>'member_id')::uuid order by ordinal),array_agg((w->>'weight')::bigint order by ordinal) into ids,amounts from jsonb_array_elements(weights) with ordinality q(w,ordinal);
 parts := private.divide_cents(surplus,amounts);
 for i in 1..array_length(ids,1) loop state := private.split_state_add(state,ids[i],'surplus_share_cents',parts[i]); end loop;
 for member in select m.*,p.nickname,coalesce(b.balance_cents,0) as person_balance from finance.financial_space_members m left join finance.people p on p.id = m.person_id left join finance.account_balances b on b.id = p.ledger_account_id where m.financial_space_id = p_space and m.user_id is not null and (state ? m.id::text or m.status = 'active') order by m.id loop
  carry := coalesce(state->member.id::text,'{}'::jsonb);
  settlement := coalesce((carry->>'contribution_cents')::bigint,0)-coalesce((carry->>'share_cents')::bigint,0)-coalesce((carry->>'surplus_share_cents')::bigint,0)+coalesce((carry->>'carry_remaining_cents')::bigint,0);
  result := result || jsonb_build_array(jsonb_build_object('member_id',member.id,'person_id',member.person_id,'nickname',member.nickname,'status',member.status,'contribution_cents',coalesce((carry->>'contribution_cents')::bigint,0),'share_cents',coalesce((carry->>'share_cents')::bigint,0),'surplus_share_cents',coalesce((carry->>'surplus_share_cents')::bigint,0),'carry_in_cents',coalesce((carry->>'carry_in_cents')::bigint,0),'carry_settled_cents',coalesce((carry->>'carry_settled_cents')::bigint,0),'carry_remaining_cents',coalesce((carry->>'carry_remaining_cents')::bigint,0),'settlement_cents',settlement,'person_balance_cents',member.person_balance));
 end loop;
 return jsonb_build_object('requested_from',p_from,'from',start_on,'to',p_to,'checkpoint_id',checkpoint.id,'closed_through',checkpoint.closed_through,'cost_cents',cost,'contributions_cents',contributions,'surplus_cents',surplus,'members',result);
end;
$$;

create function api.record_member_settlement(p_space uuid,p_from_member uuid,p_to_member uuid,p_on date,p_amount_cents bigint,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare from_ledger uuid; to_ledger uuid; request jsonb; tx uuid; begin
 perform private.require_writer(p_space);
 request := jsonb_build_object('from_member',p_from_member,'to_member',p_to_member,'on',p_on,'amount_cents',p_amount_cents);
 tx := private.replay_operation(p_space,p_client_uuid,'member_settlement',request); if tx is not null then return tx; end if;
 if p_from_member is null or p_to_member is null or p_from_member = p_to_member or p_on is null or not isfinite(p_on) or p_amount_cents is null or p_amount_cents not between 1 and 9007199254740991 then raise exception 'Invalid external member settlement' using errcode = '23514'; end if;
 select c.ledger_account_id into from_ledger from finance.financial_space_members m join finance.categories c on c.member_person_id = m.person_id where m.financial_space_id = p_space and m.id = p_from_member and m.status = 'active' and c.system_role = 'space_contribution_in';
 select c.ledger_account_id into to_ledger from finance.financial_space_members m join finance.categories c on c.member_person_id = m.person_id where m.financial_space_id = p_space and m.id = p_to_member and m.status = 'active' and c.system_role = 'space_contribution_in';
 if from_ledger is null or to_ledger is null then raise exception 'Active members with contribution categories required' using errcode = '23514'; end if;
 return private.post_transaction_internal(p_space,jsonb_build_object('kind','member_settlement','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description','Acerto entre membros realizado fora do espaço','client_uuid',p_client_uuid,'operation_receipt',jsonb_build_object('operation','member_settlement','request',request),'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',from_ledger,'amount_cents',-p_amount_cents),jsonb_build_object('ledger_account_id',to_ledger,'amount_cents',p_amount_cents))),auth.uid());
end;
$$;
create function api.manage_space_member(p_space uuid,p_member uuid,p_version integer,p_action text,p_role text default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare member finance.financial_space_members; actor_role text; settlement jsonb; member_amount bigint := 0; carry jsonb; tx uuid; ledger uuid; contribution uuid; day date; since date; weights jsonb; total bigint; begin
 perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
 if p_action = 'leave' then
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode = '42501'; end if;
 else perform private.require_admin(p_space); end if;
 select role into actor_role from finance.financial_space_members where financial_space_id = p_space and user_id = auth.uid() and status = 'active';
 select * into member from finance.financial_space_members where financial_space_id = p_space and id = p_member and status = 'active' for update;
 if not found then raise exception 'Active space member not found' using errcode = 'P0002'; end if;
 if member.version is distinct from p_version then raise exception 'Member changed; reload before editing' using errcode = '40001'; end if;
 if p_action in('role','transfer_ownership') or p_action = 'remove' and member.role in('owner','admin') then perform private.require_owner(p_space); end if;
 if p_action = 'leave' and member.user_id <> auth.uid() then raise exception 'Members may only leave for themselves' using errcode = '42501'; end if;
 if p_action in('role','transfer_ownership') then
  if p_action = 'transfer_ownership' then
   if member.user_id = auth.uid() then raise exception 'Select another member for ownership' using errcode = '23514'; end if;
   update finance.financial_space_members set role = 'owner',version = version+1,updated_at = now() where id = member.id;
   update finance.financial_space_members set role = 'admin',version = version+1,updated_at = now() where financial_space_id = p_space and user_id = auth.uid() and status = 'active';
  else
   if p_role is null or p_role not in('owner','admin','member','viewer') then raise exception 'Invalid member role' using errcode = '23514'; end if;
   if member.role = 'owner' and p_role <> 'owner' and not exists(select 1 from finance.financial_space_members where financial_space_id = p_space and id <> member.id and status = 'active' and role = 'owner') then raise exception 'Last owner cannot leave or be demoted' using errcode = '23514'; end if;
   update finance.financial_space_members set role = p_role,version = version+1,updated_at = now() where id = member.id;
  end if;
 elsif p_action in('remove','leave') then
  if member.role = 'owner' and not exists(select 1 from finance.financial_space_members where financial_space_id = p_space and id <> member.id and status = 'active' and role = 'owner') then raise exception 'Last owner cannot leave or be demoted' using errcode = '23514'; end if;
  day := private.space_today(p_space);
   if exists(select 1 from finance.period_closings where financial_space_id = p_space and month = date_trunc('month',day)::date and reopened_at is null) then raise exception 'Period is closed' using errcode = '23514'; end if;
  select coalesce(min((joined_at at time zone s.timezone)::date),day) into since from finance.financial_space_members m join finance.financial_spaces s on s.id = m.financial_space_id where m.financial_space_id = p_space;
  settlement := private.calculate_member_settlement(p_space,since,day);
  select (value->>'settlement_cents')::bigint into member_amount from jsonb_array_elements(settlement->'members') where value->>'member_id' = member.id::text;
  member_amount := coalesce(member_amount,0);
  select p.ledger_account_id,c.ledger_account_id into ledger,contribution from finance.people p join finance.categories c on c.member_person_id = p.id and c.system_role = 'space_contribution_in' where p.id = member.person_id;
  if member_amount <> 0 then
   if ledger is null or contribution is null then raise exception 'Member closing accounts missing' using errcode = '23514'; end if;
   tx := private.post_transaction_internal(p_space,jsonb_build_object('kind','member_exit','occurred_on',day,'competence_month',date_trunc('month',day)::date,'description','Encerramento do acerto do membro','operation_receipt',jsonb_build_object('operation','member_exit','request',jsonb_build_object('member',member.id,'through',day)),'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',ledger,'amount_cents',-member_amount),jsonb_build_object('ledger_account_id',contribution,'amount_cents',member_amount))),auth.uid());
  end if;
  -- Carry every remaining member's full claim, so removing Ana never erases
  -- Bruno's 30000 claim in 29.8.4. The departing claim becomes person debt.
  select coalesce(jsonb_agg(jsonb_build_object('member_id',value->'member_id','amount_cents',value->'settlement_cents') order by value->>'member_id'),'[]') into carry from jsonb_array_elements(settlement->'members') where value->>'member_id' <> member.id::text;
  insert into finance.space_split_closures(financial_space_id,member_id,closed_through,settlement_cents,ledger_transaction_id,calculation,created_by) values(p_space,member.id,day,member_amount,tx,settlement || jsonb_build_object('carry_forward',carry),auth.uid());
  update finance.financial_space_members set status = 'left',left_at = clock_timestamp(),version = version+1,updated_at = now() where id = member.id;
  update finance.people set kind = 'former_member',nickname = left(regexp_replace(nickname,' \(ex-membro\)$',''),87) || ' (ex-membro)',updated_at = now() where id = member.person_id;
  update finance.ledger_accounts a set name = p.nickname,updated_at = now() from finance.people p where p.id = member.person_id and a.id = p.ledger_account_id;
  -- Renormalize the preceding proportions among the remaining members rather
  -- than reset outstanding claims or rewrite any earlier division version.
  weights := private.split_weights_on(p_space,day);
  select sum((value->>'weight')::bigint) into total from jsonb_array_elements(weights) where value->>'member_id' <> member.id::text and exists(select 1 from finance.financial_space_members where id = (value->>'member_id')::uuid and status = 'active');
  if total > 0 then
   select jsonb_agg(jsonb_build_object('member_id',id,'weight',parts[ordinal]) order by id) into weights from (
    select (value->>'member_id')::uuid as id,row_number() over(order by value->>'member_id')::integer as ordinal,
     private.divide_cents(1000000,array_agg((value->>'weight')::bigint) over(order by value->>'member_id' rows between unbounded preceding and unbounded following)) as parts
    from jsonb_array_elements(weights) where value->>'member_id' <> member.id::text and exists(select 1 from finance.financial_space_members where id = (value->>'member_id')::uuid and status = 'active')
   ) q;
   perform private.insert_split_version(p_space,day+1,'percentage',weights);
  else perform private.insert_split_version(p_space,day+1,'equal',null); end if;
 else raise exception 'Invalid membership action' using errcode = '23514'; end if;
 insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),p_action,'space_member',member.id,to_jsonb(member),jsonb_build_object('role',p_role,'settlement_cents',member_amount,'calculation',settlement));
 perform private.notify_membership(p_space,member.id,p_action);
 return member.id;
end;
$$;
create function api.sharing_summary(p_space uuid,p_from date default null,p_to date default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare from_day date := coalesce(p_from,date_trunc('month',private.space_today(p_space))::date); to_day date := coalesce(p_to,private.space_today(p_space)); begin
 if not private.is_member(p_space) then raise exception 'Space access denied' using errcode = '42501'; end if;
 return jsonb_build_object('space_id',p_space,'space_kind',(select kind from finance.financial_spaces where id = p_space),'current_user_id',auth.uid(),'split_version',(select split_version from finance.financial_spaces where id = p_space),
  'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'role',m.role,'status',m.status,'version',m.version,'nickname',p.nickname,'person_id',m.person_id) order by m.created_at,m.id) from finance.financial_space_members m left join finance.people p on p.id = m.person_id where m.financial_space_id = p_space and m.user_id is not null),'[]'),
  'invitations',case when exists(select 1 from finance.financial_space_members where financial_space_id = p_space and user_id = auth.uid() and role in('owner','admin') and status = 'active') then coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',invited_email,'role',role,'version',version,'expires_at',invitation_expires_at) order by created_at) from finance.financial_space_members where financial_space_id = p_space and status = 'invited'),'[]') else '[]'::jsonb end,
  'rule_versions',coalesce((select jsonb_agg(to_jsonb(v) order by version_number) from finance.space_split_versions v where financial_space_id = p_space),'[]'),
  'settlement',private.calculate_member_settlement(p_space,from_day,to_day),
  'person_balances',coalesce((select jsonb_agg(jsonb_build_object('person_id',p.id,'nickname',p.nickname,'kind',p.kind,'balance_cents',b.balance_cents) order by p.nickname) from finance.people p join finance.account_balances b on b.id = p.ledger_account_id where p.financial_space_id = p_space and p.kind in('member','former_member') and p.deleted_at is null),'[]'),
  'transfers',coalesce((select jsonb_agg(to_jsonb(t) order by t.occurred_on desc,t.created_at desc) from finance.space_transfer_pairs t where (t.origin_space_id = p_space or t.destination_space_id = p_space) and private.is_member(t.origin_space_id) and private.is_member(t.destination_space_id)),'[]'),
  'spaces',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'role',m.role,'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) order by f.name) from finance.financial_accounts f join finance.ledger_accounts l on l.id = f.ledger_account_id where f.financial_space_id = s.id and f.archived_at is null and f.deleted_at is null and l.liquidity = 'cash'),'[]'::jsonb))) from finance.financial_spaces s join finance.financial_space_members m on m.financial_space_id = s.id and m.user_id = auth.uid() and m.status = 'active' where s.archived_at is null),'[]'));
end;
$$;

create function api.create_space_personal_expense(p_origin_space uuid,p_destination_space uuid,p_category uuid,p_on date,p_amount_cents bigint,p_description text,p_account uuid default null,p_card uuid default null,p_client_uuid uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare request jsonb; pair uuid := gen_random_uuid(); origin_tx uuid; destination_tx uuid; payer uuid; category uuid; space_person uuid; member_person uuid; member_ledger uuid; statement uuid; begin
 perform private.lock_spaces(p_origin_space,p_destination_space); perform private.require_writer(p_origin_space); perform private.require_writer(p_destination_space);
 request := jsonb_build_object('origin',p_origin_space,'destination',p_destination_space,'category',p_category,'on',p_on,'amount_cents',p_amount_cents,'description',p_description,'account',p_account,'card',p_card);
 origin_tx := private.replay_operation(p_origin_space,p_client_uuid,'space_personal_expense',request); destination_tx := private.replay_operation(p_destination_space,p_client_uuid,'space_personal_expense',request);
 if origin_tx is not null or destination_tx is not null then
  select id into pair from finance.space_transfer_pairs where origin_transaction_id = origin_tx and destination_transaction_id = destination_tx;
  if pair is null then raise exception 'Space transfer receipt has no matching pair' using errcode = '23514'; end if;
  return pair;
 end if;
 if p_origin_space = p_destination_space or p_on is null or not isfinite(p_on) or p_amount_cents is null or p_amount_cents not between 1 and 9007199254740991 or num_nonnulls(p_account,p_card) <> 1 or nullif(trim(p_description),'') is null then raise exception 'Invalid personally paid shared expense' using errcode = '23514'; end if;
 if p_card is not null then
  select ledger_account_id into payer from finance.credit_cards where id = p_card and financial_space_id = p_origin_space and status = 'active';
  if payer is not null then statement := private.ensure_card_statement(p_origin_space,p_card,p_on); end if;
 else select f.ledger_account_id into payer from finance.financial_accounts f join finance.ledger_accounts l on l.id = f.ledger_account_id where f.id = p_account and f.financial_space_id = p_origin_space and f.archived_at is null and f.deleted_at is null and l.liquidity = 'cash'; end if;
 select ledger_account_id into category from finance.categories where id = p_category and financial_space_id = p_destination_space and kind = 'expense' and archived_at is null and deleted_at is null and system_role is distinct from 'space_transfer_out';
 if payer is null or category is null then raise exception 'Personal payment source and shared expense category required' using errcode = '23514'; end if;
 space_person := private.ensure_space_person(p_origin_space,p_destination_space); member_person := private.ensure_member_objects(p_destination_space,auth.uid());
 select ledger_account_id into member_ledger from finance.people where id = member_person;
 origin_tx := private.post_transaction_internal(p_origin_space,jsonb_build_object('kind',case when p_card is null then 'space_transfer' else 'card_purchase' end,'occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',left(p_description,200),'client_uuid',p_client_uuid,'space_transfer_id',pair,'operation_receipt',jsonb_build_object('operation','space_personal_expense','request',request),'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',space_person,'amount_cents',p_amount_cents),jsonb_build_object('ledger_account_id',payer,'amount_cents',-p_amount_cents,'card_statement_id',statement))),auth.uid());
 destination_tx := private.post_transaction_internal(p_destination_space,jsonb_build_object('kind','space_transfer','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',left(p_description,200),'client_uuid',p_client_uuid,'space_transfer_id',pair,'operation_receipt',jsonb_build_object('operation','space_personal_expense','request',request),'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',category,'amount_cents',p_amount_cents),jsonb_build_object('ledger_account_id',member_ledger,'amount_cents',-p_amount_cents))),auth.uid());
 insert into finance.space_transfer_pairs(id,origin_space_id,destination_space_id,origin_account_id,origin_credit_card_id,destination_category_id,origin_transaction_id,destination_transaction_id,kind,occurred_on,competence_month,amount_cents,request,created_by) values(pair,p_origin_space,p_destination_space,p_account,p_card,p_category,origin_tx,destination_tx,'personal_expense',p_on,date_trunc('month',p_on)::date,p_amount_cents,request,auth.uid());
 return pair;
end;
$$;

create table private.sharing_write_context(backend_pid integer not null,transaction_number bigint not null,pair_id uuid not null,primary key(backend_pid,transaction_number));
revoke all on private.sharing_write_context from public,anon,authenticated;
create function private.protect_paired_journal() returns trigger language plpgsql set search_path = '' as $$
declare pair uuid; tx uuid; space uuid; day date; begin
 if tg_table_name = 'ledger_transactions' and tg_op = 'UPDATE' and
   (to_jsonb(new)-array['version','updated_at','updated_by']) = (to_jsonb(old)-array['version','updated_at','updated_by']) then return new; end if;
 if tg_table_name = 'ledger_entries' and tg_op = 'UPDATE' and
   (to_jsonb(new)-array['reconciliation_status','reconciliation_source','reconciled_at','import_candidate_id','updated_at']) = (to_jsonb(old)-array['reconciliation_status','reconciliation_source','reconciled_at','import_candidate_id','updated_at']) then return new; end if;
 if tg_table_name = 'ledger_transactions' then
  tx := coalesce(new.id,old.id); pair := coalesce(new.space_transfer_id,old.space_transfer_id); space := coalesce(new.financial_space_id,old.financial_space_id); day := coalesce(new.occurred_on,old.occurred_on);
 else
  tx := coalesce(new.ledger_transaction_id,old.ledger_transaction_id);
  select space_transfer_id,financial_space_id,occurred_on into pair,space,day from finance.ledger_transactions where id = tx;
 end if;
 if pair is not null and tg_op <> 'INSERT' and not exists(select 1 from private.sharing_write_context where backend_pid = pg_backend_pid() and transaction_number = txid_current() and pair_id = pair) then raise exception 'Edit or cancel both space transfer journals together' using errcode = '23514'; end if;
 if tg_op <> 'INSERT' and exists(select 1 from finance.space_split_closures where ledger_transaction_id = tx) then raise exception 'Member division closing journal is immutable' using errcode = '23514'; end if;
 if exists(select 1 from finance.space_split_closures where financial_space_id = space and closed_through >= day) and not exists(select 1 from finance.ledger_transactions where id = tx and kind = 'member_exit') and
   (tg_op <> 'UPDATE' or tg_table_name <> 'ledger_transactions' or (to_jsonb(new)-array['description','notes','version','updated_at','updated_by']) is distinct from (to_jsonb(old)-array['description','notes','version','updated_at','updated_by'])) then raise exception 'Member division prefix is already closed' using errcode = '23514'; end if;
 return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger paired_transaction_guard before insert or update on finance.ledger_transactions for each row execute function private.protect_paired_journal();
create trigger paired_entry_guard before insert or update or delete on finance.ledger_entries for each row execute function private.protect_paired_journal();
create function private.check_space_transfer_pair() returns trigger language plpgsql security definer set search_path = '' as $$
declare pair finance.space_transfer_pairs; pair_id uuid; origin finance.ledger_transactions; destination finance.ledger_transactions; begin
 if tg_table_name = 'space_transfer_pairs' then pair_id := coalesce(new.id,old.id); else pair_id := coalesce(new.space_transfer_id,old.space_transfer_id); end if;
 if pair_id is null then return null; end if;
 select * into pair from finance.space_transfer_pairs where id = pair_id;
 if not found then raise exception 'Paired transfer record required' using errcode = '23514'; end if;
 select * into origin from finance.ledger_transactions where id = pair.origin_transaction_id;
 select * into destination from finance.ledger_transactions where id = pair.destination_transaction_id;
 if origin.financial_space_id is distinct from pair.origin_space_id or destination.financial_space_id is distinct from pair.destination_space_id or origin.space_transfer_id is distinct from pair.id or destination.space_transfer_id is distinct from pair.id or origin.occurred_on is distinct from destination.occurred_on or origin.occurred_on is distinct from pair.occurred_on or origin.competence_month is distinct from destination.competence_month or origin.competence_month is distinct from pair.competence_month or origin.status is distinct from destination.status or (origin.status = 'cancelled') is distinct from (pair.cancelled_at is not null) or
   (select sum(abs(amount_cents)) from finance.ledger_entries where ledger_transaction_id = origin.id) <> pair.amount_cents::numeric*2 or (select sum(abs(amount_cents)) from finance.ledger_entries where ledger_transaction_id = destination.id) <> pair.amount_cents::numeric*2 then raise exception 'Space transfer journals must agree atomically' using errcode = '23514'; end if;
 return null;
end;
$$;
create constraint trigger space_transfer_journals after insert or update on finance.space_transfer_pairs deferrable initially deferred for each row execute function private.check_space_transfer_pair();
create constraint trigger space_transfer_transaction after insert or update on finance.ledger_transactions deferrable initially deferred for each row execute function private.check_space_transfer_pair();

do $$ declare definition text; needle text; signature text; begin
 definition := pg_get_functiondef('private.post_transaction_internal(uuid,jsonb,uuid)'::regprocedure);
 needle := 'card_holder_id,import_batch_id,created_by)';
 if position(needle in definition) = 0 then raise exception 'Sharing writer insertion point not found'; end if;
 definition := replace(definition,needle,'space_transfer_id,card_holder_id,import_batch_id,created_by)');
 needle := '(p_payload->>''card_holder_id'')::uuid,(select batch_id';
 if position(needle in definition) = 0 then raise exception 'Sharing writer value point not found'; end if;
 execute replace(definition,needle,'(p_payload->>''space_transfer_id'')::uuid,' || needle);
 definition := pg_get_functiondef('api.edit_transaction(uuid,uuid,integer,jsonb,text)'::regprocedure); execute replace(definition,'api.edit_transaction','private.edit_space_transaction');
 definition := pg_get_functiondef('api.cancel_transaction(uuid,uuid,integer,text)'::regprocedure); execute replace(definition,'api.cancel_transaction','private.cancel_space_transaction');
 foreach signature in array array['api.edit_space_transfer(uuid,integer,date,bigint,text,uuid)','api.cancel_space_transfer(uuid,integer,text)'] loop
  definition := pg_get_functiondef(signature::regprocedure);
  needle := 'select version into origin_version';
  if position(needle in definition) = 0 then raise exception 'Sharing paired context point not found'; end if;
  definition := replace(definition,needle,'insert into private.sharing_write_context(backend_pid,transaction_number,pair_id) values(pg_backend_pid(),txid_current(),pair.id);
    ' || needle);
  needle := 'return pair.id;';
  -- Cleanup only after the actual paired operation; earlier cancellation replay
  -- has not installed context and deleting a missing context is harmless.
  execute replace(definition,needle,'delete from private.sharing_write_context where backend_pid = pg_backend_pid() and transaction_number = txid_current(); ' || needle);
 end loop;
 foreach signature in array array['api.post_transaction(uuid,jsonb)','api.edit_transaction(uuid,uuid,integer,jsonb,text)'] loop
  definition := pg_get_functiondef(signature::regprocedure); needle := 'perform private.require_writer(p_space);';
  execute replace(definition,needle,needle || ' if p_payload->>''kind'' in(''space_transfer'',''member_settlement'',''member_exit'') or p_payload->>''space_transfer_id'' is not null then raise exception ''Use the dedicated sharing operation'' using errcode = ''23514''; end if;');
 end loop;
 definition := pg_get_functiondef('api.edit_transaction(uuid,uuid,integer,jsonb,text)'::regprocedure); needle := 'perform private.require_writer(p_space);';
 execute replace(definition,needle,needle || ' if exists(select 1 from finance.ledger_transactions where financial_space_id = p_space and id = p_transaction and space_transfer_id is not null) then raise exception ''Edit or cancel both space transfer journals together'' using errcode = ''23514''; end if;');
 definition := pg_get_functiondef('api.refund_transaction(uuid,uuid,bigint,date,uuid,text,uuid)'::regprocedure); needle := 'perform private.require_writer(p_space);';
 execute replace(definition,needle,needle || ' if exists(select 1 from finance.ledger_transactions where financial_space_id = p_space and id = p_original and space_transfer_id is not null) then raise exception ''Correct both space transfer journals together'' using errcode = ''23514''; end if;');
 definition := pg_get_functiondef('private.reject_unimplemented_operations()'::regprocedure);
 execute replace(definition,'new.kind not in (','new.kind not in (''space_transfer'',''member_settlement'',''member_exit'',');
 definition := pg_get_functiondef('private.validate_budget()'::regprocedure);
 execute replace(definition,'category.system_role = ''financial_charges''','category.system_role in(''financial_charges'',''space_transfer_out'')');
 definition := pg_get_functiondef('private.budget_month_summary_live(uuid,date)'::regprocedure);
 needle := 'c.system_role is distinct from ''financial_charges''';
 if position(needle in definition) = 0 then raise exception 'Sharing consumption budget point not found'; end if;
 definition := replace(definition,needle,needle || ' and c.system_role is distinct from ''space_transfer_out''');
 execute replace(definition,'system_role = ''financial_charges''','system_role in(''financial_charges'',''space_transfer_out'')');
end $$;
alter table finance.ledger_transactions drop constraint ledger_transactions_kind_check;
alter table finance.ledger_transactions add constraint ledger_transactions_kind_check check(kind in('opening','expense','income','transfer','card_purchase','card_payment','card_rollover','card_credit_carry','card_installment_plan','card_charges','card_correction','card_prepayment','refund','payment_returned','balance_adjustment','investment_contribution','investment_redemption','investment_result','loan_disbursement','loan_payment','person_settlement','space_transfer','member_settlement','member_exit'));
alter table finance.operation_requests drop constraint operation_requests_operation_check;
alter table finance.operation_requests add constraint operation_requests_operation_check check(operation in('value_asset','confirm_card_charges','create_loan','configure_loan_schedule','adjust_loan_balance','prepay_loan','edit_space_transfer','configure_space_split'));

create function private.validate_sharing_category() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.system_role = 'space_transfer_out' and new.kind <> 'expense' or new.system_role = 'space_contribution_in' and (new.kind <> 'income' or not exists(select 1 from finance.people where id = new.member_person_id and financial_space_id = new.financial_space_id and kind in('member','former_member'))) then raise exception 'Sharing category has invalid class or member' using errcode = '23514'; end if;
 if tg_op = 'UPDATE' and old.system_role in('space_transfer_out','space_contribution_in') and (new.target_financial_space_id is distinct from old.target_financial_space_id or new.member_person_id is distinct from old.member_person_id or new.kind is distinct from old.kind or new.ledger_account_id is distinct from old.ledger_account_id or new.parent_id is distinct from old.parent_id) then raise exception 'Sharing category identity is immutable' using errcode = '23514'; end if;
 return new;
end;
$$;
create trigger sharing_category_valid before insert or update on finance.categories for each row execute function private.validate_sharing_category();
revoke all on function private.protect_split_history(),private.lock_spaces(uuid,uuid),private.require_owner(uuid),private.ensure_member_objects(uuid,uuid,text),private.member_activation_objects(),private.notify_membership(uuid,uuid,text),private.ensure_space_category(uuid,uuid),private.ensure_space_person(uuid,uuid),private.space_transfer_payloads(uuid,uuid,uuid,uuid,date,bigint,text,uuid,uuid,jsonb,uuid),private.insert_split_version(uuid,date,text,jsonb),private.split_weights_on(uuid,date),private.split_state_add(jsonb,uuid,text,bigint),private.calculate_member_settlement(uuid,date,date),private.protect_paired_journal(),private.check_space_transfer_pair(),private.edit_space_transaction(uuid,uuid,integer,jsonb,text),private.cancel_space_transaction(uuid,uuid,integer,text),private.validate_sharing_category() from public,anon,authenticated;
revoke all on function api.invite_space_member(uuid,text,text,text),api.accept_space_invitation(text),api.revoke_space_invitation(uuid,uuid,integer),api.create_space_transfer(uuid,uuid,uuid,uuid,date,bigint,text,uuid),api.cancel_space_transfer(uuid,integer,text),api.edit_space_transfer(uuid,integer,date,bigint,text,uuid),api.configure_space_split(uuid,integer,date,text,jsonb,uuid),api.record_member_settlement(uuid,uuid,uuid,date,bigint,uuid),api.manage_space_member(uuid,uuid,integer,text,text),api.sharing_summary(uuid,date,date),api.create_space_personal_expense(uuid,uuid,uuid,date,bigint,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function api.invite_space_member(uuid,text,text,text),api.accept_space_invitation(text),api.revoke_space_invitation(uuid,uuid,integer),api.create_space_transfer(uuid,uuid,uuid,uuid,date,bigint,text,uuid),api.cancel_space_transfer(uuid,integer,text),api.edit_space_transfer(uuid,integer,date,bigint,text,uuid),api.configure_space_split(uuid,integer,date,text,jsonb,uuid),api.record_member_settlement(uuid,uuid,uuid,date,bigint,uuid),api.manage_space_member(uuid,uuid,integer,text,text),api.sharing_summary(uuid,date,date),api.create_space_personal_expense(uuid,uuid,uuid,date,bigint,text,uuid,uuid,uuid) to authenticated;
commit;
