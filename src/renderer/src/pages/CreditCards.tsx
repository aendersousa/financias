import { useState } from 'react'
import { CreditCard as CreditCardIcon } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency } from '../lib/format'
import PageHeader from '../components/PageHeader'

export default function CreditCards() {
  const creditCards = useAppStore((s) => s.creditCards)
  const accounts = useAppStore((s) => s.accounts)
  const addCreditCard = useAppStore((s) => s.addCreditCard)
  const removeCreditCard = useAppStore((s) => s.removeCreditCard)

  const [nome, setNome] = useState('')
  const [limite, setLimite] = useState('')
  const [diaFechamento, setDiaFechamento] = useState('1')
  const [diaVencimento, setDiaVencimento] = useState('10')
  const [contaPagamentoId, setContaPagamentoId] = useState<number | ''>('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return
    setSubmitting(true)
    try {
      await addCreditCard({
        nome: nome.trim(),
        limite: Number(limite) || 0,
        dia_fechamento: Number(diaFechamento),
        dia_vencimento: Number(diaVencimento),
        conta_pagamento_id: contaPagamentoId ? Number(contaPagamentoId) : null
      })
      setNome('')
      setLimite('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={CreditCardIcon} title="Cartões" subtitle="Cartões de crédito e faturas" />

      <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Nome do cartão</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="field-input"
            placeholder="Ex: Nubank Mastercard"
            required
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Limite</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            className="field-input w-full sm:w-28"
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Dia fechamento</label>
          <input
            type="number"
            min="1"
            max="31"
            value={diaFechamento}
            onChange={(e) => setDiaFechamento(e.target.value)}
            className="field-input w-full sm:w-24"
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Dia vencimento</label>
          <input
            type="number"
            min="1"
            max="31"
            value={diaVencimento}
            onChange={(e) => setDiaVencimento(e.target.value)}
            className="field-input w-full sm:w-24"
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Conta de pagamento</label>
          <select
            value={contaPagamentoId}
            onChange={(e) => setContaPagamentoId(e.target.value ? Number(e.target.value) : '')}
            className="field-input"
          >
            <option value="">Nenhuma</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={submitting} className="btn-primary">
          Adicionar cartão
        </button>
      </form>

      <div className="table-shell">
        <table className="w-full text-sm sm:min-w-[720px]">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2.5">Cartão</th>
              <th className="px-4 py-2.5 text-right">Limite</th>
              <th className="px-4 py-2.5 text-right">Fatura atual</th>
              <th className="hidden px-4 py-2.5 md:table-cell">Fechamento</th>
              <th className="hidden px-4 py-2.5 md:table-cell">Vencimento</th>
              <th className="hidden px-4 py-2.5 md:table-cell">Conta de pagamento</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {creditCards.map((c) => (
              <tr key={c.id} className="table-row-hover">
                <td className="px-4 py-2.5">{c.nome}</td>
                <td className="px-4 py-2.5 text-right font-medium">{formatCurrency(c.limite)}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className={c.fatura_atual > c.limite ? 'font-medium text-red-500' : 'font-medium'}>
                    {formatCurrency(c.fatura_atual)}
                  </span>
                  <p className="text-xs text-slate-400">
                    {c.fatura_inicio} a {c.fatura_fim}
                  </p>
                </td>
                <td className="hidden px-4 py-2.5 text-slate-500 md:table-cell">Dia {c.dia_fechamento}</td>
                <td className="hidden px-4 py-2.5 text-slate-500 md:table-cell">Dia {c.dia_vencimento}</td>
                <td className="hidden px-4 py-2.5 text-slate-500 md:table-cell">
                  {accounts.find((a) => a.id === c.conta_pagamento_id)?.nome ?? '-'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => removeCreditCard(c.id)} className="btn-danger-text">
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {creditCards.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Nenhum cartão cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
