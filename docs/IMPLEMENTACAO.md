# Implementação do Documento Mestre 2.0

Esta implementação está em andamento. A Fase 1 ainda não está completa e as telas publicadas ainda utilizam o modelo legado. Este arquivo registra o estado do código, sem alterar a especificação.

## Documentos de referência

- [Documento Mestre](especificacao/DOCUMENTO_MESTRE.md)
- [ALT-001](especificacao/ALT-001-ARQUITETURA-SUPABASE.md)
- [Checklist de funcionalidades](COBERTURA_ESPECIFICACAO.md)

## Base implementada e testada localmente

- Esquemas `finance` (tabelas novas), `api` (RPCs) e `private` (funções de integridade). O esquema separado evita colisões com categorias e cartões legados.
- Espaços financeiros, membros, papéis e leitura isolada por RLS.
- Contas contábeis com classe, sinal natural e liquidez.
- Contas financeiras e categorias de receita/despesa.
- Valores em centavos inteiros; conversão textual sem ponto flutuante.
- Divisão pelo maior resto com desempate determinístico e pesos com sinal.
- Contas de sistema Abertura, Ajuste de saldo e Resultado de investimentos.
- Cadastro de conta com saldo inicial registrado como transação balanceada contra Abertura. Poupança usa liquidez de investimento por padrão.
- RPCs de criação, edição e cancelamento de lançamentos, com auditoria, controle de versão e preservação das partidas canceladas.
- Pelo menos duas partidas e soma zero, verificadas por gatilhos diferidos e pelas RPCs.
- Idempotência por espaço e `client_uuid`; reenvio com conteúdo diferente é recusado.
- Bloqueio de mudanças numéricas em períodos fechados, incluindo data financeira, competência padrão e competências das partidas.
- Arquivamento de contas preserva histórico e impede novas partidas.
- Visões de partidas lançadas e saldos derivados, com RLS do usuário invocador.
- Calendário TypeScript de dias úteis bancários, incluindo feriados nacionais e Carnaval; aceita feriados locais.
- Prévia de migração do legado por usuário: saldos, contagens e registros que precisam de revisão. A prévia não migra nem modifica dados.
- Pessoas com uma única conta de saldo: positivo a receber, negativo a pagar; acertos e empréstimos entre pessoas não geram receita ou despesa.
- Despesas divididas entre o usuário e pessoas, com divisão de centavos idêntica no PostgreSQL e no TypeScript. A parte dos terceiros não entra no consumo do usuário.
- Transferências entre contas próprias, aplicações e resgates de principal, sem gerar receita ou despesa; reenvios são idempotentes.
- Criação de subcategoria sob uma folha transforma o nó em pai e move o vínculo contábil para a filha “(geral)”, sem reescrever partidas históricas.
- Integridade da árvore de categorias: classes compatíveis, proibição de ciclos e conta contábil somente nas folhas; totais agregados preservam o histórico.
- Exigência diferida de pelo menos um proprietário ativo por espaço.
- Edição de histórico com conta arquivada já presente na transação; permanece proibido acrescentar outra conta arquivada ou criar novos lançamentos nela.
- Botão de privacidade no cabeçalho das telas atuais, com estado no aparelho: mascara valores monetários e rótulos de gráficos, preservando cálculos, campos digitados e exportações. A preferência de inicialização em `user_settings` continua pendente.

Operações de cartão e estorno ainda não estão habilitadas nas novas RPCs. Elas dependem das entidades de fatura e de suas regras; o banco recusa esses tipos até que o módulo esteja pronto.

## Validação

```powershell
npm test
npm run typecheck
npm run build:pwa
npm run build
npm run test:db
```

O Supabase local deve estar iniciado para os testes do banco. As migrações existentes do legado incluem uma baseline **provisória somente para teste local**. Não executar `supabase db push` indiscriminadamente em produção.

## Ordem de conclusão

1. Completar a integridade do núcleo: categorias hierárquicas, pessoas, tags, faturas, autorizações, estornos e respectivos testes do documento.
2. Obter backup completo e esquema real de produção, definir o mapeamento e testar a migração numa cópia isolada. Conferir os saldos de cada usuário antes/depois.
3. Integrar as telas às leituras em `finance` e escritas em `api`. Somente após a conferência, tornar o legado somente leitura.
4. Concluir a Fase 1 e homologar os fluxos de cadastro, lançamento, cartão, pessoas e auditoria.
5. Implementar Agenda, recorrências, Livre inicial e notificações (Fase 2).
6. Implementar importação, conciliação e fila offline (Fase 3).
7. Implementar planejamento completo, relatórios, fechamento e Saúde Financeira (Fase 4).
8. Implementar patrimônio, cronogramas de dívidas e investimentos (Fase 5).
9. Implementar compartilhamento, anexos e demais itens da Fase 6.

Backups externos, tarefas `pg_cron`, política de privacidade, exclusão de conta e configuração dos serviços de e-mail/push também precisam ser implementados e verificados. Nenhuma migração nova foi aplicada no banco de produção.
