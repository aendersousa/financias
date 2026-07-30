import {
  ArrowLeftRight,
  CreditCard,
  Goal,
  LayoutDashboard,
  LogOut,
  Moon,
  PiggyBank,
  Receipt,
  Settings,
  Sun,
  Tags,
  Wallet
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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

const items: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'transactions', label: 'Transações', icon: ArrowLeftRight },
  { page: 'accounts', label: 'Contas', icon: Wallet },
  { page: 'categories', label: 'Categorias', icon: Tags },
  { page: 'creditCards', label: 'Cartões', icon: CreditCard },
  { page: 'bills', label: 'Contas a Pagar/Receber', icon: Receipt },
  { page: 'budget', label: 'Orçamento', icon: PiggyBank },
  { page: 'goals', label: 'Metas', icon: Goal }
]

interface SidebarProps {
  active: Page
  onNavigate: (page: Page) => void
  theme: Theme
  onToggleTheme: () => void
  onLogout: () => void
}

export default function Sidebar({ active, onNavigate, theme, onToggleTheme, onLogout }: SidebarProps) {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-5 flex items-center gap-2.5 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 text-sm font-bold text-white shadow-md shadow-sky-500/20">
          R$
        </div>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Finanças</h1>
      </div>

      {items.map((item) => {
        const Icon = item.icon
        const isActive = active === item.page
        return (
          <button
            key={item.page}
            onClick={() => onNavigate(item.page)}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
              isActive
                ? 'bg-gradient-to-r from-sky-500 to-emerald-500 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Icon size={17} strokeWidth={2} />
            {item.label}
          </button>
        )
      })}

      <div className="mt-auto flex flex-col gap-1 border-t border-slate-200 pt-2 dark:border-slate-800">
        <button
          onClick={() => onNavigate('settings')}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
            active === 'settings'
              ? 'bg-gradient-to-r from-sky-500 to-emerald-500 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          <Settings size={17} />
          Configurações
        </button>
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          {theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        </button>
        <button
          onClick={onLogout}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-red-500 hover:bg-slate-200/70 dark:hover:bg-slate-800"
        >
          <LogOut size={17} />
          Sair
        </button>
      </div>
    </aside>
  )
}
