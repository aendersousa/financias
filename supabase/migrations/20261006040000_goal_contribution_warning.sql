begin;
-- A hypothetical event enters the same chronological replay as a real event.
-- No contribution, audit, sequence increment or approval row is written here.
do $$ declare definition text; needle text; begin
 definition:=pg_get_functiondef('private.reserve_balance(uuid,uuid,date)'::regprocedure);
 definition:=replace(definition,'private.reserve_balance(p_space uuid, p_reserve uuid, p_on date)','private.reserve_balance_with_contribution(p_space uuid, p_reserve uuid, p_on date, p_contribution_on date, p_amount_cents bigint)');
 needle:='for event in select * from private.reserve_ledger_events(p_space,p_reserve,p_on) order by occurred_on,registration_order,event_id loop';
 if position(needle in definition)=0 then raise exception 'Reserve chronological preflight point not found'; end if;
 execute replace(definition,needle,'for event in select * from (select * from private.reserve_ledger_events(p_space,p_reserve,p_on) union all select ''00000000-0000-4000-8000-000000000400''::uuid,p_contribution_on,now(),9223372036854775807::bigint,''contribution''::text,p_amount_cents,null::uuid where p_contribution_on<=p_on) hypothetical order by occurred_on,registration_order,event_id loop');
end $$;

create function private.preview_reserve_contribution(p_space uuid,p_reserve uuid,p_kind text,p_amount_cents bigint,p_on date,p_note text) returns jsonb language plpgsql stable set search_path='' as $$
declare reserve finance.reserves; input jsonb; after_input jsonb; calculation jsonb; after_calculation jsonb; projection_on date; balance bigint; before_free bigint; after_free bigint; token text;
begin
 if p_kind is null or p_kind not in('contribution','release') or p_amount_cents is null or p_amount_cents not between 1 and 9007199254740991 or p_on is null or not isfinite(p_on) then raise exception 'Invalid reserve contribution' using errcode='23514'; end if;
 select * into reserve from finance.reserves where financial_space_id=p_space and id=p_reserve and status in('active','achieved') and holding_mode='virtual' and archived_at is null;
 if not found then raise exception 'Active virtual reserve required' using errcode='23514'; end if;
 perform private.require_open_reserve_period(p_space,p_on);
 balance:=(private.reserve_balance(p_space,p_reserve,p_on)->>'balance_cents')::bigint;
 if p_kind='release' and p_amount_cents>balance then raise exception 'Release exceeds reserve balance' using errcode='23514'; end if;
 if reserve.reserve_type<>'goal' or p_kind<>'contribution' then return jsonb_build_object('requiresWarning',false,'approvalToken',null,'reserveVersion',reserve.version); end if;
 projection_on:=greatest(private.space_today(p_space),p_on);
 input:=api.free_to_spend_input(p_space,projection_on); calculation:=private.calculate_free_to_spend(input);
 balance:=(private.reserve_balance_with_contribution(p_space,p_reserve,projection_on,p_on,p_amount_cents)->>'balance_cents')::bigint;
 after_input:=jsonb_set(input,'{reserves}',(select jsonb_agg(case when value->>'id'=p_reserve::text then jsonb_set(value,'{balanceCents}',to_jsonb(balance)) else value end order by ord) from jsonb_array_elements(input->'reserves') with ordinality reserves(value,ord)));
 after_calculation:=private.calculate_free_to_spend(after_input);
 before_free:=(calculation#>>'{conservative,valueCents}')::bigint; after_free:=(after_calculation#>>'{conservative,valueCents}')::bigint;
 token:=encode(sha256(convert_to(jsonb_build_object('user',auth.uid(),'reserve',to_jsonb(reserve),'kind',p_kind,'amount',p_amount_cents,'on',p_on,'note',p_note,'today',private.space_today(p_space),'input',input,'after',after_calculation)::text,'UTF8')),'hex');
 return jsonb_build_object('requiresWarning',after_free<0,'conservativeBeforeCents',before_free,'conservativeAfterCents',after_free,'approvalToken',token,'projectionOn',projection_on,'reserveVersion',reserve.version);
end;
$$;
create function api.preview_reserve_contribution(p_space uuid,p_reserve uuid,p_kind text,p_amount_cents bigint,p_on date,p_note text default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_writer(p_space);
 return private.preview_reserve_contribution(p_space,p_reserve,p_kind,p_amount_cents,p_on,p_note);
end;
$$;

-- Keep canonical chronology/period/UUID rules. The extra approval token is a
-- state revision, not an authorization secret: writer membership remains the
-- authority and consent applies only to the exact currently computed preview.
do $$ declare definition text; needle text; begin
 definition:=pg_get_functiondef('api.reserve_contribution(uuid,uuid,text,bigint,date,text,uuid)'::regprocedure);
 definition:=replace(definition,'p_client_uuid uuid DEFAULT NULL::uuid)','p_client_uuid uuid DEFAULT NULL::uuid, p_approval_token text DEFAULT NULL::text)');
 definition:=replace(definition,'balance bigint; begin','balance bigint; preview jsonb; begin');
 needle:='balance:=(private.reserve_balance(p_space,p_reserve,p_on)->>''balance_cents'')::bigint;';
 if position(needle in definition)=0 then raise exception 'Canonical contribution warning point not found'; end if;
 definition:=replace(definition,needle,'preview:=private.preview_reserve_contribution(p_space,p_reserve,p_kind,p_amount_cents,p_on,p_note);
  if p_approval_token is not null and p_approval_token is distinct from preview->>''approvalToken'' then raise exception ''Contribution preview changed; review the current amount and free balance'' using errcode=''40001''; end if;
  if (preview->>''requiresWarning'')::boolean and p_approval_token is null then raise exception ''Goal contribution leaves conservative free balance negative; review and confirm the warning'' using errcode=''23514''; end if;
  '||needle);
 execute definition;
end $$;
drop function api.reserve_contribution(uuid,uuid,text,bigint,date,text,uuid);
do $$ declare definition text; needle text; begin
 definition:=pg_get_functiondef('api.confirm_reserve_funding(uuid,uuid,date,bigint,boolean,date,uuid)'::regprocedure);
 definition:=replace(definition,'p_client_uuid uuid DEFAULT NULL::uuid)','p_client_uuid uuid DEFAULT NULL::uuid, p_approval_token text DEFAULT NULL::text)');
 needle:='p_amount_cents,actual,''Confirmação do aporte de ''||p_scheduled::text,p_client_uuid);';
 if position(needle in definition)=0 then raise exception 'Manual funding approval point not found'; end if;
 execute replace(definition,needle,'p_amount_cents,actual,''Confirmação do aporte de ''||p_scheduled::text,p_client_uuid,p_approval_token);');
end $$;
drop function api.confirm_reserve_funding(uuid,uuid,date,bigint,boolean,date,uuid);
revoke all on function private.reserve_balance_with_contribution(uuid,uuid,date,date,bigint),private.preview_reserve_contribution(uuid,uuid,text,bigint,date,text),api.preview_reserve_contribution(uuid,uuid,text,bigint,date,text),api.reserve_contribution(uuid,uuid,text,bigint,date,text,uuid,text) from public,anon,authenticated;
grant execute on function api.preview_reserve_contribution(uuid,uuid,text,bigint,date,text),api.reserve_contribution(uuid,uuid,text,bigint,date,text,uuid,text) to authenticated;
revoke all on function api.confirm_reserve_funding(uuid,uuid,date,bigint,boolean,date,uuid,text) from public,anon,authenticated;
grant execute on function api.confirm_reserve_funding(uuid,uuid,date,bigint,boolean,date,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
