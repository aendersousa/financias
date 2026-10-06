import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';

// This regression uses the production build and updater, but replaces React's
// document with a tiny fixture. It needs neither Supabase nor a signed-in user.
// Run `npm run build:pwa` before `node scripts/test-pwa-updates.mjs`.
const buildRoot = resolve('out/pwa');
const artifactRoot = resolve('out/pwa-update-test');
const prefix = '/financias/';
const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const currentVersion = packageJson.version;
const futureVersion = `${currentVersion}-pwa-regression`;
const [builtHtml, builtWorker] = await Promise.all([
  readFile(resolve(buildRoot, 'index.html'), 'utf8'),
  readFile(resolve(buildRoot, 'sw.js'), 'utf8'),
]);
assert.match(builtWorker, /GET_APP_VERSION/, 'Build the worker with the migration protocol first');
assert.match(builtHtml, /name=["']app-version["']/, 'The built HTML must declare its release version');

function releaseHtml(stage, version) {
  return builtHtml
    .replace(/<script\b[^>]*type=["']module["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/(<meta\b[^>]*name=["']app-version["'][^>]*content=["'])[^"']+(["'])/i, `$1${version}$2`)
    .replace(/<body\b[^>]*>[\s\S]*?<\/body>/i, `<body>
      <main><h1>Fixture PWA</h1><output id="release">${stage}</output>
      <form><label>Descrição em edição <input id="draft" name="draft"></label>
      <button type="submit">Salvar fixture</button></form></main>
    </body>`);
}
const latestHtml = releaseHtml('LATEST', currentVersion);
const futureHtml = releaseHtml('FUTURE', futureVersion);
const futureRevision = createHash('md5').update(futureHtml).digest('hex');
let revisedIndexEntries = 0;
const futureWorker = builtWorker
  .replaceAll(JSON.stringify(currentVersion), JSON.stringify(futureVersion))
  .replace(/\{[^{}]*(?:["']url["']|\burl)\s*:\s*["']index\.html["'][^{}]*\}/g, entry => {
    const revised = entry.replace(/((?:["']revision["']|\brevision)\s*:\s*["'])[^"']+(["'])/, `$1${futureRevision}$2`);
    if (revised !== entry) revisedIndexEntries++;
    return revised;
  });
assert.notEqual(futureWorker, builtWorker, 'The future fixture must change the worker release');
assert.ok(futureWorker.includes(futureVersion), 'The future fixture must advertise a different version');
assert.equal(revisedIndexEntries, 1, 'The future fixture must change exactly one index.html precache revision');
assert.ok(futureWorker.includes(futureRevision), 'Offline navigation must use the future HTML revision');

const legacyHtml = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
  <title>Old PWA fixture</title><script defer src="${prefix}legacy-boot.js"></script></head>
  <body><h1>Fixture PWA</h1><output id="release">LEGACY</output></body></html>`;
const legacyBoot = `navigator.serviceWorker.register('${prefix}sw.js', {
  scope: '${prefix}', updateViaCache: 'none'
});`;
// Deliberately has no version protocol, updater or controllerchange listener.
// This models the obsolete cache-first shell shown in the reported bug.
const legacyWorker = `const shellCache='financias-legacy-shell';
  self.addEventListener('install',event=>event.waitUntil((async()=>{
    const cache=await caches.open(shellCache);
    await cache.addAll(['${prefix}index.html','${prefix}legacy-boot.js']);
    await self.skipWaiting();
  })()));
  self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch',event=>{
    if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
    event.respondWith((async()=>{
      const cache=await caches.open(shellCache);
      return await cache.match(event.request.mode==='navigate'?'${prefix}index.html':event.request)
        ||fetch(event.request);
    })());
  });`;

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
let stage = 'legacy';
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.2').pathname;
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const relative = decodeURIComponent(pathname.slice(prefix.length) || 'index.html');
    const target = resolve(buildRoot, relative);
    if (target !== buildRoot && !target.startsWith(buildRoot + sep)) {
      response.writeHead(403).end(); return;
    }
    let body;
    if (relative === 'index.html') body = stage === 'legacy' ? legacyHtml : stage === 'latest' ? latestHtml : futureHtml;
    else if (relative === 'sw.js') body = stage === 'legacy' ? legacyWorker : stage === 'latest' ? builtWorker : futureWorker;
    else if (relative === 'legacy-boot.js') body = legacyBoot;
    else body = await readFile(target);
    response.writeHead(200, {
      'Content-Type': mime[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...(relative === 'sw.js' ? { 'Service-Worker-Allowed': prefix } : {}),
    }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolveServer, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.2', resolveServer);
});
const address = server.address();
assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.2:${address.port}`;
const url = `${origin}${prefix}`;
await mkdir(artifactRoot, { recursive: true });
const profile = await mkdtemp(resolve(artifactRoot, 'profile-'));
const executablePath = process.env.PWA_CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const launchOptions = { headless: true, ...(executablePath ? { executablePath } : {}) };
let context;
let page;
const pageErrors = [];

async function openProfile() {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  page = context.pages()[0] || await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'load' });
}

async function reopenNormally() {
  await context.close();
  context = undefined;
  await openProfile();
}

async function workerVersion(targetPage = page) {
  return targetPage.evaluate(async () => {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return null;
    return new Promise(resolveVersion => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolveVersion(null); }, 400);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        channel.port1.close();
        resolveVersion(event.data?.type === 'APP_VERSION' ? event.data.version : null);
      };
      worker.postMessage({ type: 'GET_APP_VERSION' }, [channel.port2]);
    });
  });
}

const token = JSON.stringify({ access_token: 'fixture-session-preserved', user: { id: 'fixture-user' } });
const queueItem = {
  id: 'fixture-user:fixture-space:fixture-client',
  userId: 'fixture-user', spaceId: 'fixture-space', clientUuid: 'fixture-client',
  status: 'pending', content: { kind: 'expense', amountCents: 4500, description: 'Offline preserved' },
};
async function seedStorage() {
  await page.evaluate(async ({ token, queueItem }) => {
    localStorage.setItem('sb-pwa-regression-auth-token', token);
    await new Promise((resolveSeed, reject) => {
      const opening = indexedDB.open('financias-offline', 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore('queue', { keyPath: 'id' });
        opening.result.createObjectStore('cache');
        opening.result.createObjectStore('identity');
      };
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const transaction = db.transaction(['queue', 'identity'], 'readwrite');
        transaction.objectStore('queue').put(queueItem);
        transaction.objectStore('identity').put('fixture-user', 'owner');
        transaction.oncomplete = () => { db.close(); resolveSeed(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { token, queueItem });
}

async function assertStoragePreserved(targetPage = page) {
  const actual = await targetPage.evaluate(async () => {
    const data = { token: localStorage.getItem('sb-pwa-regression-auth-token') };
    await new Promise((resolveRead, reject) => {
      const opening = indexedDB.open('financias-offline', 1);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const transaction = db.transaction(['queue', 'identity'], 'readonly');
        const queue = transaction.objectStore('queue').getAll();
        const owner = transaction.objectStore('identity').get('owner');
        queue.onsuccess = () => { data.queue = queue.result; };
        owner.onsuccess = () => { data.owner = owner.result; };
        transaction.oncomplete = () => { db.close(); resolveRead(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
    return data;
  });
  assert.deepEqual(actual, { token, queue: [queueItem], owner: 'fixture-user' }, 'Migration must retain login and offline queue');
}

try {
  await openProfile();
  await expect(page.locator('#release')).toHaveText('LEGACY');
  assert.equal(await page.evaluate(() => isSecureContext), true, 'The loopback fixture must support service workers');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await seedStorage();
  await page.reload();
  await expect(page.locator('#release')).toHaveText('LEGACY');
  console.log('PWA updates: legacy cache-first shell and persistent user data installed.');

  stage = 'latest';
  // Only ordinary profile reopens: no cache clearing, bypass-cache reload,
  // test-injected updater or registration.update() in the obsolete document.
  await reopenNormally();
  await expect.poll(workerVersion, { timeout: 30000, message: 'A normal reopening must update the obsolete worker' }).toBe(currentVersion);
  await assertStoragePreserved();
  await reopenNormally();
  await expect(page.locator('#release')).toHaveText('LATEST');
  await assertStoragePreserved();
  await expect.poll(workerVersion).toBe(currentVersion);
  console.log('PWA updates: two normal reopens migrated the legacy shell without hard refresh.');

  await context.setOffline(true);
  await page.goto(`${url}?offline=1`, { waitUntil: 'load' });
  await expect(page.locator('#release')).toHaveText('LATEST');
  await assertStoragePreserved();
  await context.setOffline(false);
  await page.goto(url, { waitUntil: 'load' });
  await expect(page.locator('#release')).toHaveText('LATEST');
  console.log('PWA updates: navigation still works offline and retains the pending queue.');

  const secondaryPage = await context.newPage();
  secondaryPage.on('pageerror', error => pageErrors.push(error.message));
  await secondaryPage.goto(url, { waitUntil: 'load' });
  await expect(secondaryPage.locator('#release')).toHaveText('LATEST');
  await secondaryPage.locator('#draft').fill('Rascunho da segunda aba');
  const secondaryDocument = await secondaryPage.evaluate(() => performance.timeOrigin);
  await page.locator('#draft').fill('Rascunho que não pode desaparecer');
  const currentDocument = await page.evaluate(() => performance.timeOrigin);
  stage = 'future';
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  const updateButton = page.getByRole('button', { name: 'Atualizar aplicativo', exact: true });
  const secondaryUpdateButton = secondaryPage.getByRole('button', { name: 'Atualizar aplicativo', exact: true });
  await expect(updateButton).toBeVisible({ timeout: 20000 });
  await expect(secondaryUpdateButton).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#draft')).toHaveValue('Rascunho que não pode desaparecer');
  assert.equal(await page.evaluate(() => performance.timeOrigin), currentDocument, 'A later update must not reload an edited document');
  assert.equal(await workerVersion(), currentVersion, 'A normal future update must wait for user consent');
  await assertStoragePreserved();
  console.log('PWA updates: future releases show a prompt and preserve the active draft.');

  await updateButton.click();
  await expect(page.locator('#release')).toHaveText('FUTURE', { timeout: 20000 });
  await expect.poll(workerVersion, { timeout: 10000 }).toBe(futureVersion);
  await expect(updateButton).toHaveCount(0);
  await assertStoragePreserved();

  await expect.poll(() => workerVersion(secondaryPage), { timeout: 10000 }).toBe(futureVersion);
  await expect(secondaryPage.locator('#release')).toHaveText('LATEST');
  await expect(secondaryPage.locator('#draft')).toHaveValue('Rascunho da segunda aba');
  assert.equal(await secondaryPage.evaluate(() => performance.timeOrigin), secondaryDocument, 'Updating another tab must not reload an edited document');
  await expect(secondaryUpdateButton).toBeVisible();
  await assertStoragePreserved(secondaryPage);
  await secondaryUpdateButton.click();
  await expect(secondaryPage.locator('#release')).toHaveText('FUTURE', { timeout: 20000 });
  await expect(secondaryUpdateButton).toHaveCount(0);
  await assertStoragePreserved(secondaryPage);
  console.log('PWA updates: a second tab retains its draft after worker activation until accepting its own reload.');

  await context.setOffline(true);
  await page.goto(`${url}?offline=future`, { waitUntil: 'load' });
  await expect(page.locator('#release')).toHaveText('FUTURE');
  await expect.poll(workerVersion).toBe(futureVersion);
  await assertStoragePreserved();
  console.log('PWA updates: the future release remains current when reopened offline.');
  assert.deepEqual(pageErrors, [], 'The fixtures and production updater must not throw browser errors');
  console.log('PWA updates passed: legacy migration, offline reopening, login and queue preservation, future update consent and multiple edited tabs.');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(artifactRoot, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('PWA diagnostic:', await page.evaluate(async () => ({
      location: location.href,
      release: document.querySelector('#release')?.textContent,
      controller: navigator.serviceWorker.controller?.scriptURL,
      registrations: (await navigator.serviceWorker.getRegistrations()).map(registration => ({
        scope: registration.scope,
        active: registration.active?.state,
        waiting: registration.waiting?.state,
        installing: registration.installing?.state,
      })),
    })).catch(() => null));
  }
  throw error;
} finally {
  await context?.close();
  await new Promise(resolveClose => server.close(resolveClose));
  assert.ok(profile.startsWith(artifactRoot + sep), 'Only this regression profile may be removed');
  await rm(profile, { recursive: true, force: true });
}
