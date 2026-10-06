import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// Fixtures and browser requests are confined to local Supabase.
const status = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'npx supabase status -o json 2>$null'], { encoding: 'utf8', windowsHide: true }));
assert.equal(new URL(status.API_URL).hostname, '127.0.0.1', 'Account checks must never mutate production');
process.env.VITE_SUPABASE_URL = status.API_URL;
process.env.VITE_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.VITE_FINANCIAL_MODEL = 'ledger';
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, authOptions);
async function identity() {
  const email = `contas-${randomUUID().slice(0, 8)}@test.local`, password = randomUUID();
  const { error: creationError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (creationError) throw new Error(creationError.message);
  const client = createClient(status.API_URL, status.ANON_KEY, authOptions);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return { email, client, session: data.session };
}
const owner = await identity(), viewer = await identity();
async function rpc(name, args = {}, user = owner) {
  const { data, error } = await user.client.schema('api').rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}
const space = await rpc('create_space', { p_name: 'Referência de contas', p_kind: 'shared', p_timezone: 'America/Sao_Paulo' });
await rpc('initialize_space_defaults', { p_space: space });
const snapshot = () => rpc('workspace_snapshot', { p_space: space });
const management = () => rpc('management_data', { p_space: space });
const today = (await snapshot()).space.today;
await rpc('create_financial_account', { p_space: space, p_name: '222', p_kind: 'checking', p_opening_cents: 0, p_opening_on: today });
const invitation = await rpc('invite_space_member', { p_space: space, p_email: viewer.email, p_role: 'viewer', p_nickname: 'Leitor' });
await rpc('accept_space_invitation', { p_token: invitation.token }, viewer);
for (const user of [owner, viewer]) {
  const settings = await rpc('get_user_settings', {}, user);
  await rpc('update_user_settings', { p_version: settings.version, p_changes: { active_financial_space_id: space, theme: 'dark' } }, user);
}
const server = await createServer({ configFile: 'vite.pwa.config.ts', server: { host: '127.0.0.1', port: 4185, strictPort: true } });
await server.listen();
await mkdir('out/account-layout-test', { recursive: true });
let browser, page;
const errors = [];
let stage = 'startup';
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  async function openPage(user) {
    const context = await browser.newContext({ viewport: { width: 1663, height: 800 } });
    const next = await context.newPage();
    next.on('pageerror', failure => errors.push(failure.message));
    await next.route('**/rest/v1/rpc/**', route => {
      assert.equal(new URL(route.request().url()).hostname, '127.0.0.1', 'Browser RPCs must be local');
      return route.continue();
    });
    await next.addInitScript(session => localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), user.session);
    await next.goto('http://127.0.0.1:4185/financias/');
    await expect(next.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
    await next.getByRole('button', { name: '1. Contas', exact: true }).click();
    await expect(next.getByRole('heading', { name: 'Contas', exact: true })).toBeVisible();
    await expect(next.getByRole('table', { name: 'Contas', exact: true })).toBeVisible();
    await expect(next.getByRole('alert')).toHaveCount(0);
    return next;
  }
  page = await openPage(owner);
  const accounts = () => page.getByRole('table', { name: 'Contas', exact: true });
  const accountRow = name => accounts().getByRole('row').filter({ has: page.getByRole('button', { name: `Editar conta ${name}`, exact: true }) });
  const options = name => page.getByRole('region', { name: `Detalhes da conta ${name}`, exact: true });
  async function addAccount(name, kind, amount, color) {
    await page.getByLabel('Nome', { exact: true }).fill(name);
    await page.getByLabel('Tipo', { exact: true }).selectOption(kind);
    await page.getByLabel('Saldo inicial', { exact: true }).fill(amount);
    if (color) await page.getByLabel('Cor', { exact: true }).evaluate((element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, color);
    await page.getByRole('button', { name: 'Adicionar conta', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Conta adicionada');
    await expect(accountRow(name)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    return (await snapshot()).accounts.find(item => item.name === name);
  }

  stage = 'reference layout';
  for (const label of ['Nome', 'Tipo', 'Saldo inicial', 'Cor']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar conta', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cadastrar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Lançamento rápido e fila de envio', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Tipo', { exact: true })).toHaveValue('checking');
  await expect(page.getByLabel('Saldo inicial', { exact: true })).toHaveValue('0');
  assert.deepEqual(await page.getByLabel('Tipo', { exact: true }).locator('option').evaluateAll(items => items.map(item => item.value).sort()), ['benefit', 'checking', 'investment', 'payment', 'property', 'savings', 'wallet']);
  for (const column of ['Conta', 'Tipo', 'Saldo atual']) await expect(accounts().getByRole('columnheader', { name: column, exact: true })).toBeVisible();
  await expect(accountRow('222')).toContainText('Conta corrente');
  await expect(accountRow('222')).toContainText('R$ 0,00');
  const fieldBoxes = await Promise.all(['Nome', 'Tipo', 'Saldo inicial', 'Cor'].map(label => page.getByLabel(label, { exact: true }).boundingBox()));
  assert.ok(fieldBoxes.every(box => box && Math.abs(box.y - fieldBoxes[0].y) < 5), 'Desktop creation controls sit on one row');
  await page.screenshot({ path: 'out/account-layout-test/desktop-dark.png', fullPage: true });

  stage = 'adding an account and persisting its color';
  const bank = await addAccount('Banco com cor', 'checking', '1.000,00', '#ab1234');
  assert.equal(bank.balance_cents, 100000, 'Brazilian opening amount is interpreted as integer cents');
  assert.equal(bank.kind, 'checking');
  const settingsAfterCreation = await rpc('get_user_settings');
  assert.equal(settingsAfterCreation.preferences[`account_color:${bank.id}`], '#ab1234', 'Selected color persists in per-user preferences');
  const rgb = 'rgb(171, 18, 52)';
  await expect(accountRow(bank.name).locator('.account-color-dot')).toHaveCSS('background-color', rgb);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '1. Contas', exact: true }).click();
  await expect(accountRow(bank.name)).toContainText('R$ 1.000,00');
  await expect(accountRow(bank.name).locator('.account-color-dot')).toHaveCSS('background-color', rgb);

  stage = 'editing account details and checking balances';
  await accountRow(bank.name).getByRole('button', { name: `Editar conta ${bank.name}`, exact: true }).click();
  await page.getByLabel('Nome da conta', { exact: true }).fill('Banco editado');
  await page.getByLabel('Instituição', { exact: true }).fill('Banco local de teste');
  await page.getByRole('button', { name: 'Salvar conta', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Alterações salvas');
  const edited = (await management()).accounts.find(item => item.id === bank.id);
  assert.equal(edited.name, 'Banco editado'); assert.equal(edited.institution_name, 'Banco local de teste');
  await expect(accountRow(edited.name).locator('.account-color-dot')).toHaveCSS('background-color', rgb);
  await accountRow(edited.name).getByRole('button', { name: `Editar conta ${edited.name}`, exact: true }).click();
  await options(edited.name).getByRole('button', { name: 'Conferir saldo com o extrato', exact: true }).click();
  const beforeCheck = await snapshot();
  await options(edited.name).getByLabel('Saldo do extrato (R$)', { exact: true }).fill('1.005,00');
  await options(edited.name).getByRole('button', { name: 'Comparar saldos', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Conferência salva' })).toBeVisible();
  const afterCheck = await snapshot();
  assert.equal(afterCheck.accounts.find(item => item.id === bank.id).balance_cents, 100000, 'Comparing the statement does not move money');
  assert.deepEqual(afterCheck.transactions, beforeCheck.transactions, 'Balance checking produces no transaction');
  await options(edited.name).getByRole('button', { name: 'Cancelar', exact: true }).click();

  stage = 'excluding retains account history';
  const closed = await addAccount('Conta encerrada', 'payment', '25,00', '#0ea5e9');
  await rpc('transfer_between_accounts', { p_space: space, p_from: closed.id, p_to: bank.id, p_amount_cents: 2500, p_occurred_on: today, p_client_uuid: randomUUID() });
  await page.getByRole('button', { name: 'Atualizar', exact: true }).first().click();
  await expect(accountRow(closed.name)).toContainText('R$ 0,00');
  const beforeArchive = await snapshot();
  const transactionDetails = await Promise.all(beforeArchive.transactions.map(item => rpc('transaction_detail', { p_space: space, p_transaction: item.id })));
  const history = transactionDetails.filter(item => item.entries.some(entry => entry.ledger_account_id === closed.ledger_account_id));
  assert.ok(history.length >= 2, 'The ended account has opening and transfer history');
  await accountRow(closed.name).getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(accountRow(closed.name)).toHaveCount(0);
  assert.ok((await management()).accounts.find(item => item.id === closed.id).archived_at, 'Excluir archives the account');
  const afterArchive = await snapshot();
  for (const transaction of history) {
    const retained = await rpc('transaction_detail', { p_space: space, p_transaction: transaction.transaction.id });
    assert.deepEqual(retained.transaction, transaction.transaction, 'Excluding preserves the transaction header');
    assert.deepEqual(retained.entries, transaction.entries, 'Excluding preserves the original entries');
  }
  assert.equal(afterArchive.accounts.find(item => item.id === bank.id).balance_cents, beforeArchive.accounts.find(item => item.id === bank.id).balance_cents, 'Excluding cannot move another account balance');

  stage = 'privacy and mobile layout';
  await page.getByRole('button', { name: 'Ocultar valores', exact: true }).click();
  await expect(accounts()).toContainText('••••');
  await expect(accounts()).not.toContainText(/R\$\s*\d/);
  await page.getByRole('button', { name: 'Mostrar valores', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Adicionar conta', exact: true })).toBeEnabled();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Accounts have no horizontal page overflow on a phone');
  for (const label of ['Nome', 'Tipo', 'Saldo inicial', 'Cor']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  await expect(accountRow(edited.name).getByRole('button', { name: 'Excluir', exact: true })).toBeVisible();
  await page.screenshot({ path: 'out/account-layout-test/mobile-dark.png', fullPage: true });

  stage = 'viewer permissions';
  const readOnlyPage = await openPage(viewer);
  await expect(readOnlyPage.getByRole('button', { name: 'Adicionar conta', exact: true })).toHaveCount(0);
  await expect(readOnlyPage.getByRole('button', { name: 'Excluir', exact: true })).toHaveCount(0);
  await expect(readOnlyPage.getByRole('button', { name: /^Editar conta / })).toHaveCount(0);
  await expect(readOnlyPage.getByRole('table', { name: 'Contas', exact: true })).toContainText('Banco editado');
  await readOnlyPage.screenshot({ path: 'out/account-layout-test/viewer-dark.png', fullPage: true });
  assert.deepEqual(errors, [], 'Account flows produce no uncaught browser exceptions');
  console.log('Account layout passed: compact persistent form, account table, desktop/mobile, BRL opening balance, persisted color, details/edit, comparison does not mutate money, exclusion retains history, privacy, viewer read only.');
} catch (failure) {
  await page?.screenshot({ path: 'out/account-layout-test/failure.png', fullPage: true });
  console.log(`Account layout failed at ${stage}.`);
  if (page) console.log((await page.locator('main').innerText()).slice(-3500));
  throw failure;
} finally {
  await browser?.close(); await server.close();
  await owner.client.auth.signOut(); await viewer.client.auth.signOut();
}
