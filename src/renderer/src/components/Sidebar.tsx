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
import { useAppStore } from '../store/useAppStore'
import Brand from './Brand'

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

const groups: { title: string; items: { page: Page; label: string; icon: LucideIcon; hint: string }[] }[] = [
  { title: '1. Cadastros iniciais', items: [
    { page: 'accounts', label: 'Contas', icon: Wallet, hint: 'Primeiro: banco ou carteira' },
    { page: 'categories', label: 'Categorias', icon: Tags, hint: 'Depois: tipos de receita e despesa' },
    { page: 'creditCards', label: 'Cartões', icon: CreditCard, hint: 'Opcional: se usa cartão de crédito' }
  ] },
  { title: '2. Movimentações', items: [
    { page: 'transactions', label: 'Transações', icon: ArrowLeftRight, hint: 'Registre receitas e despesas' },
    { page: 'bills', label: 'A pagar / receber', icon: Receipt, hint: 'Organize os próximos vencimentos' }
  ] },
  { title: '3. Planejamento', items: [
    { page: 'budget', label: 'Orçamento', icon: PiggyBank, hint: 'Defina limites por categoria' },
    { page: 'goals', label: 'Metas', icon: Goal, hint: 'Escolha quanto quer guardar' }
  ] }
]

interface SidebarProps {
  active: Page
  onNavigate: (page: Page) => void
  theme: Theme
  onToggleTheme: () => void
  onLogout: () => void
}

export default function Sidebar({ active, onNavigate, theme, onToggleTheme, onLogout }: SidebarProps) {
  const hasAccounts = useAppStore((s) => s.accounts.length > 0)
  const hasCategories = useAppStore((s) => s.categories.length > 0)
  const nextPage: Page = !hasAccounts ? 'accounts' : 'categories'
  return (
    <aside className="walletup-sidebar flex h-full w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-5 px-2">
        <Brand />
      </div>

      <nav aria-label="Menu principal e ordem de cadastro" className="flex flex-col gap-1">
        <button onClick={() => onNavigate('dashboard')} aria-current={active === 'dashboard' ? 'page' : undefined}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-emerald-500 ${active === 'dashboard' ? 'nav-active' : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
          <LayoutDashboard size={17} />Dashboard
        </button>
        {(!hasAccounts || !hasCategories) && <div className="my-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 dark:border-emerald-900 dark:bg-emerald-950/40">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{!hasAccounts ? 'Comece por uma conta' : 'Agora confira as categorias'}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{!hasAccounts ? 'Cadastre seu banco ou carteira e informe o saldo inicial.' : 'Crie categorias para organizar suas receitas e despesas. Depois, registre as transações.'}</p>
          <button className="brand-link mt-2 text-xs font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-emerald-500" onClick={() => onNavigate(nextPage)}>{!hasAccounts ? 'Cadastrar conta' : 'Cadastrar categorias'}</button>
        </div>}
      {groups.map((group) => <section key={group.title} className="mt-3" aria-label={group.title}>
        <h2 className="mb-1.5 px-3 text-xs font-semibold text-slate-500 dark:text-slate-400">{group.title}</h2>
        <div className="flex flex-col gap-1">
      {group.items.map((item) => {
        const Icon = item.icon
        const isActive = active === item.page
        return (
          <button
            key={item.page}
            onClick={() => onNavigate(item.page)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-emerald-500 ${
              isActive
                ? 'nav-active'
                : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Icon size={17} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span className="min-w-0"><span className="block">{item.label}</span><span className={`mt-0.5 block text-[11px] font-normal leading-snug ${isActive ? 'opacity-80' : 'text-slate-500 dark:text-slate-400'}`}>{item.hint}</span></span>
          </button>
        )
      })}
        </div>
      </section>)}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-slate-200 pt-2 dark:border-slate-800">
        <button
          onClick={() => onNavigate('settings')}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
            active === 'settings'
              ? 'nav-active'
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
