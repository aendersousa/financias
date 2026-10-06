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
    // Reuse the installed worker offline. Only the web build provides one.
    let registration = await navigator.serviceWorker.getRegistration(base.href);
    if (!registration) {
      const response = await fetch(new URL('sw.js', base), { cache: 'no-store' }).catch(() => null);
      if (!response?.ok || !response.headers.get('content-type')?.includes('javascript')) return;
      registration = await navigator.serviceWorker.register(new URL('sw.js', base), {
        scope: base.pathname,
        updateViaCache: 'none'
      });
    }
    let refreshing = false;
    const alreadyControlled = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (alreadyControlled && !refreshing) {
        refreshing = true;
        location.reload();
      }
    });
    let banner;
    function offerUpdate() {
      if (!registration.waiting || !alreadyControlled || banner) return;
      banner = document.createElement('div');
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:100;background:#0f172a;color:white;padding:16px;border-radius:12px;box-shadow:0 4px 24px #0004;display:flex;gap:16px;align-items:center;justify-content:space-between;font:14px system-ui';
      const message = document.createElement('span');
      message.textContent = 'Há uma nova versão do aplicativo. Seus lançamentos pendentes ficam salvos neste aparelho.';
      const button = document.createElement('button');
      button.textContent = 'Atualizar aplicativo';
      button.style.cssText = 'background:#0d9488;color:white;border:0;border-radius:8px;padding:10px 14px;font:600 14px system-ui;cursor:pointer';
      button.addEventListener('click', () => {
        button.disabled = true;
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      });
      banner.append(message, button);
      document.body.append(banner);
    }
    offerUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offerUpdate();
      });
    });
    registration.update().catch(() => {});
    window.addEventListener('online', () => registration.update().catch(() => {}));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  });
}
