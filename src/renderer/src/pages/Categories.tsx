import { useState } from 'react'
import { Tags } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import PageHeader from '../components/PageHeader'
import CategoryPanels from '../components/CategoryPanels'
import ColorInput from '../components/ColorInput'
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
          <ColorInput
            value={cor}
            onChange={setCor}
            disabled={submitting}
          />
        </div>
        <button type="submit" disabled={submitting} className="btn-primary">
          Adicionar categoria
        </button>
      </form>

      <CategoryPanels
        categories={categories.map(category => ({ id: category.id, name: category.nome, kind: category.tipo === 'receita' ? 'income' : 'expense', color: category.cor }))}
        renderActions={category => <button onClick={() => removeCategory(category.id)} className="btn-danger-text">Excluir</button>}
      />
    </div>
  )
}
