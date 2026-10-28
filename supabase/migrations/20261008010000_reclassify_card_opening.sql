begin;

create or replace function api.reclassify_card_opening(
  p_space uuid,
  p_card uuid,
  p_close_date date default null,
  p_due_date date default null,
  p_client_uuid uuid default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  card finance.credit_cards;
  tx_row record;
  stmt finance.card_statements;
  open_stmt_id uuid;
  today_date date;
  v_close date;
  v_due date;
  v_start date;
  v_effective date;
  v_amount bigint;
begin
  perform private.require_admin(p_space);
  perform pg_advisory_xact_lock(hashtextextended(p_space::text, 0));

  select * into card from finance.credit_cards where financial_space_id = p_space and id = p_card and deleted_at is null for update;
  if not found then raise exception 'Cartão não encontrado' using errcode = 'P0002'; end if;

  select t.id as tx_id, e.id as entry_id, e.amount_cents, e.card_statement_id
  into tx_row
  from finance.ledger_entries e
  join finance.ledger_transactions t on t.id = e.ledger_transaction_id
  where e.ledger_account_id = card.ledger_account_id
    and t.kind = 'opening'
    and t.description = 'Saldo inicial: fatura aberta'
    and t.status = 'posted'
  limit 1;

  if not found then
    raise exception 'Nenhum saldo inicial de fatura aberta encontrado para reclassificar neste cartão.' using errcode = '23514';
  end if;

  select * into stmt from finance.card_statements where id = tx_row.card_statement_id for update;
  if not found or stmt.status <> 'open' then
    raise exception 'Fatura aberta não encontrada ou já fechada.' using errcode = '23514';
  end if;

  today_date := private.space_today(p_space);

  if p_close_date is not null then
    v_close := p_close_date;
  else
    if extract(day from today_date) >= card.closing_day then
      v_close := make_date(extract(year from today_date)::integer, extract(month from today_date)::integer, card.closing_day);
    else
      v_close := (make_date(extract(year from today_date)::integer, extract(month from today_date)::integer, 1) - interval '1 day')::date;
      v_close := make_date(extract(year from v_close)::integer, extract(month from v_close)::integer, least(card.closing_day, extract(day from v_close)::integer));
    end if;
  end if;

  if p_due_date is not null then
    v_due := p_due_date;
  else
    if card.due_day >= card.closing_day then
      v_due := make_date(extract(year from v_close)::integer, extract(month from v_close)::integer, card.due_day);
    else
      v_due := (date_trunc('month', v_close) + interval '1 month')::date;
      v_due := make_date(extract(year from v_due)::integer, extract(month from v_due)::integer, card.due_day);
    end if;
  end if;

  v_start := (date_trunc('month', v_close) - interval '1 month')::date;
  v_start := make_date(extract(year from v_start)::integer, extract(month from v_start)::integer, least(card.closing_day, extract(day from (date_trunc('month', v_start) + interval '1 month - 1 day')::date)::integer)) + 1;

  v_effective := private.effective_due_date(p_space, v_due);
  v_amount := abs(tx_row.amount_cents);

  update finance.card_statements set
    reference_month = date_trunc('month', v_due)::date,
    period_start = v_start,
    period_end = v_close - case when card.closing_day_purchase_goes_next then 1 else 0 end,
    closing_on = v_close,
    due_on = v_due,
    effective_due_on = v_effective,
    status = 'closed',
    closed_at = now(),
    closing_amount_cents = v_amount,
    dates_overridden = false,
    version = version + 1,
    updated_at = now()
  where id = stmt.id;

  update finance.ledger_transactions set
    description = 'Saldo inicial: fatura ' || to_char(v_due, 'MM/YYYY')
  where id = tx_row.tx_id;

  open_stmt_id := private.ensure_card_statement(p_space, p_card, today_date);

  insert into finance.audit_logs(financial_space_id, actor_id, action, entity_type, entity_id, before_data, after_data)
  values(p_space, auth.uid(), 'card_opening_reclassified', 'credit_card', p_card, to_jsonb(stmt), jsonb_build_object('statement_id', stmt.id, 'closed_at', now(), 'due_on', v_due, 'open_statement_id', open_stmt_id));

  return stmt.id;
end;
$$;

revoke all on function api.reclassify_card_opening(uuid,uuid,date,date,uuid) from public,anon,authenticated;
grant execute on function api.reclassify_card_opening(uuid,uuid,date,date,uuid) to authenticated;
notify pgrst, 'reload schema';

commit;
