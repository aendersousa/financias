import type { LedgerTransactionEntry } from './ledgerRepository'

export function transactionFlow(entries: LedgerTransactionEntry[]): 'Entrada' | 'Saída' | 'Transferência' | null {
  const accounts = entries.filter(entry => entry.owner_type === 'financial_account')
  const incoming = accounts.some(entry => entry.amount_cents > 0)
  const outgoing = accounts.some(entry => entry.amount_cents < 0)
  if (incoming && outgoing) return 'Transferência'
  if (incoming) return 'Entrada'
  if (outgoing) return 'Saída'
  return null
}
