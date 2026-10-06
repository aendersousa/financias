import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// All fixtures use local Supabase; auth tokens are kept in memory.
const status = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'npx supabase status -o json 2>$null'], { encoding: 'utf8', windowsHide: true }));
assert.equal(new URL(status.API_URL).hostname, '127.0.0.1', 'Category checks must never mutate production');
process.env.VITE_SUPABASE_URL = status.API_URL;
process.env.VITE_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.VITE_FINANCIAL_MODEL = 'ledger';
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, authOptions);
async function identity() {
  const email = `categorias-${randomUUID().slice(0, 8)}@test.local`, password = randomUUID();
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
const space = await rpc('create_space', { p_name: 'Referência de categorias', p_kind: 'shared', p_timezone: 'America/Sao_Paulo' });
await rpc('initialize_space_defaults', { p_space: space });
const snapshot = () => rpc('workspace_snapshot', { p_space: space });
const management = () => rpc('management_data', { p_space: space });
const today = (await snapshot()).space.today;
const account = await rpc('create_financial_account', { p_space: space, p_name: 'Conta para conferir histórico', p_kind: 'checking', p_opening_cents: 100000, p_opening_on: today });
for (const [name, kind, color] of [
  ['Salário', 'income', '#22c55e'], ['Freelance', 'income', '#16a34a'],
  ['Investimentos', 'income', '#0ea5e9'], ['Outras receitas', 'income', '#64748b'],
  ['Alimentação', 'expense', '#f97316'], ['Transporte', 'expense', '#eab308'],
  ['Moradia', 'expense', '#a855f7'], ['Saúde', 'expense', '#ef4444'],
  ['Educação', 'expense', '#3b82f6'], ['Lazer', 'expense', '#ec4899'],
  ['Compras', 'expense', '#f43f5e'], ['Outras despesas', 'expense', '#64748b'],
]) {
  const id = await rpc('create_category', { p_space: space, p_name: name, p_kind: kind, p_income_class: kind === 'income' ? 'recurring' : null });
  const item = (await management()).categories.find(category => category.id === id);
  await rpc('manage_category', { p_space: space, p_category: id, p_version: item.version, p_action: 'update', p_changes: { color } });
}
const invitation = await rpc('invite_space_member', { p_space: space, p_email: viewer.email, p_role: 'viewer', p_nickname: 'Leitor' });
await rpc('accept_space_invitation', { p_token: invitation.token }, viewer);
for (const user of [owner, viewer]) {
  const settings = await rpc('get_user_settings', {}, user);
  await rpc('update_user_settings', { p_version: settings.version, p_changes: { active_financial_space_id: space, theme: 'dark' } }, user);
}
const server = await createServer({ configFile: 'vite.pwa.config.ts', server: { host: '127.0.0.1', port: 4184, strictPort: true } });
await server.listen();
await mkdir('out/category-layout-test', { recursive: true });
let browser, page;
const errors = [];
let stage = 'startup';
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  async function openPage(user) {
    const context = await browser.newContext({ viewport: { width: 1663, height: 950 } });
    const next = await context.newPage();
    next.on('pageerror', failure => errors.push(failure.message));
    await next.route('**/rest/v1/rpc/**', route => {
      assert.equal(new URL(route.request().url()).hostname, '127.0.0.1', 'Browser RPCs must be local');
      return route.continue();
    });
    await next.addInitScript(session => localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), user.session);
    await next.goto('http://127.0.0.1:4184/financias/');
    await expect(next.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
    await next.getByRole('button', { name: '2. Categorias', exact: true }).click();
    await expect(next.getByRole('heading', { name: 'Categorias', exact: true })).toBeVisible();
    await expect(next.getByRole('heading', { name: 'Receitas', exact: true })).toBeVisible();
    await expect(next.getByRole('heading', { name: 'Despesas', exact: true })).toBeVisible();
    await expect(next.getByRole('alert')).toHaveCount(0);
    return next;
  }
  page = await openPage(owner);
  const panel = name => page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const categoryRow = name => page.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Editar categoria ${name}`, exact: true }) });
  stage = 'reference layout';
  await expect(page.getByText('Organize receitas e despesas por categoria', { exact: true })).toBeVisible();
  for (const label of ['Nome', 'Tipo', 'Cor']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar categoria', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cadastrar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Lançamento rápido e fila de envio', exact: true })).toHaveCount(0);
  await expect(panel('Receitas').getByRole('button', { name: 'Editar categoria Salário', exact: true })).toBeVisible();
  await expect(panel('Despesas').getByRole('button', { name: 'Editar categoria Alimentação', exact: true })).toBeVisible();
  const incomeBox = await panel('Receitas').boundingBox(), expenseBox = await panel('Despesas').boundingBox();
  assert.ok(incomeBox && expenseBox && Math.abs(incomeBox.y - expenseBox.y) < 2 && expenseBox.x > incomeBox.x, 'Desktop has two category lists side by side');
  await page.screenshot({ path: 'out/category-layout-test/desktop-dark.png', fullPage: true });

  stage = 'adding colored categories';
  for (const [name, kind, color, group] of [
    ['Receita criada no formulário', 'income', '#12ab34', 'Receitas'],
    ['Despesa criada no formulário', 'expense', '#ab1234', 'Despesas'],
  ]) {
    await page.getByLabel('Nome', { exact: true }).fill(name);
    await page.getByLabel('Tipo', { exact: true }).selectOption(kind);
    await page.getByLabel('Cor', { exact: true }).evaluate((element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, color);
    await page.getByRole('button', { name: 'Adicionar categoria', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Categoria adicionada');
    await expect(panel(group).getByRole('button', { name: `Editar categoria ${name}`, exact: true })).toBeVisible();
    const saved = (await management()).categories.find(item => item.name === name);
    assert.equal(saved.kind, kind); assert.equal(saved.color, color, 'Selected color is persisted by category administration');
    const rgb = `rgb(${[1, 3, 5].map(start => Number.parseInt(color.slice(start, start + 2), 16)).join(', ')})`;
    await expect(categoryRow(name).locator('.category-color-dot')).toHaveCSS('background-color', rgb);
  }
  await page.reload();
  await page.getByRole('button', { name: '2. Categorias', exact: true }).click();
  await expect(categoryRow('Despesa criada no formulário')).toBeVisible();
  await expect(categoryRow('Receita criada no formulário')).toBeVisible();

  stage = 'editing and excluding preserve history';
  const category = (await management()).categories.find(item => item.name === 'Despesa criada no formulário');
  const beforePosting = await snapshot();
  const transaction = await rpc('post_transaction', { p_space: space, p_payload: {
    kind: 'expense', occurred_on: today, competence_month: `${today.slice(0, 7)}-01`,
    description: 'Lançamento preservado após excluir categoria', client_uuid: randomUUID(),
    entries: [{ ledger_account_id: category.ledger_account_id, amount_cents: 1234 }, { ledger_account_id: beforePosting.accounts.find(item => item.id === account).ledger_account_id, amount_cents: -1234 }],
  } });
  await categoryRow(category.name).getByRole('button', { name: `Editar categoria ${category.name}`, exact: true }).click();
  await page.getByLabel('Nome da categoria', { exact: true }).fill('Despesa editada no formulário');
  await page.getByRole('button', { name: 'Salvar categoria', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Alterações salvas');
  const edited = (await management()).categories.find(item => item.id === category.id);
  assert.equal(edited.name, 'Despesa editada no formulário'); assert.equal(edited.color, '#ab1234');
  const beforeArchive = await snapshot();
  await categoryRow(edited.name).getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(categoryRow(edited.name)).toHaveCount(0);
  assert.ok((await management()).categories.find(item => item.id === category.id).archived_at, 'Excluir archives the category');
  const afterArchive = await snapshot();
  assert.deepEqual(afterArchive.transactions.find(item => item.id === transaction), beforeArchive.transactions.find(item => item.id === transaction), 'Archiving retains the original posting and its history');
  assert.equal(afterArchive.accounts.find(item => item.id === account).balance_cents, beforeArchive.accounts.find(item => item.id === account).balance_cents, 'Archiving cannot change money');
  assert.ok(afterArchive.transactions.some(item => item.description === 'Lançamento preservado após excluir categoria'));

  stage = 'mobile layout';
  await expect(page.getByRole('button', { name: 'Adicionar categoria', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Categories have no horizontal page overflow on a phone');
  for (const label of ['Nome', 'Tipo', 'Cor']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  const mobileIncome = await panel('Receitas').boundingBox(), mobileExpense = await panel('Despesas').boundingBox();
  assert.ok(mobileIncome && mobileExpense && mobileExpense.y >= mobileIncome.y + mobileIncome.height, 'Mobile stacks the income and expense lists');
  await page.screenshot({ path: 'out/category-layout-test/mobile-dark.png', fullPage: true });

  stage = 'viewer permissions';
  const readOnlyPage = await openPage(viewer);
  await expect(readOnlyPage.getByRole('button', { name: 'Adicionar categoria', exact: true })).toHaveCount(0);
  await expect(readOnlyPage.getByRole('button', { name: 'Excluir', exact: true })).toHaveCount(0);
  await expect(readOnlyPage.getByRole('button', { name: /^Editar categoria / })).toHaveCount(0);
  await expect(readOnlyPage.getByText('Salário', { exact: true })).toBeVisible();
  await readOnlyPage.screenshot({ path: 'out/category-layout-test/viewer-dark.png', fullPage: true });
  assert.deepEqual(errors, [], 'Category flows produce no uncaught browser exceptions');
  console.log('Category layout passed: compact persistent form, two lists, desktop/mobile, colored income/expense creation, edit, archive preserves postings and balances, viewer read only.');
} catch (failure) {
  await page?.screenshot({ path: 'out/category-layout-test/failure.png', fullPage: true });
  console.log(`Category layout failed at ${stage}.`);
  if (page) console.log((await page.locator('main').innerText()).slice(-3500));
  throw failure;
} finally {
  await browser?.close(); await server.close();
  await owner.client.auth.signOut(); await viewer.client.auth.signOut();
}
