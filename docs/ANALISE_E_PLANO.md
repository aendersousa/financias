# Análise do app atual e plano de evolução para o Documento Mestre v2.0

| Campo | Valor |
|---|---|
| Data | 05/10/2026 |
| Status | Aprovado em 05/10/2026, com as decisões da seção 10 |
| Base | `docs/DOCUMENTO_MESTRE.md` (v2.0) e `docs/ALT-001-ARQUITETURA-SUPABASE.md` |
| Código analisado | branch `master`, commit `c2450f5` |

## 0. Resumo

1. O app atual é um controle financeiro simples: lançamentos de receita e despesa com status "pago/pendente", contas com saldo inicial digitado, cartões sem fatura como entidade, contas a pagar sem ligação com os lançamentos, orçamentos e metas. Quase todo cálculo é feito no navegador. Dá para aproveitar autenticação, a casca do app (React, Tailwind, tema, PWA, Android) e a navegação. O motor financeiro e o modelo de dados precisam ser feitos do zero.
2. O esquema atual tem 7 tabelas em `public` (`accounts`, `categories`, `credit_cards`, `transactions`, `bills`, `budgets`, `goals`), RLS por `user_id`, uma função `create_installment_purchase` e um gatilho que cria categorias no cadastro. Não existe pasta `supabase/migrations`: o esquema foi aplicado à mão pelo SQL Editor a partir de `supabase/schema.sql`. Não consegui ler o banco de produção daqui; o que está neste documento sobre o esquema vem desse arquivo e precisa ser conferido (Apêndice 1).
3. Três nomes do modelo novo (`categories`, `credit_cards`, `budgets`) já existem em `public` com outro formato. Como nada pode ser apagado, proponho criar o modelo novo num esquema próprio (`core`), não exposto pela API, com as funções de escrita e as visões de leitura no esquema `api`. As tabelas antigas ficam intactas em `public`.
4. A migração dos dados é possível sem perda e com conferência exata do saldo de cada conta. Ela tem duas partes ambíguas, porque o app atual não registra pagamento de fatura: as compras de cartão marcadas como "pendente" e as contas a pagar marcadas como "pagas". Proponho regras explícitas para essas duas partes, com relatório do que fica só no histórico antigo (seção 5).
5. Proponho que a troca do app dos usuários (migração dos dados e versão nova) aconteça ao fim da Fase 2, e não ao fim da Fase 1, para que as contas a pagar não sumam entre uma fase e outra. O desenvolvimento segue a ordem do documento: Fase 1 primeiro, motor antes das telas.
6. Este ambiente não tem Docker, Supabase CLI nem `pg_dump`. Sem eles não dá para cumprir a regra "testar com `supabase start` antes de produção". É o primeiro bloqueio a resolver (decisão 1).
7. Encontrei sete pontos em que o documento está ambíguo, desatualizado ou não cabe no app. Não mudei nenhuma regra: estão na seção 8 como propostas de alteração (ALT-002 a ALT-008).
8. Encontrei dois problemas de segurança no esquema atual (seção 3.3). Nenhum deles expõe dados de outro usuário para leitura, mas permitem gravar referências cruzadas.

As decisões que preciso de você estão na seção 9.

---

## 1. Como a análise foi feita e seus limites

- Li todo o código de `src/` (processo principal do Electron, preload, store Zustand, `computations.ts`, todas as páginas), `supabase/schema.sql`, `package.json`, configurações do Vite, PWA, Capacitor e o workflow do iOS.
- Li do Documento Mestre: Parte I (seções 1 a 5), Parte II (seções 6 a 21), seções 32 e 33, Apêndices A e B, e também as seções 36 a 40 e o Apêndice C, porque definem fases, testes e decisões. Li o ALT-001 inteiro.
- Conferi automaticamente os 192 pares "data (dia da semana)" do documento: todos estão corretos.
- **Não li o banco de produção.** Não há credencial de banco neste ambiente (só a chave pública do app, que não dá acesso ao catálogo). Como o esquema foi aplicado à mão, a produção pode ter diferenças em relação a `schema.sql`. O Apêndice 1 traz consultas só de leitura para você rodar no SQL Editor; o resultado delas confirma ou corrige as seções 3 e 4 e dimensiona a migração.

---

## 2. O que o app já faz e como se relaciona com o Documento Mestre

### 2.1 Arquitetura atual

| Item | Hoje |
|---|---|
| Interface | React 19 + TypeScript + Tailwind 4 + Recharts + Zustand, um único código em `src/renderer` |
| Plataformas | PWA no GitHub Pages (`registerType: 'autoUpdate'`); APK Android via Capacitor (build debug); app de Windows via Electron com atualização automática (`electron-updater`); workflow manual que gera um IPA de iOS não assinado |
| Dados | `supabase-js` direto do navegador, `select('*')` de todas as tabelas no login e a cada gravação |
| Cálculos | No cliente (`computations.ts`): saldo das contas, fatura atual, orçamento realizado, resumo mensal |
| Escrita | `insert`/`update`/`delete` direto nas tabelas; só a compra parcelada usa uma função no banco |
| Autenticação | Supabase Auth com e-mail e senha e Google (redirecionamento por plataforma em `oauth.ts`) |

### 2.2 Funcionalidades atuais × Documento Mestre

| Área | O app hoje | No documento | Fase | Aproveitamento |
|---|---|---|---|---|
| Acesso | Login, cadastro, Google, troca de senha | T-01, T-44; 35.1 | 1 | Quase integral |
| Espaço financeiro | Não existe: tudo por `user_id` | D-005; 29; 32.2 | 1 | Novo |
| Contas | 4 tipos (corrente, poupança, carteira, investimento), saldo inicial digitado, cor | 7.1, 7.2 (liquidez), 6.4.3 (saldo inicial por abertura) | 1 | Refazer |
| Categorias | Lista plana de receita ou despesa, com cor | 7.3 (árvore, essencial, fixa/variável, classe de renda, papéis de sistema, conta contábil por folha) | 1 | Refazer |
| Lançamentos | Receita ou despesa, uma conta, status pago/pendente, exclusão física | 8 (partidas dobradas, `posted`/`cancelled`, edição auditada) | 1 | Refazer |
| Transferência | Não existe | 6.5.5 | 1 | Novo |
| Cartões | Cadastro com limite e dias; "fatura atual" calculada no cliente somando despesas do ciclo | 9 inteiro (fatura como registro, limite com histórico, pagamento, rotativo etc.) | 1 | Refazer |
| Compra parcelada | Função que cria N lançamentos mensais; o centavo que sobra vai para a última parcela | 9.3: uma transação com uma partida por parcela, cada uma na sua fatura; `dividir()` com resíduo na 1ª | 1 | Refazer |
| Contas a pagar e a receber | Tabela `bills`, status marcado à mão, sem ligação com lançamentos | 10 (Agenda, vínculo pela partida, situação calculada) | 2 | Refazer |
| Orçamento | Por categoria e mês; realizado soma lançamentos do mês, inclusive cada parcela no seu mês | 13 (parcelado conta pelo total no mês da compra, D-012) | 4 | Refazer |
| Metas | Valor atual digitado e somado à mão | 14 (reserva virtual, aportes, consumo pelas partidas) | 4 | Refazer |
| Tela inicial | Saldo total (soma todas as contas), receitas × despesas em 6 meses, gastos por categoria, próximas contas, uso dos cartões, últimos lançamentos | 23; T-03 | 1, 2, 4 | Adaptar |
| Tema claro e escuro | Sim | 28.2 | 1 | Aproveitar |
| PWA | Sim, online, sem nada offline | 27 (online-first; fila offline na Fase 3) | 1 e 3 | Aproveitar |
| Pessoas, tags, busca, exportação CSV, auditoria, ajuste de saldo, moeda estrangeira, empréstimo genérico, autorizações de cartão | Não existem | 4.3 a 4.17 | 1 | Novos |

Correspondência das telas atuais com as do documento (22):

| Tela atual | Telas do documento |
|---|---|
| `Login.tsx` | T-01 Acesso |
| — | T-02 Primeiro uso (nova) |
| `Dashboard.tsx` | T-03 Início |
| `Transactions.tsx` | T-04 a T-08 (extrato, detalhe, novo, rápido, favoritos) |
| `Accounts.tsx` | T-09 a T-11 |
| `CreditCards.tsx` | T-12 a T-15 |
| `Bills.tsx` | T-16 a T-19 (Fase 2) |
| `Categories.tsx` | T-38 |
| `Budget.tsx` | T-25 (Fase 4) |
| `Goals.tsx` | T-26, T-27 (Fase 4) |
| `Settings.tsx` | T-36, T-42 (tema), T-44 (senha) |
| — | Novas na Fase 1: T-20, T-21 (pessoas), T-34 (busca), T-37 (espaço), T-39 (tags), T-43 (exportação), T-45 (histórico e auditoria) |

### 2.3 Regras do documento que o app atual não cumpre

Esta lista mostra por que o motor não pode ser adaptado aos poucos e precisa ser reescrito:

1. **Dinheiro em ponto flutuante.** O banco usa `numeric` (exato), mas o app converte com `Number(valor)`, soma em `number` e formata com `toLocaleString`. Viola 6.1.2 e 8.8.
2. **Exclusão física.** Lançamentos, contas, cartões, contas a pagar e metas são apagados com `delete`. Apagar uma conta apaga em cascata todos os lançamentos dela. Viola 2.7.
3. **Saldo digitado.** `accounts.saldo_inicial` é um número digitado. Viola 6.4.3 e 5.4.
4. **Pagar fatura não existe.** Uma compra no cartão marcada "pago" reduz o saldo da conta na data da compra. A 2ª parcela em diante nasce "pendente" e não há tela para mudar o status de um lançamento. Viola 9.9 e INV-CARD-001.
5. **Fatura não é registro.** É uma soma por intervalo de datas feita no cliente; parcelas são lançamentos soltos ligados por `recorrencia_id`. Viola D-006 e INV-CARD-004.
6. **Divisão de centavos.** `round(total/n, 2)` com a sobra na última parcela. Viola 8.8.4 (`dividir()`, resíduo na 1ª por padrão).
7. **Estado intermediário no registro de fatos.** "Pendente" convive com "pago" na mesma tabela. Viola D-003; o que é previsto deve ficar na Agenda.
8. **Cálculo no cliente.** Viola 2.3.2 e 2.4.3.
9. **Sem auditoria.** Viola 2.8 e 20.10.
10. **"Hoje" em UTC.** `todayIso()` usa `toISOString()`: depois das 21h em Brasília, o formulário sugere a data de amanhã. Viola 8.4.
11. **Sem dias úteis.** Não existe vencimento efetivo. Viola 8.9.
12. **Situação digitada.** A conta a pagar é marcada "paga" à mão. Viola D-008.
13. **Saldo total soma poupança e investimento.** Viola D-021 e D-022 (Saldo em contas só soma contas caixa).
14. **Orçamento por parcela.** Viola D-012 e INV-BUDGET-002.

---

## 3. Esquema atual do Supabase

Segundo `supabase/schema.sql` (a conferir com o Apêndice 1).

### 3.1 Tabelas

| Tabela | Colunas principais | Chaves e restrições |
|---|---|---|
| `accounts` | `id int identity`, `user_id uuid`, `nome`, `tipo` (`corrente`, `poupanca`, `carteira`, `investimento`), `saldo_inicial numeric`, `cor` | FK `auth.users` com cascade |
| `categories` | `id`, `user_id`, `nome`, `tipo` (`receita`, `despesa`), `cor`, `icone` | |
| `credit_cards` | `id`, `user_id`, `nome`, `limite numeric`, `dia_fechamento`, `dia_vencimento`, `conta_pagamento_id` | FK `accounts` com set null |
| `transactions` | `id`, `user_id`, `account_id` (obrigatório), `category_id`, `tipo`, `valor numeric`, `data date`, `descricao`, `status` (`pago`, `pendente`), `cartao_id`, `recorrencia_id int` | FK `accounts` com cascade, `categories` restrict, `credit_cards` set null; `recorrencia_id` sem FK |
| `bills` | `id`, `user_id`, `descricao`, `valor`, `vencimento`, `tipo` (`pagar`, `receber`), `status` (`pendente`, `pago`), `recorrencia text` livre, `conta_id` | |
| `budgets` | `id`, `user_id`, `categoria_id`, `mes_ano text` ('AAAA-MM'), `valor_planejado` | único (`user_id`, `categoria_id`, `mes_ano`) |
| `goals` | `id`, `user_id`, `nome`, `valor_alvo`, `valor_atual`, `prazo` | |

### 3.2 RLS, funções e gatilhos

- RLS ligada nas 7 tabelas, com uma política `own rows` para todos os comandos: `auth.uid() = user_id` no `using` e no `with check`.
- `public.seed_default_categories()` (`SECURITY DEFINER`), disparada `after insert on auth.users`: cria 12 categorias padrão.
- `public.create_installment_purchase(...)` (`SECURITY DEFINER`, `search_path = public`): cria as N parcelas.

### 3.3 Achados de segurança

1. **A política de RLS não confere a dona das referências.** O `with check` só confere `user_id`. A checagem de chave estrangeira não passa pela RLS, então um usuário consegue gravar um lançamento com `account_id`, `category_id` ou `cartao_id` de outro usuário (os ids são sequenciais). Ele não consegue ler os dados do outro. O efeito prático: se o dono apagar a conta, o cascade apaga também o lançamento do outro usuário.
2. **`create_installment_purchase` não confere que conta, categoria e cartão são do usuário.** Mesmo problema, dentro de uma função `SECURITY DEFINER`.

Proponho corrigir os dois numa migração pequena logo depois da migração de base (decisão 14). A correção não apaga nada: troca as políticas e a função.

---

## 4. Diferenças entre o modelo atual e o do documento (seção 32)

### 4.1 Organização proposta no Supabase

| Esquema | Conteúdo | Exposto pela API |
|---|---|---|
| `public` | Tabelas antigas, intactas. Depois da troca, só leitura | Sim (como hoje) |
| `core` | Todas as tabelas da seção 32, com RLS de leitura por espaço | Não |
| `api` | Funções de escrita (`SECURITY DEFINER`, `search_path = ''`) e visões de leitura com `security_invoker` | Sim (incluir em "Exposed schemas" e no `config.toml`) |
| `private` | Funções auxiliares: `is_member`, `has_role`, `today(space)`, `dividir`, dias úteis | Não |
| `migration` | Mapa legado → novo, retrato "antes", relatório da conferência | Não |

Por quê: (a) três nomes da seção 32 já existem em `public` com outro formato; (b) com as tabelas fora do esquema exposto, o cliente não tem nem como tentar gravar no Ledger, o que reforça a regra 3.1 do ALT-001 além do `REVOKE`; (c) as tabelas antigas continuam funcionando para os apps já instalados até a troca. Essa organização é uma escolha de implementação, mas a registro como ALT-007 para manter a rastreabilidade.

### 4.2 Tabela por tabela

| Atual (`public`) | Novo (`core`) | Diferença principal |
|---|---|---|
| `auth.users` | `auth.users` + `profiles` + `user_settings` | Mapeamento do ALT-001 |
| (implícito: `user_id`) | `financial_spaces`, `financial_space_members`, `space_settings` | Um espaço pessoal por usuário, com o usuário como `owner` |
| `accounts` | `ledger_accounts` (asset, com liquidez) + `financial_accounts` | Saldo inicial vira transação `opening`; tipo vira `kind` + liquidez |
| `categories` | `ledger_accounts` (income/expense) + `categories` | Árvore, marcas, classe de renda, papéis de sistema, conta contábil por folha |
| `credit_cards` | `ledger_accounts` (liability) + `credit_cards` + `credit_card_limits` + `card_statements` | Limite com histórico; faturas como registro; configuração do cartão |
| `transactions` | `ledger_transactions` + `ledger_entries` (+ `commitments` para os pendentes) | Partidas dobradas; "pendente" sai do Ledger |
| `bills` | `commitments` (`one_off`) | Situação calculada pelas partidas vinculadas |
| `budgets` | `budgets` (`consumption`) + `budget_month_overrides` | Vigência em vez de um registro por mês; marca essencial |
| `goals` | `reserves` (`goal`, virtual) + `reserve_contributions` | Saldo calculado: aportes − liberações − consumos |
| `create_installment_purchase` | `api.post_card_purchase` (entre outras) | Uma transação; `dividir()`; fatura por parcela |
| gatilho `seed_default_categories` | gatilho novo de criação do espaço | Cria espaço, membro, configurações, 3 contas de sistema e categorias padrão com os 5 papéis de sistema. O gatilho antigo continua existindo |

Coluna por coluna, nas tabelas que serão migradas:

**`accounts` → `financial_accounts` + `ledger_accounts`**

| Atual | Novo |
|---|---|
| `id int` | `id uuid` novo; o vínculo fica em `migration.legacy_map` |
| `user_id` | `financial_space_id` do espaço pessoal do usuário |
| `nome`, `cor` | `name`, `color`; `ledger_accounts.name` recebe cópia |
| `tipo = corrente` | `kind = checking`, liquidez `cash` |
| `tipo = carteira` | `kind = wallet`, liquidez `cash` |
| `tipo = poupanca` | `kind = savings`, liquidez `investment` pelo D-022, o que tira a poupança do Saldo em contas (decisão 7) |
| `tipo = investimento` | `kind = investment`, liquidez `investment` |
| `saldo_inicial` | Transação `opening` contra Abertura (seção 5) |
| — | `institution_name`, `icon`, `is_emergency_reserve`, campos de importação e de conferência: vazios ou padrão |

**`categories` → `categories` + `ledger_accounts`**

| Atual | Novo |
|---|---|
| `nome`, `cor`, `icone` | `name`, `color`, `icon`; todas viram folhas no 1º nível, cada uma com conta contábil |
| `tipo = receita` | `kind = income`; `income_class` obrigatória: Salário → `recurring`; Investimentos → `financial`; demais → `extraordinary` (decisão 9) |
| `tipo = despesa` | `kind = expense`; `fixity = variable`, `is_essential = false`, `is_tax_deductible = false` (padrões; o usuário ajusta) |
| — | As 5 categorias de sistema (7.3.7) são criadas em todo espaço. Nomes repetidos no mesmo nível recebem sufixo " (2)" por causa da unicidade de 33.6 |

**`credit_cards` → `credit_cards` + `credit_card_limits` + `card_statements`**

| Atual | Novo |
|---|---|
| `nome` | `name` |
| `limite` | Uma linha em `credit_card_limits` com `valid_from` = data de corte |
| `dia_fechamento`, `dia_vencimento` | `closing_day`, `due_day` |
| `conta_pagamento_id` | `default_payment_financial_account_id` |
| (comportamento do cálculo atual: compra no dia do fechamento fica na fatura que fecha) | `closing_day_purchase_goes_next` (decisão 8) |
| — | `started_on` = data de corte; demais campos com os padrões de 9.1.2 |

**`transactions`, `bills`, `budgets`, `goals`**: as regras estão na seção 5, porque dependem do significado de cada registro, e não só da coluna.

### 4.3 Tabelas novas, sem equivalente atual

Núcleo, que nasce na Fase 1 (32.1.7): `profiles`, `financial_spaces`, `financial_space_members`, `user_settings`, `space_settings`, `ledger_accounts`, `tags`, `ledger_transaction_tags`, `people`, `loans`, `credit_card_holders`, `card_authorizations`, `draft_transactions`, `recurrence_rules`, `recurrence_rule_versions`, `reserves`, `period_closings`, `audit_logs`, `holidays`. Depois: `notifications` (Fase 2), `import_batches`, `import_candidates`, `attachments` (Fase 3), `budget_month_overrides`, `reserve_contributions`, `period_snapshots` (Fase 4), `loan_installments`, `asset_valuations` (Fase 5), `automation_rules` (Fase 6).

### 4.4 Adaptações da seção 32 ao Supabase (cobertas pelo ALT-001)

| Na seção 32 | No Supabase |
|---|---|
| `users`, `created_by REFERENCES users` | `auth.users`; `created_by` e similares referenciam `auth.users(id)` com `ON DELETE SET NULL` |
| Tabelas de infraestrutura do Laravel (`sessions`, `jobs` etc.) | Não existem |
| `notifications` no formato do Laravel (Fase 2) | Tabela própria com as mesmas colunas de negócio |
| `id uuid PRIMARY KEY` | `DEFAULT gen_random_uuid()` |
| `updated_at` | Gatilho genérico de atualização |
| `holidays` com `NULLS NOT DISTINCT` | Exige PostgreSQL 15 ou superior; a versão da produção sai do Apêndice 1 |
| Relógio injetável (36.1.2) | `private.today(space)` usa o fuso do espaço e aceita uma data fixa só em sessão de teste (`session_user = 'postgres'`) |
| `DB::transaction(..., attempts: 3)` (33.9.3) | Repetição no cliente para erro de impasse (`40P01`) e de serialização (`40001`) |
| Tradução de erros (33.9.4) | As funções levantam `check_violation` com o nome da restrição; o TypeScript traduz para mensagem de domínio |

---

## 5. Plano de migração dos dados dos usuários atuais

### 5.1 Princípios

1. Nada é apagado. As tabelas antigas ficam em `public` para sempre; depois da troca, só leitura.
2. Todo registro antigo aparece em `migration.legacy_map` com o destino ou com o motivo explícito de não ter sido migrado. A contagem tem de fechar.
3. A migração roda numa única transação do banco. Se qualquer conferência falhar, ela aborta e nada muda.
4. Nenhum valor é arredondado em silêncio. Se o diagnóstico encontrar fração de centavo, paro e trago a lista.
5. Não copio dados reais para fora da produção. O ensaio é feito na própria produção, numa transação que sempre termina em `ROLLBACK` (5.5). Os testes da migração usam dados fictícios que reproduzem cada caso estranho.

### 5.2 Antes de tudo

1. Rodar o diagnóstico do Apêndice 1 (só leitura) para confirmar o esquema real, a versão do PostgreSQL, o volume e os casos estranhos: valores com fração de centavo, valores zero ou negativos, lançamentos pagos com data futura, referências cruzadas entre usuários, nomes de categoria repetidos, valores usados em `bills.recorrencia`.
2. Backup completo (`pg_dump` de esquema e dados) antes de qualquer migração em produção, guardado fora do Supabase e fora deste repositório, que é público (decisão 12).
3. Teste de restauração desse backup (critério da Fase 1, 38.2), num Supabase local temporário, apagado ao fim (decisão 17).

### 5.3 Regras de conversão

**Valores.** `numeric` → centavos com `valor * 100`, só quando o resultado é inteiro. Lançamentos de valor zero não entram no Ledger (`amount_nonzero`), não mudam saldo e são listados. Valores negativos são migrados preservando o efeito no saldo.

**Espaço.** Cada usuário de `auth.users` ganha um espaço pessoal (fuso `America/Sao_Paulo`, BRL), com membro `owner`, `space_settings`, as 3 contas de sistema e as categorias de sistema. Usuários sem nenhum dado também ganham, para entrar no app novo prontos para uso.

**Data de corte (D).** A data local do dia da migração.

**Saldo de referência de cada conta.** É o número que o app mostra hoje, calculado exatamente como `computeAccountsWithBalance`:

```
saldo_legado(conta) = saldo_inicial
                    + Σ valor dos lançamentos 'pago' de receita
                    − Σ valor dos lançamentos 'pago' de despesa
  considerando só lançamentos do mesmo usuário (t.user_id = a.user_id),
  com ou sem cartão, com qualquer data
```

**Lançamentos pagos.** Há duas opções (decisão 5):

| | Opção A: só abertura | Opção B: histórico + abertura (recomendada) |
|---|---|---|
| Abertura de cada conta | Em D, pelo `saldo_legado` menos os pagos com data futura | Na data do primeiro lançamento da conta, se for anterior a D; senão, em D. Pelo `saldo_inicial` |
| Lançamentos pagos | Não entram no Ledger | Cada um vira uma transação `income` ou `expense` na conta antiga e na categoria correspondente, na data dele. Compra de cartão marcada "paga" entra como despesa na conta (era o que ela fazia no app antigo), com a observação "compra no cartão <nome>, marcada como paga no app antigo" |
| Pagos com data futura | Viram lançamentos agendados (data futura), nas duas opções | |
| Gráficos e relatórios | Começam vazios em D; o histórico antigo fica numa tela só de leitura | Mostram o passado. Diferenças esperadas: transferências que o usuário lançou como receita e despesa aparecem como receita e despesa, e compras de cartão aparecem como despesa da conta |
| Correção depois | — | Como nenhum mês estará fechado até a Fase 4, o usuário pode recategorizar o histórico migrado livremente |

Nas duas opções, a soma das partidas de cada conta (sem filtro de data) é igual ao `saldo_legado`. É a conferência principal.

**Compras de cartão pendentes.** No app antigo elas nunca reduziram a conta, e a 2ª parcela em diante fica "pendente" para sempre, mesmo depois de paga no banco. Proponho (decisão 6):

1. Distribuir cada compra pendente nas faturas do modelo novo, pela data dela e pelo ciclo do cartão. Parcelas são identificadas pelo grupo `recorrencia_id`, com k pela ordem da data e N pelo tamanho do grupo.
2. Faturas cujo vencimento efetivo é igual ou posterior a D: o que cair nelas é dívida em aberto e entra como abertura do cartão em uso (9.16), em transações `opening` com data D: uma por fatura fechada não paga, uma para a fatura aberta e uma por parcelamento em andamento com as parcelas restantes nas faturas futuras. Não gera consumo.
3. Faturas com vencimento anterior a D: o app não sabe se foram pagas. Proponho tratá-las como pagas fora do app: elas não entram no Ledger (no app antigo, também não afetavam o saldo), ficam no histórico antigo e são listadas no relatório da migração com a quantidade e o valor por cartão.
4. Na primeira entrada no app novo, cada cartão migrado aparece como "a conferir", com a soma lançada ao lado do limite utilizado informado pelo banco (9.16.3). Se a dívida real for outra, o usuário corrige editando a transação de abertura, como manda 6.4.3.

**Lançamentos pendentes sem cartão.** São previsões. Viram compromissos avulsos (`commitments.kind = one_off`): direção pela receita ou despesa, certeza `confirmed`, vencimento nominal = data, competência = mês da data, categoria e conta de pagamento do lançamento. Os de data passada aparecem como "Pendente · vencido" para o usuário decidir.

**Contas a pagar e a receber (`bills`).**
- Pendentes: compromissos avulsos, com o texto de `recorrencia` guardado em `notes` (o campo é texto livre, não dá para gerar a regra recorrente com segurança; o usuário cria a regra na Agenda).
- Pagas: não há lançamento que as pague, então o compromisso nasceria "pendente", o que estaria errado. Ficam só no histórico antigo e são listadas.

**Orçamentos e metas.** Migram na Fase 4, quando as telas novas existirem (seção 6.5). Até lá, ver a decisão 10.

**Referências cruzadas** (lançamento de um usuário apontando para conta, categoria ou cartão de outro): não migram para o espaço de ninguém; ficam listadas. No app antigo esses lançamentos já não apareciam no saldo da conta do dono do lançamento.

### 5.4 Conferência antes e depois

Dentro da transação da migração, depois de travar as tabelas antigas contra escrita:

1. **Retrato "antes"** em `migration.snapshot_legacy`: `saldo_legado` de cada conta; por cartão, a soma dos pendentes e a fatura atual como o app antigo calcula; contagem de registros por tabela e por usuário; por usuário, categoria e mês, a soma dos lançamentos pagos (só na opção B).
2. **Migração.**
3. **Retrato "depois"** e comparação, em centavos:

| Conferência | Critério | Se falhar |
|---|---|---|
| Saldo de cada conta | Σ partidas válidas da conta nova = `saldo_legado` | Aborta |
| Soma por usuário | Σ das contas novas = Σ `saldo_legado` | Aborta |
| Dívida de cada cartão | −Σ partidas da conta do cartão = Σ das compras pendentes classificadas "em aberto" pela regra de 5.3 | Aborta |
| Cobertura | Todo registro antigo está em `legacy_map`, com destino ou motivo | Aborta |
| Consumo histórico (opção B) | Por usuário, categoria e mês, a soma migrada = a soma antiga do mesmo recorte | Aborta |
| Invariantes | INV-LEDGER-001, 002, 004 e INV-CARD-002, 004 sobre tudo o que foi gravado | Aborta |
| Itens não migrados | Lista por motivo, com quantidade e valor | Só informa; vai para o relatório |

4. **Relatório** em `migration.conference_report`, guardado. Proponho também mostrar a cada usuário, uma vez, a conferência das suas contas ("saldo no app antigo × saldo agora").

Uma diferença é esperada e não é erro: o **Saldo em contas** da tela inicial nova pode ser menor que o "saldo total" antigo, porque deixa de somar poupança (D-022) e investimentos e não conta lançamentos com data futura. O saldo de cada conta, individualmente, bate.

### 5.5 Execução e troca

1. **Antes da troca, uma versão de transição dos apps atuais** (decisão 15): uma tabela `public.app_config` com a versão mínima aceita e um aviso "Atualize o app" quando a versão instalada for menor. O app de Windows e o PWA se atualizam sozinhos; o APK precisa ser reinstalado pelo usuário. Essa versão precisa estar nos aparelhos antes da troca.
2. **Ensaio na produção:** `migration.run(mode => 'dry_run')` faz tudo e termina em `ROLLBACK`, devolvendo o relatório. Rodo quantas vezes for preciso, revisamos juntos.
3. **Janela de troca**, avisada aos usuários com antecedência.
4. Backup e verificação do arquivo.
5. `migration.run(mode => 'apply')`, numa transação: `LOCK TABLE ... IN SHARE MODE` nas tabelas antigas (leitura liberada, escrita bloqueada), retrato antes, migração, retrato depois, conferência. Se tudo bater: `REVOKE INSERT, UPDATE, DELETE` das tabelas antigas para `anon` e `authenticated`, versão mínima atualizada, `COMMIT`.
6. Publicação das versões novas (PWA, APK assinado, app de Windows).
7. Conferência final com você e registro da aprovação.

**Volta atrás.** Até o passo 5, nada mudou. Depois dele, voltar significa devolver a escrita às tabelas antigas e baixar a versão mínima; o que os usuários lançarem no app novo nesse intervalo não volta para o antigo. Por isso a janela de troca deve ser curta e o ensaio, completo.

### 5.6 O que fica no app antigo e até quando

| Tabela antiga | Depois da troca |
|---|---|
| `accounts`, `categories`, `credit_cards`, `transactions`, `bills` | Só leitura, para sempre. Tela "Histórico do app antigo" só de leitura (na opção A, é o único acesso ao passado) |
| `budgets`, `goals` | Conforme a decisão 10 até a Fase 4; depois, só leitura |

---

## 6. Ordem de trabalho por fases

Sigo a seção 38 e a sequência da seção 39. Os passos 3 a 7 da seção 39 viram uma etapa de preparação antes da Fase 1. Convenções do trabalho: uma branch por bloco (`feat/...`, `test/...`, `chore/...`, `spec/ALT-NNN-...`), commits pequenos no padrão Conventional Commits em português, citando INV, CT, D e ALT (37.3, 37.4). Nada vai para produção sem teste local com `supabase start` e sem backup.

### 6.1 Preparação (passos 3 a 7 da seção 39)

| Passo | Entrega | Saída |
|---|---|---|
| P1 | Ferramentas locais: Docker Desktop, Supabase CLI, cliente PostgreSQL (`pg_dump`) | `supabase start` funcionando nesta máquina (decisão 1) |
| P2 | `supabase init`; migração de base com o esquema real da produção (a partir do dump só de esquema), marcada como já aplicada na produção com `supabase migration repair` | `supabase db reset` local reproduz a produção |
| P3 | Migração de correção de segurança do esquema antigo (3.3) | Testes pgTAP de isolamento das tabelas antigas (decisão 14) |
| P4 | Versão de transição dos apps com a versão mínima (5.5, item 1) | Versão publicada nas três plataformas (decisão 15) |
| P5 | Backup diário por GitHub Actions para armazenamento privado, criptografado; restauração testada | Primeiro backup restaurado num Supabase local (decisões 12 e 17) |
| P6 | Ferramentas de teste: pgTAP (`supabase test db`), Vitest, fast-check; integração contínua com `supabase start` + testes do banco + Vitest + `tsc` | Integração contínua aprovada com um teste trivial de cada tipo |
| P7 | Ambiente de homologação: um segundo projeto Supabase gratuito, só com dados fictícios | Projeto criado (decisão 3) |
| P8 | Alterações da especificação aprovadas (seção 8) | ALTs incorporadas ao documento |

### 6.2 Fase 1 — Fundação utilizável

Ordem interna: banco, depois testes, depois funções, depois telas. Cada bloco é uma branch com vários commits pequenos.

**Bloco 1.1 — Esquema núcleo** (migrações em `supabase/migrations`)

1. Esquemas `core`, `api`, `private`, `migration`; extensões `btree_gist`, `pg_trgm`, `pg_cron`.
2. Espaços e usuários: `profiles`, `financial_spaces`, `financial_space_members`, `user_settings`, `space_settings`; `private.is_member`, `private.has_role`, `private.today`.
3. Ledger: `ledger_accounts`, `ledger_transactions`, `ledger_entries`, `tags`, `ledger_transaction_tags`, `draft_transactions`.
4. Entidades: `financial_accounts`, `categories`, `people`, `loans`.
5. Cartões: `credit_cards`, `credit_card_holders`, `credit_card_limits`, `card_statements`, `card_authorizations`.
6. Tabelas do núcleo usadas pelas referências e gatilhos: `commitments`, `recurrence_rules`, `recurrence_rule_versions`, `reserves`, `period_closings`.
7. `audit_logs`, `holidays` (carga de 2026 a 2031, com Paixão e Carnaval calculados pela Páscoa).
8. CHECKs (33.5), índices únicos e de exclusão (33.6), gatilhos diferidos (33.3) e imediatos (33.4), trava de período (33.7).
9. Visões de 32.11: `posted_ledger_entries`, `card_statement_balances`, `commitment_settlements`, `cash_balance`.
10. RLS de leitura em todas as tabelas com `financial_space_id`; `REVOKE` de escrita para `anon` e `authenticated`; visões de leitura em `api` com `security_invoker`.

**Bloco 1.2 — Testes do banco (pgTAP), escritos antes das funções**

- Integridade (36.6): cada restrição com o teste que espera o erro pelo nome exato, mais os testes positivos (conciliar em fatura fechada, por exemplo).
- Isolamento: um usuário de outro espaço não lê nem grava nada.
- Invariantes da Fase 1: INV-LEDGER-001, 002, 003, 004, 005, 007, 008, 009; INV-CARD-001 a 007; INV-REPORT-004. Cada teste começa pelo ID (36.2.2).
- Os testes de soma zero e de liquidação chamam `SET CONSTRAINTS ALL IMMEDIATE` para disparar os gatilhos diferidos dentro da transação do teste (36.1.3).

**Bloco 1.3 — Funções de escrita (`api.*`)**, cada uma numa única transação, com validação, travas em ordem crescente, gravação, auditoria e verificação antecipada das restrições diferidas (8.7):

- Espaço: criação no cadastro (gatilho novo em `auth.users`), configurações.
- Entidades com a conta contábil junto (7.1.3): contas financeiras, categorias (inclusive transformar folha em pai, 7.3.9), tags, pessoas, empréstimo genérico; arquivamento.
- Ledger: `post_transaction`, `edit_transaction` (regravação das partidas com versão, 8.6), `cancel_transaction`; abertura; transferência; despesa e receita, inclusive divididas com pessoas; acerto com pessoa; ajuste de saldo e explicação do ajuste.
- Cartões: configuração, limite, mudança de fechamento e vencimento (9.5.6); compra à vista, parcelada e com juros; realocação de parcela; pagamento total, parcial e antecipado com imputação (9.9.2); rotativo; transporte de crédito; parcelamento da fatura; antecipação; estorno nos modelos (a) e (b) e parcial; correção; compra em moeda estrangeira e confirmação; autorizações manuais e retenção por boleto; cancelamento e arquivamento; abertura de cartão em uso.
- `private.dividir()` com os mesmos vetores do TypeScript.
- Idempotência por `client_uuid` (já no modelo, usada de fato na Fase 3).

**Bloco 1.4 — Casos do Apêndice B da Fase 1**, com os números exatos do apêndice, em centavos, e data fixa:

| Caso | Onde |
|---|---|
| CT-CARD-001 a CT-CARD-010 | pgTAP |
| CT-AGENDA-006 (partidas, saldo da pessoa e consumo) | pgTAP |
| CT-AGENDA-007 | Vitest (`dividir`, conversão de texto) e pgTAP (`dividir` no banco) |
| CT-ADJ-001 | pgTAP |
| CT-FX-001 | pgTAP |

Um script confere que todo INV e CT exigido na fase aparece no nome de pelo menos um teste (36.2.3).

**Bloco 1.5 — TypeScript puro (Vitest)**: conversão de texto em centavos sem ponto flutuante (8.8.2; depende da ALT-003), formatação pt-BR, `dividir()` com vetores compartilhados em `tests/fixtures/split-vectors.json`, datas `AAAA-MM-DD` sem UTC.

**Bloco 1.6 — Testes gerativos**: Vitest + fast-check chamando as funções `api.*` no Supabase local, com um modelo de referência em TypeScript (saldos, faturas) comparado com o banco depois de cada operação (36.4). Começa com operações de Ledger e de cartão.

**Bloco 1.7 — Tarefas agendadas (`pg_cron`)**: fechamento e abertura de faturas, rotativo no vencimento efetivo, autorizações, conferência diária de integridade, feriados (ALT-001, seção 4).

**Bloco 1.8 — Migração dos dados**: funções do esquema `migration` com os testes sobre dados fictícios de cada caso de 5.3 (pago e pendente no cartão, parcelas, data futura, valor zero, negativo, referência cruzada, nome repetido, fração de centavo que deve abortar). Só roda em produção na troca (5.5).

**Bloco 1.9 — Telas da Fase 1** (22.18): T-01 a T-15, T-20, T-21, T-34, T-36 a T-39, T-42 a T-45. Antes, os wireframes para sua aprovação (passo 7 da seção 39). As telas leem pelas visões de `api` e escrevem só por RPC; nenhuma soma valores por conta própria.

**Bloco 1.10 — Homologação da Fase 1** no projeto de homologação, com dados fictícios. Critérios de 38.1 e da Fase 1, inclusive e-mail transacional (A-05).

### 6.3 Fase 2 — Agenda e Livre

Compromissos, recorrências versionadas, vencimentos, calendário, lançamentos agendados, previsão de saldo, Livre v1 com reserva mínima, indicador de parcelas futuras, conciliação por saldo, feriados locais, notificações (Edge Functions chamadas pelo `pg_cron`). Antes de começar, a ALT-008 precisa estar decidida (onde roda o motor do Livre). Testes: INV-AGENDA, INV-REC, INV-LFG da fase e os CT da fase mínima 2.

Se a decisão 4 for a recomendada, **a troca do app dos usuários e a migração dos dados acontecem ao fim desta fase**.

### 6.4 Fase 3 — Importação

OFX e CSV, deduplicação, conciliação, autorizações vindas da importação, fila offline com `client_uuid`. Anexos no Supabase Storage com políticas por espaço.

### 6.5 Fase 4 — Planejamento

Orçamentos, metas e provisões, Livre completo, relatórios, fechamento mensal, Saúde Financeira. **Migração de `budgets` e `goals`**, com conferência própria: cada `goals.valor_atual` vira um aporte manual na data da migração (a conta de guarda é a primeira conta caixa do usuário, ajustável) e o saldo da reserva tem de ser igual ao `valor_atual`; cada orçamento mensal antigo vira uma vigência (meses seguidos com o mesmo valor viram uma só) e o orçado de cada mês tem de ser igual ao antigo. Depois, as duas tabelas antigas ficam só leitura.

### 6.6 Fase 5 — Patrimônio

Investimentos, empréstimos com cronograma, bens, patrimônio líquido e evolução. A versão 1.0.0 do app sai aqui (37.8).

### 6.7 Fase 6 — Ecossistema

Compartilhamento com convites e papéis (a RLS por espaço já existe desde a Fase 1), regras automáticas, documentos, busca avançada, contas em moeda estrangeira, Open Finance, assistente.

---

## 7. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | Apps antigos instalados continuam tentando gravar nas tabelas antigas depois da troca. O APK não se atualiza sozinho | Versão de transição com aviso de atualização (P4) bem antes da troca; tabelas antigas só leitura na troca, o que impede divergência; aviso aos usuários |
| R2 | Significado ambíguo dos dados antigos (cartão pago/pendente, transferências lançadas como receita e despesa, contas pagas sem lançamento) | Regras explícitas (5.3), relatório do que não migrou, cartão "a conferir" na primeira entrada, histórico editável até a Fase 4 |
| R3 | O esquema real da produção difere de `schema.sql` | Diagnóstico do Apêndice 1 e migração de base a partir do dump real |
| R4 | Sem Docker nem CLI nesta máquina | Decisão 1 |
| R5 | Valores com fração de centavo nos dados antigos | Diagnóstico; a migração aborta em vez de arredondar |
| R6 | O repositório é público: o documento e o plano ficam públicos quando enviados; backups não podem ficar aqui | Decisão 12. Por enquanto, os commits ficam só na máquina |
| R7 | A Fase 1 é grande (cartões completos, auditoria, busca, exportação) e longa | Blocos independentes com testes; o app atual segue funcionando até a troca |
| R8 | Plano gratuito: pausa por inatividade, 500 MB, limite de e-mails do Supabase Auth | Backup diário mantém o projeto ativo (ALT-001); acompanhar o tamanho; decidir o provedor de e-mail (A-05) |
| R9 | Obrigações de LGPD já valem (ALT-001, seção 6) e o app não tem política de privacidade, exclusão de conta nem registro de acesso | ALT-005 |
| R10 | Concorrência e impasses nas funções do banco chamadas por vários aparelhos | Travas em ordem crescente (33.9), repetição no cliente para `40P01` e `40001`, testes de concorrência |
| R11 | Diferença percebida no saldo da tela inicial depois da troca (poupança, investimentos e agendados saem do Saldo em contas) | Conferência por conta mostrada ao usuário; nota de versão |

---

## 8. Pontos da especificação que precisam de alteração registrada

Não mudei nenhuma regra. Proponho estas alterações; a numeração só vale se você aprovar.

**ALT-002 (editorial) — Repositório.** O ALT-001 substituiu D-020, mas D-025 continua dizendo "repositório novo depois do Documento Mestre", e a capa e a seção 37.1 também. D-032 rejeita expressamente o repositório novo. Proposta: marcar a parte de repositório de D-025 como substituída por D-032 e atualizar capa e 37.1.

**ALT-003 (normativa) — Conversão de texto em centavos com ponto.** A seção 8.8.2 manda remover separadores de milhar ("1.234,5" → 123450), e CT-AGENDA-007 diz que "19.90" vira 1990. Aplicando 8.8.2 ao pé da letra, o ponto de "19.90" seria separador de milhar e o resultado seria 199000. Proposta de regra: se o texto tem vírgula, a vírgula é decimal e todo ponto é milhar; sem vírgula e com um único ponto seguido de 1 ou 2 dígitos, o ponto é decimal ("19.90" → 1990; "19.9" → 1990); sem vírgula e com pontos seguidos de grupos de 3 dígitos, os pontos são milhar ("1.234" → 123400); só dígitos são reais inteiros ("1234" → 123400). Qualquer outro formato é recusado. Afeta 8.8.2, 36.7.1 e CT-AGENDA-007.

**ALT-004 — Plataformas.** D-032 e o ALT-001 citam PWA e APK. O app também tem versão de Windows (Electron, com atualização automática) e um workflow que gera IPA de iOS não assinado; a seção 2.2.6 diz que app nativo só entra na Fase 6. Proposta: registrar se essas duas saídas continuam (decisão 11).

**ALT-005 — LGPD e segurança já com usuários.** O ALT-001 (seção 6) diz que as obrigações da seção 35 para dados de terceiros valem desde já, mas a exclusão de conta com pseudonimização está na Fase 6 (4.15, 5.2), e o critério da Fase 6 pede 2FA "antes de qualquer acesso de terceiros", condição que já foi ultrapassada. Proposta: mover para a Fase 1 a política de privacidade, a exclusão de conta e o registro de acesso (login, logout e falhas, em `audit_logs`), e decidir a fase da 2FA.

**ALT-006 — Transição dos usuários atuais.** O documento foi escrito para um app novo, sem usuários. Proposta: registrar as regras de migração (data de corte, abertura, histórico, cartões, pendentes) como complemento da seção 7 do ALT-001, e o que acontece com as funcionalidades atuais que o documento só entrega em fases posteriores: Metas e Orçamentos (Fase 4) e, se a troca for antes da Fase 2, Contas a pagar (decisão 10). A seção 38.2.2 exige alteração registrada para mudar funcionalidade de fase.

**ALT-007 — Organização do banco.** Tabelas em `core` (não exposto), funções de escrita e visões de leitura em `api`, auxiliares em `private` (4.1). Motivo: colisão de nomes com as tabelas antigas e reforço da regra "o cliente nunca grava direto no Ledger". Não muda tabela nem coluna da seção 32, só onde elas ficam.

**ALT-008 (decidir antes da Fase 2) — Onde roda o motor do Livre.** O ALT-001 (regra 7) diz que o motor do Livre é um módulo TypeScript usado pela tela e pelas Edge Functions. As seções 2.3.2 e 2.4.3 dizem que todo cálculo financeiro acontece no servidor e que a interface não calcula valores. Opções: (a) o mesmo módulo roda numa Edge Function e a tela só exibe; (b) o cálculo é feito em SQL; (c) aceitar o cálculo no cliente com o mesmo módulo, alterando 2.3.2 e 2.4.3. Recomendo (a).

---

## 9. Decisões que preciso de você

### Para começar a preparação

1. **Ferramentas locais.** Posso instalar Docker Desktop (exige WSL2, permissão de administrador e provavelmente reiniciar o Windows), Supabase CLI e o cliente do PostgreSQL nesta máquina? Sem isso não há `supabase start`. *Recomendo: sim.*
2. **Acesso ao banco de produção.** Para o dump de esquema e os backups preciso da string de conexão com senha, numa variável de ambiente local, nunca gravada em arquivo do repositório. Alternativa: você roda o Apêndice 1 e o backup e me passa o resultado. *Recomendo: você roda o Apêndice 1 agora; para os backups, variável de ambiente.*
3. **Homologação.** Criar um segundo projeto Supabase gratuito, só com dados fictícios? *Recomendo: sim.*
4. **Quando trocar o app dos usuários.** (a) Ao fim da Fase 1, com Contas a pagar, Metas e Orçamentos em modo antigo; (b) ao fim da Fase 2, com a Agenda já cobrindo contas a pagar e pendentes; (c) ao fim da Fase 4, com tudo novo. *Recomendo: (b).*
5. **Histórico na migração.** Opção A (só abertura na data de corte) ou B (histórico dos lançamentos pagos + abertura no início), seção 5.3. *Recomendo: B.*
6. **Compras de cartão pendentes de faturas já vencidas.** Aprova tratá-las como pagas fora do app (ficam só no histórico antigo e no relatório), com o cartão "a conferir" na primeira entrada? *Recomendo: sim.*

### Para a migração

7. **Poupança.** Migrar como `investment` (D-022; sai do Saldo em contas) ou como `cash` (mantém o número que o usuário vê hoje)? *Recomendo: seguir o D-022 e avisar na nota de versão; o usuário pode reclassificar.*
8. **Compra no dia do fechamento.** O cálculo atual deixa a compra do dia do fechamento na fatura que fecha; o padrão do documento manda para a seguinte. *Recomendo: padrão do documento (`true`); o usuário pode mudar por cartão.*
9. **Classe de renda das categorias de receita migradas.** Salário → recorrente; Investimentos → financeira; demais → extraordinária. *Recomendo: assim, com aviso para revisar.*
10. **Funcionalidades atuais antes da sua fase.** Metas: manter a tela atual funcionando sobre a tabela antiga até a Fase 4 (não depende de lançamentos). Orçamentos: manter o orçado antigo e calcular o realizado a partir do Ledger, ou deixar a tela só leitura até a Fase 4. Contas a pagar: só se a troca for antes da Fase 2. *Recomendo: Metas como estão; Orçamentos com realizado lido do Ledger. As duas coisas entram na ALT-006.*

### Sobre a especificação e o projeto

11. **Windows e iOS.** Manter o app de Windows (mesmo código; a atualização automática ajuda na troca) e o workflow do IPA? *Recomendo: manter os dois e registrar na ALT-004.*
12. **Repositório público.** Onde ficam os backups (proponho um repositório privado só para eles) e se o Documento Mestre e este plano podem ficar públicos quando eu enviar a branch. Tornar este repositório privado exige plano pago do GitHub para manter o GitHub Pages. *Até você decidir, não envio nada (`git push`).*
13. **Alterações da seção 8.** Aprova ALT-002 a ALT-007 como propostas? A ALT-008 pode esperar o fim da Fase 1.
14. **Correção de segurança do esquema antigo (3.3).** Aplicar logo depois da migração de base? *Recomendo: sim.*
15. **Versão de transição com aviso de atualização** antes da troca? *Recomendo: sim.*
16. **Podem esperar:** nome do app (A-01; hoje "Finanças"), provedor de e-mail transacional (A-05; necessário para concluir a Fase 1) e biblioteca de componentes (A-03; antes dos wireframes).
17. **Teste de restauração do backup.** Num Supabase local temporário, apagado ao fim, ou num projeto temporário na nuvem? Restaurar dados reais no projeto de homologação vai contra 37.7.2. *Recomendo: local temporário.*

---

## 10. Decisões aprovadas (05/10/2026)

O plano foi aprovado. Onde a decisão difere da recomendação da seção 9, vale o que está aqui.

| # | Decisão |
|---|---|
| 1 | Instalar Docker Desktop, Supabase CLI e cliente PostgreSQL. Avisar antes de qualquer reinício |
| 2 | Sem senha de escrita da produção. O proprietário roda o Apêndice 1. O dump do esquema usa um usuário só de leitura (`supabase/admin/01_schema_reader.sql`). A senha completa existe só como segredo do GitHub Actions, para os backups. Migrações em produção: eu preparo, o proprietário revisa e aplica |
| 3 | Homologação num segundo projeto Supabase gratuito, só com dados fictícios |
| 4 | Troca do app dos usuários ao fim da Fase 2 (opção b) |
| 5 | Histórico: opção B |
| 6 | Compras de cartão pendentes de faturas já vencidas: pagas fora do app, no relatório, cartão "a conferir" |
| 7 | Poupança como `investment` (D-022), com aviso na nota de versão |
| 8 | Compra no dia do fechamento vai para a fatura seguinte (padrão do documento) |
| 9 | Classe de renda das categorias migradas como proposto |
| 10 | Metas: tela atual sobre a tabela antiga até a Fase 4. Orçamentos: orçado antigo com realizado lido do Ledger. Entra na ALT-006 |
| 11 | Windows (Electron): mantido. iOS: workflow do IPA aposentado; o iPhone usa a PWA. Entra na ALT-004 |
| 12 | Repositório continua público; documento e plano podem ser publicados. Backups num repositório privado separado, criptografados, com a chave fora do GitHub. Nenhum segredo é commitado |
| 13 | ALT-002 a ALT-007 aprovadas. Na ALT-005, a 2FA (TOTP do Supabase Auth) entra como opcional na Fase 2. ALT-008 decidida antes da Fase 2, com tendência à opção (a) |
| 14 | A correção de segurança do esquema antigo vem primeiro, logo depois do diagnóstico, como migração pequena e isolada, sem esperar o resto da preparação |
| 15 | Versão de transição com aviso de atualização: sim |
| 16 | A-01 e A-03 podem esperar; o provedor de e-mail transacional (A-05) precisa estar resolvido antes do fim da Fase 1 |
| 17 | Teste de restauração num Supabase local temporário |

Ordem resultante: diagnóstico (Apêndice 1) e usuário só de leitura → migração de base + correção de segurança (revisada e aplicada pelo proprietário) → P1 a P8.

---

## Apêndice 1 — Diagnóstico só de leitura

Para rodar no SQL Editor do Supabase. Nenhuma consulta altera dados nem mostra e-mails.

```sql
-- 1. Versão e extensões
select version();
select extname, extversion from pg_extension order by 1;

-- 2. Estrutura real das tabelas antigas
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
 order by table_name, ordinal_position;

select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies where schemaname = 'public' order by 1, 2;

select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' order by 1;

select event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation
  from information_schema.triggers
 where trigger_schema in ('public', 'auth') order by 2, 3;

-- 3. Volume
select (select count(*) from auth.users)                       as usuarios,
       (select count(distinct user_id) from public.transactions) as usuarios_com_lancamentos,
       (select count(*) from public.accounts)     as contas,
       (select count(*) from public.categories)   as categorias,
       (select count(*) from public.credit_cards) as cartoes,
       (select count(*) from public.transactions) as lancamentos,
       (select count(*) from public.bills)        as contas_a_pagar,
       (select count(*) from public.budgets)      as orcamentos,
       (select count(*) from public.goals)        as metas,
       pg_size_pretty(pg_database_size(current_database())) as tamanho_banco;

-- 4. Valores que não são centavos inteiros, zero ou negativos
select 'transactions' as tabela,
       count(*) filter (where valor * 100 <> trunc(valor * 100)) as fracao_de_centavo,
       count(*) filter (where valor = 0) as zero,
       count(*) filter (where valor < 0) as negativo
  from public.transactions
union all
select 'accounts.saldo_inicial', count(*) filter (where saldo_inicial * 100 <> trunc(saldo_inicial * 100)),
       count(*) filter (where saldo_inicial = 0), count(*) filter (where saldo_inicial < 0) from public.accounts
union all
select 'bills', count(*) filter (where valor * 100 <> trunc(valor * 100)),
       count(*) filter (where valor = 0), count(*) filter (where valor < 0) from public.bills
union all
select 'budgets', count(*) filter (where valor_planejado * 100 <> trunc(valor_planejado * 100)),
       count(*) filter (where valor_planejado = 0), count(*) filter (where valor_planejado < 0) from public.budgets
union all
select 'goals', count(*) filter (where valor_atual * 100 <> trunc(valor_atual * 100) or valor_alvo * 100 <> trunc(valor_alvo * 100)),
       count(*) filter (where valor_alvo = 0), count(*) filter (where valor_atual < 0 or valor_alvo < 0) from public.goals
union all
select 'credit_cards.limite', count(*) filter (where limite * 100 <> trunc(limite * 100)),
       count(*) filter (where limite = 0), count(*) filter (where limite < 0) from public.credit_cards;

-- 5. Lançamentos por status, com e sem cartão, e com data futura
select (cartao_id is not null) as no_cartao, status, tipo,
       count(*) as qtd, sum(valor) as total,
       count(*) filter (where data > (now() at time zone 'America/Sao_Paulo')::date) as com_data_futura
  from public.transactions group by 1, 2, 3 order by 1, 2, 3;

-- 6. Referências cruzadas entre usuários
select 'transactions.account_id' as ref, count(*) from public.transactions t
  join public.accounts a on a.id = t.account_id where a.user_id <> t.user_id
union all
select 'transactions.category_id', count(*) from public.transactions t
  join public.categories c on c.id = t.category_id where c.user_id <> t.user_id
union all
select 'transactions.cartao_id', count(*) from public.transactions t
  join public.credit_cards c on c.id = t.cartao_id where c.user_id <> t.user_id
union all
select 'credit_cards.conta_pagamento_id', count(*) from public.credit_cards c
  join public.accounts a on a.id = c.conta_pagamento_id where a.user_id <> c.user_id
union all
select 'bills.conta_id', count(*) from public.bills b
  join public.accounts a on a.id = b.conta_id where a.user_id <> b.user_id
union all
select 'budgets.categoria_id', count(*) from public.budgets b
  join public.categories c on c.id = b.categoria_id where c.user_id <> b.user_id;

-- 7. Nomes de categoria repetidos (sem diferenciar maiúsculas)
select user_id, tipo, lower(nome) as nome, count(*)
  from public.categories group by 1, 2, 3 having count(*) > 1;

-- 8. Valores usados em bills.recorrencia
select recorrencia, count(*) from public.bills group by 1 order by 2 desc;

-- 9. Parcelamentos: grupos e status
select count(distinct recorrencia_id) as grupos,
       count(*) filter (where recorrencia_id is not null) as parcelas,
       count(*) filter (where recorrencia_id is not null and status = 'pendente') as parcelas_pendentes
  from public.transactions;
```
