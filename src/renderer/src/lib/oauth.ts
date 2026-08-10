import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { supabase } from './supabaseClient'

const NATIVE_REDIRECT_URL = 'financas://auth-callback'

function isElectron(): boolean {
  return typeof window.api !== 'undefined'
}

export function getAuthRedirectUrl(): string {
  if (Capacitor.isNativePlatform() || isElectron()) {
    return NATIVE_REDIRECT_URL
  }
  // Plain web / PWA: redirect back to the page itself, where
  // supabase-js will pick up the session from the URL automatically.
  return window.location.origin + window.location.pathname
}

export async function signInWithGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: getAuthRedirectUrl(), skipBrowserRedirect: true }
  })
  if (error) throw error
  if (!data.url) return

  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url: data.url })
  } else if (isElectron()) {
    window.open(data.url, '_blank')
  } else {
    window.location.href = data.url
  }
}

export async function handleOAuthCallbackUrl(url: string): Promise<void> {
  const hashIndex = url.indexOf('#')
  if (hashIndex === -1) return

  const params = new URLSearchParams(url.slice(hashIndex + 1))
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  if (!access_token || !refresh_token) return

  await supabase.auth.setSession({ access_token, refresh_token })

  if (Capacitor.isNativePlatform()) {
    await Browser.close().catch(() => {})
  }
}
