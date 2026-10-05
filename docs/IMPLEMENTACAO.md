# Implementação do Documento Mestre 2.0

**Em andamento. O conjunto completo dos documentos ainda não está concluído.** O novo modelo tem APIs e uma interface de validação local. A versão publicada continua usando o legado; nenhuma migração nova foi aplicada em produção.

## Referências

- [Documento Mestre](especificacao/DOCUMENTO_MESTRE.md)
- [ALT-001](especificacao/ALT-001-ARQUITETURA-SUPABASE.md)
- [Checklist integral](COBERTURA_ESPECIFICACAO.md)

## Implementado e validado localmente

- Espaços financeiros, membros, isolamento por RLS, auditoria e pelo menos um proprietário ativo.
- Contabilidade de partidas balanceadas, valores em centavos, abertura, transferências, aplicações/resgates de principal e saldos derivados.
- Criação, edição e cancelamento de lançamentos, versões otimistas, idempotência e bloqueio de períodos fechados.
- Contas arquivadas preservam histórico; edição pode reter uma conta arquivada já presente, sem autorizar novas movimentações nela.
- Categorias hierárquicas, proibição de ciclos, contas contábeis nas folhas e transformação de folha em grupo com uma filha “(geral)”.
- Pessoas com saldo único, acertos sem receita/despesa e despesas compartilhadas.
- Divisão por maior resto, com pesos e desempate determinístico, compartilhada entre PostgreSQL e TypeScript.
- Calendário bancário com feriados nacionais, Carnaval, ajustes de vencimento e suporte a feriados locais.
- Cartões, titulares, limites, autorizações e retenção temporária de limite para pagamentos por boleto.
- Compras parceladas reconhecem o consumo integral uma vez; parcelas vinculam a dívida às faturas. Pagamento de cartão não cria uma nova despesa.
- Faturas com saldo e liquidação derivados, ciclo de fechamento, transporte de crédito e rolagem de dívida por um ciclo, incluindo recálculo por pagamento retroativo.
- Estornos em conta e cartão, limites pelo valor original, idempotência e tratamento dos modelos de estorno de parcelas.
- Edição de compras abertas preserva metadados de fatura e parcelas. Operações técnicas exigem seu serviço específico.
- Agenda com vencimento nominal/efetivo, liquidação parcial/integral, ajuste de valor estimado e reabertura automática ao cancelar pagamento.
- Recorrências com versões imutáveis, geração idempotente, preservação de ocorrências tocadas/pagas e encerramento de série.
- Orçamentos por categoria e descendentes, ajuste mensal, consumo/pendências derivados e proteção contra sobreposição essencial, inclusive ao mover categorias.
- Privacidade nas telas legadas e na interface local: mascara valores sem alterar cálculos ou campos de cadastro.
- Prévia somente leitura da migração do legado. **Não existe ainda migração automática homologada.**

## Interface do novo modelo

`npm run dev:ledger` abre o modo local em **http://127.0.0.1:4179/financias/**, conectado exclusivamente ao Supabase local. Exige uma conta desse ambiente. Os usuários e dados de produção não são copiados automaticamente.

Telas conectadas: visão geral, contas, categorias, cartões, pessoas, lançamentos, Agenda e orçamentos. Os formulários permitem receitas/despesas, compras parceladas, pagamentos de cartão, transferências e liquidação integral de compromissos. As demais operações do novo backend ainda precisam de interface completa.

A ativação por `VITE_FINANCIAL_MODEL=ledger` permanece optativa. Não ativar no site publicado antes da migração conferida.

## Validação

```powershell
npm test
npm run typecheck
npm run build:pwa
npm run build
npm run test:db
npm run test:db:fresh
npm run test:api:local
npm run test:browser:local
```

O teste de banco do zero cria um banco isolado com prefixo `financias_verify_`, aplica todas as migrações e executa os testes. Não limpa o banco em uso. Os bancos de verificação ficam disponíveis para inspeção.

Os testes de API e navegador criam usuários/espaços fictícios **somente no Supabase local** e os preservam para inspeção. O teste de navegador usa Chrome instalado no caminho padrão do Windows e gera capturas em `out/verification/`.

Resultados: 31 testes TypeScript e 179 verificações de banco em 17 arquivos. Os fluxos de autenticação/cadastro/movimentação passaram pela API HTTP; os formulários, privacidade e layout móvel passaram no Chrome.

Para uma instância local iniciada antes de atualizar `config.toml`, pode ser necessário atualizar os esquemas expostos e recarregar a API. Procedimento documentado na [configuração oficial do PostgREST](https://docs.postgrest.org/en/latest/references/configuration.html). A configuração de desenvolvimento permite a conexão à API local; o build mantém a política de conexão de produção.

## Pendências para conclusão integral

1. Completar operações específicas de cartões: encargos, parcelamento de fatura, antecipação, correções e seus fluxos de interface.
2. Completar tags, preferências no servidor, gestão de membros e telas de auditoria/edição/estorno/recorrência.
3. Implementar o motor integral de reservas/metas/provisões e seus vínculos com parcelas e estornos.
4. Integrar a projeção do Livre aos dados reais, alertas e telas. O módulo TypeScript inicial ainda depende da decisão abaixo.
5. Obter o esquema e backup reais de produção, implementar/testar o mapeamento do legado e conferir saldos por usuário em uma cópia isolada.
6. Implementar notificações, importação/conciliação, fila offline, relatórios, fechamento, Saúde Financeira, patrimônio, investimentos e cronogramas de dívidas.
7. Completar compartilhamento, anexos, exclusão de conta, exportação, política de privacidade, backups externos e serviços de e-mail/push.
8. Configurar e verificar tarefas agendadas e funções de infraestrutura no ambiente de destino.
9. Homologar as seis fases do documento; somente então ativar o novo modelo em produção.

### Decisão pendente no Livre

As seções 15.11.2 e 15.11.4 entram em conflito quando a menor receita histórica supera a previsão: o conservador usa o histórico, enquanto o esperado usa a previsão, mas outra regra exige que o esperado nunca seja menor. Foi solicitado ao usuário escolher a regra. O código inicial detecta essa situação e não produz silenciosamente um resultado contraditório; ainda não está ativo nas telas.

### Publicação

A publicação do código-fonte no repositório público foi rejeitada pela revisão automática de aprovação, por falta de autorização explícita para expor esse conteúdo naquele destino. Os commits podem ser salvos localmente. Não contornar essa restrição por outra API.

As migrações do legado incluem uma baseline **provisória somente para teste local**. Não executar `supabase db push` indiscriminadamente em produção.
