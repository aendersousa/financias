import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Menu } from 'lucide-react'
import Sidebar, { type Page } from './components/Sidebar'
import Login from './pages/Login'
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
import { supabase } from './lib/supabaseClient'

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const loadAll = useAppStore((s) => s.loadAll)
  const reset = useAppStore((s) => s.reset)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) {
      loadAll()
    } else {
      reset()
    }
  }, [session, loadAll, reset])

  if (authLoading) {
    return <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-950" />
  }

  if (!session) {
    return <Login />
  }

  function handleNavigate(next: Page) {
    setPage(next)
    setMobileNavOpen(false)
  }

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="hidden md:flex">
        <Sidebar
          active={page}
          onNavigate={handleNavigate}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={() => supabase.auth.signOut()}
        />
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute inset-y-0 left-0">
            <Sidebar
              active={page}
              onNavigate={handleNavigate}
              theme={theme}
              onToggleTheme={toggleTheme}
              onLogout={() => supabase.auth.signOut()}
            />
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 md:hidden">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Abrir menu"
            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Menu size={22} />
          </button>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 text-xs font-bold text-white">
            R$
          </div>
          <span className="font-semibold text-slate-800 dark:text-slate-100">Finanças</span>
        </div>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
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
    </div>
  )
}
