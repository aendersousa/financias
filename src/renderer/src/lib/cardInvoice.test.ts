import {describe,it,expect} from 'vitest'
import {nextCardInvoice} from './cardInvoice'
describe('nextCardInvoice',()=>{
  it('shows an unpaid closed invoice before the open invoice and excludes future installments',()=>{
    const closed={status:'closed',remaining_cents:6700,effective_due_on:'2026-10-10'}
    expect(nextCardInvoice([{status:'future',remaining_cents:20000,effective_due_on:'2026-12-10'},{status:'open',remaining_cents:5000,effective_due_on:'2026-11-10'},closed])).toBe(closed)
  })
  it('moves to the open invoice after the earlier invoice is paid',()=>{
    expect(nextCardInvoice([{status:'closed',remaining_cents:0,effective_due_on:'2026-10-10'},{status:'open',remaining_cents:5000,effective_due_on:'2026-11-10'}])?.remaining_cents).toBe(5000)
  })
  it('does not present future installments as a current invoice',()=>{
    expect(nextCardInvoice([{status:'future',remaining_cents:5000,effective_due_on:'2026-11-10'}])).toBeUndefined()
  })
})
