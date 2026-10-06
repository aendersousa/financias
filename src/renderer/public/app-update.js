if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  // A worker can update in another tab. Keep an unfinished form on screen
  // until this user chooses to reload, even after that worker becomes active.
  let editing = false;
  for (const event of ['input', 'change', 'submit']) {
    document.addEventListener(event, () => { editing = true; }, true);
  }
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
    }
    let refreshing = false;
    const alreadyControlled = Boolean(navigator.serviceWorker.controller);
    let activeUpdate = false;
    function reloadAfterUpdate() {
      if (!alreadyControlled || refreshing) return;
      activeUpdate = true;
      if (editing) {
        offerUpdate();
      } else {
        refreshing = true;
        location.reload();
      }
    }
    navigator.serviceWorker.addEventListener('controllerchange', reloadAfterUpdate);
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'APP_UPDATED') reloadAfterUpdate();
    });
    let banner;
    function offerUpdate() {
      if ((!registration?.waiting && !activeUpdate) || !alreadyControlled || banner) return;
      banner = document.createElement('div');
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      banner.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:100;background:#141e25;color:white;padding:16px;border-radius:12px;box-shadow:0 4px 24px #0004;display:flex;gap:16px;align-items:center;justify-content:space-between;font:14px system-ui';
      const message = document.createElement('span');
      message.textContent = 'Há uma nova versão do aplicativo. Seus lançamentos pendentes ficam salvos neste aparelho.';
      const button = document.createElement('button');
      button.textContent = 'Atualizar aplicativo';
      button.style.cssText = 'background:#18d47b;color:#0b2115;border:0;border-radius:8px;padding:10px 14px;font:600 14px system-ui;cursor:pointer';
      button.addEventListener('click', () => {
        button.disabled = true;
        editing = false;
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        else { refreshing = true; location.reload(); }
      });
      banner.append(message, button);
      document.body.append(banner);
    }
    // Re-register existing workers too, so older registrations inherit the
    // no-HTTP-cache policy when checking sw.js and its imports.
    try {
      registration = await navigator.serviceWorker.register(new URL('sw.js', base), {
        scope: base.pathname,
        updateViaCache: 'none'
      });
    } catch {
      // An installed registration remains useful when the network check fails.
      if (!registration) return;
    }
    function watchInstallingWorker() {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offerUpdate();
      });
    }
    offerUpdate();
    watchInstallingWorker();
    registration.addEventListener('updatefound', watchInstallingWorker);
    registration.update().catch(() => {});
    window.addEventListener('online', () => registration.update().catch(() => {}));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  });
}
