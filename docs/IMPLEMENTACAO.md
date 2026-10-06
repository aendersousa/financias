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
- Tags, mesclagem sem duplicação de vínculos, preferências individuais no servidor e histórico de alterações.
- Encargos confirmados do cartão, parcelamento de fatura e antecipação de parcelas; o estorno não credita novamente parcelas já antecipadas.
- Conciliação manual de partidas: conferir, desfazer conferência, anotar mesmo em mês fechado e confirmar a revisão ao mudar valores conferidos.
- Avaliações de investimentos/bens, resgates com imposto retido e valorização simultânea, empréstimos recebidos e amortização com encargos. Cancelar uma avaliação preserva seu histórico e deixa de satisfazer a conferência mensal.
- Fechamento/reabertura mensal por administrador, avisos, fotografia versionada e recálculo das fotografias posteriores. Os controles incluem reservas no fim do mês.
- Metas virtuais, metas em investimentos e provisões com compromisso vinculado. Aportes/liberações não movimentam o Ledger; consumos, parcelas, devoluções e cancelamentos recalculam a reserva cronologicamente.
- Estornos de reservas descontam primeiro o gasto comum, respeitam a capacidade de cada parcela futura e restauram somente o que foi consumido. Encerrar a reserva libera seu saldo; quitar a provisão libera a sobra e cancelar o pagamento reabre a provisão.
- Ordem de registro explícita para eventos do mesmo dia e bloqueio de aportes/liberações em meses fechados, inclusive quando um cancelamento altera uma quitação em outro mês.
- Datas e sugestões de aportes por ciclo de renda, cotas cumulativas e capacidade disponível em módulo TypeScript testado. A execução automática dos aportes ainda depende da integração integral da projeção.
- Identidade dos envios repetidos separada das observações editáveis, inclusive avaliações sem alteração de saldo e confirmação de encargos zerados.
- Dashboard usa apenas liquidez `cash` no Saldo em contas e mostra benefícios, investimentos/poupança e bens separadamente.
- Livre para gastar calculado no servidor, com cenários conservador/esperado, horizonte de renda principal ou ciclo alternativo, receitas históricas, pessoas, pagamentos agendados, faturas e cobertura cronológica das reservas. As cotas essenciais consideram hierarquia de categorias, histórico, parcelas e o vínculo de benefícios; VR/VA continua separado do dinheiro em conta.
- Configurações do ciclo, reserva mínima de segurança e vínculo de categorias ao benefício, com controle de versão e permissões.
- Central de notificações por usuário: Agenda, faturas/encargos, limites de orçamento, progresso de metas e reservas descobertas. Leitura, arquivamento, preferências e repetição dos eventos têm testes de isolamento e idempotência. As tarefas externas, e-mail/push e os demais tipos ainda estão pendentes.
- Lançamento rápido em conta/benefício ou cartão em 1x, fila persistente IndexedDB, reenvio com UUID estável, espera crescente e lista de recusados. O cache conserva os últimos totais do servidor, sem recalculá-los pelos pendentes. Logout e troca de usuário exigem confirmação antes de apagar dados locais.
- PWA compilada abre após recarga completa sem internet, mantém a fila após uma atualização aceita pelo usuário e envia os pendentes quando a conexão volta. XAMPP/localhost continuam sem service worker para facilitar o desenvolvimento.
- Privacidade nas telas legadas e na interface local: mascara valores sem alterar cálculos ou campos de cadastro.
- Prévia somente leitura da migração do legado. **Não existe ainda migração automática homologada.**

## Interface do novo modelo

`npm run dev:ledger` abre o modo local em **http://127.0.0.1:4179/financias/**, conectado exclusivamente ao Supabase local. Exige uma conta desse ambiente. Os usuários e dados de produção não são copiados automaticamente.

Telas conectadas: visão geral/Livre, lançamento rápido/fila, contas, categorias, cartões/operações de fatura, pessoas, lançamentos/detalhes/edição/estornos/conciliação, Agenda, orçamentos, recorrências, metas/provisões, patrimônio, relatório mensal/fechamento, tags, auditoria, Central de notificações e configurações. Os fluxos ainda não cobrem integralmente as seis fases; as pendências estão abaixo.

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
npm run test:offline:local
```

O teste de banco do zero cria um banco isolado com prefixo `financias_verify_`, aplica todas as migrações e executa os testes. Não limpa o banco em uso. Os bancos de verificação ficam disponíveis para inspeção.

Os testes de API e navegador criam usuários/espaços fictícios **somente no Supabase local** e os preservam para inspeção. O teste de navegador usa Chrome instalado no caminho padrão do Windows e gera capturas em `out/verification/`.

Resultados desta etapa: **88 testes TypeScript em 7 arquivos** e **533 verificações SQL em 34 arquivos**, com todas as migrações aplicadas em um banco isolado criado do zero. Typecheck, compilação PWA/desktop e teste REST local passaram. Chrome passou por metas/provisões, conciliação/edição/estorno, cancelamento/substituição de avaliações, amortização, fechamento/reabertura, tags, recorrências, configurações, Central de notificações, privacidade e layout móvel. O cálculo do servidor foi comparado com o motor TypeScript independente.

O teste da PWA usa Chrome, uma compilação isolada em `out/offline-pwa-test` e HTTP loopback, conectado somente ao Supabase local. Verifica service worker real, recarga inteira sem internet, valores em cache, fila preservada após atualizar o aplicativo e envio ao reconectar. A política de conexão liberada para a API local existe somente na resposta do servidor de teste; o artefato de produção conserva sua política original.

Para uma instância local iniciada antes de atualizar `config.toml`, pode ser necessário atualizar os esquemas expostos e recarregar a API. Procedimento documentado na [configuração oficial do PostgREST](https://docs.postgrest.org/en/latest/references/configuration.html). A configuração de desenvolvimento permite a conexão à API local; o build mantém a política de conexão de produção.

## Pendências para conclusão integral

1. Completar correções específicas de cartões, portadores, mudanças de regras/datas, cancelamento/arquivamento e gestão de autorizações na interface.
2. Completar gestão de membros, operações de cadastro/arquivamento/classificação e edição isolada de ocorrências na interface.
3. Integrar aportes automáticos/capacidade, mudança de valor das provisões, cotas na interface e ciclos de provisões recorrentes.
4. Completar indicador de parcelas futuras, linha do tempo e cenários, alertas do Livre e tarefas externas de geração. O cálculo principal do Livre já usa dados reais no ambiente local.
5. Obter o esquema e backup reais de produção, implementar/testar o mapeamento do legado e conferir saldos por usuário em uma cópia isolada.
6. Completar os demais tipos da Central de notificações, importação/conciliação de extratos, relatórios completos, Saúde Financeira e cronogramas de dívidas. Price/SAC e validação do cronograma do credor existem em módulo TypeScript testado; ainda não há persistência de cronograma nem integração com a Agenda.
7. Completar modelos/favoritos e sugestões do lançamento rápido, comparação com o registro do servidor em conflitos, envio para outro espaço, sincronização em segundo plano quando disponível e cache dos demais conjuntos previstos. A fila básica com persistência e reenvio já passou em navegador.
8. Completar compartilhamento, anexos, exclusão de conta, exportação, política de privacidade, backups externos e serviços de e-mail/push.
9. Configurar e verificar tarefas agendadas e funções de infraestrutura no ambiente de destino.
10. Homologar as seis fases do documento; somente então ativar o novo modelo em produção.

### Regra assumida no Livre

As seções 15.11.2 e 15.11.4 entram em conflito quando a menor receita histórica supera a previsão. Sem resposta à preferência opcional, foi adotada e comunicada a opção recomendada: uma entrada estimada no conservador usa o menor entre a previsão e os três recebimentos mais recentes, menos o já recebido e com piso zero. O esperado mantém a previsão. CT-LFG-010 continua com os valores oficiais. É uma resolução explícita da contradição, e não uma afirmação de que o texto original já define esse caso de forma consistente.

### Publicação

A publicação do código-fonte no repositório público foi rejeitada pela revisão automática de aprovação, por falta de autorização explícita para expor esse conteúdo naquele destino. Os commits podem ser salvos localmente. Não contornar essa restrição por outra API.

As migrações do legado incluem uma baseline **provisória somente para teste local**. Não executar `supabase db push` indiscriminadamente em produção.
