# Cobertura da especificacao 2.0

Cada item abaixo corresponde a uma funcionalidade da secao 4 do Documento Mestre.
Uma tela basica existente nao significa que todas as regras dessa funcionalidade foram implementadas.
Os itens permanecem pendentes ate implementacao, testes dos INV/CT aplicaveis e homologacao.
A fundacao tecnica implementada esta descrita em IMPLEMENTACAO.md.

### 4.1 Convenções da seção

### 4.2 Início

- [ ] Saldo em contas, com acesso ao saldo de cada conta caixa (fase 1; referencia 7, 23)
- [ ] Saldo de cada benefício (VR/VA), exibido à parte (fase 1; referencia 7, 23)
- [ ] Faturas dos cartões (aberta e fechadas não pagas) e limite livre (fase 1; referencia 9, 23)
- [ ] Gastos do mês por categoria (consumo por competência, 5 maiores e "Outras") (fase 1; referencia 12, 23)
- [ ] Parcelas futuras por mês (total e próximos 6 meses) (fase 1; referencia 23)
- [ ] Resumo dos valores a receber e a pagar com pessoas (fase 1; referencia 7, 23)
- [ ] Atalho de lançamento rápido e modelos de lançamento (fase 1; referencia 27)
- [ ] Modo privacidade (ocultar valores) (fase 1; referencia 28)
- [ ] Instalação como PWA, online-first, sem funcionar offline (fase 1; referencia 27)
- [ ] Livre para gastar, versão inicial, no cenário conservador, com o esperado como "se as receitas previstas entrarem" (fase 2; referencia 15, 16)
- [ ] Próximos vencimentos e itens vencidos da Agenda (fase 2; referencia 10)
- [ ] Indicador de parcelas futuras ao lado do Livre (fase 2; referencia 15)
- [ ] Livre para gastar completo, com orçamentos essenciais, metas e provisões (fase 4; referencia 15)
- [ ] Situação dos orçamentos do mês e progresso das metas e provisões (fase 4; referencia 13, 14)
- [ ] Patrimônio líquido e sua evolução (fase 5; referencia 17)
### 4.3 Contas

- [ ] Cadastro de contas financeiras com tipo de liquidez: conta corrente, conta de pagamento, carteira, dinheiro, VR/VA, investimento (poupança como investimento por padrão) e bem (fase 1; referencia 7)
- [ ] Mudança da liquidez de uma conta (por exemplo, tratar a poupança como caixa) (fase 1; referencia 7)
- [ ] Saldo inicial por Abertura (fase 1; referencia 7, 8)
- [ ] Transferência entre contas próprias, inclusive aplicação e resgate de investimento pelo valor principal (fase 1; referencia 8)
- [ ] Vínculo do VR/VA com as categorias que ele paga (fase 1; referencia 7)
- [ ] Ajuste de saldo em conta caixa e "Explicar ajuste" (fase 1; referencia 11)
- [ ] Arquivamento de conta (sem partidas novas; as antigas continuam editáveis) (fase 1; referencia 7)
- [ ] Marcação de conta de investimento como reserva de emergência (fase 4; referencia 18)
- [ ] Alerta de reserva descoberta (fase 4; referencia 14)
- [ ] Valorização de investimentos e bens e resgate com rendimento e impostos (fase 5; referencia 17)
### 4.4 Cartões

- [ ] Cadastro do cartão: limite concedido com histórico, dias de fechamento e de vencimento e demais regras do cartão (fase 1; referencia 9)
- [ ] Portadores (cartão adicional e cartão virtual) (fase 1; referencia 9)
- [ ] Faturas como registros próprios, com vencimento efetivo em dia útil bancário (fins de semana, feriados nacionais e segunda e terça de Carnaval; D-031) (fase 1; referencia 8.9, 9)
- [ ] Compra à vista e parcelada, com sugestão e troca da fatura e realocação de parcelas entre faturas não fechadas (fase 1; referencia 9)
- [ ] Compra parcelada com juros (fase 1; referencia 9)
- [ ] Pagamento total, parcial e antecipado; saldo credor (fase 1; referencia 9)
- [ ] Rotativo e parcelamento da fatura (fase 1; referencia 9)
- [ ] Antecipação de parcelas (fase 1; referencia 9)
- [ ] Estorno total e parcial, nos dois modelos de tratamento das parcelas (fase 1; referencia 9, 11)
- [ ] Início de uso com cartão já em andamento (faturas fechadas não pagas, fatura aberta e parcelamentos em andamento) contra Abertura (fase 1; referencia 9)
- [ ] Limite utilizado e limite livre (fase 1; referencia 9)
- [ ] Autorizações pendentes lançadas à mão e retenção do limite no pagamento por boleto, até o fim do prazo de liberação (fase 1; referencia 9)
- [ ] Mudança do dia de vencimento, com efeito só nas faturas não fechadas (fase 1; referencia 9)
- [ ] Cancelamento e arquivamento do cartão (fase 1; referencia 9)
- [ ] Fatura como item automático da Agenda e aviso contra a criação de recorrência de pagamento do cartão (fase 2; referencia 10)
- [ ] Lista das recorrências ligadas ao cartão no cancelamento (fase 2; referencia 9, 10)
- [ ] Autorizações pendentes vindas da importação (fase 3; referencia 9, 19)
- [ ] Conciliação de parcelas programadas ("PARC nn/mm") (fase 3; referencia 19)
### 4.5 Lançamentos

- [ ] Despesa, receita e transferência (fase 1; referencia 8)
- [ ] Lançamento dividido entre categorias e com pessoas (fase 1; referencia 7, 8)
- [ ] Data financeira e competência editável (fase 1; referencia 8)
- [ ] Lançamento rápido em até 3 toques (fase 1; referencia 27)
- [ ] Modelos de lançamento (favoritos) (fase 1; referencia 27)
- [ ] Sugestão de categoria pela descrição, com base no histórico do espaço (fase 1; referencia 27)
- [ ] Aplicação de tags (fase 1; referencia 7)
- [ ] Rascunhos fora do Ledger (fase 1; referencia 8)
- [ ] Edição e recategorização auditadas em mês aberto (fase 1; referencia 8, 20)
- [ ] Excluir lançamento (cancelar sem apagar) (fase 1; referencia 8)
- [ ] Estorno, reembolso e devolução ligados à compra; rótulos "estornada" e "parcialmente reembolsada"; custo líquido (fase 1; referencia 11)
- [ ] Reembolso já conhecido na compra, registrado como valor a receber (fase 1; referencia 11)
- [ ] Cashback em conta ou na fatura (fase 1; referencia 11)
- [ ] Compra em moeda estrangeira registrada em reais, com valor estimado até a confirmação e IOF como lançamento próprio (fase 1; referencia 21)
- [ ] Exportação da lista filtrada em CSV (fase 1; referencia 25)
- [ ] Lançamento agendado (fase 2; referencia 10)
- [ ] Pagamento devolvido (fase 2; referencia 10)
- [ ] Status de conciliação por lançamento, com marcação manual (fase 2; referencia 19)
- [ ] Fila offline de lançamentos rápidos; tela sem conexão com "atualizado às hh:mm" e soma dos pendentes de envio; lista "Não enviados" (fase 3; referencia 27)
- [ ] Regras automáticas de categorização e classificação (fase 6; referencia 5.2)
### 4.6 Agenda e calendário

- [ ] Compromissos avulsos a pagar e a receber (fase 2; referencia 10)
- [ ] Classificação por direção e certeza (confirmado, estimado, condicional) (fase 2; referencia 10)
- [ ] Regras recorrentes versionadas: editar esta ocorrência, esta e as próximas ou toda a série; encerrar (fase 2; referencia 10)
- [ ] Competência da ocorrência pelo vencimento ou com deslocamento (fase 2; referencia 10)
- [ ] Renda principal e ciclo financeiro padrão para quem não tem renda principal (fase 2; referencia 10, 15)
- [ ] Vencimento efetivo dos compromissos em dia útil bancário (fins de semana, feriados nacionais e segunda e terça de Carnaval; D-031) (fase 2; referencia 8.9, 10)
- [ ] Pagamento e recebimento vinculados: quitação total ou parcial, vários compromissos numa só transação, juros e multa em partida separada (fase 2; referencia 10)
- [ ] Quitação automática e perguntas ao usuário (parcial, quitar com diferença, juros ou multa, valor real maior, adiantamento) (fase 2; referencia 10)
- [ ] Situação e prazo calculados ("Parcial · vencido") (fase 2; referencia 10)
- [ ] Cancelar compromisso (fase 2; referencia 10)
- [ ] Meio de pagamento por item (conta ou cartão) (fase 2; referencia 10)
- [ ] Lembretes ligados a pessoas (fase 2; referencia 10)
- [ ] Calendário financeiro mensal com compromissos, faturas e lançamentos agendados (fase 2; referencia 22)
- [ ] Assinaturas: marca na regra recorrente e cálculo do total mensal e do total anual (fase 2; referencia 10, 25)
- [ ] Relatório de assinaturas (25.6) (fase 4; referencia 25)
- [ ] Compromisso coberto por provisão, que já nasce vinculado (fase 4; referencia 14)
### 4.7 Pessoas

- [ ] Cadastro de pessoa (apelido) com uma única conta de saldo (fase 1; referencia 7)
- [ ] Despesa dividida com pessoa, com os centavos repartidos por dividir() (fase 1; referencia 7, 8)
- [ ] Empréstimo para uma pessoa e de uma pessoa; recebimento e pagamento (fase 1; referencia 7)
- [ ] Saldo e extrato por pessoa (fase 1; referencia 7)
- [ ] Lembrete com data na Agenda (fase 2; referencia 10)
- [ ] Valores a pagar a pessoas no Comprometido; valores a receber só no cenário esperado (fase 2; referencia 15)
### 4.8 Planejamento

- [ ] Livre para gastar, versão inicial: Saldo em contas, entradas previstas, Comprometido e reserva mínima de segurança (configuração simples, com padrão zero), ainda sem orçamentos, metas e provisões (15.17.3) (fase 2; referencia 15)
- [ ] Cenários conservador e esperado; Livre negativo com a mensagem de cobertura (fase 2; referencia 15, 16)
- [ ] Previsão de saldo com horizonte escolhido pelo usuário (fase 2; referencia 16)
- [ ] Indicador de parcelas futuras, com o percentual da renda recorrente média, calculada desde esta fase (fase 2; referencia 15, 18)
- [ ] Orçamentos de consumo por categoria e mês, com marca essencial (fase 4; referencia 13)
- [ ] Necessidade dos essenciais, abatida pelo VR/VA (fase 4; referencia 15)
- [ ] Metas (reserva virtual em conta caixa ou caixinha como conta de investimento) (fase 4; referencia 14)
- [ ] Provisões com aporte calculado e pagamento em cotas (fase 4; referencia 14)
- [ ] Vínculo de lançamentos e compromissos a metas e provisões (fase 4; referencia 14)
- [ ] Livre para gastar completo (fase 4; referencia 15)
- [ ] Orçamento de fluxo mensal: tipo previsto no modelo de dados (fase 4; referencia 13)
- [ ] Orçamento de fluxo mensal: interface (fase sem fase; referencia 5.3)
### 4.9 Patrimônio

- [ ] Passivo genérico de empréstimo ou financiamento, sem cronograma (fase 1; referencia 17)
- [ ] Empréstimos e financiamentos com cronograma, com a parcela registrada de forma detalhada ou simplificada (fase 5; referencia 17)
- [ ] Compra financiada (bem ou despesa) (fase 5; referencia 17)
- [ ] Investimentos: valorização, rendimento, resgate com impostos e Resultado de investimentos (fase 5; referencia 17)
- [ ] Bens com valor atualizado (fase 5; referencia 17)
- [ ] Patrimônio líquido e sua evolução, dividida em receitas − despesas, resultado de investimentos, aberturas e ajustes (fase 5; referencia 17)
- [ ] Aviso, no fechamento, de investimentos e bens sem valor informado no último dia do mês (fase 5; referencia 20)
### 4.10 Relatórios e Saúde Financeira

- [ ] Extrato por conta, por fatura e por categoria (fase 1; referencia 25)
- [ ] Consumo por categoria, por competência, com visão alternativa por parcela (fase 4; referencia 12, 25)
- [ ] Receitas por categoria (fase 4; referencia 25)
- [ ] Fluxo de caixa por data (operacional, dívidas, investimentos e bens, pessoas; benefícios em seção própria) (fase 4; referencia 12)
- [ ] Rateio do pagamento da fatura por categoria (fase 4; referencia 12)
- [ ] Linha "De meses anteriores" (fase 4; referencia 12, 20)
- [ ] Comparação com o mês anterior, por categoria (fase 4; referencia 25)
- [ ] Despesas dedutíveis no IR, por ano (fase 4; referencia 25)
- [ ] Saúde Financeira: custo médio mensal, renda e renda recorrente, taxa de poupança, fixas × variáveis × parcelas e dívidas, comprometimento da renda, reserva de emergência em meses, parcelas comprometidas nos próximos 6 meses e custo de crédito (fase 4; referencia 18)
- [ ] Insights automáticos (por exemplo, "delivery aumentou 37%") (fase 6; referencia 5.2)
### 4.11 Importação e conciliação

- [ ] Conciliação por saldo (saldo informado do extrato × saldo do aplicativo; conta divergente) (fase 2; referencia 19)
- [ ] Importação de OFX e CSV em lotes, com hash, desfazer lote e mapeamento de colunas do CSV salvo por conta (fase 3; referencia 19)
- [ ] Deduplicação (FITID, campos estáveis, ordem entre linhas idênticas) (fase 3; referencia 19)
- [ ] Conciliação por nível de confiança com lançamentos, compromissos da Agenda e parcelas programadas (fase 3; referencia 19)
- [ ] Linhas pendentes e pré-autorizações fora do Ledger; revisão de linhas que somem entre importações (fase 3; referencia 19)
- [ ] Cadastro, contra Abertura, de compra parcelada anterior ao uso do aplicativo, a partir de uma parcela importada (fase 3; referencia 19)
- [ ] Open Finance (leitura de dados das instituições) (fase 6; referencia 5.2)
### 4.12 Notificações

- [ ] Alerta de saldo negativo em conta (N-20: cheque especial em conta caixa; erro de registro em benefício, investimento ou bem), exibido como aviso na tela (Início e detalhe da conta) e calculado na hora (fase 1; referencia 7, 23, 26)
- [ ] Central de notificações no aplicativo e preferências por tipo de notificação (fase 2; referencia 26)
- [ ] Notificação push pelo PWA, quando o aparelho permitir (fase 2; referencia 26)
- [ ] Alerta de saldo negativo em conta (N-20) também na Central e por push (fase 2; referencia 26)
- [ ] Vencimentos: item da Agenda vence amanhã (inclusive fatura), item vencido, fatura fecha hoje (fase 2; referencia 26)
- [ ] "Você recebeu seu salário?" na data da renda principal (fase 2; referencia 26)
- [ ] Lançamento agendado chegou à data: "confirme no extrato" (fase 2; referencia 26)
- [ ] Conta divergente na conciliação por saldo (fase 2; referencia 26)
- [ ] Possível correspondência encontrada; linha em revisão; itens não enviados da fila (fase 3; referencia 26)
- [ ] Orçamento em 80%, 90% e 100% (fase 4; referencia 26)
- [ ] Gasto acima do mês anterior (fase 4; referencia 26)
- [ ] Meta atingiu 50%, 75% e 100% (limiares editáveis); provisão atrasada; reserva descoberta (fase 4; referencia 26)
- [ ] Fim de garantia próximo (fase 6; referencia 5.2)
### 4.13 Documentos, anexos e garantias

- [ ] Anexos (comprovante, nota fiscal, boleto, contrato) em lançamentos, compromissos e bens (fase 6; referencia 5.2)
- [ ] Garantias: nota, data da compra e fim da garantia, ligadas à compra (fase 6; referencia 5.2)
- [ ] Comprovantes de despesas dedutíveis no IR (fase 6; referencia 5.2)
### 4.14 Busca

- [ ] Busca global básica: campo único, com resultados em lançamentos, itens da Agenda (a partir da Fase 2), contas, cartões, categorias, pessoas e tags, e filtros por texto, valor, período, conta, categoria e tag (fase 1; referencia 22)
- [ ] Busca avançada: combinações salvas, busca em anexos e operadores (fase 6; referencia 5.2)
### 4.15 Configurações

- [ ] Autenticação: cadastro, entrada, saída e troca de senha (fase 1; referencia 35)
- [ ] Espaço: nome e fuso horário (padrão America/Sao_Paulo), com moeda-base BRL fixa (fase 1; referencia 29)
- [ ] Categorias: hierarquia, ícone, cor, essencial, fixa ou variável, dedutível no IR; transformar folha em pai (fase 1; referencia 7)
- [ ] Gestão de tags (fase 1; referencia 7)
- [ ] Tema claro e escuro; preferências de acessibilidade (fase 1; referencia 28)
- [ ] Exportação dos dados do espaço em CSV (fase 1; referencia 35)
- [ ] Reserva mínima de segurança (fase 2; referencia 15)
- [ ] Feriados locais do espaço (Corpus Christi, estaduais e municipais; tipo `local`, D-031), considerados no vencimento efetivo (fase 2; referencia 8.9, 22)
- [ ] Aviso de itens não enviados ao sair da conta (fase 3; referencia 27)
- [ ] Exclusão da conta do usuário, com exportação oferecida antes e pseudonimização (fase 6; referencia 35)
### 4.16 Auditoria

- [ ] Registro de auditoria de toda criação, edição, cancelamento, conciliação e reabertura (antes, depois, usuário, data e hora em UTC, motivo quando exigido) (fase 1; referencia 20)
- [ ] Histórico de versões de cada lançamento (fase 1; referencia 20)
- [ ] Consulta da auditoria do espaço por período, usuário e registro (fase 1; referencia 20)
- [ ] Fechamento mensal, com aviso de itens da Agenda ainda abertos com competência no mês (fase 4; referencia 20)
- [ ] Reabertura de mês com motivo (fase 4; referencia 20)
- [ ] Retrato mensal, provisório enquanto o mês está aberto e gravado como versão a cada fechamento, com as versões anteriores preservadas (fase 4; referencia 17, 20)
### 4.17 Espaços compartilhados

- [ ] Mais de um espaço por usuário e troca do espaço ativo (fase 1; referencia 29)
- [ ] Mover um lançamento para outro espaço (cancelar e recriar) (fase 1; referencia 29)
- [ ] Convites e membros; papéis de proprietário, administrador, membro e somente leitura (fase 6; referencia 29)
- [ ] Regra de divisão do espaço e acerto entre membros (fase 6; referencia 29)
- [ ] Transferência entre espaços (repasse e aporte ligados) (fase 6; referencia 29)
- [ ] Despesa do espaço paga com dinheiro pessoal (fase 6; referencia 29)
- [ ] Saída de membro (conta de ex-membro, revogação imediata do acesso e da fila offline) (fase 6; referencia 29)
