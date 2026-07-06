import type { Theme } from '../lib/theme'

export type Page =
  | 'dashboard'
  | 'accounts'
  | 'categories'
  | 'transactions'
  | 'creditCards'
  | 'bills'
  | 'budget'
  | 'goals'
  | 'settings'

const items: { page: Page; label: string }[] = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'transactions', label: 'Transações' },
  { page: 'accounts', label: 'Contas' },
  { page: 'categories', label: 'Categorias' },
  { page: 'creditCards', label: 'Cartões' },
  { page: 'bills', label: 'Contas a Pagar/Receber' },
  { page: 'budget', label: 'Orçamento' },
  { page: 'goals', label: 'Metas' }
]

interface SidebarProps {
  active: Page
  onNavigate: (page: Page) => void
  theme: Theme
  onToggleTheme: () => void
}

export default function Sidebar({ active, onNavigate, theme, onToggleTheme }: SidebarProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
      <h1 className="mb-4 px-2 text-lg font-semibold text-slate-800 dark:text-slate-100">Finanças</h1>
      {items.map((item) => (
        <button
          key={item.page}
          onClick={() => onNavigate(item.page)}
          className={`rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
            active === item.page
              ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          {item.label}
        </button>
      ))}

      <div className="mt-auto flex flex-col gap-1">
        <button
          onClick={() => onNavigate('settings')}
          className={`rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
            active === 'settings'
              ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          Configurações
        </button>
        <button
          onClick={onToggleTheme}
          className="rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        </button>
      </div>
    </aside>
  )
}
