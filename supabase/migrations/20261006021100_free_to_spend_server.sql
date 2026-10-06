begin;
-- Canonical computation stays on the server (27.1.2). The TypeScript engine is
-- an independently tested oracle; screens receive this immutable read result.
create function private.free_obligation(p_state jsonb,p_reserves jsonb,p_id text,p_group text,p_value bigint,p_reserve text default null,p_on text default null) returns jsonb
language plpgsql immutable set search_path='' as $$
begin
  if p_value<0 then raise exception 'Negative projection obligation' using errcode='23514'; end if;
  if p_reserve is not null and p_reserves ? p_reserve then
    return jsonb_set(p_state,'{linked}',(p_state->'linked')||jsonb_build_array(jsonb_build_object('id',p_id,'group',p_group,'value',p_value,'reserveId',p_reserve,'on',p_on)));
  end if;
  return jsonb_set(jsonb_set(p_state,'{obligations}',to_jsonb((p_state->>'obligations')::bigint+p_value)),'{items}',(p_state->'items')||jsonb_build_array(jsonb_build_object('id',p_id,'group',p_group,'amountCents',-p_value)));
end;
$$;
create function private.free_considered(p_item jsonb,p_expected boolean) returns bigint
language plpgsql immutable set search_path='' as $$
declare due bigint:=(p_item->>'dueCents')::bigint; historical bigint;
begin
  if not p_expected and p_item->>'certainty'='estimated' then
    if p_item->>'direction'='inflow' then
      select min(value::text::bigint) into historical from jsonb_array_elements(coalesce(p_item->'actualHistoryCents','[]')) with ordinality history(value,position) where position<=3;
      if historical is not null then due:=least(due,historical); end if;
    else
      select floor(avg(value::text::numeric)+0.5)::bigint into historical from jsonb_array_elements(coalesce(p_item->'actualHistoryCents','[]')) with ordinality history(value,position) where position<=3;
      if historical is not null then due:=greatest(due,historical); end if;
    end if;
  end if;
  return greatest(0,due-(p_item->>'paidCents')::bigint);
end;
$$;
create function private.calculate_free_to_spend(p_input jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare
  day date:=(p_input->>'today')::date; horizon date; cycle_day integer:=(p_input->>'fallbackCycleDay')::integer;
  cash bigint:=(p_input->>'cashBalanceCents')::bigint; safety bigint:=(p_input->>'safetyReserveCents')::bigint; essential bigint:=(p_input->>'essentialNeedCents')::bigint;
  reserves jsonb:='{}'; reserved bigint:=0; state jsonb; result jsonb; scenario jsonb; expected boolean;
  item jsonb; part jsonb; reserve record; row record; amount bigint; remaining bigint; counted bigint; linked bigint; whole boolean; available bigint; covered bigint; uncovered bigint; total_uncovered bigint; committed bigint; free_value bigint;
begin
  if not isfinite(day) or cycle_day not between 1 and 31 or safety<0 or essential<0 then raise exception 'Invalid projection settings' using errcode='23514'; end if;
  select min((value->>'effectiveDueOn')::date) into horizon from jsonb_array_elements(p_input->'commitments')
    where coalesce((value->>'mainIncome')::boolean,false) and not coalesce((value->>'cancelled')::boolean,false) and value->>'direction'='inflow' and value->>'paymentLiquidity'='cash'
      and (value->>'effectiveDueOn')::date>day and (value->>'paidCents')::bigint<(value->>'dueCents')::bigint;
  if horizon is null then
    horizon:=private.clamped_day(date_trunc('month',day)::date,cycle_day);
    if horizon<=day then horizon:=private.clamped_day((date_trunc('month',day)+interval '1 month')::date,cycle_day); end if;
  end if;
  for item in select value from jsonb_array_elements(p_input->'reserves') loop
    if (item->>'active')::boolean and item->>'holdingMode'='virtual' then
      amount:=greatest(0,(item->>'balanceCents')::bigint); reserved:=reserved+amount;
      reserves:=reserves||jsonb_build_object(item->>'id',amount);
    end if;
  end loop;
  result:=jsonb_build_object('horizonEnd',horizon);
  foreach expected in array array[false,true] loop
    state:=jsonb_build_object('income',0,'obligations',0,'items','[]'::jsonb,'linked','[]'::jsonb);
    for item in select value from jsonb_array_elements(p_input->'commitments') loop
      if coalesce((item->>'cancelled')::boolean,false) or (item->>'paidCents')::bigint>=(item->>'dueCents')::bigint or (item->>'effectiveDueOn')::date>=horizon then continue; end if;
      if item->>'direction'='inflow' then
        if item->>'paymentLiquidity'<>'cash' or not expected and (item->>'certainty'='conditional' or (item->>'effectiveDueOn')::date<day) then continue; end if;
        amount:=private.free_considered(item,expected);
        state:=jsonb_set(jsonb_set(state,'{income}',to_jsonb((state->>'income')::bigint+amount)),'{items}',(state->'items')||jsonb_build_array(jsonb_build_object('id',item->>'id','group','income','amountCents',amount)));
      elsif item->>'paymentLiquidity' in('cash','card') then
        state:=private.free_obligation(state,reserves,item->>'id','agenda',private.free_considered(item,expected),item->>'reserveId',item->>'effectiveDueOn');
      end if;
    end loop;
    for item in select value from jsonb_array_elements(p_input->'statements') loop
      remaining:=greatest(0,(item->>'remainingIncludingScheduledCents')::bigint);
      whole:=item->>'status'<>'future' or (item->>'effectiveDueOn')::date<horizon;
      counted:=case when whole then remaining else least(remaining,coalesce((item->>'firstInstallmentCents')::bigint,0)+coalesce((item->>'essentialFractionCents')::bigint,0)) end;
      select coalesce(sum((value->>'amountCents')::bigint),0)::bigint into linked from jsonb_array_elements(coalesce(item->'reservedUnconsumed','[]'));
      if linked>counted or linked<0 then raise exception 'Reserve links exceed projected statement' using errcode='23514'; end if;
      state:=private.free_obligation(state,reserves,item->>'id','card',counted-linked+case when whole then coalesce((item->>'estimatedChargesCents')::bigint,0) else 0 end);
      for part in select value from jsonb_array_elements(coalesce(item->'reservedUnconsumed','[]')) loop
        state:=private.free_obligation(state,reserves,(item->>'id')||':'||(part->>'reserveId'),'card_reserve',(part->>'amountCents')::bigint,part->>'reserveId',coalesce(part->>'occurredOn',item->>'effectiveDueOn'));
      end loop;
    end loop;
    for item in select value from jsonb_array_elements(p_input->'people') loop
      if jsonb_array_length(item->'openReminderDates')>0 and not exists(select 1 from jsonb_array_elements_text(item->'openReminderDates') date_value where date_value::date<horizon) then continue; end if;
      amount:=(item->>'balanceCents')::bigint;
      if amount<0 then state:=private.free_obligation(state,reserves,item->>'id','person',-amount);
      elsif expected then state:=jsonb_set(jsonb_set(state,'{income}',to_jsonb((state->>'income')::bigint+amount)),'{items}',(state->'items')||jsonb_build_array(jsonb_build_object('id',item->>'id','group','person','amountCents',amount))); end if;
    end loop;
    for item in select value from jsonb_array_elements(p_input->'scheduled') loop
      if (item->>'occurredOn')::date<=day or (item->>'occurredOn')::date>=horizon then continue; end if;
      amount:=(item->>'netCashCents')::bigint;
      if amount>0 then
        state:=jsonb_set(jsonb_set(state,'{income}',to_jsonb((state->>'income')::bigint+amount)),'{items}',(state->'items')||jsonb_build_array(jsonb_build_object('id',item->>'id','group','scheduled','amountCents',amount)));
      elsif amount<0 then
        select coalesce(sum((value->>'amountCents')::bigint),0)::bigint into linked from jsonb_array_elements(coalesce(item->'reservedOutflows','[]'));
        if linked> -amount or linked<0 then raise exception 'Reserve links exceed scheduled outflow' using errcode='23514'; end if;
        state:=private.free_obligation(state,reserves,item->>'id','scheduled',-amount-linked);
        for part in select value from jsonb_array_elements(coalesce(item->'reservedOutflows','[]')) loop
          state:=private.free_obligation(state,reserves,(item->>'id')||':'||(part->>'reserveId'),'scheduled_reserve',(part->>'amountCents')::bigint,part->>'reserveId',item->>'occurredOn');
        end loop;
      end if;
    end loop;
    total_uncovered:=0;
    for reserve in select key,value from jsonb_each(reserves) loop
      available:=reserve.value::text::bigint;
      for row in select entry.value as item from jsonb_array_elements(state->'linked') entry(value) where entry.value->>'reserveId'=reserve.key order by entry.value->>'on',entry.value->>'id' loop
        amount:=(row.item->>'value')::bigint; covered:=least(available,amount); available:=available-covered; uncovered:=amount-covered; total_uncovered:=total_uncovered+uncovered;
        state:=jsonb_set(state,'{items}',(state->'items')||jsonb_build_array(jsonb_build_object('id',row.item->>'id','group',row.item->>'group','amountCents',-uncovered,'reserveId',reserve.key,'consideredCents',amount,'coveredCents',covered)));
      end loop;
    end loop;
    committed:=(state->>'obligations')::bigint+total_uncovered;
    free_value:=cash+(state->>'income')::bigint-committed-reserved-safety-essential;
    if greatest(abs(free_value::numeric),abs(cash::numeric),abs((state->>'income')::numeric),abs(committed::numeric),abs(reserved::numeric))>9007199254740991 then raise exception 'Projection exceeds safe integer cents' using errcode='23514'; end if;
    scenario:=jsonb_build_object('valueCents',free_value,'cashCents',cash,'expectedInflowsCents',(state->>'income')::bigint,'committedCents',committed,'reservedCents',reserved,'uncoveredReserveCents',total_uncovered,'safetyCents',safety,'essentialCents',essential,'items',state->'items');
    result:=result||jsonb_build_object(case when expected then 'expected' else 'conservative' end,scenario);
  end loop;
  if (result#>>'{expected,valueCents}')::bigint<(result#>>'{conservative,valueCents}')::bigint then raise exception 'Expected scenario below conservative scenario' using errcode='23514'; end if;
  return result;
end;
$$;
create function api.free_to_spend_summary(p_space uuid,p_on date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare input jsonb;
begin
  input:=api.free_to_spend_input(p_space,p_on);
  return jsonb_build_object('input',input,'calculation',private.calculate_free_to_spend(input));
end;
$$;
revoke all on function private.free_obligation(jsonb,jsonb,text,text,bigint,text,text),private.free_considered(jsonb,boolean),private.calculate_free_to_spend(jsonb),api.free_to_spend_summary(uuid,date) from public,anon,authenticated;
grant execute on function api.free_to_spend_summary(uuid,date) to authenticated;
commit;
