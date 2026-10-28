begin;

create or replace function api.settle_person_with_interest(p_space uuid,p_person uuid,p_account uuid,p_direction text,p_amount_cents bigint,p_interest_cents bigint,p_category uuid,p_occurred_on date,p_client_uuid uuid,p_description text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare person finance.people; account finance.financial_accounts; category finance.categories; principal bigint; sign integer; entries jsonb;
begin
  perform private.require_writer(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_direction not in ('receive','pay') or p_direction is null or p_amount_cents is null or p_amount_cents<=0 or p_interest_cents is null or p_interest_cents<=0 or p_interest_cents>p_amount_cents then raise exception 'Invalid principal or interest payment' using errcode='23514';end if;
  select * into person from finance.people where id=p_person and financial_space_id=p_space and archived_at is null and deleted_at is null;
  if not found then raise exception 'Active person required' using errcode='23514';end if;
  select f.* into account from finance.financial_accounts f join finance.ledger_accounts a on a.id=f.ledger_account_id where f.id=p_account and f.financial_space_id=p_space and f.archived_at is null and f.deleted_at is null and a.liquidity='cash';
  if not found then raise exception 'Active cash account required' using errcode='23514';end if;
  select * into category from finance.categories where id=p_category and financial_space_id=p_space and ledger_account_id is not null and archived_at is null and deleted_at is null and kind=case when p_direction='receive' then 'income' else 'expense' end;
  if not found then raise exception 'Choose an interest category matching the payment direction' using errcode='23514';end if;
  principal:=p_amount_cents-p_interest_cents;
  sign:=case when p_direction='receive' then 1 else -1 end;
  entries:=jsonb_build_array(jsonb_build_object('ledger_account_id',account.ledger_account_id,'amount_cents',sign*p_amount_cents),jsonb_build_object('ledger_account_id',category.ledger_account_id,'amount_cents',-sign*p_interest_cents));
  if principal>0 then entries:=entries||jsonb_build_array(jsonb_build_object('ledger_account_id',person.ledger_account_id,'amount_cents',-sign*principal));end if;
  return private.post_transaction_internal(p_space,jsonb_build_object('kind','person_settlement','occurred_on',p_occurred_on,'competence_month',date_trunc('month',p_occurred_on)::date,'description',coalesce(nullif(trim(p_description),''),case when sign=1 then 'Recebimento de ' else 'Pagamento para ' end||person.nickname),'notes','Pagamento com juros','client_uuid',p_client_uuid,'operation_receipt',jsonb_build_object('operation','person_interest_payment','request',jsonb_build_object('person',p_person,'direction',p_direction,'interest_cents',p_interest_cents,'principal_cents',principal)),'entries',entries),auth.uid());
end;
$$;
revoke all on function api.settle_person_with_interest(uuid,uuid,uuid,text,bigint,bigint,uuid,date,uuid,text) from public,anon,authenticated;
grant execute on function api.settle_person_with_interest(uuid,uuid,uuid,text,bigint,bigint,uuid,date,uuid,text) to authenticated;

create or replace function private.person_payment_totals(p_space uuid,p_ledger uuid) returns jsonb language sql stable set search_path='' as $$
  with movements as (
    select t.id,t.kind,t.occurred_on,t.created_at,sum(e.amount_cents)::numeric as amount
    from finance.ledger_entries e join finance.ledger_transactions t on t.id=e.ledger_transaction_id
    where e.financial_space_id=p_space and e.ledger_account_id=p_ledger and t.status='posted' and t.occurred_on<=private.space_today(p_space)
    group by t.id
  ),history as (
    select *,coalesce(sum(amount) over(order by occurred_on,created_at,id rows between unbounded preceding and 1 preceding),0) as previous from movements
  ),interest as (
    select coalesce(sum((t.operation_receipt->'request'->>'interest_cents')::bigint) filter(where t.operation_receipt->'request'->>'direction'='receive'),0) as received,
      coalesce(sum((t.operation_receipt->'request'->>'interest_cents')::bigint) filter(where t.operation_receipt->'request'->>'direction'='pay'),0) as paid
    from finance.ledger_transactions t
    where t.financial_space_id=p_space and t.status='posted' and t.occurred_on<=private.space_today(p_space)
      and t.operation_receipt->>'operation'='person_interest_payment'
      and t.operation_receipt->'request'->>'person'=(select p.id::text from finance.people p where p.ledger_account_id=p_ledger and p.financial_space_id=p_space)
  )
  select jsonb_build_object(
    'received_cents',coalesce(sum(least(-amount,previous)) filter(where kind='person_settlement' and amount<0 and previous>0),0)+(select received from interest),
    'paid_cents',coalesce(sum(least(amount,-previous)) filter(where kind='person_settlement' and amount>0 and previous<0),0)+(select paid from interest),
    'lent_cents',coalesce(sum(case when previous<0 then greatest(amount+previous,0) else amount end) filter(where amount>0 and kind in('opening','person_settlement')),0),
    'borrowed_cents',coalesce(sum(case when previous>0 then greatest(-amount-previous,0) else -amount end) filter(where amount<0 and kind in('opening','person_settlement')),0),
    'interest_received_cents',(select received from interest),'interest_paid_cents',(select paid from interest)
  ) from history;
$$;
commit;

