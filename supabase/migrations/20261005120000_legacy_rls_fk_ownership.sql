-- Correção de segurança do esquema antigo (ANALISE_E_PLANO.md, seção 3.3; decisão 14).
--
-- Problema 1: as políticas "own rows" só conferem user_id na gravação. A checagem
-- de chave estrangeira não passa pela RLS, então um usuário consegue gravar linhas
-- que apontam para conta, categoria ou cartão de outro usuário.
-- Problema 2: create_installment_purchase é SECURITY DEFINER e não confere a dona
-- da conta, da categoria e do cartão recebidos.
--
-- O que esta migração faz:
--   - troca só o WITH CHECK das políticas das 4 tabelas que têm referências
--     (o USING, que controla a leitura, não muda);
--   - passa create_installment_purchase a SECURITY INVOKER, de modo que as
--     políticas acima valem também dentro dela; o cálculo das parcelas não muda;
--   - tira o EXECUTE da função de anon e de PUBLIC.
--
-- O que ela não faz: não apaga nem altera nenhuma linha. Linhas antigas com
-- referência cruzada (Apêndice 1, consulta 6) continuam como estão; só não podem
-- ser criadas novas nem alteradas para esse estado.

-- transactions: conta e categoria obrigatórias, cartão opcional
alter policy "own rows" on public.transactions
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.accounts a
       where a.id = transactions.account_id
         and a.user_id = auth.uid()
    )
    and exists (
      select 1 from public.categories c
       where c.id = transactions.category_id
         and c.user_id = auth.uid()
    )
    and (
      transactions.cartao_id is null
      or exists (
        select 1 from public.credit_cards k
         where k.id = transactions.cartao_id
           and k.user_id = auth.uid()
      )
    )
  );

-- credit_cards: conta de pagamento opcional
alter policy "own rows" on public.credit_cards
  with check (
    auth.uid() = user_id
    and (
      credit_cards.conta_pagamento_id is null
      or exists (
        select 1 from public.accounts a
         where a.id = credit_cards.conta_pagamento_id
           and a.user_id = auth.uid()
      )
    )
  );

-- bills: conta opcional
alter policy "own rows" on public.bills
  with check (
    auth.uid() = user_id
    and (
      bills.conta_id is null
      or exists (
        select 1 from public.accounts a
         where a.id = bills.conta_id
           and a.user_id = auth.uid()
      )
    )
  );

-- budgets: categoria obrigatória
alter policy "own rows" on public.budgets
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.categories c
       where c.id = budgets.categoria_id
         and c.user_id = auth.uid()
    )
  );

-- Compra parcelada: mesmo cálculo de antes, agora com as permissões de quem chama.
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
returns setof public.transactions
language plpgsql
security invoker
set search_path = ''
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

    insert into public.transactions
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
      update public.transactions set recorrencia_id = v_grupo_id where id = v_new_id;
    end if;
  end loop;

  return query select * from public.transactions where recorrencia_id = v_grupo_id order by data;
end;
$$;

revoke execute on function public.create_installment_purchase(integer, integer, integer, numeric, integer, date, text, text)
  from public, anon;
grant execute on function public.create_installment_purchase(integer, integer, integer, numeric, integer, date, text, text)
  to authenticated;
