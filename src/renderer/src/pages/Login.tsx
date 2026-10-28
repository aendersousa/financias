import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { getAuthRedirectUrl, signInWithGoogle } from '../lib/oauth'
import { useAppStore } from '../store/useAppStore'
import Brand from '../components/Brand'

export default function Login() {
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  async function handleGoogleSignIn() {
    setError('')
    setGoogleLoading(true)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível iniciar o login com Google.')
    } finally {
      setGoogleLoading(false)
    }
  }

  async function handleForgotPassword() {
    setError('')
    setInfo('')
    if (!email.trim()) {
      setError('Digite seu e-mail no campo acima primeiro.')
      return
    }
    setResetLoading(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getAuthRedirectUrl()
      })
      if (resetError) {
        setError(resetError.message)
      } else {
        setInfo('Enviamos um link de redefinição de senha para o seu e-mail.')
      }
    } finally {
      setResetLoading(false)
    }
  }

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
    <div className="login-screen relative flex min-h-screen items-center justify-center px-4 py-16">
      <div className="login-glow pointer-events-none absolute inset-0" />

      <button
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
        className="absolute right-4 top-4 rounded-lg p-2 text-slate-500 hover:bg-slate-200/70 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <h1><Brand size="lg" /></h1>
        </div>

        <div className="login-card rounded-2xl border p-6 sm:p-7">
          <p className="mb-5 text-center text-sm text-slate-500 dark:text-slate-400">
            {mode === 'signin' ? 'Entre com sua conta para continuar' : 'Crie sua conta para começar'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-email" className="text-xs font-medium text-slate-500 dark:text-slate-400">E-mail</label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
                className="field-input w-full py-2.5"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-password" className="text-xs font-medium text-slate-500 dark:text-slate-400">Senha</label>
              <input
                id="login-password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                placeholder="••••••••"
                className="field-input w-full py-2.5"
                required
              />
              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resetLoading}
                  className="brand-link self-end text-xs font-medium hover:underline focus-visible:outline-2 focus-visible:outline-emerald-500 disabled:opacity-50"
                >
                  {resetLoading ? 'Enviando...' : 'Esqueceu a senha?'}
                </button>
              )}
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
                {error}
              </p>
            )}
            {info && (
              <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary mt-1 w-full justify-center py-2.5 disabled:opacity-50"
            >
              {submitting ? 'Aguarde...' : mode === 'signin' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            <span className="text-xs text-slate-400">ou</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-emerald-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-700"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
              />
              <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05z" />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
              />
            </svg>
            {googleLoading ? 'Abrindo o Google...' : 'Entrar com Google'}
          </button>

          <button
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError('')
              setInfo('')
            }}
            className="brand-link mt-5 w-full text-center text-xs font-medium hover:underline focus-visible:outline-2 focus-visible:outline-emerald-500"
          >
            {mode === 'signin' ? 'Não tem conta? Criar uma agora' : 'Já tem conta? Entrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
