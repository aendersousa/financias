begin;
create function api.workspace_metadata(p_space uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_member(p_space) then raise exception 'Space access denied' using errcode = '42501'; end if;
  return jsonb_build_object(
    'tags',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]') from finance.tags t where t.financial_space_id = p_space),
    'transaction_tags',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from finance.ledger_transaction_tags t where t.financial_space_id = p_space),
    'recurrences',(select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('current_version',(select to_jsonb(v) from finance.recurrence_rule_versions v where v.recurrence_rule_id = r.id order by v.version_number desc limit 1)) order by r.title),'[]') from finance.recurrence_rules r where r.financial_space_id = p_space and r.archived_at is null),
    'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]') from(select id,actor_id,action,entity_type,entity_id,created_at from finance.audit_logs where financial_space_id = p_space order by created_at desc limit 200) a)
  );
end;
$$;
revoke all on function api.workspace_metadata(uuid) from public,anon,authenticated;
grant execute on function api.workspace_metadata(uuid) to authenticated;
commit;
