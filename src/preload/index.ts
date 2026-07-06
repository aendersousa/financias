import { contextBridge, ipcRenderer } from 'electron'
import type {
  Account,
  AccountWithBalance,
  Bill,
  BudgetView,
  Category,
  CreditCardWithFatura,
  Goal,
  MonthlySummary,
  NewAccount,
  NewBill,
  NewCategory,
  NewCreditCard,
  NewGoal,
  NewInstallmentPurchase,
  NewTransaction,
  Transaction,
  TransactionView
} from '../shared/types'

const api = {
  accounts: {
    list: (): Promise<AccountWithBalance[]> => ipcRenderer.invoke('accounts:list'),
    create: (data: NewAccount): Promise<Account> => ipcRenderer.invoke('accounts:create', data),
    update: (id: number, data: Partial<NewAccount>): Promise<Account> =>
      ipcRenderer.invoke('accounts:update', id, data),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('accounts:delete', id)
  },
  categories: {
    list: (): Promise<Category[]> => ipcRenderer.invoke('categories:list'),
    create: (data: NewCategory): Promise<Category> => ipcRenderer.invoke('categories:create', data),
    update: (id: number, data: Partial<NewCategory>): Promise<Category> =>
      ipcRenderer.invoke('categories:update', id, data),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('categories:delete', id)
  },
  transactions: {
    list: (): Promise<TransactionView[]> => ipcRenderer.invoke('transactions:list'),
    create: (data: NewTransaction): Promise<Transaction> => ipcRenderer.invoke('transactions:create', data),
    update: (id: number, data: Partial<NewTransaction>): Promise<Transaction> =>
      ipcRenderer.invoke('transactions:update', id, data),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('transactions:delete', id),
    createInstallments: (data: NewInstallmentPurchase): Promise<Transaction[]> =>
      ipcRenderer.invoke('transactions:createInstallments', data)
  },
  creditCards: {
    list: (): Promise<CreditCardWithFatura[]> => ipcRenderer.invoke('creditCards:list'),
    create: (data: NewCreditCard): Promise<CreditCardWithFatura> => ipcRenderer.invoke('creditCards:create', data),
    update: (id: number, data: Partial<NewCreditCard>): Promise<CreditCardWithFatura> =>
      ipcRenderer.invoke('creditCards:update', id, data),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('creditCards:delete', id)
  },
  bills: {
    list: (): Promise<Bill[]> => ipcRenderer.invoke('bills:list'),
    create: (data: NewBill): Promise<Bill> => ipcRenderer.invoke('bills:create', data),
    update: (id: number, data: Partial<NewBill>): Promise<Bill> => ipcRenderer.invoke('bills:update', id, data),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('bills:delete', id)
  },
  budgets: {
    list: (mesAno: string): Promise<BudgetView[]> => ipcRenderer.invoke('budgets:list', mesAno),
    set: (categoriaId: number, mesAno: string, valorPlanejado: number): Promise<void> =>
      ipcRenderer.invoke('budgets:set', categoriaId, mesAno, valorPlanejado)
  },
  goals: {
    list: (): Promise<Goal[]> => ipcRenderer.invoke('goals:list'),
    create: (data: NewGoal): Promise<Goal> => ipcRenderer.invoke('goals:create', data),
    update: (id: number, data: Partial<NewGoal>): Promise<Goal> => ipcRenderer.invoke('goals:update', id, data),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('goals:delete', id)
  },
  reports: {
    monthlySummary: (months: number): Promise<MonthlySummary[]> =>
      ipcRenderer.invoke('reports:monthlySummary', months)
  },
  exportData: {
    transactionsCsv: (): Promise<{ canceled: boolean; path?: string }> =>
      ipcRenderer.invoke('export:transactionsCsv')
  },
  backup: {
    create: (): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke('backup:create')
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
