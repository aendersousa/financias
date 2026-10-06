import type { ReactNode } from 'react'

interface CategoryItem {
  id: string | number
  name: string
  kind: 'income' | 'expense' | string
  color?: string | null
}

export default function CategoryPanels<T extends CategoryItem>({
  categories, renderName, renderActions, renderEditor
}: {
  categories: T[]
  renderName?: (category: T) => ReactNode
  renderActions?: (category: T) => ReactNode
  renderEditor?: (category: T) => ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {([['income', 'Receitas'], ['expense', 'Despesas']] as const).map(([kind, title]) => (
        <section key={kind} aria-label={title} className="card min-w-0 p-4 sm:min-h-[352px]">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {categories.filter(category => category.kind === kind).map(category => (
              <li key={category.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="category-color-dot h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: category.color ?? '#64748b' }} />
                    {renderName ? renderName(category) : <span className="break-words">{category.name}</span>}
                  </span>
                  {renderActions?.(category)}
                </div>
                {renderEditor?.(category)}
              </li>
            ))}
            {!categories.some(category => category.kind === kind) && <li className="py-2 text-sm text-slate-400">Nenhuma categoria.</li>}
          </ul>
        </section>
      ))}
    </div>
  )
}
