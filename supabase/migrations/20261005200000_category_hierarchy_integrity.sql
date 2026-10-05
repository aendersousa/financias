begin;
create unique index category_unique_ledger_account on finance.categories(financial_space_id,ledger_account_id) where ledger_account_id is not null;
create function private.validate_category() returns trigger
language plpgsql set search_path = '' as $$
declare ancestor uuid; parent_kind text; parent_parent uuid; depth integer := 0; account finance.ledger_accounts; begin
  ancestor := new.parent_id;
  while ancestor is not null loop
    if ancestor = new.id then raise exception 'Category hierarchy cannot contain cycles' using errcode = '23514'; end if;
    select kind,parent_id into parent_kind,parent_parent from finance.categories where id = ancestor and financial_space_id = new.financial_space_id;
    if not found then raise exception 'Category parent belongs to another space or does not exist' using errcode = '23514'; end if;
    if parent_kind <> new.kind then raise exception 'Category parent must have the same kind' using errcode = '23514'; end if;
    ancestor := parent_parent; depth := depth + 1;
    if depth > 1000 then raise exception 'Category hierarchy is too deep' using errcode = '23514'; end if;
  end loop;
  if new.ledger_account_id is not null then
    select * into account from finance.ledger_accounts where financial_space_id = new.financial_space_id and id = new.ledger_account_id;
    if not found or account.owner_type <> 'category' or account.account_class <> new.kind then raise exception 'Category ledger account has wrong class or space' using errcode = '23514'; end if;
  end if;
  if tg_op = 'UPDATE' and old.system_role is not null and (new.system_role is distinct from old.system_role or new.archived_at is not null or new.deleted_at is not null) then
    raise exception 'System category role cannot be removed, archived or deleted' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger category_valid before insert or update on finance.categories for each row execute function private.validate_category();
create function private.category_leaf_has_account() returns trigger
language plpgsql set search_path = '' as $$
declare space uuid := coalesce(new.financial_space_id,old.financial_space_id); begin
  if exists(select 1 from finance.categories c where c.financial_space_id = space and c.deleted_at is null and
    ((exists(select 1 from finance.categories child where child.parent_id = c.id and child.deleted_at is null) and c.ledger_account_id is not null) or
     (not exists(select 1 from finance.categories child where child.parent_id = c.id and child.deleted_at is null) and c.archived_at is null and
       (c.ledger_account_id is null or (c.kind = 'income' and c.income_class is null))))) then
    raise exception 'Active leaves require ledger accounts; parents must not have them' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger category_leaf_has_account after insert or update or delete on finance.categories deferrable initially deferred for each row execute function private.category_leaf_has_account();

create function private.space_has_owner() returns trigger
language plpgsql set search_path = '' as $$
declare space uuid; begin
  if tg_table_name = 'financial_spaces' then space := coalesce(new.id,old.id); else space := coalesce(new.financial_space_id,old.financial_space_id); end if;
  if exists(select 1 from finance.financial_spaces where id = space) and not exists(select 1 from finance.financial_space_members where financial_space_id = space and role = 'owner' and status = 'active') then
    raise exception 'Financial space requires an active owner' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger space_has_owner_members after insert or update or delete on finance.financial_space_members deferrable initially deferred for each row execute function private.space_has_owner();
create constraint trigger space_has_owner_root after insert on finance.financial_spaces deferrable initially deferred for each row execute function private.space_has_owner();

create or replace function api.create_category(p_space uuid,p_name text,p_kind text,p_parent uuid default null,p_income_class text default null,p_is_essential boolean default false,p_fixity text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare category_id uuid; ledger_id uuid; general_id uuid; parent finance.categories; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_kind not in ('expense','income') then raise exception 'Invalid category kind' using errcode = '23514'; end if;
  if p_kind = 'income' and p_income_class is null then raise exception 'Income class is required' using errcode = '23514'; end if;
  if p_parent is not null then
    select * into parent from finance.categories where financial_space_id = p_space and id = p_parent for update;
    if not found or parent.kind <> p_kind or parent.archived_at is not null or parent.deleted_at is not null then raise exception 'Invalid category parent' using errcode = '23514'; end if;
    if parent.ledger_account_id is not null then
      -- Move only the product link; never rewrite historical ledger entries.
      update finance.categories set ledger_account_id = null,version = version + 1,updated_at = now() where id = parent.id;
      insert into finance.categories(financial_space_id,parent_id,ledger_account_id,kind,name,icon,color,is_essential,fixity,is_tax_deductible,income_class,benefit_financial_account_id,created_by)
        values(p_space,parent.id,parent.ledger_account_id,parent.kind,parent.name || ' (geral)',parent.icon,parent.color,parent.is_essential,parent.fixity,parent.is_tax_deductible,parent.income_class,parent.benefit_financial_account_id,auth.uid()) returning id into general_id;
      insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data)
        values(p_space,auth.uid(),'converted_to_parent','category',parent.id,to_jsonb(parent),jsonb_build_object('general_category_id',general_id));
    end if;
  end if;
  insert into finance.ledger_accounts(financial_space_id,account_class,owner_type,name,created_by) values(p_space,p_kind,'category',p_name,auth.uid()) returning id into ledger_id;
  insert into finance.categories(financial_space_id,parent_id,ledger_account_id,kind,name,income_class,is_essential,fixity,created_by)
    values(p_space,p_parent,ledger_id,p_kind,p_name,p_income_class,p_is_essential,case when p_kind = 'expense' then coalesce(p_fixity,'variable') else p_fixity end,auth.uid()) returning id into category_id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,after_data) values(p_space,auth.uid(),'created','category',category_id,jsonb_build_object('name',p_name,'kind',p_kind));
  return category_id;
end;
$$;

create function api.move_category(p_space uuid,p_category uuid,p_parent uuid,p_version integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare category finance.categories; parent finance.categories; begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  select * into category from finance.categories where financial_space_id = p_space and id = p_category for update;
  if not found or category.deleted_at is not null then raise exception 'Category not found' using errcode = 'P0002'; end if;
  if category.version <> p_version then raise exception 'Category changed; reload before editing' using errcode = '40001'; end if;
  if p_parent is not null then
    select * into parent from finance.categories where financial_space_id = p_space and id = p_parent and archived_at is null and deleted_at is null;
    if not found or parent.kind <> category.kind or parent.ledger_account_id is not null then raise exception 'Destination must be a parent of the same kind' using errcode = '23514'; end if;
  end if;
  update finance.categories set parent_id = p_parent,version = version + 1,updated_at = now() where id = category.id;
  insert into finance.audit_logs(financial_space_id,actor_id,action,entity_type,entity_id,before_data,after_data)
    values(p_space,auth.uid(),'moved','category',category.id,to_jsonb(category),jsonb_build_object('parent_id',p_parent));
  return category.id;
end;
$$;
create view finance.category_balances with (security_invoker = true) as
with recursive descendants as (
  select id as root_id,id,financial_space_id,ledger_account_id from finance.categories where deleted_at is null
  union all
  select d.root_id,c.id,c.financial_space_id,c.ledger_account_id from descendants d join finance.categories c on c.parent_id = d.id and c.financial_space_id = d.financial_space_id where c.deleted_at is null
)
select d.root_id as category_id,d.financial_space_id,coalesce(sum(b.balance_cents),0)::bigint as balance_cents
from descendants d left join finance.account_balances b on b.id = d.ledger_account_id group by d.root_id,d.financial_space_id;
grant select on finance.category_balances to authenticated;
revoke all on function private.validate_category(),private.category_leaf_has_account(),private.space_has_owner() from public,anon,authenticated;
revoke all on function api.move_category(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function api.move_category(uuid,uuid,uuid,integer) to authenticated;
commit;
