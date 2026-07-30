import { useState } from 'react'
import { Receipt } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency, formatDate, todayIso } from '../lib/format'
import PageHeader from '../components/PageHeader'
import type { BillType } from '../../../shared/types'

export default function Bills() {
  const bills = useAppStore((s) => s.bills)
  const accounts = useAppStore((s) => s.accounts)
  const addBill = useAppStore((s) => s.addBill)
  const updateBill = useAppStore((s) => s.updateBill)
  const removeBill = useAppStore((s) => s.removeBill)

  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState(todayIso())
  const [tipo, setTipo] = useState<BillType>('pagar')
  const [recorrencia, setRecorrencia] = useState('')
  const [contaId, setContaId] = useState<number | ''>('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!descricao.trim() || !valor) return
    setSubmitting(true)
    try {
      await addBill({
        descricao: descricao.trim(),
        valor: Number(valor),
        vencimento,
        tipo,
        status: 'pendente',
        recorrencia: recorrencia.trim() || null,
        conta_id: contaId ? Number(contaId) : null
      })
      setDescricao('')
      setValor('')
    } finally {
      setSubmitting(false)
    }
  }

  const aPagar = bills.filter((b) => b.tipo === 'pagar')
  const aReceber = bills.filter((b) => b.tipo === 'receber')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={Receipt} title="Contas a Pagar/Receber" subtitle="Compromissos financeiros com vencimento" />

      <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Descrição</label>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="field-input"
            placeholder="Ex: Aluguel"
            required
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as BillType)} className="field-input">
            <option value="pagar">A pagar</option>
            <option value="receber">A receber</option>
          </select>
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Valor</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="field-input w-full sm:w-28"
            required
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Vencimento</label>
          <input
            type="date"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
            className="field-input"
            required
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Recorrência</label>
          <input
            value={recorrencia}
            onChange={(e) => setRecorrencia(e.target.value)}
            className="field-input w-full sm:w-32"
            placeholder="Ex: mensal"
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Conta</label>
          <select
            value={contaId}
            onChange={(e) => setContaId(e.target.value ? Number(e.target.value) : '')}
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
          Cadastrar
        </button>
      </form>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BillList title="Contas a pagar" items={aPagar} onToggle={updateBill} onRemove={removeBill} />
        <BillList title="Contas a receber" items={aReceber} onToggle={updateBill} onRemove={removeBill} />
      </div>
    </div>
  )
}

function BillList({
  title,
  items,
  onToggle,
  onRemove
}: {
  title: string
  items: {
    id: number
    descricao: string
    valor: number
    vencimento: string
    status: 'pendente' | 'pago'
    recorrencia: string | null
  }[]
  onToggle: (id: number, data: { status: 'pendente' | 'pago' }) => Promise<void>
  onRemove: (id: number) => Promise<void>
}) {
  return (
    <div className="card p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div>
              <p className="font-medium text-slate-800 dark:text-slate-100">{b.descricao}</p>
              <p className="text-xs text-slate-400">
                Vence em {formatDate(b.vencimento)}
                {b.recorrencia ? ` · ${b.recorrencia}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{formatCurrency(b.valor)}</span>
              <button
                onClick={() => onToggle(b.id, { status: b.status === 'pago' ? 'pendente' : 'pago' })}
                className={`rounded-full px-2 py-0.5 text-xs ${
                  b.status === 'pago'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                }`}
              >
                {b.status === 'pago' ? 'Pago' : 'Pendente'}
              </button>
              <button onClick={() => onRemove(b.id)} className="btn-danger-text">
                Excluir
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <p className="py-2 text-sm text-slate-400">Nada por aqui.</p>}
      </ul>
    </div>
  )
}
