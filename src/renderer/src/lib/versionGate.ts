import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { isOutdated } from '../../../shared/appVersion'

export const APP_VERSION: string = __APP_VERSION__

export interface VersionPolicy {
  min_version: string
  message: string | null
  download_url: string | null
}

const RECHECK_MS = 30 * 60 * 1000

// Consulta a versão mínima ao abrir, a cada 30 minutos e quando o app volta ao
// primeiro plano. Se a consulta falhar (sem internet, função ainda inexistente no
// servidor), o app continua funcionando normalmente.
export function useVersionGate(): VersionPolicy | null {
  const [blocking, setBlocking] = useState<VersionPolicy | null>(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const { data, error } = await supabase.rpc('app_version_policy')
      if (cancelled || error || !data) return
      const policy = data as VersionPolicy
      setBlocking(isOutdated(APP_VERSION, policy.min_version) ? policy : null)
    }

    function onVisible() {
      if (document.visibilityState === 'visible') check()
    }

    check()
    const timer = window.setInterval(check, RECHECK_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return blocking
}
