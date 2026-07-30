import { useState } from 'react'
import { Tags } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import PageHeader from '../components/PageHeader'
import type { CategoryType } from '../../../shared/types'

export default function Categories() {
  const categories = useAppStore((s) => s.categories)
  const addCategory = useAppStore((s) => s.addCategory)
  const removeCategory = useAppStore((s) => s.removeCategory)

  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<CategoryType>('despesa')
  const [cor, setCor] = useState('#64748b')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return
    setSubmitting(true)
    try {
      await addCategory({ nome: nome.trim(), tipo, cor, icone: null })
      setNome('')
    } finally {
      setSubmitting(false)
    }
  }

  const receitas = categories.filter((c) => c.tipo === 'receita')
  const despesas = categories.filter((c) => c.tipo === 'despesa')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={Tags} title="Categorias" subtitle="Organize receitas e despesas por categoria" />

      <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Nome</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="field-input"
            placeholder="Ex: Assinaturas"
            required
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="field-label">Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as CategoryType)} className="field-input">
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
          </select>
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
          Adicionar categoria
        </button>
      </form>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CategoryList title="Receitas" items={receitas} onRemove={removeCategory} />
        <CategoryList title="Despesas" items={despesas} onRemove={removeCategory} />
      </div>
    </div>
  )
}

function CategoryList({
  title,
  items,
  onRemove
}: {
  title: string
  items: { id: number; nome: string; cor: string }[]
  onRemove: (id: number) => void
}) {
  return (
    <div className="card p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.cor }} />
              {c.nome}
            </span>
            <button onClick={() => onRemove(c.id)} className="btn-danger-text">
              Excluir
            </button>
          </li>
        ))}
        {items.length === 0 && <p className="py-2 text-sm text-slate-400">Nenhuma categoria.</p>}
      </ul>
    </div>
  )
}
