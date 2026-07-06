import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency } from '../lib/format'
import type { AccountType } from '../../../shared/types'

const tipoLabels: Record<AccountType, string> = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  carteira: 'Carteira',
  investimento: 'Investimento'
}

export default function Accounts() {
  const accounts = useAppStore((s) => s.accounts)
  const addAccount = useAppStore((s) => s.addAccount)
  const removeAccount = useAppStore((s) => s.removeAccount)

  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<AccountType>('corrente')
  const [saldoInicial, setSaldoInicial] = useState('0')
  const [cor, setCor] = useState('#0ea5e9')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return
    setSubmitting(true)
    try {
      await addAccount({ nome: nome.trim(), tipo, saldo_inicial: Number(saldoInicial) || 0, cor })
      setNome('')
      setSaldoInicial('0')
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
          <label className="text-xs text-slate-500">Nome</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            placeholder="Ex: Nubank"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Tipo</label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as AccountType)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            {Object.entries(tipoLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Saldo inicial</label>
          <input
            type="number"
            step="0.01"
            value={saldoInicial}
            onChange={(e) => setSaldoInicial(e.target.value)}
            className="w-32 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Cor</label>
          <input
            type="color"
            value={cor}
            onChange={(e) => setCor(e.target.value)}
            className="h-9 w-12 rounded-md border border-slate-300 dark:border-slate-700"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          Adicionar conta
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Conta</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2 text-right">Saldo atual</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {accounts.map((a) => (
              <tr key={a.id}>
                <td className="flex items-center gap-2 px-4 py-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: a.cor }} />
                  {a.nome}
                </td>
                <td className="px-4 py-2 text-slate-500">{tipoLabels[a.tipo]}</td>
                <td className="px-4 py-2 text-right font-medium">{formatCurrency(a.saldo_atual)}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => removeAccount(a.id)} className="text-xs text-red-500 hover:underline">
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma conta cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
