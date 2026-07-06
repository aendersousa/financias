import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency } from '../lib/format'

export default function Goals() {
  const goals = useAppStore((s) => s.goals)
  const addGoal = useAppStore((s) => s.addGoal)
  const updateGoal = useAppStore((s) => s.updateGoal)
  const removeGoal = useAppStore((s) => s.removeGoal)

  const [nome, setNome] = useState('')
  const [valorAlvo, setValorAlvo] = useState('')
  const [prazo, setPrazo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [aportes, setAportes] = useState<Record<number, string>>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim() || !valorAlvo) return
    setSubmitting(true)
    try {
      await addGoal({ nome: nome.trim(), valor_alvo: Number(valorAlvo), valor_atual: 0, prazo: prazo || null })
      setNome('')
      setValorAlvo('')
      setPrazo('')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAporte(id: number, valorAtual: number) {
    const aporte = Number(aportes[id] || 0)
    if (!aporte) return
    await updateGoal(id, { valor_atual: valorAtual + aporte })
    setAportes((prev) => ({ ...prev, [id]: '' }))
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Meta</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            placeholder="Ex: Reserva de emergência"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Valor alvo</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={valorAlvo}
            onChange={(e) => setValorAlvo(e.target.value)}
            className="w-32 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Prazo</label>
          <input
            type="date"
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          Criar meta
        </button>
      </form>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {goals.map((g) => {
          const pct = g.valor_alvo > 0 ? Math.min(100, (g.valor_atual / g.valor_alvo) * 100) : 0
          return (
            <div
              key={g.id}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">{g.nome}</h3>
                <button onClick={() => removeGoal(g.id)} className="text-xs text-red-500 hover:underline">
                  Excluir
                </button>
              </div>
              <p className="text-sm text-slate-500">
                {formatCurrency(g.valor_atual)} de {formatCurrency(g.valor_alvo)}
              </p>
              <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-2 rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
              </div>
              {g.prazo && <p className="text-xs text-slate-400">Prazo: {g.prazo}</p>}
              <div className="mt-2 flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  placeholder="Aporte"
                  value={aportes[g.id] || ''}
                  onChange={(e) => setAportes((prev) => ({ ...prev, [g.id]: e.target.value }))}
                  className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
                <button
                  onClick={() => handleAporte(g.id, g.valor_atual)}
                  className="rounded-md bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
                >
                  Adicionar
                </button>
              </div>
            </div>
          )
        })}
        {goals.length === 0 && <p className="text-sm text-slate-400">Nenhuma meta cadastrada.</p>}
      </div>
    </div>
  )
}
