if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', async () => {
    const base = new URL('.', document.querySelector('script[src$="app-update.js"]').src);
    // Local XAMPP should always read the latest build from disk.
    if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        if (registration.scope === base.href) await registration.unregister();
      }
      if (navigator.serviceWorker.controller?.scriptURL === new URL('sw.js', base).href) {
        location.reload();
      }
      return;
    }
    // Only the web build provides a service worker.
    const response = await fetch(new URL('sw.js', base), { cache: 'no-store' }).catch(() => null);
    if (!response?.ok || !response.headers.get('content-type')?.includes('javascript')) return;
    let refreshing = false;
    const alreadyControlled = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (alreadyControlled && !refreshing) {
        refreshing = true;
        location.reload();
      }
    });
    const registration = await navigator.serviceWorker.register(new URL('sw.js', base), {
      scope: base.pathname,
      updateViaCache: 'none'
    });
    registration.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  });
}
