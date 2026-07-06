import { create } from 'zustand'
import type {
  AccountWithBalance,
  Bill,
  BudgetView,
  Category,
  CreditCardWithFatura,
  Goal,
  NewAccount,
  NewBill,
  NewCategory,
  NewCreditCard,
  NewGoal,
  NewInstallmentPurchase,
  NewTransaction,
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

  loadAll: () => Promise<void>

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

  loadBudgets: (mesAno: string) => Promise<void>
  setBudget: (categoriaId: number, mesAno: string, valorPlanejado: number) => Promise<void>
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

  loadAll: async () => {
    set({ loading: true })
    const [accounts, categories, transactions, creditCards, bills, goals] = await Promise.all([
      window.api.accounts.list(),
      window.api.categories.list(),
      window.api.transactions.list(),
      window.api.creditCards.list(),
      window.api.bills.list(),
      window.api.goals.list()
    ])
    set({ accounts, categories, transactions, creditCards, bills, goals, loading: false })
  },

  addAccount: async (data) => {
    await window.api.accounts.create(data)
    await get().loadAll()
  },
  removeAccount: async (id) => {
    await window.api.accounts.delete(id)
    await get().loadAll()
  },

  addCategory: async (data) => {
    await window.api.categories.create(data)
    await get().loadAll()
  },
  removeCategory: async (id) => {
    await window.api.categories.delete(id)
    await get().loadAll()
  },

  addTransaction: async (data) => {
    await window.api.transactions.create(data)
    await get().loadAll()
  },
  removeTransaction: async (id) => {
    await window.api.transactions.delete(id)
    await get().loadAll()
  },
  addInstallmentPurchase: async (data) => {
    await window.api.transactions.createInstallments(data)
    await get().loadAll()
  },

  addCreditCard: async (data) => {
    await window.api.creditCards.create(data)
    await get().loadAll()
  },
  removeCreditCard: async (id) => {
    await window.api.creditCards.delete(id)
    await get().loadAll()
  },

  addBill: async (data) => {
    await window.api.bills.create(data)
    await get().loadAll()
  },
  updateBill: async (id, data) => {
    await window.api.bills.update(id, data)
    await get().loadAll()
  },
  removeBill: async (id) => {
    await window.api.bills.delete(id)
    await get().loadAll()
  },

  addGoal: async (data) => {
    await window.api.goals.create(data)
    await get().loadAll()
  },
  updateGoal: async (id, data) => {
    await window.api.goals.update(id, data)
    await get().loadAll()
  },
  removeGoal: async (id) => {
    await window.api.goals.delete(id)
    await get().loadAll()
  },

  loadBudgets: async (mesAno) => {
    const budgets = await window.api.budgets.list(mesAno)
    set({ budgets, budgetMonth: mesAno })
  },
  setBudget: async (categoriaId, mesAno, valorPlanejado) => {
    await window.api.budgets.set(categoriaId, mesAno, valorPlanejado)
    await get().loadBudgets(mesAno)
  }
}))
