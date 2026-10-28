begin;
create table finance.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  locale text not null default 'pt-BR' check(locale = 'pt-BR'),theme text not null default 'system' check(theme in('system','light','dark')),
  privacy_mode boolean not null default false,active_financial_space_id uuid references finance.financial_spaces(id) on delete set null,
  notification_preferences jsonb not null default '{}' check(jsonb_typeof(notification_preferences) = 'object'),preferences jsonb not null default '{}' check(jsonb_typeof(preferences) = 'object'),
  version integer not null default 1,updated_at timestamptz not null default now()
);
alter table finance.user_settings enable row level security;
create policy own_read on finance.user_settings for select to authenticated using(user_id = auth.uid());
revoke all on finance.user_settings from public,anon,authenticated;
grant select on finance.user_settings to authenticated;
create table finance.tags (
  id uuid primary key default gen_random_uuid(),financial_space_id uuid not null references finance.financial_spaces(id) on delete cascade,
  name text not null check(char_length(trim(name)) between 1 and 100),archived_at timestamptz,version integer not null default 1,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(financial_space_id,id)
);
create unique index tag_name_unique on finance.tags(financial_space_id,lower(trim(name)));
create table finance.ledger_transaction_tags (
  financial_space_id uuid not null,ledger_transaction_id uuid not null,tag_id uuid not null,
  created_by uuid references auth.users(id),created_at timestamptz not null default now(),primary key(ledger_transaction_id,tag_id),
  foreign key(financial_space_id,ledger_transaction_id) references finance.ledger_transactions(financial_space_id,id) on delete cascade,
  foreign key(financial_space_id,tag_id) references finance.tags(financial_space_id,id)
);
alter table finance.tags enable row level security;
alter table finance.ledger_transaction_tags enable row level security;
create policy member_read on finance.tags for select to authenticated using(private.is_member(financial_space_id));
create policy member_read on finance.ledger_transaction_tags for select to authenticated using(private.is_member(financial_space_id));
revoke all on finance.tags,finance.ledger_transaction_tags from public,anon,authenticated;
grant select on finance.tags,finance.ledger_transaction_tags to authenticated;
create function api.get_user_settings() returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into finance.user_settings(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  select to_jsonb(s) into result from finance.user_settings s where s.user_id = auth.uid();
  return result;
end;
$$;
create function api.update_user_settings(p_version integer,p_changes jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous finance.user_settings; result jsonb; selected_space uuid; begin
  perform api.get_user_settings();
  select * into previous from finance.user_settings where user_id = auth.uid() for update;
  if previous.version is distinct from p_version then raise exception 'Settings changed; reload before editing' using errcode = '40001'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_changes) key where key not in('theme','privacy_mode','active_financial_space_id','notification_preferences','preferences')) then raise exception 'Invalid settings fields' using errcode = '23514'; end if;
  selected_space := case when p_changes ? 'active_financial_space_id' then (p_changes->>'active_financial_space_id')::uuid else previous.active_financial_space_id end;
  if selected_space is not null and not private.is_member(selected_space) then raise exception 'Space access denied' using errcode = '42501'; end if;
  update finance.user_settings set theme = coalesce(p_changes->>'theme',theme),privacy_mode = coalesce((p_changes->>'privacy_mode')::boolean,privacy_mode),
    active_financial_space_id = selected_space,notification_preferences = case when p_changes ? 'notification_preferences' then notification_preferences || (p_changes->'notification_preferences') else notification_preferences end,
    preferences = case when p_changes ? 'preferences' then preferences || (p_changes->'preferences') else preferences end,version = version+1,updated_at = now()
  where user_id = auth.uid() returning to_jsonb(user_settings.*) into result;
  return result;
end;
$$;
create function api.create_tag(p_space uuid,p_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; begin
  perform private.require_writer(p_space);
  insert into finance.tags(financial_space_id,name,created_by) values(p_space,trim(p_name),auth.uid()) returning id into result;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','tag',result,jsonb_build_object('name',trim(p_name)));
  return result;
end;
$$;
create function api.manage_tag(p_space uuid,p_tag uuid,p_version integer,p_action text,p_name text default null,p_destination uuid default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare previous finance.tags; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into previous from finance.tags where id = p_tag and financial_space_id = p_space for update;
  if not found then raise exception 'Tag not found' using errcode = 'P0002'; end if;
  if previous.version is distinct from p_version then raise exception 'Tag changed; reload before editing' using errcode = '40001'; end if;
  if p_action = 'rename' then update finance.tags set name = trim(p_name),version = version+1,updated_at = now() where id = p_tag;
  elsif p_action = 'archive' then update finance.tags set archived_at = now(),version = version+1,updated_at = now() where id = p_tag;
  elsif p_action = 'restore' then update finance.tags set archived_at = null,version = version+1,updated_at = now() where id = p_tag;
  elsif p_action = 'delete' then
    if exists(select 1 from finance.ledger_transaction_tags where tag_id = p_tag) then raise exception 'Linked tag cannot be deleted' using errcode = '23514'; end if;
    delete from finance.tags where id = p_tag;
  elsif p_action = 'merge' then
    if p_tag = p_destination or not exists(select 1 from finance.tags where id = p_destination and financial_space_id = p_space and archived_at is null) then raise exception 'Invalid destination tag' using errcode = '23514'; end if;
    insert into finance.ledger_transaction_tags(financial_space_id,ledger_transaction_id,tag_id,created_by)
      select financial_space_id,ledger_transaction_id,p_destination,auth.uid() from finance.ledger_transaction_tags where tag_id = p_tag on conflict do nothing;
    delete from finance.ledger_transaction_tags where tag_id = p_tag;
    delete from finance.tags where id = p_tag;
  else raise exception 'Invalid tag action' using errcode = '23514'; end if;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),p_action,'tag',p_tag,to_jsonb(previous),jsonb_build_object('name',p_name,'destination',p_destination));
  return coalesce(p_destination,p_tag);
end;
$$;
create function api.set_transaction_tags(p_space uuid,p_transaction uuid,p_tags uuid[],p_expected_tags uuid[]) returns uuid language plpgsql security definer set search_path = '' as $$
declare before_tags uuid[]; supplied uuid[]; expected uuid[]; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if not exists(select 1 from finance.ledger_transactions where id = p_transaction and financial_space_id = p_space) then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  select coalesce(array_agg(tag_id order by tag_id),'{}'::uuid[]) into before_tags from finance.ledger_transaction_tags where ledger_transaction_id = p_transaction;
  select coalesce(array_agg(distinct id order by id),'{}'::uuid[]) into supplied from unnest(p_tags) id;
  select coalesce(array_agg(distinct id order by id),'{}'::uuid[]) into expected from unnest(p_expected_tags) id;
  if before_tags is distinct from expected then raise exception 'Tags changed; reload before editing' using errcode = '40001'; end if;
  if array_position(supplied,null) is not null or exists(select 1 from unnest(supplied) requested(id) where not exists(select 1 from finance.tags t where t.id = requested.id and t.financial_space_id = p_space and (t.archived_at is null or t.id = any(before_tags)))) then raise exception 'Tag not available in this space' using errcode = '23514'; end if;
  delete from finance.ledger_transaction_tags where ledger_transaction_id = p_transaction;
  insert into finance.ledger_transaction_tags(financial_space_id,ledger_transaction_id,tag_id,created_by) select p_space,p_transaction,id,auth.uid() from unnest(supplied) id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data) values(p_space,auth.uid(),'tags_changed','ledger_transaction',p_transaction,to_jsonb(before_tags),to_jsonb(supplied));
  return p_transaction;
end;
$$;
revoke all on function api.get_user_settings(),api.update_user_settings(integer,jsonb),api.create_tag(uuid,text),api.manage_tag(uuid,uuid,integer,text,text,uuid),api.set_transaction_tags(uuid,uuid,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function api.get_user_settings(),api.update_user_settings(integer,jsonb),api.create_tag(uuid,text),api.manage_tag(uuid,uuid,integer,text,text,uuid),api.set_transaction_tags(uuid,uuid,uuid[],uuid[]) to authenticated;
commit;
