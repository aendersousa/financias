-- financias: schema Postgres para Supabase
-- Rode este script inteiro no SQL Editor do seu projeto Supabase (Supabase Dashboard > SQL Editor > New query).

create table accounts (
  id integer generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('corrente','poupanca','carteira','investimento')),
  saldo_inicial numeric not null default 0,
  cor text not null default '#64748b'
);

create table categories (
  id integer generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('receita','despesa')),
  cor text not null default '#64748b',
  icone text
);

create table credit_cards (
  id integer generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  limite numeric not null default 0,
  dia_fechamento integer not null,
  dia_vencimento integer not null,
  conta_pagamento_id integer references accounts(id) on delete set null
);

create table transactions (
  id integer generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id integer not null references accounts(id) on delete cascade,
  category_id integer not null references categories(id) on delete restrict,
  tipo text not null check (tipo in ('receita','despesa')),
  valor numeric not null,
  data date not null,
  descricao text not null default '',
  status text not null check (status in ('pago','pendente')) default 'pago',
  cartao_id integer references credit_cards(id) on delete set null,
  recorrencia_id integer
);
create index idx_transactions_account on transactions(account_id);
create index idx_transactions_category on transactions(category_id);
create index idx_transactions_data on transactions(data);
create index idx_transactions_user on transactions(user_id);

create table bills (
  id integer generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  descricao text not null,
  valor numeric not null,
  vencimento date not null,
  tipo text not null check (tipo in ('pagar','receber')),
  status text not null check (status in ('pendente','pago')) default 'pendente',
  recorrencia text,
  conta_id integer references accounts(id) on delete set null
);

create table budgets (
  id integer generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  categoria_id integer not null references categories(id) on delete cascade,
  mes_ano text not null,
  valor_planejado numeric not null,
  unique (user_id, categoria_id, mes_ano)
);

create table goals (
  id integer generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  valor_alvo numeric not null,
  valor_atual numeric not null default 0,
  prazo date
);

-- Row Level Security: cada usuário só enxerga/altera as próprias linhas
alter table accounts enable row level security;
alter table categories enable row level security;
alter table credit_cards enable row level security;
alter table transactions enable row level security;
alter table bills enable row level security;
alter table budgets enable row level security;
alter table goals enable row level security;

create policy "own rows" on accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on credit_cards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on bills for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on budgets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seed automático de categorias padrão quando um novo usuário se cadastra
-- (equivalente ao antigo seed.ts, mas disparado no banco em vez de no app)
create or replace function public.seed_default_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.categories (user_id, nome, tipo, cor, icone) values
    (new.id, 'Salário', 'receita', '#22c55e', null),
    (new.id, 'Freelance', 'receita', '#16a34a', null),
    (new.id, 'Investimentos', 'receita', '#0ea5e9', null),
    (new.id, 'Outras receitas', 'receita', '#64748b', null),
    (new.id, 'Alimentação', 'despesa', '#f97316', null),
    (new.id, 'Transporte', 'despesa', '#eab308', null),
    (new.id, 'Moradia', 'despesa', '#a855f7', null),
    (new.id, 'Saúde', 'despesa', '#ef4444', null),
    (new.id, 'Educação', 'despesa', '#3b82f6', null),
    (new.id, 'Lazer', 'despesa', '#ec4899', null),
    (new.id, 'Compras', 'despesa', '#f43f5e', null),
    (new.id, 'Outras despesas', 'despesa', '#64748b', null);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.seed_default_categories();

-- Compra parcelada no cartão: cria N transações mensais atomicamente
-- (equivalente ao antigo createInstallmentPurchase do main process)
create or replace function public.create_installment_purchase(
  p_account_id integer,
  p_category_id integer,
  p_cartao_id integer,
  p_valor_total numeric,
  p_parcelas integer,
  p_data date,
  p_descricao text,
  p_status text
)
returns setof transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valor_parcela numeric;
  v_ajuste numeric;
  v_grupo_id integer;
  v_valor_atual numeric;
  v_new_id integer;
  i integer;
begin
  v_valor_parcela := round(p_valor_total / p_parcelas, 2);
  v_ajuste := round(p_valor_total - (v_valor_parcela * p_parcelas), 2);

  for i in 0..p_parcelas - 1 loop
    v_valor_atual := case when i = p_parcelas - 1 then v_valor_parcela + v_ajuste else v_valor_parcela end;

    insert into transactions
      (user_id, account_id, category_id, tipo, valor, data, descricao, status, cartao_id, recorrencia_id)
    values (
      auth.uid(),
      p_account_id,
      p_category_id,
      'despesa',
      v_valor_atual,
      (p_data + (i || ' months')::interval)::date,
      case when p_parcelas > 1 then p_descricao || ' (' || (i + 1) || '/' || p_parcelas || ')' else p_descricao end,
      case when i = 0 then p_status else 'pendente' end,
      p_cartao_id,
      v_grupo_id
    )
    returning id into v_new_id;

    if i = 0 then
      v_grupo_id := v_new_id;
      update transactions set recorrencia_id = v_grupo_id where id = v_new_id;
    end if;
  end loop;

  return query select * from transactions where recorrencia_id = v_grupo_id order by data;
end;
$$;

grant execute on function public.create_installment_purchase to authenticated;
