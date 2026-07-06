import { BrowserWindow, ipcMain } from 'electron'
import * as accounts from './db/repositories/accounts'
import * as categories from './db/repositories/categories'
import * as transactions from './db/repositories/transactions'
import * as creditCards from './db/repositories/credit_cards'
import * as bills from './db/repositories/bills'
import * as budgets from './db/repositories/budgets'
import * as goals from './db/repositories/goals'
import * as reports from './db/repositories/reports'
import { backupDatabase, exportTransactionsCsv } from './export'

export function registerIpcHandlers(): void {
  ipcMain.handle('accounts:list', () => accounts.listAccounts())
  ipcMain.handle('accounts:create', (_e, data) => accounts.createAccount(data))
  ipcMain.handle('accounts:update', (_e, id, data) => accounts.updateAccount(id, data))
  ipcMain.handle('accounts:delete', (_e, id) => accounts.deleteAccount(id))

  ipcMain.handle('categories:list', () => categories.listCategories())
  ipcMain.handle('categories:create', (_e, data) => categories.createCategory(data))
  ipcMain.handle('categories:update', (_e, id, data) => categories.updateCategory(id, data))
  ipcMain.handle('categories:delete', (_e, id) => categories.deleteCategory(id))

  ipcMain.handle('transactions:list', () => transactions.listTransactions())
  ipcMain.handle('transactions:create', (_e, data) => transactions.createTransaction(data))
  ipcMain.handle('transactions:update', (_e, id, data) => transactions.updateTransaction(id, data))
  ipcMain.handle('transactions:delete', (_e, id) => transactions.deleteTransaction(id))
  ipcMain.handle('transactions:createInstallments', (_e, data) => transactions.createInstallmentPurchase(data))

  ipcMain.handle('creditCards:list', () => creditCards.listCreditCards())
  ipcMain.handle('creditCards:create', (_e, data) => creditCards.createCreditCard(data))
  ipcMain.handle('creditCards:update', (_e, id, data) => creditCards.updateCreditCard(id, data))
  ipcMain.handle('creditCards:delete', (_e, id) => creditCards.deleteCreditCard(id))

  ipcMain.handle('bills:list', () => bills.listBills())
  ipcMain.handle('bills:create', (_e, data) => bills.createBill(data))
  ipcMain.handle('bills:update', (_e, id, data) => bills.updateBill(id, data))
  ipcMain.handle('bills:delete', (_e, id) => bills.deleteBill(id))

  ipcMain.handle('budgets:list', (_e, mesAno) => budgets.listBudgets(mesAno))
  ipcMain.handle('budgets:set', (_e, categoriaId, mesAno, valorPlanejado) =>
    budgets.setBudget(categoriaId, mesAno, valorPlanejado)
  )

  ipcMain.handle('goals:list', () => goals.listGoals())
  ipcMain.handle('goals:create', (_e, data) => goals.createGoal(data))
  ipcMain.handle('goals:update', (_e, id, data) => goals.updateGoal(id, data))
  ipcMain.handle('goals:delete', (_e, id) => goals.deleteGoal(id))

  ipcMain.handle('reports:monthlySummary', (_e, months) => reports.getMonthlySummary(months))

  ipcMain.handle('export:transactionsCsv', (e) => exportTransactionsCsv(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('backup:create', (e) => backupDatabase(BrowserWindow.fromWebContents(e.sender)))
}
