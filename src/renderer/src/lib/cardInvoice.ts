export interface InvoiceSummary { effective_due_on: string; status: string; remaining_cents: number }
export function nextCardInvoice(statements:InvoiceSummary[]):InvoiceSummary|undefined {
  const current=statements.filter(statement=>['open','closed'].includes(statement.status)).sort((a,b)=>a.effective_due_on.localeCompare(b.effective_due_on))
  return current.find(statement=>statement.remaining_cents>0)??current[0]
}
