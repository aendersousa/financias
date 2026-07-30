import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import {
  computeAccountsWithBalance,
  computeBudgetView,
  computeCreditCardsWithFatura,
  computeTransactionsView
} from '../lib/computations'
import { applyTheme, getInitialTheme, type Theme } from '../lib/theme'
import type {
  Account,
  AccountWithBalance,
  Bill,
  Budget,
  BudgetView,
  Category,
  CreditCard,
  CreditCardWithFatura,
  Goal,
  NewAccount,
  NewBill,
  NewCategory,
  NewCreditCard,
  NewGoal,
  NewInstallmentPurchase,
  NewTransaction,
  Transaction,
  TransactionView
} from '../../../shared/types'

interface AppState {
  accounts: AccountWithBalance[]
  categories: Category[]
  transactions: TransactionView[]
  creditCards: CreditCardWithFatura[]
  bills: Bill[]
  goals: Goal[]
  budgets: BudgetView[]
  budgetMonth: string
  loading: boolean
  theme: Theme

  loadAll: () => Promise<void>
  reset: () => void
  toggleTheme: () => void

  addAccount: (data: NewAccount) => Promise<void>
  removeAccount: (id: number) => Promise<void>

  addCategory: (data: NewCategory) => Promise<void>
  removeCategory: (id: number) => Promise<void>

  addTransaction: (data: NewTransaction) => Promise<void>
  removeTransaction: (id: number) => Promise<void>
  addInstallmentPurchase: (data: NewInstallmentPurchase) => Promise<void>

  addCreditCard: (data: NewCreditCard) => Promise<void>
  removeCreditCard: (id: number) => Promise<void>

  addBill: (data: NewBill) => Promise<void>
  updateBill: (id: number, data: Partial<NewBill>) => Promise<void>
  removeBill: (id: number) => Promise<void>

  addGoal: (data: NewGoal) => Promise<void>
  updateGoal: (id: number, data: Partial<NewGoal>) => Promise<void>
  removeGoal: (id: number) => Promise<void>

  loadBudgets: (mesAno: string) => void
  setBudget: (categoriaId: number, mesAno: string, valorPlanejado: number) => Promise<void>
}

interface RawState {
  rawAccounts: Account[]
  rawCategories: Category[]
  rawTransactions: Transaction[]
  rawCreditCards: CreditCard[]
  rawBudgets: Budget[]
}

const initialRaw: RawState = {
  rawAccounts: [],
  rawCategories: [],
  rawTransactions: [],
  rawCreditCards: [],
  rawBudgets: []
}

let raw: RawState = { ...initialRaw }

function throwIfError<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message)
  return data as T
}

export const useAppStore = create<AppState>((set, get) => ({
  accounts: [],
  categories: [],
  transactions: [],
  creditCards: [],
  bills: [],
  goals: [],
  budgets: [],
  budgetMonth: new Date().toISOString().slice(0, 7),
  loading: false,
  theme: getInitialTheme(),

  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    set({ theme: next })
  },

  reset: () => {
    raw = { ...initialRaw }
    set({
      accounts: [],
      categories: [],
      transactions: [],
      creditCards: [],
      bills: [],
      goals: [],
      budgets: []
    })
  },

  loadAll: async () => {
    set({ loading: true })
    const [accountsRes, categoriesRes, transactionsRes, creditCardsRes, billsRes, goalsRes, budgetsRes] =
      await Promise.all([
        supabase.from('accounts').select('*'),
        supabase.from('categories').select('*'),
        supabase.from('transactions').select('*'),
        supabase.from('credit_cards').select('*'),
        supabase.from('bills').select('*'),
        supabase.from('goals').select('*'),
        supabase.from('budgets').select('*')
      ])

    raw = {
      rawAccounts: throwIfError<Account[]>(accountsRes),
      rawCategories: throwIfError<Category[]>(categoriesRes),
      rawTransactions: throwIfError<Transaction[]>(transactionsRes),
      rawCreditCards: throwIfError<CreditCard[]>(creditCardsRes),
      rawBudgets: throwIfError<Budget[]>(budgetsRes)
    }
    const bills = throwIfError<Bill[]>(billsRes)
    const goals = throwIfError<Goal[]>(goalsRes)

    set({
      accounts: computeAccountsWithBalance(raw.rawAccounts, raw.rawTransactions),
      categories: raw.rawCategories,
      transactions: computeTransactionsView(raw.rawTransactions, raw.rawAccounts, raw.rawCategories, raw.rawCreditCards),
      creditCards: computeCreditCardsWithFatura(raw.rawCreditCards, raw.rawTransactions),
      bills,
      goals,
      loading: false
    })
    get().loadBudgets(get().budgetMonth)
  },

  addAccount: async (data) => {
    throwIfError(await supabase.from('accounts').insert(data))
    await get().loadAll()
  },
  removeAccount: async (id) => {
    throwIfError(await supabase.from('accounts').delete().eq('id', id))
    await get().loadAll()
  },

  addCategory: async (data) => {
    throwIfError(await supabase.from('categories').insert(data))
    await get().loadAll()
  },
  removeCategory: async (id) => {
    throwIfError(await supabase.from('categories').delete().eq('id', id))
    await get().loadAll()
  },

  addTransaction: async (data) => {
    throwIfError(await supabase.from('transactions').insert(data))
    await get().loadAll()
  },
  removeTransaction: async (id) => {
    throwIfError(await supabase.from('transactions').delete().eq('id', id))
    await get().loadAll()
  },
  addInstallmentPurchase: async (data) => {
    throwIfError(
      await supabase.rpc('create_installment_purchase', {
        p_account_id: data.account_id,
        p_category_id: data.category_id,
        p_cartao_id: data.cartao_id,
        p_valor_total: data.valor_total,
        p_parcelas: data.parcelas,
        p_data: data.data,
        p_descricao: data.descricao,
        p_status: data.status
      })
    )
    await get().loadAll()
  },

  addCreditCard: async (data) => {
    throwIfError(await supabase.from('credit_cards').insert(data))
    await get().loadAll()
  },
  removeCreditCard: async (id) => {
    throwIfError(await supabase.from('credit_cards').delete().eq('id', id))
    await get().loadAll()
  },

  addBill: async (data) => {
    throwIfError(await supabase.from('bills').insert(data))
    await get().loadAll()
  },
  updateBill: async (id, data) => {
    throwIfError(await supabase.from('bills').update(data).eq('id', id))
    await get().loadAll()
  },
  removeBill: async (id) => {
    throwIfError(await supabase.from('bills').delete().eq('id', id))
    await get().loadAll()
  },

  addGoal: async (data) => {
    throwIfError(await supabase.from('goals').insert(data))
    await get().loadAll()
  },
  updateGoal: async (id, data) => {
    throwIfError(await supabase.from('goals').update(data).eq('id', id))
    await get().loadAll()
  },
  removeGoal: async (id) => {
    throwIfError(await supabase.from('goals').delete().eq('id', id))
    await get().loadAll()
  },

  loadBudgets: (mesAno) => {
    set({
      budgets: computeBudgetView(raw.rawCategories, raw.rawBudgets, raw.rawTransactions, mesAno),
      budgetMonth: mesAno
    })
  },
  setBudget: async (categoriaId, mesAno, valorPlanejado) => {
    throwIfError(
      await supabase
        .from('budgets')
        .upsert(
          { categoria_id: categoriaId, mes_ano: mesAno, valor_planejado: valorPlanejado },
          { onConflict: 'user_id,categoria_id,mes_ano' }
        )
    )
    await get().loadAll()
  }
}))

applyTheme(useAppStore.getState().theme)
