export type AccountType = 'corrente' | 'poupanca' | 'carteira' | 'investimento'

export interface Account {
  id: number
  nome: string
  tipo: AccountType
  saldo_inicial: number
  cor: string
}

export interface AccountWithBalance extends Account {
  saldo_atual: number
}

export type NewAccount = Omit<Account, 'id'>

export type CategoryType = 'receita' | 'despesa'

export interface Category {
  id: number
  nome: string
  tipo: CategoryType
  cor: string
  icone: string | null
}

export type NewCategory = Omit<Category, 'id'>

export type TransactionStatus = 'pago' | 'pendente'

export interface Transaction {
  id: number
  account_id: number
  category_id: number
  tipo: CategoryType
  valor: number
  data: string
  descricao: string
  status: TransactionStatus
  cartao_id: number | null
}

export interface TransactionView extends Transaction {
  conta_nome: string
  categoria_nome: string
  cartao_nome: string | null
}

export type NewTransaction = Omit<Transaction, 'id'>

export interface CreditCard {
  id: number
  nome: string
  limite: number
  dia_fechamento: number
  dia_vencimento: number
  conta_pagamento_id: number | null
}

export type NewCreditCard = Omit<CreditCard, 'id'>

export interface CreditCardWithFatura extends CreditCard {
  fatura_atual: number
  fatura_inicio: string
  fatura_fim: string
}

export interface NewInstallmentPurchase {
  account_id: number
  category_id: number
  cartao_id: number
  valor_total: number
  parcelas: number
  data: string
  descricao: string
  status: TransactionStatus
}

export type BillType = 'pagar' | 'receber'
export type BillStatus = 'pendente' | 'pago'

export interface Bill {
  id: number
  descricao: string
  valor: number
  vencimento: string
  tipo: BillType
  status: BillStatus
  recorrencia: string | null
  conta_id: number | null
}

export type NewBill = Omit<Bill, 'id'>

export interface Budget {
  id: number
  categoria_id: number
  mes_ano: string
  valor_planejado: number
}

export type NewBudget = Omit<Budget, 'id'>

export interface BudgetView extends Budget {
  categoria_nome: string
  valor_realizado: number
}

export interface Goal {
  id: number
  nome: string
  valor_alvo: number
  valor_atual: number
  prazo: string | null
}

export type NewGoal = Omit<Goal, 'id'>

export interface MonthlySummary {
  mes: string
  receitas: number
  despesas: number
  saldo_acumulado: number
}
