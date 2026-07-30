import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    setSubmitting(true)
    try {
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) setError(signInError.message)
      } else {
        const { error: signUpError } = await supabase.auth.signUp({ email, password })
        if (signUpError) {
          setError(signUpError.message)
        } else {
          setInfo('Conta criada. Verifique seu e-mail para confirmar o cadastro antes de entrar.')
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(14,165,233,0.15),transparent_60%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(14,165,233,0.12),transparent_60%)]" />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-500 text-xl font-bold text-white shadow-lg shadow-sky-500/20">
            R$
          </div>
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Finanças</h1>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/80 p-7 shadow-xl shadow-slate-900/5 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <p className="mb-5 text-center text-sm text-slate-500 dark:text-slate-400">
            {mode === 'signin' ? 'Entre com sua conta para continuar' : 'Crie sua conta para começar'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-shadow placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                placeholder="••••••••"
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-shadow placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                required
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
                {error}
              </p>
            )}
            {info && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 rounded-lg bg-gradient-to-r from-sky-500 to-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-sky-500/20 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Aguarde...' : mode === 'signin' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>

          <button
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError('')
              setInfo('')
            }}
            className="mt-5 w-full text-center text-xs font-medium text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400"
          >
            {mode === 'signin' ? 'Não tem conta? Criar uma agora' : 'Já tem conta? Entrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
