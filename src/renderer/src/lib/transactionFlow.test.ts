import { describe, expect, it } from 'vitest'
import { transactionFlow } from './transactionFlow'

const account = (amount_cents: number, owner_type = 'financial_account') => ({ amount_cents, owner_type, account_name: 'Banco', account_class: 'asset' })

describe('transactionFlow', () => {
  it('identifies money received in a settlement or opening balance', () => {
    expect(transactionFlow([account(10000), account(-10000, 'person')])).toBe('Entrada')
    expect(transactionFlow([account(10000), account(-10000, 'system')])).toBe('Entrada')
  })
  it('identifies money paid regardless of the transaction kind', () => {
    expect(transactionFlow([account(-2500), account(2500, 'person')])).toBe('Saída')
    expect(transactionFlow([account(-2500), account(2500, 'credit_card')])).toBe('Saída')
  })
  it('keeps both directions for a transfer between accounts', () => {
    expect(transactionFlow([account(-5000), account(5000)])).toBe('Transferência')
  })
  it('does not imply a bank movement for card purchases or missing data', () => {
    expect(transactionFlow([account(-2000, 'credit_card'), account(2000, 'category')])).toBeNull()
    expect(transactionFlow([])).toBeNull()
  })
})
