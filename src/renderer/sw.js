import { matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

const base = new URL(self.registration.scope)
const version = __APP_VERSION__

// Register before precaching so even an explicit index.html navigation goes
// online first. Offline fallback stays paired with this worker's cached assets.
registerRoute(new NavigationRoute(async ({ request }) => {
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 5000)
  try {
    const response = await fetch(new Request(request, {
      cache: 'no-store', signal: abort.signal
    }))
    if (response.ok && response.headers.get('content-type')?.includes('text/html')) return response
  } catch {
    // Connection loss and a slow server both fall back to the installed shell.
  } finally {
    clearTimeout(timeout)
  }
  const cached = await matchPrecache(new URL('index.html', base).href)
  return cached ?? new Response('Sem conexão. Abra o aplicativo com internet primeiro.', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}, { allowlist: [new RegExp(`^${base.pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)] }))

precacheAndRoute(self.__WB_MANIFEST)

function activeWorkerSupportsUpdates(active) {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    const timeout = setTimeout(() => {
      channel.port1.close()
      resolve(false)
    }, 1500)
    channel.port1.onmessage = event => {
      clearTimeout(timeout)
      channel.port1.close()
      resolve(event.data?.type === 'APP_VERSION' && event.data.protocol === 1)
    }
    active.postMessage({ type: 'GET_APP_VERSION' }, [channel.port2])
  })
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Older shells cannot activate a waiting worker. Repair them once, while
    // keeping the usual update prompt for subsequent releases.
    const active = self.registration.active
    if (active && !await activeWorkerSupportsUpdates(active)) await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim()
    const clients = await self.clients.matchAll({ type: 'window' })
    for (const client of clients) client.postMessage({ type: 'APP_UPDATED', version })
  })())
})

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting())
  if (event.data?.type === 'GET_APP_VERSION') {
    event.ports[0]?.postMessage({ type: 'APP_VERSION', protocol: 1, version })
  }
})
