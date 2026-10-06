import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { APP_VERSION, type VersionPolicy } from '../lib/versionGate'

const DEFAULT_DOWNLOAD_URL = 'https://github.com/aendersousa/financias/releases/latest'

function platform(): 'android' | 'desktop' | 'web' {
  if (Capacitor.isNativePlatform()) return 'android'
  if (typeof window.api !== 'undefined') return 'desktop'
  return 'web'
}

async function reloadWithNewVersion() {
  const registration = await navigator.serviceWorker?.getRegistration()
  await registration?.update().catch(() => undefined)
  window.location.reload()
}

export default function UpdateRequired({ policy }: { policy: VersionPolicy }) {
  const [busy, setBusy] = useState(false)
  const where = platform()
  const downloadUrl = policy.download_url ?? DEFAULT_DOWNLOAD_URL

  return (
    <div className="flex h-screen items-center justify-center bg-slate-100 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-semibold">Atualize o app</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {policy.message ?? 'Esta versão do Finanças não é mais aceita. Atualize para continuar usando.'}
        </p>

        {where === 'web' && (
          <button
            className="btn-primary mt-5 w-full"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              reloadWithNewVersion()
            }}
          >
            {busy ? 'Atualizando…' : 'Atualizar agora'}
          </button>
        )}

        {where === 'android' && (
          <button className="btn-primary mt-5 w-full" onClick={() => Browser.open({ url: downloadUrl })}>
            Baixar a nova versão
          </button>
        )}

        {where === 'desktop' && (
          <p className="mt-5 text-sm text-slate-600 dark:text-slate-300">
            Feche e abra o app de novo: a atualização é baixada automaticamente. Se não acontecer, baixe a nova versão em{' '}
            <span className="break-all font-medium">{downloadUrl}</span>.
          </p>
        )}

        <p className="mt-4 text-xs text-slate-400">
          Versão instalada: {APP_VERSION} · mínima aceita: {policy.min_version}
        </p>
      </div>
    </div>
  )
}
