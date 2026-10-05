# ALT-001 — Arquitetura com Supabase (Documento Mestre v2.0)

**Decisão:** D-032 substitui D-020. **Data:** 05/10/2026.

O aplicativo passa a ser a **evolução do app de finanças existente** (PWA no GitHub Pages + APK Android + Supabase), e não um projeto Laravel novo. Partes I, II e III, o modelo de dados (32), as restrições do banco (33) e os Apêndices A, B e C continuam valendo. Este arquivo prevalece sobre a Parte IV sempre que ela citar Laravel, Inertia, PHP, Pest, serviços PHP ou o scheduler do Laravel.

---

## 1. Stack

| Camada | Tecnologia |
|---|---|
| Front-end | React + TypeScript (a base que o app já usa) |
| Hospedagem web | GitHub Pages, como PWA online-first |
| Android | O empacotamento que o app já usa para gerar o APK; versão `release` assinada para distribuição |
| Banco | Supabase PostgreSQL |
| Autenticação | Supabase Auth (e-mail e senha, Google) |
| Isolamento | Row Level Security por espaço financeiro |
| Escrita no Ledger | Funções no banco (RPC), única porta de escrita |
| Tarefas agendadas | `pg_cron` |
| E-mail e push | Edge Functions (TypeScript), chamadas pelo `pg_cron` quando necessário |
| Anexos (fase 6) | Supabase Storage, com políticas por espaço |
| Migrações | Supabase CLI (`supabase/migrations`, versionadas no Git) |
| Testes | pgTAP (banco), Vitest (TypeScript), fast-check (testes gerativos) |
| Backup | GitHub Actions diário com `pg_dump`, guardado fora do Supabase |

## 2. Correspondência com a Parte IV

| No documento (Parte IV) | No Supabase |
|---|---|
| `users` + kit de autenticação do Laravel | `auth.users` + tabela `profiles` (chave = `auth.uid()`) |
| `user_settings` | colunas em `profiles` ou tabela `user_settings` com chave `auth.uid()` |
| LedgerService (única porta de escrita) | funções SQL no esquema `api` (ex.: `api.post_transaction`, `api.edit_transaction`, `api.cancel_transaction`, `api.pay_statement`), que validam e gravam tudo numa única transação do banco |
| Policies do Laravel | RLS + verificação de papel dentro das funções |
| Scheduler do Laravel (seção 34) | jobs do `pg_cron` chamando funções SQL |
| Filas | jobs do `pg_cron` + `pg_net` chamando Edge Functions |
| Controllers e páginas Inertia | telas React que leem por visões com RLS e escrevem só por RPC |
| Pest/PHPUnit | pgTAP para regras do banco; Vitest e fast-check para o motor em TypeScript |
| Laravel Sail / ambiente local | `supabase start` (Docker) + `npm run dev` |

## 3. Regras de implementação

1. **Nada de escrita direta no Ledger.** Revogar `INSERT`, `UPDATE` e `DELETE` do papel `authenticated` em `ledger_transactions`, `ledger_entries`, `commitments`, `card_statements` e demais tabelas do motor. Toda escrita passa pelas funções do esquema `api`.
2. **Funções de escrita:** `SECURITY DEFINER`, com `SET search_path = ''`, nomes totalmente qualificados e verificação explícita de que `auth.uid()` é membro do espaço com o papel exigido. Nunca confiar em `financial_space_id` vindo do cliente sem essa verificação.
3. **Leitura:** RLS em todas as tabelas com `financial_space_id`. Política padrão: o usuário lê linhas dos espaços em que está em `financial_space_members`. A verificação usa uma função auxiliar `STABLE` (ex.: `private.is_member(space_id)`) para não repetir subconsultas.
4. **Integridade:** as restrições da seção 33 valem como estão. O Supabase é PostgreSQL completo: gatilhos de restrição diferidos (soma zero, mínimo de 2 partidas, liquidação ≤ devido), chaves estrangeiras compostas com `financial_space_id`, CHECKs e índices únicos parciais.
5. **Dinheiro:** `bigint` em centavos no banco. No TypeScript, valores em centavos como `number` inteiro; o texto digitado é convertido sem ponto flutuante (8.8).
6. **Datas:** `occurred_on date` e `competence_month date`, no fuso do espaço. O `pg_cron` roda em UTC: os alertas das 08:00 de Brasília rodam às 11:00 UTC.
7. **Motor do Livre para gastar:** um módulo TypeScript puro, sem acesso a banco, que recebe os dados já lidos e devolve o resultado. O mesmo módulo é usado pela tela e pelas Edge Functions dos alertas. Ele é testado com os casos CT-LFG e CT-GOAL do Apêndice B.
8. **Fila offline:** `ledger_transactions.client_uuid` com índice único por espaço; a função de gravação devolve o registro existente em reenvio (INV-SYNC-001).
9. **Feriados:** tabela `holidays` global (`national`, `bank`) mais feriados `local` por espaço (D-031).

## 4. Tarefas agendadas (substitui a seção 34)

| Tarefa | Quando (UTC) | Função |
|---|---|---|
| Gerar ocorrências de recorrências | diária, 03:00 | `api.job_generate_occurrences()` |
| Fechar e abrir faturas; rotativo no vencimento efetivo | diária, 03:10 | `api.job_card_cycles()` |
| Alertas do dia (08:00 de Brasília) | diária, 11:00 | `api.job_daily_alerts()` → Edge Function de e-mail ou push |
| Conferência de integridade (INV-LEDGER-001 e 003 etc.) | diária, 04:00 | `api.job_integrity_check()` |
| Manter feriados (5 anos à frente) | anual | `api.job_holidays()` |

## 5. Riscos do plano gratuito e mitigação

- **Pausa após 7 dias sem atividade:** o backup diário pelo GitHub Actions mantém o projeto em uso. Se o projeto for pausado, os dados não se perdem: reativa-se pelo painel.
- **Limite de 500 MB:** suficiente para uso pessoal e familiar; acompanhar o tamanho e alertar acima de 70%.
- **Backup:** `pg_dump` diário pelo GitHub Actions, criptografado, guardado fora do Supabase (repositório privado ou outro armazenamento). Testar a restauração uma vez por fase.

## 6. LGPD

O app já é usado por outras pessoas. Por isso a exceção de uso estritamente pessoal (art. 4º, I) **não se aplica**: as obrigações da seção 35 para dados de terceiros valem desde já (política de privacidade, exclusão de conta, exportação dos dados, registro de acesso).

## 7. Migração do app existente

1. Fazer backup completo do banco atual antes de qualquer mudança.
2. Mapear as tabelas atuais para o modelo do documento (32).
3. Criar as tabelas novas ao lado das antigas, sem apagar nada.
4. Migrar os dados de cada usuário como lançamentos de **abertura** (saldos iniciais contra Abertura, 6) e, quando houver histórico confiável, como transações do Ledger.
5. Conferir, para cada usuário, que os saldos depois da migração batem com os de antes.
6. Só depois trocar as telas para o modelo novo. As tabelas antigas ficam somente leitura até a conferência final.
