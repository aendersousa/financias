import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// Both fixture writes and browser RPCs are confined to local Supabase.
const status = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'npx supabase status -o json 2>$null'], { encoding:'utf8', windowsHide:true }));
assert.equal(new URL(status.API_URL).hostname, '127.0.0.1', 'Card layout checks must never mutate production');
process.env.VITE_SUPABASE_URL = status.API_URL;
process.env.VITE_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.VITE_FINANCIAL_MODEL = 'ledger';
const authOptions = { auth:{ persistSession:false, autoRefreshToken:false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, authOptions);
async function identity() {
  const email = `cartoes-${randomUUID().slice(0, 8)}@test.local`, password = randomUUID();
  const { error:creationError } = await admin.auth.admin.createUser({ email, password, email_confirm:true });
  if (creationError) throw new Error(creationError.message);
  const client = createClient(status.API_URL, status.ANON_KEY, authOptions);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return { email, client, session:data.session };
}
const owner = await identity(), viewer = await identity();
async function rpc(name, args = {}, user = owner) {
  const { data, error } = await user.client.schema('api').rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}
const space = await rpc('create_space', { p_name:'Referência de cartões', p_kind:'shared', p_timezone:'America/Sao_Paulo' });
await rpc('initialize_space_defaults', { p_space:space });
const snapshot = () => rpc('workspace_snapshot', { p_space:space });
const management = () => rpc('card_management_summary', { p_space:space });
const today = (await snapshot()).space.today;
const bank = await rpc('create_financial_account', { p_space:space, p_name:'Conta de pagamento local', p_kind:'checking', p_opening_cents:100000, p_opening_on:today });
const category = await rpc('create_category', { p_space:space, p_name:'Compra local', p_kind:'expense' });
const originalCard = await rpc('create_credit_card', { p_space:space, p_name:'Cartão de referência', p_limit_cents:500000, p_closing_day:1, p_due_day:10, p_payment_account:bank });
await rpc('record_card_purchase', { p_space:space, p_card:originalCard, p_category:category, p_total_cents:12000, p_installments:2, p_on:today, p_description:'Compra com histórico preservado', p_client_uuid:randomUUID() });
const invitation = await rpc('invite_space_member', { p_space:space, p_email:viewer.email, p_role:'viewer', p_nickname:'Leitor' });
await rpc('accept_space_invitation', { p_token:invitation.token }, viewer);
for (const user of [owner, viewer]) {
  const settings = await rpc('get_user_settings', {}, user);
  await rpc('update_user_settings', { p_version:settings.version, p_changes:{ active_financial_space_id:space, theme:'dark' } }, user);
}
const server = await createServer({ configFile:'vite.pwa.config.ts', server:{ host:'127.0.0.1', port:4187, strictPort:true } });
await server.listen();
await mkdir('out/card-layout-test', { recursive:true });
let browser, page;
const errors = [];
let stage = 'startup';
try {
  browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
  async function openPage(user) {
    const context = await browser.newContext({ viewport:{ width:1663, height:900 } });
    const next = await context.newPage();
    next.on('pageerror', failure => errors.push(failure.message));
    await next.route('**/rest/v1/rpc/**', route => {
      assert.equal(new URL(route.request().url()).hostname, '127.0.0.1', 'Browser RPCs must be local');
      return route.continue();
    });
    await next.addInitScript(session => localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), user.session);
    await next.goto('http://127.0.0.1:4187/financias/');
    await expect(next.getByRole('heading', { name:'Visão geral', exact:true })).toBeVisible();
    await next.getByRole('button', { name:'3. Cartões', exact:true }).click();
    await expect(next.getByRole('heading', { name:'Cartões', exact:true })).toBeVisible();
    await expect(next.getByRole('table', { name:'Cartões', exact:true })).toBeVisible();
    await expect(next.getByRole('alert')).toHaveCount(0);
    return next;
  }
  page = await openPage(owner);
  const form = () => page.getByRole('form', { name:'Adicionar cartão', exact:true });
  const table = () => page.getByRole('table', { name:'Cartões', exact:true });
  const cardRow = name => table().getByRole('row').filter({ has:page.getByRole('button', { name:`Editar cartão ${name}`, exact:true }) });
  const details = name => page.getByRole('region', { name:`Detalhes do cartão ${name}`, exact:true });

  stage = 'reference layout';
  const labels = ['Nome', 'Limite', 'Dia de fechamento', 'Dia de vencimento', 'Conta de pagamento'];
  for (const label of labels) await expect(form().getByLabel(label, { exact:true })).toBeVisible();
  await expect(form().getByRole('button', { name:'Adicionar cartão', exact:true })).toBeEnabled();
  await expect(page.getByRole('button', { name:'Cadastrar', exact:true })).toHaveCount(0);
  await expect(page.getByRole('region', { name:'Lançamento rápido e fila de envio', exact:true })).toHaveCount(0);
  await expect(page.getByRole('region', { name:'Gestão dos cartões', exact:true })).toHaveCount(0);
  await expect(form().getByLabel('Conta de pagamento', { exact:true })).toHaveValue('');
  await expect(form().getByLabel('Conta de pagamento', { exact:true }).locator('option[value=""]')).toHaveText('Selecionar ao pagar');
  for (const column of ['Cartão', 'Limite', 'Utilizado', 'Disponível', 'Fechamento', 'Vencimento']) await expect(table().getByRole('columnheader', { name:column, exact:true })).toBeVisible();
  await expect(cardRow('Cartão de referência')).toContainText('R$ 5.000,00');
  await expect(cardRow('Cartão de referência')).toContainText('R$ 120,00');
  await expect(cardRow('Cartão de referência')).toContainText('R$ 4.880,00');
  const fieldBoxes = await Promise.all(labels.map(label => form().getByLabel(label, { exact:true }).boundingBox()));
  assert.ok(fieldBoxes.every(box => box && Math.abs(box.y - fieldBoxes[0].y) < 5), 'Desktop card creation controls sit on one row');
  await page.screenshot({ path:'out/card-layout-test/desktop-dark.png', fullPage:true });

  stage = 'BRL creation and optional payment account';
  const beforeCreate = await snapshot();
  await form().getByLabel('Nome', { exact:true }).fill('Cartão novo');
  await form().getByLabel('Limite', { exact:true }).fill('1.234,56');
  await form().getByLabel('Dia de fechamento', { exact:true }).fill('5');
  await form().getByLabel('Dia de vencimento', { exact:true }).fill('15');
  await form().getByRole('button', { name:'Adicionar cartão', exact:true }).click();
  await expect(page.getByRole('status')).toContainText('Cartão adicionado');
  await expect(cardRow('Cartão novo')).toContainText('R$ 1.234,56');
  const created = (await management()).cards.find(item => item.name === 'Cartão novo');
  assert.equal(created.granted_cents, 123456, 'Brazilian limit text is interpreted as integer cents');
  assert.equal(created.default_payment_financial_account_id, null, 'A card can be created without committing to a payment account');
  assert.equal(created.balance_cents, 0);
  assert.equal((await snapshot()).accounts.find(item => item.id === bank).balance_cents, beforeCreate.accounts.find(item => item.id === bank).balance_cents, 'Creating a card does not alter a bank balance');
  assert.deepEqual((await snapshot()).transactions, beforeCreate.transactions, 'Creating a card creates no money movement');

  stage = 'editing card rules preserves debt and history';
  const beforeEdit = (await management()).cards.find(item => item.id === originalCard);
  const beforeEditSnapshot = await snapshot();
  await cardRow('Cartão de referência').getByRole('button', { name:'Editar cartão Cartão de referência', exact:true }).click();
  const editor = details('Cartão de referência').getByRole('region', { name:'Gestão dos cartões', exact:true });
  await editor.getByLabel('Nome', { exact:true }).fill('Cartão editado');
  await editor.getByLabel('Dia de fechamento', { exact:true }).fill('11');
  await editor.getByLabel('Dia de vencimento', { exact:true }).fill('19');
  await editor.getByRole('button', { name:'Salvar', exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Regras atualizadas' })).toBeVisible();
  const edited = (await management()).cards.find(item => item.id === originalCard);
  assert.equal(edited.name, 'Cartão editado');
  assert.equal(edited.closing_day, 11); assert.equal(edited.due_day, 19);
  assert.equal(edited.balance_cents, beforeEdit.balance_cents, 'Editing card rules preserves card debt');
  assert.equal(edited.granted_cents, beforeEdit.granted_cents, 'Editing rules preserves the limit');
  assert.equal(edited.used_cents, beforeEdit.used_cents, 'Editing rules preserves utilized limit');
  assert.deepEqual(edited.statements.map(item => item.id).sort(), beforeEdit.statements.map(item => item.id).sort(), 'Rule changes retain the original statements');
  assert.deepEqual((await snapshot()).transactions, beforeEditSnapshot.transactions, 'Editing card rules does not create or alter transactions');
  await cardRow('Cartão editado').getByRole('button', { name:'Ver detalhes do cartão Cartão editado', exact:true }).click();
  await expect(details('Cartão editado')).toHaveCount(0);

  stage = 'cancelled and archived cards remain recoverable';
  await cardRow('Cartão novo').getByRole('button', { name:'Ver detalhes do cartão Cartão novo', exact:true }).click();
  const lifecycle = details('Cartão novo').getByRole('region', { name:'Gestão dos cartões', exact:true });
  await lifecycle.getByRole('button', { name:'Cancelar cartão', exact:true }).click();
  await expect.poll(async () => (await management()).cards.find(item => item.id === created.id).status).toBe('cancelled');
  await expect(cardRow('Cartão novo')).toBeVisible();
  await lifecycle.getByRole('button', { name:'Arquivar cartão', exact:true }).click();
  await expect.poll(async () => (await management()).cards.find(item => item.id === created.id).status).toBe('archived');
  await expect(cardRow('Cartão novo')).toBeVisible();
  await lifecycle.getByRole('button', { name:'Desarquivar cartão', exact:true }).click();
  await expect.poll(async () => (await management()).cards.find(item => item.id === created.id).status).toBe('cancelled');
  await lifecycle.getByRole('button', { name:'Reativar cartão', exact:true }).click();
  await expect.poll(async () => (await management()).cards.find(item => item.id === created.id).status).toBe('active');
  assert.equal((await management()).cards.find(item => item.id === created.id).granted_cents, 123456, 'Card lifecycle retains the limit');
  await cardRow('Cartão novo').getByRole('button', { name:'Ver detalhes do cartão Cartão novo', exact:true }).click();
  await expect(details('Cartão novo')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name:'Visão geral', exact:true })).toBeVisible();
  await page.getByRole('button', { name:'3. Cartões', exact:true }).click();
  await expect(cardRow('Cartão editado')).toContainText('R$ 120,00');
  await expect(cardRow('Cartão novo')).toContainText('R$ 1.234,56');
  await expect(page.getByRole('region', { name:'Gestão dos cartões', exact:true })).toHaveCount(0);

  stage = 'privacy and responsive layouts in both themes';
  await page.getByRole('button', { name:'Ocultar valores', exact:true }).click();
  await expect(table()).toContainText('••••');
  await expect(table()).not.toContainText(/R\$\s*\d/);
  await page.getByRole('button', { name:'Mostrar valores', exact:true }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), theme);
    await page.setViewportSize({ width:1663, height:900 });
    await expect(table()).toHaveCSS('color', theme === 'dark' ? 'rgb(237, 241, 243)' : 'rgb(20, 30, 37)');
    await expect(cardRow('Cartão editado')).toHaveCSS('color', theme === 'dark' ? 'rgb(237, 241, 243)' : 'rgb(20, 30, 37)');
    await page.screenshot({ path:`out/card-layout-test/desktop-${theme}.png`, fullPage:true });
    await page.setViewportSize({ width:390, height:844 });
    for (const label of labels) await expect(form().getByLabel(label, { exact:true })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Cards have no horizontal page overflow on a phone');
    await expect(cardRow('Cartão editado').getByRole('button', { name:'Ver detalhes do cartão Cartão editado', exact:true })).toBeVisible();
    await page.screenshot({ path:`out/card-layout-test/mobile-${theme}.png`, fullPage:true });
  }

  stage = 'viewer has details without mutation controls';
  const readOnlyPage = await openPage(viewer);
  await expect(readOnlyPage.getByRole('form', { name:'Adicionar cartão', exact:true })).toHaveCount(0);
  await expect(readOnlyPage.getByRole('button', { name:/^Editar cartão / })).toHaveCount(0);
  await readOnlyPage.getByRole('button', { name:'Ver detalhes do cartão Cartão editado', exact:true }).click();
  const viewerDetails = readOnlyPage.getByRole('region', { name:'Detalhes do cartão Cartão editado', exact:true });
  await expect(viewerDetails.getByRole('region', { name:'Gestão dos cartões', exact:true })).toBeVisible();
  await expect(viewerDetails.getByRole('button', { name:/^(Salvar|Cancelar cartão|Arquivar cartão|Reativar cartão|Desarquivar cartão)$/ })).toHaveCount(0);
  await expect(viewerDetails.getByRole('textbox')).toHaveCount(0);
  await readOnlyPage.screenshot({ path:'out/card-layout-test/viewer-dark.png', fullPage:true });

  stage = 'cached cards are read only when offline';
  await page.evaluate(async () => {
    const storage = await import('/financias/src/lib/offlineStorage.ts');
    if (!await storage.cachedWorkspace()) throw new Error('The active workspace must be cached before testing offline');
  });
  await page.route('**/rest/v1/**', route => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText:'Sem conexão' })).toBeVisible();
  await page.getByRole('button', { name:'3. Cartões', exact:true }).click();
  await expect(table()).toContainText('Cartão editado');
  await expect(table()).toContainText('R$ 120,00');
  await expect(page.getByRole('form', { name:'Adicionar cartão', exact:true })).toHaveCount(0);
  await expect(table().getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('region', { name:'Gestão dos cartões', exact:true })).toHaveCount(0);
  await page.screenshot({ path:'out/card-layout-test/offline-mobile-dark.png', fullPage:true });
  assert.deepEqual(errors, [], 'Card flows produce no uncaught browser exceptions');
  console.log('Card layout passed: persistent compact form, BRL creation, optional payment account, table, preserved debt/limit/history, cancel/archive/restore, private values, desktop/mobile in both themes, viewer read only and cached offline table.');
} catch (failure) {
  await page?.screenshot({ path:'out/card-layout-test/failure.png', fullPage:true });
  console.log(`Card layout failed at ${stage}.`);
  if (page) console.log((await page.locator('main').innerText()).slice(-4000));
  throw failure;
} finally {
  await browser?.close(); await server.close();
  await owner.client.auth.signOut(); await viewer.client.auth.signOut();
}
