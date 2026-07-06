import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency } from '../lib/format'

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
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Nome do cartão</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            placeholder="Ex: Nubank Mastercard"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Limite</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            className="w-28 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Dia fechamento</label>
          <input
            type="number"
            min="1"
            max="31"
            value={diaFechamento}
            onChange={(e) => setDiaFechamento(e.target.value)}
            className="w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Dia vencimento</label>
          <input
            type="number"
            min="1"
            max="31"
            value={diaVencimento}
            onChange={(e) => setDiaVencimento(e.target.value)}
            className="w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Conta de pagamento</label>
          <select
            value={contaPagamentoId}
            onChange={(e) => setContaPagamentoId(e.target.value ? Number(e.target.value) : '')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="">Nenhuma</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          Adicionar cartão
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Cartão</th>
              <th className="px-4 py-2 text-right">Limite</th>
              <th className="px-4 py-2 text-right">Fatura atual</th>
              <th className="px-4 py-2">Fechamento</th>
              <th className="px-4 py-2">Vencimento</th>
              <th className="px-4 py-2">Conta de pagamento</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {creditCards.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2">{c.nome}</td>
                <td className="px-4 py-2 text-right font-medium">{formatCurrency(c.limite)}</td>
                <td className="px-4 py-2 text-right">
                  <span className={c.fatura_atual > c.limite ? 'font-medium text-red-500' : 'font-medium'}>
                    {formatCurrency(c.fatura_atual)}
                  </span>
                  <p className="text-xs text-slate-400">
                    {c.fatura_inicio} a {c.fatura_fim}
                  </p>
                </td>
                <td className="px-4 py-2 text-slate-500">Dia {c.dia_fechamento}</td>
                <td className="px-4 py-2 text-slate-500">Dia {c.dia_vencimento}</td>
                <td className="px-4 py-2 text-slate-500">
                  {accounts.find((a) => a.id === c.conta_pagamento_id)?.nome ?? '-'}
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => removeCreditCard(c.id)} className="text-xs text-red-500 hover:underline">
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
