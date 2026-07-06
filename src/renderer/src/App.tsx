import { useEffect, useState } from 'react'
import Sidebar, { type Page } from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import Categories from './pages/Categories'
import Transactions from './pages/Transactions'
import CreditCards from './pages/CreditCards'
import Bills from './pages/Bills'
import Budget from './pages/Budget'
import Goals from './pages/Goals'
import Settings from './pages/Settings'
import { useAppStore } from './store/useAppStore'
import { applyTheme, getInitialTheme, type Theme } from './lib/theme'

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const loadAll = useAppStore((s) => s.loadAll)

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar
        active={page}
        onNavigate={setPage}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />
      <main className="flex-1 overflow-y-auto p-6">
        {page === 'dashboard' && <Dashboard />}
        {page === 'accounts' && <Accounts />}
        {page === 'categories' && <Categories />}
        {page === 'transactions' && <Transactions />}
        {page === 'creditCards' && <CreditCards />}
        {page === 'bills' && <Bills />}
        {page === 'budget' && <Budget />}
        {page === 'goals' && <Goals />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  )
}
