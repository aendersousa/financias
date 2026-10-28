begin;
alter table finance.ledger_transactions add constraint required_transaction_relation check(kind not in ('refund','payment_returned','card_correction','card_prepayment') or related_transaction_id is not null);
create or replace function private.reject_unimplemented_operations() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind not in ('opening','expense','income','transfer','balance_adjustment','investment_contribution','investment_redemption','investment_result','person_settlement','loan_disbursement','loan_payment','card_purchase','card_payment','refund','card_rollover','card_credit_carry','card_charges') then raise exception 'Operation requires a financial module not yet enabled' using errcode = '0A000'; end if;
  return new;
end;
$$;
create function private.next_open_competence(p_space uuid,p_month date) returns date language plpgsql stable set search_path = '' as $$
declare result date := date_trunc('month',p_month)::date; idx integer := 0; begin
  while exists(select 1 from finance.period_closings where financial_space_id = p_space and month = result and reopened_at is null) loop
    result := (result + interval '1 month')::date; idx := idx+1;
    if idx > 1200 then raise exception 'No open competence month found' using errcode = '23514'; end if;
  end loop;
  return result;
end;
$$;
create function private.refund_within_original() returns trigger language plpgsql set search_path = '' as $$
declare original_id uuid; invalid boolean; begin
  if tg_table_name = 'ledger_transactions' then
    original_id := case when new.kind = 'refund' then new.related_transaction_id else new.id end;
  else
    select case when t.kind = 'refund' then t.related_transaction_id else t.id end into original_id from finance.ledger_transactions t where t.id = coalesce(new.ledger_transaction_id,old.ledger_transaction_id);
  end if;
  select exists(select 1 from finance.ledger_transactions r join finance.ledger_transactions original on original.id = r.related_transaction_id
    where r.kind = 'refund' and r.status = 'posted' and r.related_transaction_id = original_id and (original.status <> 'posted' or original.kind not in ('expense','card_purchase'))) into invalid;
  if invalid then raise exception 'Refund requires a posted original expense or purchase' using errcode = '23514'; end if;
  if exists(with refundable as (
    select e.ledger_account_id,sum(e.amount_cents)::numeric as amount from finance.ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id where e.ledger_transaction_id = original_id and a.account_class = 'expense' group by e.ledger_account_id
  ), refunded as (
    select e.ledger_account_id,-sum(e.amount_cents)::numeric as amount from finance.ledger_entries e join finance.ledger_transactions r on r.id = e.ledger_transaction_id join finance.ledger_accounts a on a.id = e.ledger_account_id
    where r.related_transaction_id = original_id and r.kind = 'refund' and r.status = 'posted' and a.account_class = 'expense' group by e.ledger_account_id
  ) select 1 from refunded r left join refundable f on f.ledger_account_id = r.ledger_account_id where r.amount < 0 or r.amount > coalesce(f.amount,0)) then raise exception 'Refund exceeds original category consumption' using errcode = '23514'; end if;
  return null;
end;
$$;
create constraint trigger refund_original_tx after insert or update on finance.ledger_transactions deferrable initially deferred for each row execute function private.refund_within_original();
create constraint trigger refund_original_entries after insert or update or delete on finance.ledger_entries deferrable initially deferred for each row execute function private.refund_within_original();

create function api.refund_transaction(p_space uuid,p_original uuid,p_amount_cents bigint,p_on date,p_destination_account uuid default null,p_model text default null,p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare original finance.ledger_transactions; card finance.credit_cards; destination finance.financial_accounts; category_rows uuid[]; category_amounts bigint[]; category_months date[]; category_parts bigint[];
  statement_ids uuid[]; statement_amounts bigint[]; statement_parts bigint[]; entries jsonb := '[]'; available bigint; pool bigint; remaining bigint; idx integer; open_statement uuid; effective_month date; original_month date; tx_id uuid; request_model text := p_model;
begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 9007199254740991 or p_on is null then raise exception 'Invalid refund amount or date' using errcode = '23514'; end if;
  if p_client_uuid is not null then
    select * into original from finance.ledger_transactions where financial_space_id = p_space and client_uuid = p_client_uuid;
    if found then
      if original.kind <> 'refund' or original.related_transaction_id <> p_original or original.occurred_on <> p_on or original.notes is distinct from jsonb_build_object('destination',p_destination_account,'model',p_model,'amount_cents',p_amount_cents)::text then raise exception 'Client UUID reused with different refund' using errcode = '23505'; end if;
      return original.id;
    end if;
  end if;
  select * into original from finance.ledger_transactions where financial_space_id = p_space and id = p_original and status = 'posted' and kind in ('expense','card_purchase') for update;
  if not found then raise exception 'Original expense or purchase not found' using errcode = '23514'; end if;
  select array_agg(ledger_account_id order by line_number),array_agg(amount_cents order by line_number),array_agg(competence order by line_number),sum(amount_cents)::bigint into category_rows,category_amounts,category_months,available from (
    select e.ledger_account_id,min(e.line_number) as line_number,coalesce(e.competence_month,original.competence_month) as competence,
      (sum(e.amount_cents) + coalesce((select sum(r.amount_cents) from finance.ledger_entries r join finance.ledger_transactions rt on rt.id = r.ledger_transaction_id where rt.related_transaction_id = p_original and rt.kind = 'refund' and rt.status = 'posted' and r.ledger_account_id = e.ledger_account_id),0))::bigint as amount_cents
    from finance.ledger_entries e join finance.ledger_accounts a on a.id = e.ledger_account_id where e.ledger_transaction_id = p_original and a.account_class = 'expense'
    group by e.ledger_account_id,coalesce(e.competence_month,original.competence_month)
  ) parts where amount_cents > 0;
  if available is null or p_amount_cents > available then raise exception 'Refund exceeds remaining consumption' using errcode = '23514'; end if;
  category_parts := private.divide_cents(p_amount_cents,category_amounts);
  for idx in 1..array_length(category_rows,1) loop
    if category_parts[idx] <> 0 then
      original_month := category_months[idx]; effective_month := private.next_open_competence(p_space,original_month);
      entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',category_rows[idx],'amount_cents',-category_parts[idx],'competence_month',effective_month,'original_competence_month',case when effective_month <> original_month then original_month end));
    end if;
  end loop;
  if original.kind = 'card_purchase' then
    select c.* into card from finance.credit_cards c join finance.ledger_entries e on e.ledger_account_id = c.ledger_account_id where e.ledger_transaction_id = p_original limit 1;
    if p_destination_account is not null then raise exception 'Card refund credits the original card' using errcode = '23514'; end if;
    if p_model is null then p_model := card.default_refund_model; end if;
    if p_model not in ('cancel_remaining','credit_open_statement') then raise exception 'Invalid card refund model' using errcode = '23514'; end if;
    remaining := p_amount_cents;
    if p_model = 'cancel_remaining' then
      select array_agg(id order by reference_month),array_agg(amount order by reference_month),sum(amount)::bigint into statement_ids,statement_amounts,pool from (
        select s.id,s.reference_month,(-sum(e.amount_cents) - coalesce((select sum(re.amount_cents) from finance.ledger_entries re join finance.ledger_transactions rt on rt.id = re.ledger_transaction_id where rt.related_transaction_id = p_original and rt.kind = 'refund' and rt.status = 'posted' and re.card_statement_id = s.id),0))::bigint as amount
        from finance.ledger_entries e join finance.card_statements s on s.id = e.card_statement_id where e.ledger_transaction_id = p_original and s.status <> 'closed' group by s.id
      ) future where amount > 0;
      if coalesce(pool,0) > 0 then
        statement_parts := private.divide_cents(least(remaining,pool),statement_amounts);
        for idx in 1..array_length(statement_ids,1) loop
          if statement_parts[idx] > 0 then entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',statement_parts[idx],'card_statement_id',statement_ids[idx])); end if;
        end loop;
        remaining := remaining-least(remaining,pool);
      end if;
    end if;
    if remaining > 0 then
      open_statement := private.ensure_card_statement(p_space,card.id,private.space_today(p_space));
      entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',remaining,'card_statement_id',open_statement));
    end if;
  else
    select * into destination from finance.financial_accounts where financial_space_id = p_space and id = p_destination_account and archived_at is null and deleted_at is null;
    if not found then raise exception 'Refund destination account not found' using errcode = '23514'; end if;
    entries := entries || jsonb_build_array(jsonb_build_object('ledger_account_id',destination.ledger_account_id,'amount_cents',p_amount_cents));
  end if;
  tx_id := private.post_transaction_internal(p_space,jsonb_build_object('kind','refund','occurred_on',p_on,'competence_month',private.next_open_competence(p_space,original.competence_month),'description',left('Estorno: ' || original.description,200),
    'related_transaction_id',p_original,'relation_type','refund_of','client_uuid',p_client_uuid,'notes',jsonb_build_object('destination',p_destination_account,'model',request_model,'amount_cents',p_amount_cents)::text,'entries',entries),auth.uid());
  return tx_id;
end;
$$;

create function api.open_card_balance(p_space uuid,p_card uuid,p_reference_month date,p_amount_cents bigint,p_on date,p_description text default 'Saldo inicial do cartão',p_client_uuid uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare card finance.credit_cards; statement_id uuid; opening_id uuid; cycle_purchase date; closing_month date; begin
  perform private.require_writer(p_space); perform pg_advisory_xact_lock(hashtextextended(p_space::text,0));
  if p_reference_month is null or extract(day from p_reference_month) <> 1 or p_amount_cents is null or p_amount_cents = 0 or abs(p_amount_cents::numeric) > 9007199254740991 then raise exception 'Invalid card opening' using errcode = '23514'; end if;
  select * into card from finance.credit_cards where id = p_card and financial_space_id = p_space;
  if not found then raise exception 'Card not found' using errcode = 'P0002'; end if;
  closing_month := case when card.due_day > card.closing_day then p_reference_month else (p_reference_month-interval '1 month')::date end;
  cycle_purchase := private.clamped_day((closing_month-interval '1 month')::date,card.closing_day) + case when card.closing_day_purchase_goes_next then 0 else 1 end;
  statement_id := private.ensure_card_statement(p_space,p_card,cycle_purchase);
  select id into opening_id from finance.ledger_accounts where financial_space_id = p_space and system_role = 'opening';
  return api.post_transaction(p_space,jsonb_build_object('kind','opening','source','system','occurred_on',p_on,'competence_month',date_trunc('month',p_on)::date,'description',p_description,'client_uuid',p_client_uuid,
    'entries',jsonb_build_array(jsonb_build_object('ledger_account_id',opening_id,'amount_cents',p_amount_cents),jsonb_build_object('ledger_account_id',card.ledger_account_id,'amount_cents',-p_amount_cents,'card_statement_id',statement_id))));
end;
$$;
-- Carry original competence through the common internal writer.
do $$ declare definition text; begin
  definition := pg_get_functiondef('private.post_transaction_internal(uuid,jsonb,uuid)'::regprocedure);
  definition := replace(definition,'line_number,competence_month,card_statement_id','line_number,competence_month,original_competence_month,card_statement_id');
  definition := replace(definition,'(entry->>''competence_month'')::date,(entry->>''card_statement_id'')','(entry->>''competence_month'')::date,(entry->>''original_competence_month'')::date,(entry->>''card_statement_id'')');
  execute definition;
end $$;
revoke all on function private.next_open_competence(uuid,date),private.refund_within_original() from public,anon,authenticated;
revoke all on function api.refund_transaction(uuid,uuid,bigint,date,uuid,text,uuid),api.open_card_balance(uuid,uuid,date,bigint,date,text,uuid) from public,anon,authenticated;
grant execute on function api.refund_transaction(uuid,uuid,bigint,date,uuid,text,uuid),api.open_card_balance(uuid,uuid,date,bigint,date,text,uuid) to authenticated;
commit;
