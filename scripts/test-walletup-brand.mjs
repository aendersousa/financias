import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// Branding checks use an isolated local identity and never send requests to production.
const status = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'npx supabase status -o json 2>$null'], { encoding: 'utf8', windowsHide: true }));
assert.equal(new URL(status.API_URL).hostname, '127.0.0.1');
process.env.VITE_SUPABASE_URL = status.API_URL;
process.env.VITE_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.VITE_FINANCIAL_MODEL = 'ledger';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const email = `walletup-${randomUUID().slice(0, 8)}@test.local`, password = randomUUID();
const { data: identity, error: creationError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (creationError) throw creationError;
const client = createClient(status.API_URL, status.ANON_KEY, options);
const { data: auth, error: signInError } = await client.auth.signInWithPassword({ email, password });
if (signInError) throw signInError;
async function rpc(name, args = {}) {
  const { data, error } = await client.schema('api').rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}
const space = await rpc('create_space', { p_name: 'Carteira pessoal', p_kind: 'shared', p_timezone: 'America/Sao_Paulo' });
await rpc('initialize_space_defaults', { p_space: space });
const today = (await rpc('workspace_snapshot', { p_space: space })).space.today;
const account = await rpc('create_financial_account', { p_space: space, p_name: 'Conta azul preservada', p_kind: 'checking', p_opening_cents: 125000, p_opening_on: today });
const category = await rpc('create_category', { p_space: space, p_name: 'Categoria azul preservada', p_kind: 'income', p_income_class: 'recurring' });
const data = await rpc('management_data', { p_space: space });
await rpc('manage_category', { p_space: space, p_category: category, p_version: data.categories.find(item => item.id === category).version, p_action: 'update', p_changes: { color: '#0ea5e9' } });
async function setTheme(theme) {
  const settings = await rpc('get_user_settings');
  await rpc('update_user_settings', { p_version: settings.version, p_changes: { active_financial_space_id: space, theme, preferences: { ...settings.preferences, [`account_color:${account}`]: '#0ea5e9' } } });
}
const server = await createServer({ configFile: 'vite.pwa.config.ts', server: { host: '127.0.0.1', port: 4186, strictPort: true } });
await server.listen();
await mkdir('out/walletup-brand-test', { recursive: true });
let browser, page;
const errors = [];
let stage = 'startup';
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  async function openPage(theme, session) {
    const context = await browser.newContext({ viewport: { width: 1663, height: 950 } });
    const next = await context.newPage();
    next.on('pageerror', failure => errors.push(failure.message));
    await next.route('**/rest/v1/rpc/**', route => {
      assert.equal(new URL(route.request().url()).hostname, '127.0.0.1');
      return route.continue();
    });
    await next.addInitScript(({ theme, session }) => {
      localStorage.setItem('financias:theme', theme);
      if (session) localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
    }, { theme, session });
    await next.goto('http://127.0.0.1:4186/financias/');
    return next;
  }
  async function checkBrand(next) {
    await expect(next.locator('.walletup-brand').first()).toBeVisible();
    await expect(next.locator('.walletup-wordmark').first()).toHaveText('WalletUp');
    assert.equal(await next.title(), 'WalletUp');
    await expect.poll(() => next.locator('.walletup-mark img').first().evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    const color = await next.locator('.walletup-up').first().evaluate(element => {
      const probe = document.createElement('canvas').getContext('2d');
      probe.fillStyle = getComputedStyle(element).color;
      probe.fillRect(0, 0, 1, 1);
      return [...probe.getImageData(0, 0, 1, 1).data];
    });
    assert.ok(color[1] > color[0] && color[1] > color[2], 'Wordmark Up uses the green brand color');
  }
  async function checkPhone(next) {
    await next.setViewportSize({ width: 390, height: 844 });
    assert.ok(await next.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Branding must not create horizontal page overflow');
    await checkBrand(next);
  }
  for (const theme of ['dark', 'light']) {
    stage = `${theme} login`;
    page = await openPage(theme);
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await checkBrand(page);
    assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), theme === 'dark');
    await page.screenshot({ path: `out/walletup-brand-test/login-desktop-${theme}.png`, fullPage: true });
    await checkPhone(page);
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Entrar com Google', exact: true })).toBeInViewport();
    await page.screenshot({ path: `out/walletup-brand-test/login-mobile-${theme}.png`, fullPage: true });
    await page.context().close();

    stage = `${theme} account layout and saved colors`;
    await setTheme(theme);
    page = await openPage(theme, auth.session);
    await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
    await checkBrand(page);
    await page.getByRole('button', { name: 'Contas', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Contas', exact: true })).toBeVisible();
    const accountRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Editar conta Conta azul preservada', exact: true }) });
    await expect(accountRow.locator('.account-color-dot')).toHaveCSS('background-color', 'rgb(14, 165, 233)');
    await expect(accountRow).toContainText('R$ 1.250,00');
    const fieldBoxes = await Promise.all(['Nome', 'Tipo', 'Saldo inicial', 'Cor'].map(label => page.getByLabel(label, { exact: true }).boundingBox()));
    assert.ok(fieldBoxes.every(box => box && Math.abs(box.y - fieldBoxes[0].y) < 5), 'Accounts retain the compact reference form');
    await page.screenshot({ path: `out/walletup-brand-test/accounts-desktop-${theme}.png`, fullPage: true });

    stage = `${theme} category layout and saved colors`;
    await page.getByRole('button', { name: 'Categorias', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Categorias', exact: true })).toBeVisible();
    const panel = name => page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) });
    const categoryRow = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Editar categoria Categoria azul preservada', exact: true }) });
    await expect(categoryRow.locator('.category-color-dot')).toHaveCSS('background-color', 'rgb(14, 165, 233)');
    const income = await panel('Receitas').boundingBox(), expense = await panel('Despesas').boundingBox();
    assert.ok(income && expense && Math.abs(income.y - expense.y) < 2 && expense.x > income.x, 'Categories retain the two reference lists');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: `out/walletup-brand-test/categories-desktop-${theme}.png`, fullPage: true });
    await checkPhone(page);
    const phoneIncome = await panel('Receitas').boundingBox(), phoneExpense = await panel('Despesas').boundingBox();
    assert.ok(phoneIncome && phoneExpense && phoneExpense.y >= phoneIncome.y + phoneIncome.height);
    await page.screenshot({ path: `out/walletup-brand-test/categories-mobile-${theme}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Contas', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Adicionar conta', exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `out/walletup-brand-test/accounts-mobile-${theme}.png`, fullPage: true });
    await page.context().close();
  }
  assert.deepEqual(errors, []);
  console.log('WalletUp branding passed: light/dark desktop/mobile login, loaded wallet logo, branded title, accounts/categories reference layouts, user colors and balances preserved, no uncaught browser errors.');
} catch (failure) {
  if (page && !page.isClosed()) await page.screenshot({ path: 'out/walletup-brand-test/failure.png', fullPage: true });
  console.log(`WalletUp branding failed at ${stage}.`);
  throw failure;
} finally {
  await browser?.close();
  await server.close();
  await client.auth.signOut();
  // Supabase fixtures contain local financial history and follow existing suites' retention policy.
  assert.ok(identity.user.id);
}
