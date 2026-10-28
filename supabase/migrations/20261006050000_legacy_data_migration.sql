-- Migração dos dados do app antigo (public.*) para o modelo novo (finance.*).
-- ANALISE_E_PLANO.md, seções 5 e 11 (passo T5). Decisões aplicadas: 5 (histórico,
-- opção B), 6 (compras de cartão pendentes de faturas já vencidas = pagas fora do
-- app), 7 (poupança como investment), 8 (compra no dia do fechamento vai para a
-- fatura seguinte, padrão do cartão novo), 9 (classe de renda), 12 (nada apagado).
--
-- Nada roda ao aplicar esta migração: ela só cria o esquema legacy_migration.
-- A migração dos dados é executada à parte, por quem administra a produção:
--
--   select legacy_migration.run('dry_run');  -- ensaio: faz tudo, confere e desfaz
--   select legacy_migration.run('apply');    -- de verdade: só confirma se tudo bater
--
-- Como funciona:
--   - todos os dados novos passam pelas funções api.* do app, agindo como cada
--     usuário (mesmas validações, travas e auditoria de um lançamento normal);
--   - as tabelas antigas ficam travadas contra escrita durante a execução;
--   - todo registro antigo termina em legacy_migration.map como migrado, não
--     migrado (com o motivo) ou erro;
--   - a conferência compara, ao centavo, o saldo de cada conta antiga com o saldo
--     da conta nova e a dívida pendente de cada cartão com a dívida nova;
--   - em 'apply', qualquer erro ou diferença desfaz tudo; se tudo bater, as
--     tabelas antigas passam a só leitura para anon e authenticated.
-- Nenhuma tabela ou linha antiga é apagada ou alterada.

begin;

create schema legacy_migration;
revoke all on schema legacy_migration from public, anon, authenticated, service_role;

create table legacy_migration.runs (
  id bigint generated always as identity primary key,
  mode text not null check (mode in ('dry_run', 'apply')),
  cutoff_on date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'completed', 'failed')),
  report jsonb
);
create unique index runs_single_apply on legacy_migration.runs ((true))
  where mode = 'apply' and status = 'completed';

create table legacy_migration.map (
  run_id bigint not null references legacy_migration.runs (id),
  legacy_table text not null,
  legacy_id integer not null,
  user_id uuid,
  outcome text not null check (outcome in ('migrated', 'not_migrated', 'error')),
  target_table text,
  target_id uuid,
  rule text not null,
  amount_cents bigint,
  primary key (run_id, legacy_table, legacy_id)
);

create table legacy_migration.conference (
  run_id bigint not null references legacy_migration.runs (id),
  user_id uuid,
  check_name text not null,
  ref text not null,
  before_cents numeric,
  after_cents numeric,
  ok boolean not null
);

-- Reais (numeric) → centavos, sem arredondar: fração de centavo é erro.
create function legacy_migration.to_cents(p_value numeric)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null then
    return null;
  end if;
  if p_value * 100 <> trunc(p_value * 100) then
    raise exception 'O valor % tem fração de centavo', p_value using errcode = '22023';
  end if;
  return (p_value * 100)::bigint;
end;
$$;

-- Ciclo da fatura de uma compra, pela mesma regra de
-- private.ensure_card_statement_from_rules (9.5), sem gravar nada.
create function legacy_migration.card_cycle(
  p_closing_day integer,
  p_due_day integer,
  p_goes_next boolean,
  p_on date,
  out period_start date,
  out period_end date,
  out closing_on date,
  out due_on date,
  out reference_month date
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_close_month date;
  v_previous_closing date;
begin
  v_close_month := date_trunc('month', p_on)::date;
  closing_on := private.clamped_day(v_close_month, p_closing_day);
  if p_on > closing_on or (p_on = closing_on and p_goes_next) then
    v_close_month := (v_close_month + interval '1 month')::date;
  end if;
  closing_on := private.clamped_day(v_close_month, p_closing_day);
  v_previous_closing := private.clamped_day((v_close_month - interval '1 month')::date, p_closing_day);
  period_start := v_previous_closing + case when p_goes_next then 0 else 1 end;
  period_end := closing_on - case when p_goes_next then 1 else 0 end;
  due_on := private.clamped_day(v_close_month, p_due_day);
  if due_on <= closing_on then
    due_on := private.clamped_day((v_close_month + interval '1 month')::date, p_due_day);
  end if;
  reference_month := date_trunc('month', due_on)::date;
end;
$$;

-- Destino de um registro antigo já migrado nesta execução.
create function legacy_migration.target(p_run bigint, p_table text, p_id integer)
returns uuid
language sql
stable
set search_path = ''
as $$
  select target_id from legacy_migration.map
   where run_id = p_run and legacy_table = p_table and legacy_id = p_id and outcome = 'migrated';
$$;

create function legacy_migration.record(
  p_run bigint, p_table text, p_id integer, p_user uuid, p_outcome text,
  p_target_table text, p_target uuid, p_rule text, p_amount bigint
)
returns void
language sql
set search_path = ''
as $$
  insert into legacy_migration.map
    (run_id, legacy_table, legacy_id, user_id, outcome, target_table, target_id, rule, amount_cents)
  values (p_run, p_table, p_id, p_user, p_outcome, p_target_table, p_target, p_rule, p_amount);
$$;

-- Migra os dados de um usuário. Cada item roda num bloco próprio: um erro vira
-- linha 'error' no mapa e não interrompe os outros itens (o run decide no fim).
create function legacy_migration.migrate_user(p_run bigint, p_user uuid, p_today date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_space uuid;
  v_opening_ledger uuid;
  r record;
  v_id uuid;
  v_name text;
  v_n integer;
  v_kind text;
  v_cents bigint;
  v_effect bigint;
  v_account_ledger uuid;
  v_category_ledger uuid;
  v_first_on date;
  v_payment uuid;
  v_card record;
  v_cycle record;
  v_effective_due date;
  v_bucket text;
  v_closed jsonb;
  v_open bigint;
  v_entries jsonb;
  v_total bigint;
  v_statement uuid;
  v_statement_ref date;
  v_group record;
  v_preview jsonb;
  v_first_cash uuid;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);

  v_space := api.create_personal_space('Pessoal');
  if exists (select 1 from finance.financial_accounts where financial_space_id = v_space)
     or exists (select 1 from finance.ledger_transactions where financial_space_id = v_space) then
    raise exception 'O espaço pessoal do usuário % já tem dados no modelo novo', p_user;
  end if;

  -- Categorias. Uma categoria do app antigo com o mesmo nome e tipo de uma
  -- categoria padrão do espaço (por exemplo Cashback) é ligada a ela; nomes
  -- repetidos no app antigo recebem sufixo " (2)", " (3)"...
  for r in select * from public.categories where user_id = p_user order by id loop
    begin
      v_kind := case r.tipo when 'receita' then 'income' else 'expense' end;
      select c.id into v_id
        from finance.categories c
       where c.financial_space_id = v_space and c.parent_id is null
         and lower(trim(c.name)) = lower(trim(r.nome)) and c.kind = v_kind
         and c.ledger_account_id is not null and c.archived_at is null and c.deleted_at is null
         and not exists (select 1 from legacy_migration.map m
                          where m.run_id = p_run and m.target_id = c.id);
      if found then
        perform legacy_migration.record(p_run, 'categories', r.id, p_user, 'migrated',
          'finance.categories', v_id, 'ligada à categoria padrão de mesmo nome', null);
      else
        v_name := left(trim(r.nome), 92);
        v_n := 1;
        while exists (select 1 from finance.categories c
                       where c.financial_space_id = v_space and c.parent_id is null
                         and lower(trim(c.name)) = lower(v_name)
                         and c.archived_at is null and c.deleted_at is null) loop
          v_n := v_n + 1;
          v_name := left(trim(r.nome), 92) || ' (' || v_n || ')';
        end loop;
        v_id := api.create_category(v_space, v_name, v_kind, null,
          case when v_kind = 'income' then
            case lower(trim(r.nome))
              when 'salário' then 'recurring'
              when 'salario' then 'recurring'
              when 'investimentos' then 'financial'
              else 'extraordinary'
            end
          end,
          false, null);
        update finance.categories set color = r.cor, icon = r.icone where id = v_id;
        perform legacy_migration.record(p_run, 'categories', r.id, p_user, 'migrated',
          'finance.categories', v_id,
          case when v_n > 1 then 'criada com sufixo (nome repetido)' else 'criada' end, null);
      end if;
    exception when others then
      perform legacy_migration.record(p_run, 'categories', r.id, p_user, 'error', null, null, sqlerrm, null);
    end;
  end loop;

  -- Contas. Opção B: o saldo inicial entra como abertura na data do primeiro
  -- lançamento pago da conta (ou na data de corte, se não houver nenhum antes dela).
  for r in select * from public.accounts where user_id = p_user order by id loop
    begin
      select min(t.data) into v_first_on
        from public.transactions t
       where t.user_id = p_user and t.account_id = r.id and t.status = 'pago';
      v_id := api.create_financial_account(v_space, r.nome,
        case r.tipo
          when 'corrente' then 'checking'
          when 'carteira' then 'wallet'
          when 'poupanca' then 'savings'
          when 'investimento' then 'investment'
        end,
        legacy_migration.to_cents(r.saldo_inicial),
        least(coalesce(v_first_on, p_today), p_today));
      update finance.financial_accounts set color = r.cor where id = v_id;
      perform legacy_migration.record(p_run, 'accounts', r.id, p_user, 'migrated',
        'finance.financial_accounts', v_id, 'criada com abertura', legacy_migration.to_cents(r.saldo_inicial));
    exception when others then
      perform legacy_migration.record(p_run, 'accounts', r.id, p_user, 'error', null, null, sqlerrm, null);
    end;
  end loop;

  select fa.id into v_first_cash
    from public.accounts a
    join legacy_migration.map m on m.run_id = p_run and m.legacy_table = 'accounts'
                               and m.legacy_id = a.id and m.outcome = 'migrated'
    join finance.financial_accounts fa on fa.id = m.target_id
   where a.user_id = p_user and a.tipo in ('corrente', 'carteira')
   order by a.id
   limit 1;

  -- Cartões.
  for r in select * from public.credit_cards where user_id = p_user order by id loop
    begin
      select legacy_migration.target(p_run, 'accounts', a.id) into v_payment
        from public.accounts a where a.id = r.conta_pagamento_id and a.user_id = p_user;
      v_id := api.create_credit_card(v_space, r.nome, legacy_migration.to_cents(r.limite),
        r.dia_fechamento, r.dia_vencimento, v_payment);
      perform legacy_migration.record(p_run, 'credit_cards', r.id, p_user, 'migrated',
        'finance.credit_cards', v_id, 'criado', legacy_migration.to_cents(r.limite));
    exception when others then
      perform legacy_migration.record(p_run, 'credit_cards', r.id, p_user, 'error', null, null, sqlerrm, null);
    end;
  end loop;

  -- Lançamentos pagos (opção B): cada um vira receita ou despesa na conta antiga,
  -- com ou sem cartão, porque era assim que afetavam o saldo no app antigo.
  for r in
    select t.*, k.nome as cartao_nome
      from public.transactions t
      left join public.credit_cards k on k.id = t.cartao_id
     where t.user_id = p_user and t.status = 'pago'
     order by t.data, t.id
  loop
    begin
      if not exists (select 1 from public.accounts a where a.id = r.account_id and a.user_id = p_user)
         or not exists (select 1 from public.categories c where c.id = r.category_id and c.user_id = p_user) then
        perform legacy_migration.record(p_run, 'transactions', r.id, p_user, 'not_migrated', null, null,
          'referência a conta ou categoria de outro usuário', legacy_migration.to_cents(r.valor));
        continue;
      end if;
      v_cents := legacy_migration.to_cents(r.valor);
      if v_cents = 0 then
        perform legacy_migration.record(p_run, 'transactions', r.id, p_user, 'not_migrated', null, null,
          'valor zero', 0);
        continue;
      end if;
      v_effect := case r.tipo when 'receita' then v_cents else -v_cents end;
      select fa.ledger_account_id into v_account_ledger
        from finance.financial_accounts fa
       where fa.id = legacy_migration.target(p_run, 'accounts', r.account_id);
      select c.ledger_account_id, c.name into v_category_ledger, v_name
        from finance.categories c
       where c.id = legacy_migration.target(p_run, 'categories', r.category_id);
      if v_account_ledger is null or v_category_ledger is null then
        raise exception 'Conta ou categoria do lançamento não foi migrada';
      end if;
      v_id := api.post_transaction(v_space, jsonb_build_object(
        'kind', case r.tipo when 'receita' then 'income' else 'expense' end,
        'occurred_on', r.data,
        'competence_month', date_trunc('month', r.data)::date,
        'description', left(coalesce(nullif(trim(r.descricao), ''), v_name), 200),
        'notes', 'Migrado do app antigo (lançamento ' || r.id || ').'
          || case when r.cartao_id is not null
               then ' Compra no cartão ' || coalesce(r.cartao_nome, '?') || ', marcada como paga no app antigo.'
               else '' end,
        'source', 'system',
        'entries', jsonb_build_array(
          jsonb_build_object('ledger_account_id', v_account_ledger, 'amount_cents', v_effect),
          jsonb_build_object('ledger_account_id', v_category_ledger, 'amount_cents', -v_effect))));
      perform legacy_migration.record(p_run, 'transactions', r.id, p_user, 'migrated',
        'finance.ledger_transactions', v_id,
        case when r.cartao_id is not null then 'paga no cartão: despesa da conta'
             when r.data > p_today then 'paga com data futura: lançamento agendado'
             else 'paga' end,
        v_cents);
    exception when others then
      perform legacy_migration.record(p_run, 'transactions', r.id, p_user, 'error', null, null, sqlerrm, null);
    end;
  end loop;

  -- Compras de cartão pendentes → abertura do cartão em uso (9.16), por fatura.
  for v_card in
    select k.*, legacy_migration.target(p_run, 'credit_cards', k.id) as new_id
      from public.credit_cards k
     where k.user_id = p_user
     order by k.id
  loop
    if v_card.new_id is null then
      insert into legacy_migration.map
        (run_id, legacy_table, legacy_id, user_id, outcome, rule, amount_cents)
      select p_run, 'transactions', t.id, p_user, 'error', 'cartão não foi migrado', null
        from public.transactions t
       where t.user_id = p_user and t.cartao_id = v_card.id and t.status = 'pendente'
      on conflict do nothing;
      continue;
    end if;
    begin
      create temporary table if not exists lm_card_items (
        legacy_id integer, group_id integer, data date, cents bigint, bucket text,
        period_start date, closing_on date, due_on date, effective_due_on date,
        reference_month date, description text
      ) on commit drop;
      truncate lm_card_items;

      for r in
        select t.* from public.transactions t
         where t.user_id = p_user and t.cartao_id = v_card.id and t.status = 'pendente'
         order by t.data, t.id
      loop
        if r.tipo <> 'despesa' or r.valor <= 0 then
          perform legacy_migration.record(p_run, 'transactions', r.id, p_user, 'not_migrated', null, null,
            'pendente no cartão sem ser despesa positiva', legacy_migration.to_cents(r.valor));
          continue;
        end if;
        select * into v_cycle
          from legacy_migration.card_cycle(v_card.dia_fechamento, v_card.dia_vencimento,
            (select closing_day_purchase_goes_next from finance.credit_cards where id = v_card.new_id), r.data);
        v_effective_due := private.effective_due_date(v_space, v_cycle.due_on, 'next');
        v_bucket := case
          when p_today < v_cycle.period_start then 'future'
          when p_today <= v_cycle.period_end then 'open'
          when v_effective_due >= p_today then 'closed_unpaid'
          else 'assumed_paid'
        end;
        insert into lm_card_items values (
          r.id, r.recorrencia_id, r.data, legacy_migration.to_cents(r.valor), v_bucket,
          v_cycle.period_start, v_cycle.closing_on, v_cycle.due_on, v_effective_due,
          v_cycle.reference_month, coalesce(nullif(trim(r.descricao), ''), 'Compra no cartão'));
      end loop;

      select coalesce(jsonb_agg(jsonb_build_object(
               'period_start', s.period_start, 'closing_on', s.closing_on, 'due_on', s.due_on,
               'effective_due_on', s.effective_due_on, 'amount_cents', s.total) order by s.closing_on), '[]'::jsonb)
        into v_closed
        from (select period_start, closing_on, due_on, effective_due_on, sum(cents) as total
                from lm_card_items where bucket = 'closed_unpaid'
               group by period_start, closing_on, due_on, effective_due_on) s;
      select coalesce(sum(cents), 0) into v_open from lm_card_items where bucket = 'open';

      if jsonb_array_length(v_closed) > 0 or v_open > 0 then
        perform api.configure_card_opening(v_space, v_card.new_id, p_today,
          jsonb_build_object('closed_statements', v_closed, 'open_amount_cents', v_open), null);
        -- A fatura aberta usada pela abertura tem de ser a mesma que a migração calculou.
        if exists (select 1 from lm_card_items where bucket = 'open')
           and not exists (
             select 1 from finance.card_statements s
              where s.credit_card_id = v_card.new_id and s.status = 'open'
                and s.reference_month = (select max(reference_month) from lm_card_items where bucket = 'open')) then
          raise exception 'A fatura aberta calculada difere da fatura aberta do cartão novo';
        end if;
      end if;

      -- Faturas futuras: uma abertura por parcelamento (ou por compra avulsa), com
      -- o valor exato de cada parcela do app antigo.
      select id into v_opening_ledger from finance.ledger_accounts
       where financial_space_id = v_space and system_role = 'opening';
      for v_group in
        select coalesce(group_id, -legacy_id) as gkey, min(description) as description
          from lm_card_items where bucket = 'future'
         group by coalesce(group_id, -legacy_id)
         order by min(data)
      loop
        v_entries := '[]'::jsonb;
        v_total := 0;
        for r in
          select i.*,
                 (select count(*) from public.transactions g
                   where v_group.gkey > 0 and g.recorrencia_id = v_group.gkey and g.user_id = p_user) as group_size,
                 (select count(*) from public.transactions g
                   where v_group.gkey > 0 and g.recorrencia_id = v_group.gkey and g.user_id = p_user
                     and (g.data, g.id) <= (i.data, i.legacy_id)) as group_rank,
                 substring(t.descricao from '\((\d+)/(\d+)\)\s*$') as k_text,
                 substring(t.descricao from '\(\d+/(\d+)\)\s*$') as n_text
            from lm_card_items i
            join public.transactions t on t.id = i.legacy_id
           where i.bucket = 'future' and coalesce(i.group_id, -i.legacy_id) = v_group.gkey
           order by i.data, i.legacy_id
        loop
          v_statement := private.import_card_statement(v_space, v_card.new_id, r.reference_month);
          select reference_month into v_statement_ref from finance.card_statements where id = v_statement;
          if v_statement_ref is distinct from r.reference_month then
            raise exception 'A fatura de % calculada (%) difere da fatura do cartão novo (%)',
              r.data, r.reference_month, v_statement_ref;
          end if;
          v_total := v_total + r.cents;
          v_entries := v_entries || jsonb_build_array(
            jsonb_build_object('ledger_account_id',
                (select ledger_account_id from finance.credit_cards where id = v_card.new_id),
              'amount_cents', -r.cents, 'card_statement_id', v_statement)
            || case when r.group_size >= 2 then jsonb_build_object(
                 'installment_number', coalesce(r.k_text::integer, r.group_rank),
                 'installment_count', greatest(coalesce(r.n_text::integer, r.group_size), r.group_size))
               else '{}'::jsonb end);
        end loop;
        v_id := private.post_transaction_internal(v_space, jsonb_build_object(
          'kind', 'opening', 'occurred_on', p_today,
          'competence_month', date_trunc('month', p_today)::date,
          'description', left('Saldo inicial: ' || regexp_replace(v_group.description, '\s*\(\d+/\d+\)\s*$', ''), 200),
          'notes', 'Migrado do app antigo: parcelas futuras pendentes.',
          'source', 'system',
          'entries', jsonb_build_array(jsonb_build_object('ledger_account_id', v_opening_ledger, 'amount_cents', v_total))
                     || v_entries), p_user);
      end loop;

      insert into legacy_migration.map
        (run_id, legacy_table, legacy_id, user_id, outcome, target_table, target_id, rule, amount_cents)
      select p_run, 'transactions', i.legacy_id, p_user,
             case when i.bucket = 'assumed_paid' then 'not_migrated' else 'migrated' end,
             case when i.bucket = 'assumed_paid' then null else 'finance.credit_cards' end,
             case when i.bucket = 'assumed_paid' then null else v_card.new_id end,
             case i.bucket
               when 'open' then 'pendente no cartão: fatura aberta'
               when 'closed_unpaid' then 'pendente no cartão: fatura fechada a vencer'
               when 'future' then 'pendente no cartão: fatura futura'
               else 'pendente no cartão de fatura já vencida: considerada paga fora do app'
             end,
             i.cents
        from lm_card_items i;
      if exists (select 1 from lm_card_items) then
        update finance.credit_cards set version = version + 1 where id = v_card.new_id;
      end if;
    exception when others then
      insert into legacy_migration.map
        (run_id, legacy_table, legacy_id, user_id, outcome, rule, amount_cents)
      select p_run, 'transactions', t.id, p_user, 'error', 'abertura do cartão: ' || sqlerrm, null
        from public.transactions t
       where t.user_id = p_user and t.cartao_id = v_card.id and t.status = 'pendente'
      on conflict do nothing;
    end;
  end loop;

  -- Lançamentos pendentes sem cartão → compromissos avulsos da Agenda.
  for r in
    select * from public.transactions
     where user_id = p_user and status = 'pendente' and cartao_id is null
     order by data, id
  loop
    begin
      v_cents := legacy_migration.to_cents(r.valor);
      v_payment := legacy_migration.target(p_run, 'accounts', r.account_id);
      if v_cents <= 0 or v_payment is null
         or not exists (select 1 from public.accounts a where a.id = r.account_id and a.user_id = p_user) then
        perform legacy_migration.record(p_run, 'transactions', r.id, p_user, 'not_migrated', null, null,
          'pendente sem valor positivo ou sem conta própria', v_cents);
        continue;
      end if;
      v_id := api.create_commitment(v_space, jsonb_build_object(
        'kind', 'one_off',
        'direction', case r.tipo when 'receita' then 'inflow' else 'outflow' end,
        'certainty', 'confirmed',
        'title', left(coalesce(nullif(trim(r.descricao), ''), 'Lançamento pendente do app antigo'), 200),
        'notes', 'Migrado do app antigo (lançamento pendente ' || r.id || ').',
        'category_id', legacy_migration.target(p_run, 'categories', r.category_id),
        'amount_cents', v_cents,
        'due_on', r.data,
        'payment_method', 'account',
        'payment_financial_account_id', v_payment));
      perform legacy_migration.record(p_run, 'transactions', r.id, p_user, 'migrated',
        'finance.commitments', v_id, 'pendente: compromisso da Agenda', v_cents);
    exception when others then
      perform legacy_migration.record(p_run, 'transactions', r.id, p_user, 'error', null, null, sqlerrm, null);
    end;
  end loop;

  -- Contas a pagar e a receber.
  for r in select * from public.bills where user_id = p_user order by id loop
    begin
      if r.status = 'pago' then
        perform legacy_migration.record(p_run, 'bills', r.id, p_user, 'not_migrated', null, null,
          'conta marcada como paga sem lançamento: fica só no histórico antigo', legacy_migration.to_cents(r.valor));
        continue;
      end if;
      v_cents := legacy_migration.to_cents(r.valor);
      v_payment := coalesce(
        (select legacy_migration.target(p_run, 'accounts', a.id) from public.accounts a
          where a.id = r.conta_id and a.user_id = p_user),
        v_first_cash);
      if v_cents <= 0 or v_payment is null then
        perform legacy_migration.record(p_run, 'bills', r.id, p_user, 'not_migrated', null, null,
          'conta pendente sem valor positivo ou sem conta para pagamento', v_cents);
        continue;
      end if;
      v_id := api.create_commitment(v_space, jsonb_build_object(
        'kind', 'one_off',
        'direction', case r.tipo when 'receber' then 'inflow' else 'outflow' end,
        'certainty', 'confirmed',
        'title', left(coalesce(nullif(trim(r.descricao), ''), 'Conta do app antigo'), 200),
        'notes', 'Migrado do app antigo (conta ' || r.id || ').'
          || case when nullif(trim(r.recorrencia), '') is not null
               then ' Recorrência no app antigo: ' || trim(r.recorrencia) || '.' else '' end,
        'amount_cents', v_cents,
        'due_on', r.vencimento,
        'payment_method', 'account',
        'payment_financial_account_id', v_payment));
      perform legacy_migration.record(p_run, 'bills', r.id, p_user, 'migrated',
        'finance.commitments', v_id, 'pendente: compromisso da Agenda', v_cents);
    exception when others then
      perform legacy_migration.record(p_run, 'bills', r.id, p_user, 'error', null, null, sqlerrm, null);
    end;
  end loop;

  -- Metas → meta virtual guardada na primeira conta caixa, com o valor atual como aporte.
  for r in select * from public.goals where user_id = p_user order by id loop
    begin
      if v_first_cash is null or r.valor_alvo <= 0 then
        perform legacy_migration.record(p_run, 'goals', r.id, p_user, 'not_migrated', null, null,
          'meta sem valor-alvo positivo ou usuário sem conta caixa', legacy_migration.to_cents(r.valor_atual));
        continue;
      end if;
      v_id := api.create_reserve(v_space, jsonb_build_object(
        'reserve_type', 'goal', 'name', r.nome, 'holding_mode', 'virtual',
        'financial_account_id', v_first_cash,
        'target_amount_cents', legacy_migration.to_cents(r.valor_alvo),
        'target_date', r.prazo, 'contribution_mode', 'manual'));
      v_cents := legacy_migration.to_cents(r.valor_atual);
      if v_cents > 0 then
        v_preview := private.preview_reserve_contribution(v_space, v_id, 'contribution', v_cents, p_today,
          'Valor guardado no app antigo');
        perform api.reserve_contribution(v_space, v_id, 'contribution', v_cents, p_today,
          'Valor guardado no app antigo', null,
          case when (v_preview->>'requiresWarning')::boolean then v_preview->>'approvalToken' end);
      end if;
      perform legacy_migration.record(p_run, 'goals', r.id, p_user, 'migrated',
        'finance.reserves', v_id, 'meta virtual com aporte do valor atual', v_cents);
    exception when others then
      perform legacy_migration.record(p_run, 'goals', r.id, p_user, 'error', null, null, sqlerrm, null);
    end;
  end loop;

  -- Orçamentos: meses seguidos com o mesmo valor viram uma vigência só; valor zero
  -- é tratado como "sem orçamento".
  for r in
    with b as (
      select x.*, (x.mes_ano || '-01')::date as month
        from public.budgets x where x.user_id = p_user
    ), marked as (
      select b.*, case when lag(month) over w = (month - interval '1 month')::date
                        and lag(valor_planejado) over w = valor_planejado then 0 else 1 end as starts
        from b window w as (partition by categoria_id order by month)
    ), grouped as (
      select marked.*, sum(starts) over (partition by categoria_id order by month) as grp from marked
    )
    select categoria_id, grp, min(month) as from_month, max(month) as until_month,
           min(valor_planejado) as valor, array_agg(id order by month) as ids
      from grouped
     group by categoria_id, grp
     order by categoria_id, min(month)
  loop
    begin
      if r.valor = 0 then
        insert into legacy_migration.map (run_id, legacy_table, legacy_id, user_id, outcome, rule, amount_cents)
        select p_run, 'budgets', unnest(r.ids), p_user, 'not_migrated', 'orçamento com valor zero', 0;
        continue;
      end if;
      v_id := api.create_budget(v_space, jsonb_build_object(
        'budget_type', 'consumption',
        'category_id', legacy_migration.target(p_run, 'categories', r.categoria_id),
        'amount_cents', legacy_migration.to_cents(r.valor),
        'effective_from_month', r.from_month,
        'effective_until_month', r.until_month));
      insert into legacy_migration.map
        (run_id, legacy_table, legacy_id, user_id, outcome, target_table, target_id, rule, amount_cents)
      select p_run, 'budgets', unnest(r.ids), p_user, 'migrated', 'finance.budgets', v_id,
             'orçamento mensal agrupado em vigência', legacy_migration.to_cents(r.valor);
    exception when others then
      insert into legacy_migration.map (run_id, legacy_table, legacy_id, user_id, outcome, rule)
      select p_run, 'budgets', unnest(r.ids), p_user, 'error', sqlerrm;
    end;
  end loop;
end;
$$;

-- Conferência de uma execução: saldos de contas, dívida de cartões e cobertura.
create function legacy_migration.check_run(p_run bigint, p_only_users uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Saldo de cada conta antiga (como o app antigo mostra) × saldo da conta nova.
  insert into legacy_migration.conference (run_id, user_id, check_name, ref, before_cents, after_cents, ok)
  select p_run, a.user_id, 'saldo da conta', 'accounts:' || a.id,
         (a.saldo_inicial + coalesce((select sum(case when t.tipo = 'receita' then t.valor else -t.valor end)
                                        from public.transactions t
                                       where t.account_id = a.id and t.user_id = a.user_id
                                         and t.status = 'pago'), 0)) * 100,
         (select coalesce(sum(e.amount_cents), 0)
            from finance.financial_accounts fa
            join finance.ledger_entries e on e.ledger_account_id = fa.ledger_account_id
            join finance.ledger_transactions lt on lt.id = e.ledger_transaction_id and lt.status = 'posted'
           where fa.id = legacy_migration.target(p_run, 'accounts', a.id)),
         false
    from public.accounts a
   where p_only_users is null or a.user_id = any (p_only_users);

  -- Dívida de cada cartão: compras pendentes em aberto (fatura fechada a vencer,
  -- aberta ou futura) × dívida do cartão novo.
  insert into legacy_migration.conference (run_id, user_id, check_name, ref, before_cents, after_cents, ok)
  select p_run, k.user_id, 'dívida do cartão', 'credit_cards:' || k.id,
         coalesce((select sum(m.amount_cents) from legacy_migration.map m
                    join public.transactions t on t.id = m.legacy_id
                   where m.run_id = p_run and m.legacy_table = 'transactions' and m.outcome = 'migrated'
                     and m.target_table = 'finance.credit_cards' and t.cartao_id = k.id), 0),
         (select -coalesce(sum(e.amount_cents), 0)
            from finance.credit_cards c
            join finance.ledger_entries e on e.ledger_account_id = c.ledger_account_id
            join finance.ledger_transactions lt on lt.id = e.ledger_transaction_id and lt.status = 'posted'
           where c.id = legacy_migration.target(p_run, 'credit_cards', k.id)),
         false
    from public.credit_cards k
   where p_only_users is null or k.user_id = any (p_only_users);

  -- Cobertura: todo registro antigo tem uma linha no mapa.
  insert into legacy_migration.conference (run_id, user_id, check_name, ref, before_cents, after_cents, ok)
  select p_run, null, 'cobertura', x.tbl, x.legacy_rows,
         (select count(*) from legacy_migration.map m where m.run_id = p_run and m.legacy_table = x.tbl), false
    from (
      select 'accounts' as tbl, count(*) as legacy_rows from public.accounts where p_only_users is null or user_id = any (p_only_users)
      union all select 'categories', count(*) from public.categories where p_only_users is null or user_id = any (p_only_users)
      union all select 'credit_cards', count(*) from public.credit_cards where p_only_users is null or user_id = any (p_only_users)
      union all select 'transactions', count(*) from public.transactions where p_only_users is null or user_id = any (p_only_users)
      union all select 'bills', count(*) from public.bills where p_only_users is null or user_id = any (p_only_users)
      union all select 'goals', count(*) from public.goals where p_only_users is null or user_id = any (p_only_users)
      union all select 'budgets', count(*) from public.budgets where p_only_users is null or user_id = any (p_only_users)
    ) x;

  update legacy_migration.conference
     set ok = before_cents is not distinct from after_cents
   where run_id = p_run;
end;
$$;

create function legacy_migration.build_report(p_run bigint)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'run_id', r.id,
    'mode', r.mode,
    'cutoff_on', r.cutoff_on,
    'users', (select count(distinct user_id) from legacy_migration.map where run_id = r.id),
    'ok', not exists (select 1 from legacy_migration.map where run_id = r.id and outcome = 'error')
          and not exists (select 1 from legacy_migration.conference where run_id = r.id and not ok),
    'migrated', (select coalesce(jsonb_object_agg(legacy_table, n), '{}'::jsonb)
                   from (select legacy_table, count(*) as n from legacy_migration.map
                          where run_id = r.id and outcome = 'migrated' group by legacy_table) s),
    'not_migrated', (select coalesce(jsonb_agg(jsonb_build_object(
                        'table', legacy_table, 'rule', rule, 'count', n, 'amount_cents', cents)
                        order by legacy_table, rule), '[]'::jsonb)
                       from (select legacy_table, rule, count(*) as n, sum(amount_cents) as cents
                               from legacy_migration.map where run_id = r.id and outcome = 'not_migrated'
                              group by legacy_table, rule) s),
    'errors', (select coalesce(jsonb_agg(jsonb_build_object(
                  'table', legacy_table, 'legacy_id', legacy_id, 'user_id', user_id, 'message', rule)
                  order by legacy_table, legacy_id), '[]'::jsonb)
                 from (select * from legacy_migration.map where run_id = r.id and outcome = 'error'
                        order by legacy_table, legacy_id limit 200) e),
    'conference', jsonb_build_object(
      'checks', (select count(*) from legacy_migration.conference where run_id = r.id),
      'failed', (select coalesce(jsonb_agg(jsonb_build_object(
                    'check', check_name, 'ref', ref, 'user_id', user_id,
                    'before', before_cents, 'after', after_cents) order by check_name, ref), '[]'::jsonb)
                   from (select * from legacy_migration.conference where run_id = r.id and not ok
                          order by check_name, ref limit 200) f))
  )
  from legacy_migration.runs r
  where r.id = p_run;
$$;

-- Tabelas antigas só leitura para os papéis do app (decisão 12: nada é apagado).
create function legacy_migration.freeze_legacy()
returns void
language plpgsql
set search_path = ''
as $$
begin
  revoke insert, update, delete, truncate on
    public.accounts, public.categories, public.credit_cards, public.transactions,
    public.bills, public.budgets, public.goals
  from anon, authenticated;
  if to_regprocedure('public.create_installment_purchase(integer, integer, integer, numeric, integer, date, text, text)') is not null then
    revoke execute on function
      public.create_installment_purchase(integer, integer, integer, numeric, integer, date, text, text)
    from authenticated;
  end if;
end;
$$;

-- Ponto de entrada. 'dry_run' faz tudo, monta o relatório e desfaz. 'apply' só
-- confirma se não houver erro nem diferença; senão aborta com o relatório.
-- p_only_users serve aos testes; em produção fica vazio (todos os usuários).
create function legacy_migration.run(p_mode text default 'dry_run', p_only_users uuid[] default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_run bigint;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_user uuid;
  v_report jsonb;
begin
  if p_mode is null or p_mode not in ('dry_run', 'apply') then
    raise exception 'Modo inválido: use dry_run ou apply';
  end if;
  if p_mode = 'apply' and exists (select 1 from legacy_migration.runs where mode = 'apply' and status = 'completed') then
    raise exception 'A migração do app antigo já foi aplicada';
  end if;

  begin
    lock table public.accounts, public.categories, public.credit_cards, public.transactions,
               public.bills, public.budgets, public.goals in share mode;

    insert into legacy_migration.runs (mode, cutoff_on, status)
    values (p_mode, v_today, 'running') returning id into v_run;

    for v_user in
      select distinct u.user_id
        from (select user_id from public.accounts
              union select user_id from public.categories
              union select user_id from public.credit_cards
              union select user_id from public.transactions
              union select user_id from public.bills
              union select user_id from public.budgets
              union select user_id from public.goals) u
       where p_only_users is null or u.user_id = any (p_only_users)
       order by u.user_id
    loop
      begin
        perform legacy_migration.migrate_user(v_run, v_user, v_today);
      exception when others then
        insert into legacy_migration.map (run_id, legacy_table, legacy_id, user_id, outcome, rule)
        values (v_run, 'users', 0, v_user, 'error', sqlerrm)
        on conflict do nothing;
      end;
    end loop;
    perform set_config('request.jwt.claims', '', true);

    perform legacy_migration.check_run(v_run, p_only_users);
    v_report := legacy_migration.build_report(v_run);
    update legacy_migration.runs
       set report = v_report, finished_at = now(),
           status = case when (v_report->>'ok')::boolean then 'completed' else 'failed' end
     where id = v_run;

    if p_mode = 'dry_run' then
      raise exception using errcode = 'LMDRY', message = 'ensaio desfeito';
    end if;
    if not (v_report->>'ok')::boolean then
      raise exception 'Migração não aplicada: há erros ou diferenças na conferência'
        using detail = v_report::text;
    end if;
    perform legacy_migration.freeze_legacy();
    return v_report;
  exception when sqlstate 'LMDRY' then
    return v_report;
  end;
end;
$$;

revoke all on all functions in schema legacy_migration from public, anon, authenticated, service_role;
revoke all on all tables in schema legacy_migration from public, anon, authenticated, service_role;

commit;
