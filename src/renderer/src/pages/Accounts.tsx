import { useState } from 'react'
import { Wallet } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency } from '../lib/format'
import PageHeader from '../components/PageHeader'
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
      <PageHeader icon={Wallet} title="Contas" subtitle="Suas contas bancárias, carteiras e investimentos" />

      <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Nome</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="field-input"
            placeholder="Ex: Nubank"
            required
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as AccountType)} className="field-input">
            {Object.entries(tipoLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Saldo inicial</label>
          <input
            type="number"
            step="0.01"
            value={saldoInicial}
            onChange={(e) => setSaldoInicial(e.target.value)}
            className="field-input w-full sm:w-32"
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Cor</label>
          <input
            type="color"
            value={cor}
            onChange={(e) => setCor(e.target.value)}
            className="h-9 w-12 rounded-lg border border-slate-300 dark:border-slate-700"
          />
        </div>
        <button type="submit" disabled={submitting} className="btn-primary">
          Adicionar conta
        </button>
      </form>

      <div className="table-shell">
        <table className="w-full text-sm sm:min-w-[640px]">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-2.5">Conta</th>
              <th className="hidden px-4 py-2.5 sm:table-cell">Tipo</th>
              <th className="px-4 py-2.5 text-right">Saldo atual</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {accounts.map((a) => (
              <tr key={a.id} className="table-row-hover">
                <td className="flex items-center gap-2 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.cor }} />
                  {a.nome}
                </td>
                <td className="hidden px-4 py-2.5 text-slate-500 sm:table-cell">{tipoLabels[a.tipo]}</td>
                <td className="px-4 py-2.5 text-right font-medium">{formatCurrency(a.saldo_atual)}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => removeAccount(a.id)} className="btn-danger-text">
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
