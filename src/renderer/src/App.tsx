import { lazy, Suspense, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { App as CapacitorApp } from '@capacitor/app'
import Login from './pages/Login'
import { supabase } from './lib/supabaseClient'
import { handleOAuthCallbackUrl } from './lib/oauth'
import { clearLocalData, localIdentityCheck } from './lib/offlineStorage'
import { useVersionGate } from './lib/versionGate'
import UpdateRequired from './components/UpdateRequired'

const LedgerWorkspace = lazy(() => import('./pages/LedgerWorkspace'))

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [localReady, setLocalReady] = useState(false)
  const [localConflict, setLocalConflict] = useState<{ pending: number } | null>(null)
  const [localError, setLocalError] = useState('')
  const blockingVersion = useVersionGate()

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
    let cancelled = false
    setLocalReady(false)
    setLocalConflict(null)
    setLocalError('')
    if (!session) return

    void localIdentityCheck(session.user.id).then((result) => {
      if (cancelled) return
      if (result.changed) setLocalConflict({ pending: result.pending })
      else setLocalReady(true)
    }).catch((failure) => {
      if (!cancelled) setLocalError(failure.message)
    })

    return () => {
      cancelled = true
    }
  }, [session?.user.id])

  useEffect(() => {
    const removeElectronListener = window.api?.onOAuthCallback((url) => {
      handleOAuthCallbackUrl(url)
    })

    let capacitorHandle: { remove: () => void } | undefined
    CapacitorApp.addListener('appUrlOpen', (event) => {
      handleOAuthCallbackUrl(event.url)
    }).then((handle) => {
      capacitorHandle = handle
    })

    return () => {
      removeElectronListener?.()
      capacitorHandle?.remove()
    }
  }, [])

  if (blockingVersion) {
    return <UpdateRequired policy={blockingVersion} />
  }

  if (authLoading) {
    return <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-950" />
  }

  if (!session) {
    return <Login />
  }

  if (localConflict) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <p>
          Este aparelho guarda dados de outro usuário{localConflict.pending ? ` e ${localConflict.pending} lançamentos não enviados` : ''}.
          Para entrar com esta conta, apague os dados locais anteriores. Os registros do servidor serão preservados.
        </p>
        <button
          onClick={() => {
            void clearLocalData(session.user.id).then(() => {
              setLocalConflict(null)
              setLocalReady(true)
            }).catch((failure) => setLocalError(failure.message))
          }}
          className="rounded-xl bg-brand-600 px-4 py-3 text-white"
        >
          Apagar dados locais e continuar
        </button>
        <button onClick={() => void supabase.auth.signOut()} className="ml-4">
          Voltar ao acesso
        </button>
        {localError && <p role="alert">{localError}</p>}
      </div>
    )
  }

  if (!localReady) {
    return (
      <div className="p-6">
        {localError ? (
          <p role="alert">Não foi possível abrir o armazenamento deste aparelho: {localError}</p>
        ) : (
          'Abrindo os dados deste aparelho…'
        )}
      </div>
    )
  }

  return (
    <Suspense fallback={<div className="p-6">Carregando seu espaço…</div>}>
      <LedgerWorkspace key={session.user.id} />
    </Suspense>
  )
}
