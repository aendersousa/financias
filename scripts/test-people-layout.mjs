import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// Isolated identities and every browser RPC are confined to local Supabase.
const status = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'npx supabase status -o json 2>$null'], { encoding:'utf8', windowsHide:true }));
assert.equal(new URL(status.API_URL).hostname, '127.0.0.1', 'People layout checks must never mutate production');
process.env.VITE_SUPABASE_URL = status.API_URL;
process.env.VITE_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.VITE_FINANCIAL_MODEL = 'ledger';
const authOptions = { auth:{ persistSession:false, autoRefreshToken:false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, authOptions);
async function identity() {
  const email = `pessoas-${randomUUID().slice(0, 8)}@test.local`, password = randomUUID();
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
const space = await rpc('create_personal_space', { p_name:'Referência de pessoas' });
await rpc('initialize_space_defaults', { p_space:space });
const snapshot = () => rpc('workspace_snapshot', { p_space:space });
const management = () => rpc('people_management_summary', { p_space:space, p_include_archived:true });
const today = (await snapshot()).space.today;
const consumption = async () => (await rpc('reports_summary', { p_space:space, p_month:`${today.slice(0, 7)}-01` })).consumption;
const bank = await rpc('create_financial_account', { p_space:space, p_name:'Conta de pessoas local', p_kind:'checking', p_opening_cents:100000, p_opening_on:today });
const category = await rpc('create_category', { p_space:space, p_name:'Jantar local', p_kind:'expense' });
const settings = await rpc('get_user_settings');
await rpc('update_user_settings', { p_version:settings.version, p_changes:{ active_financial_space_id:space, theme:'dark' } });
const server = await createServer({ configFile:'vite.pwa.config.ts', server:{ host:'127.0.0.1', port:4188, strictPort:true } });
await server.listen();
await mkdir('out/people-layout-test', { recursive:true });
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
    await next.goto('http://127.0.0.1:4188/financias/');
    await expect(next.getByRole('heading', { name:'Visão geral', exact:true })).toBeVisible();
    await next.getByRole('button', { name:'Pessoas', exact:true }).click();
    await expect(next.getByRole('heading', { name:'Pessoas', exact:true })).toBeVisible();
    await expect(next.getByRole('table', { name:'Pessoas', exact:true })).toBeVisible();
    await expect(next.getByRole('alert')).toHaveCount(0);
    return next;
  }
  page = await openPage(owner);
  const form = () => page.getByRole('form', { name:'Adicionar pessoa', exact:true });
  const table = () => page.getByRole('table', { name:'Pessoas', exact:true });
  const personRow = name => table().getByRole('row').filter({ has:page.getByRole('button', { name:`Editar pessoa ${name}`, exact:true }) });
  const details = name => page.getByRole('region', { name:`Detalhes da pessoa ${name}`, exact:true });
  async function createPerson(name, notes = '') {
    await form().getByLabel('Apelido da pessoa', { exact:true }).fill(name);
    await form().getByLabel('Observações da pessoa', { exact:true }).fill(notes);
    await form().getByRole('button', { name:'Adicionar pessoa', exact:true }).click();
    await expect(personRow(name)).toBeVisible();
    await expect(form().getByLabel('Apelido da pessoa', { exact:true })).toHaveValue('');
    return (await management()).people.find(item => item.nickname === name);
  }
  async function openDetails(name) {
    if (!await details(name).count()) await personRow(name).getByRole('button', { name:`Ver detalhes da pessoa ${name}`, exact:true }).click();
    await expect(details(name).getByRole('heading', { name:'Movimentos', exact:true })).toBeVisible();
    await expect(details(name).getByText('Carregando histórico…', { exact:true })).toHaveCount(0);
    return details(name);
  }
  async function settle(name, amount, direction = 'receive') {
    const personDetails = await openDetails(name);
    await personDetails.getByRole('button', { name:'Registrar recebimento ou pagamento', exact:true }).click();
    const movement = page.getByRole('form', { name:'Movimentação com pessoa', exact:true });
    await expect(movement.getByLabel('Tipo de movimentação com pessoa', { exact:true }).locator('option')).toHaveText([
      'Recebi o que a pessoa me devia', 'Paguei o que devia à pessoa', 'Emprestei dinheiro à pessoa', 'Recebi dinheiro emprestado da pessoa'
    ]);
    await movement.getByLabel('Tipo de movimentação com pessoa', { exact:true }).selectOption(direction);
    await movement.getByLabel('Conta da movimentação com pessoa', { exact:true }).selectOption(bank);
    await movement.getByLabel('Valor com pessoas (R$)', { exact:true }).fill(amount);
    await movement.getByRole('button', { name:'Confirmar movimentação com pessoas', exact:true }).click();
    await expect(page.getByRole('status').filter({ hasText:'Movimentação com pessoas registrada' })).toBeVisible();
    await expect(movement).toHaveCount(0);
  }

  stage = 'persistent compact form and empty table';
  for (const label of ['Apelido da pessoa', 'Observações da pessoa']) await expect(form().getByLabel(label, { exact:true })).toBeVisible();
  await expect(form().getByRole('button', { name:'Adicionar pessoa', exact:true })).toBeEnabled();
  await expect(page.getByRole('button', { name:'Cadastrar', exact:true })).toHaveCount(0);
  await expect(page.getByRole('region', { name:'Lançamento rápido e fila de envio', exact:true })).toHaveCount(0);
  await expect(page.getByLabel('Consultar pessoa', { exact:true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name:'Valores com pessoas', exact:true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name:'Incluir pessoas arquivadas', exact:true })).toHaveCount(0);
  for (const column of ['Pessoa', 'Situação', 'Saldo']) await expect(table().getByRole('columnheader', { name:column, exact:true })).toBeVisible();
  await expect(table()).toContainText('Nenhuma pessoa cadastrada');
  const boxes = await Promise.all(['Apelido da pessoa', 'Observações da pessoa'].map(label => form().getByLabel(label, { exact:true }).boundingBox()));
  assert.ok(boxes.every(box => box && Math.abs(box.y - boxes[0].y) < 5), 'Desktop person creation fields sit on one row');
  await page.screenshot({ path:'out/people-layout-test/empty-desktop-dark.png', fullPage:true });

  stage = 'creation does not move money';
  const beforeCreate = await snapshot();
  const ana = await createPerson('Ana local', 'Contato para conferir a dívida e seu histórico.');
  await createPerson('Bruno local');
  await createPerson('Contato sem uso local');
  assert.equal(ana.balance_cents, 0);
  assert.equal(ana.notes, 'Contato para conferir a dívida e seu histórico.');
  assert.deepEqual((await snapshot()).transactions, beforeCreate.transactions, 'Registering a person creates no money movement');
  assert.equal((await snapshot()).accounts.find(item => item.id === bank).balance_cents, 100000);
  await expect(personRow('Ana local')).toContainText('Acertado');
  await expect(personRow('Ana local')).toContainText('R$ 0,00');

  stage = 'initial receivable preserves cash and consumption';
  let anaDetails = await openDetails('Ana local');
  await expect(anaDetails).toContainText(ana.notes);
  const beforeOpeningConsumption = await consumption();
  await anaDetails.getByRole('button', { name:'Informar saldo inicial', exact:true }).click();
  await anaDetails.getByLabel('Saldo inicial da pessoa (R$)', { exact:true }).fill('50,00');
  await anaDetails.getByRole('button', { name:'Registrar saldo inicial', exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Saldo inicial registrado' })).toBeVisible();
  await expect(personRow('Ana local')).toContainText('A receber');
  await expect(personRow('Ana local')).toContainText('R$ 50,00');
  assert.equal((await snapshot()).accounts.find(item => item.id === bank).balance_cents, 100000, 'Opening an existing debt does not move cash');
  assert.deepEqual(await consumption(), beforeOpeningConsumption, 'Opening debt is outside income and expense');

  stage = 'editing nickname and notes preserves financial history';
  const beforeEdit = await snapshot();
  const beforeEditHistory = await rpc('person_detail', { p_space:space, p_person:ana.id });
  anaDetails = await openDetails('Ana local');
  await anaDetails.getByRole('button', { name:'Editar apelido e observações', exact:true }).click();
  await anaDetails.getByLabel('Apelido da pessoa', { exact:true }).fill('Ana editada');
  await anaDetails.getByLabel('Observações da pessoa', { exact:true }).fill('Observações revisadas sem alterar a dívida.');
  await anaDetails.getByRole('button', { name:'Salvar pessoa', exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Cadastro salvo' })).toBeVisible();
  await expect(personRow('Ana editada')).toContainText('R$ 50,00');
  const edited = (await management()).people.find(item => item.id === ana.id);
  assert.equal(edited.notes, 'Observações revisadas sem alterar a dívida.');
  assert.equal(edited.balance_cents, 5000);
  assert.deepEqual((await snapshot()).transactions, beforeEdit.transactions, 'Contact edits do not change transactions');
  assert.deepEqual((await rpc('person_detail', { p_space:space, p_person:ana.id })).movements, beforeEditHistory.movements, 'Contact edits preserve ledger history');
  await expect(details('Ana editada').getByRole('button', { name:'Informar saldo inicial', exact:true })).toHaveCount(0);

  stage = 'settling a receivable is not new income';
  const beforeSettlement = await consumption();
  await settle('Ana editada', '50,00');
  await expect(personRow('Ana editada')).toContainText('Acertado');
  assert.equal((await snapshot()).accounts.find(item => item.id === bank).balance_cents, 105000, 'Cash increases by the payment received');
  assert.equal((await management()).people.find(item => item.id === ana.id).balance_cents, 0, 'Receipt clears the receivable');
  assert.deepEqual(await consumption(), beforeSettlement, 'Receiving from a person creates neither income nor expense');

  stage = 'shared expense consumes only the payer share';
  await page.getByRole('button', { name:'Dividir uma despesa que eu paguei', exact:true }).click();
  const shared = page.getByRole('form', { name:'Despesa dividida em partes iguais', exact:true });
  await shared.getByLabel('Conta da movimentação com pessoa', { exact:true }).selectOption(bank);
  await shared.getByLabel('Valor com pessoas (R$)', { exact:true }).fill('120,00');
  await shared.getByLabel('Descrição da despesa dividida', { exact:true }).fill('Jantar de três pessoas');
  await shared.getByLabel('Categoria da despesa dividida', { exact:true }).selectOption(category);
  await shared.getByRole('checkbox', { name:'Ana editada', exact:true }).check();
  await shared.getByRole('checkbox', { name:'Bruno local', exact:true }).check();
  await shared.getByRole('button', { name:'Confirmar movimentação com pessoas', exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Movimentação com pessoas registrada' })).toBeVisible();
  await expect(shared).toHaveCount(0);
  await expect(personRow('Ana editada')).toContainText('R$ 40,00');
  await expect(personRow('Bruno local')).toContainText('R$ 40,00');
  assert.equal((await snapshot()).accounts.find(item => item.id === bank).balance_cents, 93000, 'Payer cash falls by the full R$ 120');
  assert.equal((await consumption()).expense_cents, beforeSettlement.expense_cents + 4000, 'Only the own R$ 40 share is consumption');

  stage = 'archive guards debt and restores original history';
  anaDetails = await openDetails('Ana editada');
  await anaDetails.getByRole('button', { name:'Arquivar pessoa', exact:true }).click();
  await expect(page.getByRole('alert').filter({ hasText:'Acerte o saldo atual e os movimentos agendados antes de arquivar' })).toBeVisible();
  assert.equal((await management()).people.find(item => item.id === ana.id).archived_at, null);
  await expect(anaDetails.getByRole('button', { name:'Excluir contato sem uso', exact:true })).toHaveCount(0);
  await settle('Ana editada', '40,00');
  anaDetails = await openDetails('Ana editada');
  const beforeArchiveHistory = await rpc('person_detail', { p_space:space, p_person:ana.id });
  await anaDetails.getByRole('button', { name:'Arquivar pessoa', exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Pessoa arquivada' })).toBeVisible();
  await expect(personRow('Ana editada')).toHaveCount(0);
  await page.locator('summary').filter({ hasText:'Pessoas arquivadas' }).click();
  await page.getByRole('checkbox', { name:'Incluir pessoas arquivadas', exact:true }).check();
  anaDetails = await openDetails('Ana editada');
  await expect(anaDetails).toContainText('Saldo inicial');
  await expect(anaDetails.getByRole('button', { name:'Registrar recebimento ou pagamento', exact:true })).toHaveCount(0);
  await anaDetails.getByRole('button', { name:'Desarquivar pessoa', exact:true }).click();
  await expect.poll(async () => (await management()).people.find(item => item.id === ana.id).archived_at).toBe(null);
  assert.deepEqual((await rpc('person_detail', { p_space:space, p_person:ana.id })).movements, beforeArchiveHistory.movements, 'Archive and restore retain all four ledger movements');
  anaDetails = await openDetails('Ana editada');
  await anaDetails.getByRole('button', { name:'Abrir Agenda', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Agenda', exact:true }).first()).toBeVisible();
  await page.getByRole('button', { name:'Pessoas', exact:true }).click();

  stage = 'unused contacts can be deleted';
  const unused = await openDetails('Contato sem uso local');
  await unused.getByRole('button', { name:'Excluir contato sem uso', exact:true }).click();
  await expect(personRow('Contato sem uso local')).toHaveCount(0);
  assert.equal((await management()).people.some(item => item.nickname === 'Contato sem uso local'), false);
  assert.equal((await snapshot()).accounts.find(item => item.id === bank).balance_cents, 97000, 'Contact lifecycle never changes cash');

  stage = 'privacy and responsive layouts in both themes';
  await page.getByRole('button', { name:'Ocultar valores', exact:true }).click();
  await expect(table()).toContainText('••••');
  await expect(table()).not.toContainText(/R\$\s*\d/);
  await page.getByRole('button', { name:'Mostrar valores', exact:true }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), theme);
    await page.setViewportSize({ width:1663, height:900 });
    await expect(table()).toHaveCSS('color', theme === 'dark' ? 'rgb(237, 241, 243)' : 'rgb(20, 30, 37)');
    await page.screenshot({ path:`out/people-layout-test/desktop-${theme}.png`, fullPage:true });
    await page.setViewportSize({ width:390, height:844 });
    for (const label of ['Apelido da pessoa', 'Observações da pessoa']) await expect(form().getByLabel(label, { exact:true })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'People have no horizontal page overflow on a phone');
    await expect(personRow('Bruno local').getByRole('button', { name:'Ver detalhes da pessoa Bruno local', exact:true })).toBeVisible();
    await page.screenshot({ path:`out/people-layout-test/mobile-${theme}.png`, fullPage:true });
  }

  stage = 'viewer reads history without mutation controls';
  // Shared spaces always contain member-person rows; keep the truly empty
  // personal workspace above separate from this viewer-permission fixture.
  const viewerSpace = await rpc('create_space', { p_name:'Leitura de pessoas', p_kind:'shared', p_timezone:'America/Sao_Paulo' });
  const viewerPerson = await rpc('create_person', { p_space:viewerSpace, p_nickname:'Ana editada', p_notes:'Histórico disponível ao leitor.' });
  await rpc('manage_person', { p_space:viewerSpace, p_person:viewerPerson, p_version:1, p_action:'opening', p_changes:{ balance_cents:5000, on:today }, p_client_uuid:randomUUID() });
  const invitation = await rpc('invite_space_member', { p_space:viewerSpace, p_email:viewer.email, p_role:'viewer', p_nickname:'Leitor local' });
  await rpc('accept_space_invitation', { p_token:invitation.token }, viewer);
  const viewerSettings = await rpc('get_user_settings', {}, viewer);
  await rpc('update_user_settings', { p_version:viewerSettings.version, p_changes:{ active_financial_space_id:viewerSpace, theme:'dark' } }, viewer);
  const readOnlyPage = await openPage(viewer);
  await expect(readOnlyPage.getByRole('form', { name:'Adicionar pessoa', exact:true })).toHaveCount(0);
  await expect(readOnlyPage.getByRole('button', { name:/^Editar pessoa / })).toHaveCount(0);
  await expect(readOnlyPage.getByRole('button', { name:'Dividir uma despesa que eu paguei', exact:true })).toHaveCount(0);
  await readOnlyPage.getByRole('button', { name:'Ver detalhes da pessoa Ana editada', exact:true }).click();
  const viewerDetails = readOnlyPage.getByRole('region', { name:'Detalhes da pessoa Ana editada', exact:true });
  await expect(viewerDetails).toContainText('Saldo inicial');
  await expect(viewerDetails.getByRole('button', { name:/^(Salvar pessoa|Editar apelido e observações|Informar saldo inicial|Arquivar pessoa|Excluir contato sem uso|Registrar recebimento ou pagamento)$/ })).toHaveCount(0);
  await expect(viewerDetails.getByRole('textbox')).toHaveCount(0);
  await readOnlyPage.screenshot({ path:'out/people-layout-test/viewer-dark.png', fullPage:true });

  stage = 'cached people are read only when offline';
  await page.getByRole('button', { name:'Atualizar', exact:true }).click();
  await expect(table()).toContainText('Bruno local');
  await page.evaluate(async () => {
    const storage = await import('/financias/src/lib/offlineStorage.ts');
    if (!await storage.cachedWorkspace()) throw new Error('The active workspace must be cached before testing offline');
  });
  await page.route('**/rest/v1/**', route => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText:'Sem conexão' })).toBeVisible();
  await page.getByRole('button', { name:'Pessoas', exact:true }).click();
  await expect(table()).toContainText('Bruno local');
  await expect(table()).toContainText('R$ 40,00');
  await expect(page.getByRole('form', { name:'Adicionar pessoa', exact:true })).toHaveCount(0);
  await expect(table().getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name:'Dividir uma despesa que eu paguei', exact:true })).toHaveCount(0);
  await page.screenshot({ path:'out/people-layout-test/offline-mobile-dark.png', fullPage:true });
  assert.deepEqual(errors, [], 'People flows produce no uncaught browser exceptions');
  console.log('People layout passed: compact form, empty table, notes, initial receivable, financial history retained by editing, settlement without income, shared expense own share, archive guard/restore, deletion only unused, Agenda link, privacy, desktop/mobile themes, viewer and cached offline read only.');
} catch (failure) {
  await page?.screenshot({ path:'out/people-layout-test/failure.png', fullPage:true });
  console.log(`People layout failed at ${stage}.`);
  if (page) console.log((await page.locator('main').innerText()).slice(-4500));
  throw failure;
} finally {
  await browser?.close(); await server.close();
  await owner.client.auth.signOut(); await viewer.client.auth.signOut();
}
