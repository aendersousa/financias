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
- Conferência de saldo em duas etapas: comparar registra a evidência sem alterar valores; somente a confirmação explícita cria a diferença não identificada. “Explicar ajuste” classifica essa diferença, inteira ou parcialmente, para categoria ou Abertura, preservando a partida bancária, seu identificador e a conciliação (CT-ADJ-001).
- Avaliações de investimentos/bens, resgates com imposto retido e valorização simultânea, empréstimos recebidos e amortização com encargos. Cancelar uma avaliação preserva seu histórico e deixa de satisfazer a conferência mensal.
- Fechamento/reabertura mensal por administrador, avisos, fotografia versionada e recálculo das fotografias posteriores. Os controles incluem reservas no fim do mês.
- Metas virtuais, metas em investimentos e provisões com compromisso vinculado. Aportes/liberações não movimentam o Ledger; consumos, parcelas, devoluções e cancelamentos recalculam a reserva cronologicamente.
- Estornos de reservas descontam primeiro o gasto comum, respeitam a capacidade de cada parcela futura e restauram somente o que foi consumido. Encerrar a reserva libera seu saldo; quitar a provisão libera a sobra e cancelar o pagamento reabre a provisão.
- Ordem de registro explícita para eventos do mesmo dia e bloqueio de aportes/liberações em meses fechados, inclusive quando um cancelamento altera uma quitação em outro mês.
- Datas e sugestões de aportes por ciclo de renda, cotas cumulativas e capacidade disponível no servidor, comparadas com módulo TypeScript independente. Aportes automáticos aguardam o recebimento integral da renda principal, tratam atrasos e respeitam a capacidade disponível; confirmação/dispensa manual, alteração do plano e substituição de cotas estão conectadas à interface.
- Identidade dos envios repetidos separada das observações editáveis, inclusive avaliações sem alteração de saldo e confirmação de encargos zerados.
- Dashboard usa apenas liquidez `cash` no Saldo em contas e mostra benefícios, investimentos/poupança e bens separadamente.
- Livre para gastar calculado no servidor, com cenários conservador/esperado, horizonte de renda principal ou ciclo alternativo, receitas históricas, pessoas, pagamentos agendados, faturas e cobertura cronológica das reservas. As cotas essenciais consideram hierarquia de categorias, histórico, parcelas e o vínculo de benefícios; VR/VA continua separado do dinheiro em conta.
- Diagnóstico conservador do Livre com as mensagens canônicas de falta para compromissos ou reservas, primeira data descoberta e prioridades de cobertura (CT-LFG-011 A/B/C). A apresentação usa os valores mascarados quando a privacidade está ativa.
- Previsão diária de caixa com cenários conservador/esperado, mínimo do período e primeira data negativa; horizontes de fim do mês, 30/90 dias, seis meses e data personalizada até 24 meses, com preferência individual lembrada. Ocorrências ainda não geradas são projetadas pelas versões das recorrências sem gravar Agenda ou faturas; compras/compromissos no cartão entram no vencimento bancário da fatura. Reservas, orçamentos, benefícios e investimentos não alteram a curva.
- Aporte manual de meta virtual que deixe o Livre negativo exige prévia e confirmação explícita, inclusive nos aportes do ciclo. A prévia não grava valores; a confirmação recalcula sob o mesmo bloqueio financeiro e rejeita aprovações desatualizadas por mudança de valor, data, plano ou movimento concorrente. O UUID aceito continua idempotente.
- Configurações do ciclo, reserva mínima de segurança e vínculo de categorias ao benefício, com controle de versão e permissões.
- Central de notificações por usuário: Agenda, renda principal/adiamento, faturas/encargos/rolagem, orçamento e comparação mensal de categorias, metas/provisões/aportes, importações, compartilhamento, saldo negativo e divergências de conferência. Leitura, arquivamento, preferências e repetição dos eventos têm testes de isolamento e idempotência. A execução externa e a entrega por e-mail/push continuam pendentes.
- Lançamento rápido em conta/benefício ou cartão em 1x, modelos individuais, rascunhos fora do Ledger e sugestão de categoria pelo histórico do espaço. Fila IndexedDB com UUID estável, espera crescente e lista de recusados; recuperação compara o conteúdo originalmente recebido e o registro atual do servidor antes de preservar o servidor ou confirmar novo envio. A mudança para outro espaço seleciona novos cadastros, usa novo UUID e substitui o item local atomicamente. O cache conserva os últimos totais do servidor, sem recalculá-los pelos pendentes; logout e troca de usuário exigem confirmação antes de apagá-los.
- PWA compilada abre após recarga completa sem internet, mantém a fila após uma atualização aceita pelo usuário e envia os pendentes quando a conexão volta. XAMPP/localhost continuam sem service worker para facilitar o desenvolvimento.
- Privacidade nas telas legadas e na interface local: mascara valores sem alterar cálculos ou campos de cadastro.
- Prévia somente leitura da migração do legado. **Não existe ainda migração automática homologada.**
- Gestão de contas, categorias, feriados locais, fuso e múltiplos espaços; versões e permissões de cadastro; ajuste da liquidez e marcação de reserva de emergência. A Agenda mensal permite editar uma ocorrência, liquidar parcialmente e concluir/reabrir lembretes de pessoas.
- Gestão de cartões: regras, portadores, autorizações, histórico de limite, abertura de cartão já em uso, datas de faturas, cancelamento/reativação e arquivamento. Mudanças de fechamento preservam faturas e parcelas existentes, inclusive períodos com datas manuais.
- Importação OFX/CSV de contas e cartões, configuração de colunas/encoding, revisão por candidatos, FITID/hash/multiplicidade, confirmação e desfazimento auditados, conciliação com Agenda/parcelas, tratamento de compras em processamento e abertura de parcelamentos anteriores. O original é armazenado cifrado em tabela privada; a arquitetura de anexos no Storage ainda está pendente.
- Relatórios por competência e parcelas, fluxo de caixa por seções, benefícios separados, patrimônio, comparação de categorias, assinaturas, dedutíveis no IR e exportação CSV filtrada. Saúde Financeira usa meses completos e mostra dados insuficientes em vez de produzir métricas sem histórico; parcelas futuras são agrupadas por ciclos de renda.
- Cronogramas persistidos de empréstimos Price/SAC ou informados pelo credor, integração à Agenda, pagamentos parciais, ajuste por saldo, antecipação/substituição e arquivamento com histórico preservado.
- Compartilhamento por convite com prazo e destinatário, aceitação/revogação, gestão de papéis/proprietários, divisões exatas, acertos externos, despesas pagas pessoalmente, transferência pareada entre espaços e saída de membros com prefixo financeiro protegido.
- Orçamentos com limite por mês ou alteração das próximas competências, término do plano e histórico; uma exceção mensal preserva o limite do mês seguinte.
- Pessoas: apelido/observações, saldo inicial a receber ou pagar contra Abertura, extrato, lembretes e arquivar/restaurar; só contatos sem uso podem ser excluídos. A inicialização copia os cinco papéis básicos de categorias sem duplicar ou substituir grupos/categorias do usuário.
- Compras em moeda estrangeira: cálculo decimal da conversão no servidor, taxa ou valor em reais informados pelo usuário, rateio pela moeda original, IOF separado e configurável, estimativa/confirmação e diferenças vinculadas quando a compra já está em período/fatura protegidos. A Central encaminha as conversões pendentes para a tela correspondente.
- Conversão final participa do teto líquido de estorno e dos relatórios de parcelas, mantendo IOF separado. Correções posteriores de uma compra confirmada aparecem nos totais e no histórico; ajustes vinculados precisam ser cancelados antes da compra original. Créditos de uma compra estornada não diminuem as parcelas futuras de outra compra ou cartão.
- Gestão individual de modelos: adicionar, editar campos e excluir com confirmação/versão, sem alterar o Ledger. A consulta offline usa a cópia do espaço ativo; a edição exige conexão. Respostas atrasadas de gravação do cache não substituem a seleção mais recente, inclusive entre documentos com revisões independentes.
- Cache e preferências ficam vinculados ao usuário que iniciou o carregamento. Uma gravação atrasada depois da troca de usuário é recusada; a fila valida seu proprietário dentro da própria transação de gravação, junto da identidade local. A primeira abertura também confere e registra o proprietário atomicamente, evitando que duas abas assumam usuários diferentes sem confirmar a troca.
- Função de manutenção reúne geração da Agenda, ciclos de cartões, provisões, aportes e alertas. Endpoint local testa autenticação por segredo, configurações, RPC privilegiada e falhas. **A função não foi implantada nem agendada em produção.**

## Interface do novo modelo

Com Docker e o Supabase local já iniciados, as migrações locais aplicadas e a porta 4179 livre, `npm run dev:ledger` inicia o servidor em **http://127.0.0.1:4179/financias/**. Abra esse endereço no navegador e use uma conta criada nesse ambiente. O comando inicia somente o Vite: não abre o navegador, inicia o Supabase nem aplica migrações. Os usuários e dados de produção não são copiados automaticamente.

Telas conectadas: visão geral/Livre, lançamento rápido/gestão de modelos/rascunhos/fila, gestão de contas e categorias, gestão de cartões/operações de fatura, compras internacionais/IOF, pessoas, compartilhamento/múltiplos espaços, lançamentos/detalhes/edição/estornos/conciliação/explicação de ajustes, importação de extratos, Agenda mensal, previsão diária de saldo, orçamentos, recorrências, metas/provisões/aportes/cotas, patrimônio e cronogramas de empréstimos, relatórios/CSV, Saúde Financeira, fechamento, tags, auditoria, Central de notificações e configurações. Os fluxos ainda não cobrem integralmente as seis fases; as pendências estão abaixo.

A ativação por `VITE_FINANCIAL_MODEL=ledger` permanece optativa. Não ativar no site publicado antes da migração conferida.

O cálculo canônico do Livre é executado no PostgreSQL e lido pelas telas e pela manutenção. O módulo TypeScript funciona como oráculo independente nos testes. Isso difere da regra 7 da ALT-001, que previa compartilhar o módulo TypeScript entre tela e Edge Functions; essa decisão e os demais requisitos arquiteturais ainda precisam de conferência na homologação.

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
npm run test:browser:advanced
npm run test:offline:local
npm run test:maintenance:local
```

O teste de banco do zero cria um banco isolado com prefixo `financias_verify_`, aplica todas as migrações e executa os testes. Não limpa o banco em uso. Os bancos de verificação ficam disponíveis para inspeção.

Os testes de API e navegador criam usuários/espaços fictícios **somente no Supabase local** e os preservam para inspeção. O teste de navegador usa Chrome instalado no caminho padrão do Windows e gera capturas em `out/verification/`.

Resultados desta etapa: **116 testes TypeScript em 8 arquivos** e **1.480 verificações SQL em 61 arquivos**, com todas as migrações aplicadas em um banco isolado criado do zero (`financias_verify_20261006132000`). Typecheck, compilação PWA/desktop, teste REST local e manutenção passaram. Chrome passou pelos fluxos principais de metas/provisões, conciliação/edição/estorno, avaliações, amortização, fechamento/reabertura, tags, recorrências, configurações, Central de notificações, privacidade, layout móvel e fila offline. O cálculo do Livre do servidor foi comparado com o motor TypeScript independente; a previsão de caixa tem 59 verificações SQL próprias.

O teste avançado no Chrome passou por importação/desfazimento OFX/CSV, Agenda parcial, gestão de contas/categorias/cartões, relatórios/CSV, modelos/rascunhos, cotas e exceção de orçamento, conferência/explicação parcial de ajuste, recuperação atômica da fila e gravações de cache atrasadas em documentos independentes, conversão/IOF, histórico de pessoas, aviso e invalidação da confirmação de aporte, previsão diária/privacidade/preferência lembrada/layout móvel, cronograma de empréstimo, convites e cancelamento pareado entre espaços. Capturas da previsão ficam em `out/verification/forecast-browser.png` e `forecast-mobile.png`.

O teste da PWA usa Chrome, uma compilação isolada em `out/offline-pwa-test` e HTTP loopback, conectado somente ao Supabase local. Verifica service worker real, recarga inteira sem internet, valores em cache, fila preservada após atualizar o aplicativo e envio ao reconectar. A política de conexão liberada para a API local existe somente na resposta do servidor de teste; o artefato de produção conserva sua política original.

Para uma instância local iniciada antes de atualizar `config.toml`, pode ser necessário atualizar os esquemas expostos e recarregar a API. Procedimento documentado na [configuração oficial do PostgREST](https://docs.postgrest.org/en/latest/references/configuration.html). A configuração de desenvolvimento permite a conexão à API local; o build mantém a política de conexão de produção.

## Pendências para conclusão integral

1. Homologar os exemplos integrais do Livre e da previsão com os dados reais da migração, além dos testes locais; conferir os indicadores e as prioridades do planejamento em todos os casos dos documentos.
2. Concluir ciclos de provisões recorrentes e mudança somente das cotas futuras após pagamentos; perguntas ao cancelar o compromisso vinculado.
3. Completar os fluxos avançados de lançamento: edição de divisões, reembolso já esperado, compra parcelada com preço à vista/juros, várias quitações numa transação, juros/multa de compromisso e compra financiada de bem/despesa.
4. Completar o cache de todos os conjuntos previstos e sincronização em segundo plano quando suportada; contagem de uso/ordenação de favoritos conforme o modelo de dados dos documentos.
5. Concluir anexos/garantias e Storage privado, exportação completa em ZIP por fila/link assinado, exclusão de usuário em 30 dias com pseudonimização, registros de acesso e política de privacidade com os dados reais do operador.
6. Completar busca global/avançada, regras de categorização, insights, Open Finance, assistente e os demais itens da Fase 6 listados no checklist. Encerramento e eventual reabertura de checkpoints do compartilhamento também precisam de homologação integral.
7. Obter o esquema e backup reais de produção, implementar/testar o mapeamento do legado e conferir saldos por usuário em uma cópia isolada. A baseline local é provisória e não prova compatibilidade com o banco de produção.
8. Configurar 2FA, e-mail/push, tarefas agendadas, integridade, feriados, backups cifrados externos e restauração no ambiente de destino.
9. Homologar cada linha do checklist e todos os INV/CT aplicáveis; somente então ativar o novo modelo em produção. A aprovação de publicação no repositório público permanece pendente.

### Regra assumida no Livre

As seções 15.11.2 e 15.11.4 entram em conflito quando a menor receita histórica supera a previsão. Sem resposta à preferência opcional, foi adotada e comunicada a opção recomendada: uma entrada estimada no conservador usa o menor entre a previsão e os três recebimentos mais recentes, menos o já recebido e com piso zero. O esperado mantém a previsão. CT-LFG-010 continua com os valores oficiais. É uma resolução explícita da contradição, e não uma afirmação de que o texto original já define esse caso de forma consistente.

### Publicação

A publicação do código-fonte no repositório público foi rejeitada pela revisão automática de aprovação, por falta de autorização explícita para expor esse conteúdo naquele destino. Os commits podem ser salvos localmente. Não contornar essa restrição por outra API.

As migrações do legado incluem uma baseline **provisória somente para teste local**. Não executar `supabase db push` indiscriminadamente em produção.
