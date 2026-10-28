begin;
alter table finance.credit_cards add column if not exists card_type text not null default 'both' check(card_type in('both','credit','debit'));
do $$
declare definition text;
begin
 select pg_get_functiondef('api.manage_card(uuid,uuid,integer,text,jsonb,uuid)'::regprocedure) into definition;
 if position('''card_type''' in definition)=0 then
   if position('''late_interest_monthly_percent''))' in definition)=0 then raise exception 'Card settings validation point not found';end if;
   definition:=replace(definition,'''late_interest_monthly_percent''))','''late_interest_monthly_percent'',''card_type''))');
   definition:=replace(definition,'if p_action=''settings'' then', $patch$if p_action='settings' then
     if p_payload ? 'card_type' and (p_payload->>'card_type' is null or p_payload->>'card_type' not in('both','credit','debit')) then raise exception 'Invalid card type' using errcode='23514';end if;
   $patch$);
   if position('update finance.credit_cards set name=coalesce' in definition)=0 then raise exception 'Card settings update point not found';end if;
   definition:=replace(definition,'update finance.credit_cards set name=coalesce','update finance.credit_cards set card_type=coalesce(p_payload->>''card_type'',card_type),name=coalesce');
 end if;
 definition:=replace(definition,'update finance.ledger_accounts set card_type=coalesce(p_payload->>''card_type'',card_type),name=coalesce','update finance.ledger_accounts set name=coalesce');
 execute definition;
end;
$$;
commit;
