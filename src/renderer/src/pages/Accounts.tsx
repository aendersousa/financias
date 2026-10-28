import { useCurrencyFormatter } from '../lib/useCurrencyFormatter'
import { useState } from 'react'
import { Wallet } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import PageHeader from '../components/PageHeader'
import AccountTable from '../components/AccountTable'
import ColorInput from '../components/ColorInput'
import CurrencyInput, { parseCurrencyToNumber } from '../components/CurrencyInput'
import type { AccountType } from '../../../shared/types'

const tipoLabels: Record<AccountType, string> = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  carteira: 'Carteira',
  investimento: 'Investimento'
}

export default function Accounts() {
  const formatCurrency = useCurrencyFormatter()
  const accounts = useAppStore((s) => s.accounts)
  const addAccount = useAppStore((s) => s.addAccount)
  const removeAccount = useAppStore((s) => s.removeAccount)

  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<AccountType>('corrente')
  const [saldoInicial, setSaldoInicial] = useState('0,00')
  const [cor, setCor] = useState('#0ea5e9')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return
    setSubmitting(true)
    try {
      await addAccount({ nome: nome.trim(), tipo, saldo_inicial: parseCurrencyToNumber(saldoInicial), cor })
      setNome('')
      setSaldoInicial('0,00')
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
          <CurrencyInput
            value={saldoInicial}
            onChange={(e) => setSaldoInicial(e.target.value)}
            className="w-full sm:w-36"
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Cor</label>
          <ColorInput
            value={cor}
            onChange={setCor}
            disabled={submitting}
          />
        </div>
        <button type="submit" disabled={submitting} className="btn-primary">
          Adicionar conta
        </button>
      </form>

      <AccountTable
        accounts={accounts.map(account => ({ id: account.id, name: account.nome, type: tipoLabels[account.tipo], color: account.cor, balance: formatCurrency(account.saldo_atual) }))}
        renderActions={account => <button onClick={() => removeAccount(account.id)} className="btn-danger-text">Excluir</button>}
      />
    </div>
  )
}
