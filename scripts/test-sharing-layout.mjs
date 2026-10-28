import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// Both fixtures and browser mutations are confined to isolated local identities.
const status = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'npx supabase status -o json 2>$null'], { encoding:'utf8', windowsHide:true }));
assert.equal(new URL(status.API_URL).hostname, '127.0.0.1', 'Sharing layout checks must never mutate production');
process.env.VITE_SUPABASE_URL = status.API_URL;
process.env.VITE_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.VITE_FINANCIAL_MODEL = 'ledger';
const authOptions = { auth:{ persistSession:false, autoRefreshToken:false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, authOptions);
async function identity(label) {
  const email = `sharing-${label}-${randomUUID().slice(0, 8)}@test.local`, password = randomUUID();
  const { error:creationError } = await admin.auth.admin.createUser({ email, password, email_confirm:true });
  if (creationError) throw new Error(creationError.message);
  const client = createClient(status.API_URL, status.ANON_KEY, authOptions);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return { email, client, session:data.session };
}
const owner = await identity('owner'), administrator = await identity('admin'), member = await identity('member'), viewer = await identity('viewer'), invited = await identity('invited');
const identities = [owner, administrator, member, viewer, invited];
async function rpc(name, args = {}, user = owner) {
  const { data, error } = await user.client.schema('api').rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}
const personal = await rpc('create_personal_space', { p_name:'Pessoal da referência' });
const shared = await rpc('create_space', { p_name:'Compartilhado da referência', p_kind:'shared', p_timezone:'America/Sao_Paulo' });
const snapshot = space => rpc('workspace_snapshot', { p_space:space });
const summary = (space = shared) => rpc('sharing_summary', { p_space:space });
const today = (await snapshot(personal)).space.today;
const bank = await rpc('create_financial_account', { p_space:personal, p_name:'Banco pessoal local', p_kind:'checking', p_opening_cents:100000, p_opening_on:today });
const sharedBank = await rpc('create_financial_account', { p_space:shared, p_name:'Banco compartilhado local', p_kind:'checking', p_opening_cents:0, p_opening_on:today });
const category = await rpc('create_category', { p_space:shared, p_name:'Despesa compartilhada local', p_kind:'expense' });
for (const [user,role,nickname] of [[administrator,'admin','Administrador local'],[member,'member','Membro local'],[viewer,'viewer','Leitor local']]) {
  const invitation = await rpc('invite_space_member', { p_space:shared, p_email:user.email, p_role:role, p_nickname:nickname });
  await rpc('accept_space_invitation', { p_token:invitation.token }, user);
}
const invitedPersonal = await rpc('create_personal_space', { p_name:'Pessoal do convidado' }, invited);
for (const user of identities) {
  const settings = await rpc('get_user_settings', {}, user);
  await rpc('update_user_settings', { p_version:settings.version, p_changes:{ active_financial_space_id:user===invited?invitedPersonal:shared, theme:'dark' } }, user);
}
const initialSummary = await summary();
const ownerMember = initialSummary.members.find(item => item.user_id === owner.session.user.id);
const regularMember = initialSummary.members.find(item => item.user_id === member.session.user.id);
const server = await createServer({ configFile:'vite.pwa.config.ts', server:{ host:'127.0.0.1', port:4189, strictPort:true } });
await server.listen();
await mkdir('out/sharing-layout-test', { recursive:true });
let browser, page;
const errors = [];
let stage = 'startup';
try {
  browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
  async function openPage(user) {
    const context = await browser.newContext({ viewport:{ width:1663, height:1000 } });
    await context.grantPermissions(['clipboard-read','clipboard-write'], {origin:'http://127.0.0.1:4189'});
    const next = await context.newPage();
    next.on('pageerror', failure => errors.push(failure.message));
    await next.route('**/rest/v1/rpc/**', route => {
      assert.equal(new URL(route.request().url()).hostname, '127.0.0.1', 'Browser RPCs must be local');
      return route.continue();
    });
    await next.addInitScript(session => localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), user.session);
    await next.goto('http://127.0.0.1:4189/financias/');
    await expect(next.getByRole('heading', { name:'Visão geral', exact:true })).toBeVisible();
    await next.getByRole('button', { name:'Compartilhamento', exact:true }).click();
    await expect(next.getByRole('heading', { name:'Compartilhamento', exact:true })).toBeVisible();
    await expect(next.getByRole('table', { name:'Membros e permissões', exact:true })).toBeVisible();
    await expect(next.getByRole('alert')).toHaveCount(0);
    return next;
  }
  page = await openPage(owner);
  const invitationForm = target => target.getByRole('form', { name:'Convidar membro', exact:true });
  const membersTable = target => target.getByRole('table', { name:'Membros e permissões', exact:true });
  const transferDetails = () => page.getByRole('region', { name:'Detalhes da transferência', exact:true });
  const cash = async (space,account) => (await snapshot(space)).accounts.find(item => item.id === account).balance_cents;
  async function switchSpace(space) {
    const selector = page.getByLabel('Espaço financeiro ativo', { exact:true });
    await selector.selectOption(space);
    await expect(selector).toHaveValue(space);
    await expect(selector).toBeEnabled();
    await expect(membersTable(page)).toBeVisible();
  }
  async function confirm(target = page) {
    await target.getByRole('button', { name:'Confirmar', exact:true }).click();
    await expect(target.getByRole('status').filter({ hasText:'Alteração registrada' })).toBeVisible();
    await expect(target.getByRole('alert')).toHaveCount(0);
  }
  async function showMember(target,nickname) {
    const details = target.getByRole('region', { name:`Detalhes do membro ${nickname}`, exact:true });
    if (!await details.count()) await membersTable(target).getByRole('button', { name:`Ver detalhes de ${nickname}`, exact:true }).click();
    await expect(details).toBeVisible();
    return details;
  }
  let displayedTransferId = null;
  async function showTransfer(id) {
    if (!await transferDetails().count() || displayedTransferId !== id) {
      await page.getByRole('button', { name:`Ver detalhes da transferência ${id}`, exact:true }).click();
      displayedTransferId = id;
    }
    await expect(transferDetails()).toBeVisible();
    return transferDetails();
  }

  stage = 'persistent invitation form and compact tables';
  const invite = invitationForm(page);
  for (const label of [/^E-?mail convidado$/i,'Apelido (opcional)','Papel no espaço']) await expect(invite.getByLabel(label, { exact:true })).toBeVisible();
  await expect(invite.getByRole('button', { name:'Gerar convite', exact:true })).toBeEnabled();
  await expect(invite.getByLabel('Papel no espaço', { exact:true }).locator('option[value="owner"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name:'Convidar por e-mail', exact:true })).toHaveCount(0);
  await expect(page.getByRole('button', { name:'Cadastrar', exact:true })).toHaveCount(0);
  await expect(page.getByRole('region', { name:'Lançamento rápido e fila de envio', exact:true })).toHaveCount(0);
  for (const name of ['Membros e permissões','Acerto do período','Transferências entre espaços']) await expect(page.getByRole('table', { name, exact:true })).toBeVisible();
  await expect(membersTable(page)).toContainText('Administrador local');
  await expect(membersTable(page)).toContainText('Membro local');
  await expect(membersTable(page)).toContainText('Leitor local');
  const boxes = await Promise.all([/^E-?mail convidado$/i,'Apelido (opcional)','Papel no espaço'].map(label => invite.getByLabel(label, { exact:true }).boundingBox()));
  assert.ok(boxes.every(box => box && Math.abs(box.y-boxes[0].y)<5), 'Desktop invitation controls sit on one row');
  const ownerDetails = await showMember(page,'Membro local');
  for (const action of ['Alterar papel','Transferir propriedade','Remover']) await expect(ownerDetails.getByRole('button', { name:action, exact:true })).toBeEnabled();
  await page.screenshot({ path:'out/sharing-layout-test/owner-details-desktop-dark.png', fullPage:true });

  stage = 'invitation copy, accept and revoke preserve cash';
  const beforeInvitationCash = await cash(personal,bank);
  await invite.getByLabel(/^E-?mail convidado$/i).fill(invited.email);
  await invite.getByLabel('Apelido (opcional)', { exact:true }).fill('Convidado pela interface');
  await invite.getByLabel('Papel no espaço', { exact:true }).selectOption('member');
  await invite.getByRole('button', { name:'Gerar convite', exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Convite criado' })).toBeVisible();
  const link = await page.getByLabel('Link para aceitar o convite', { exact:true }).inputValue();
  assert.ok(link.startsWith('http://127.0.0.1:4189/financias/#invite='));
  await page.getByRole('button', { name:'Copiar link', exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Link copiado' })).toBeVisible();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()),link);
  await expect(page.getByRole('table', { name:'Convites pendentes', exact:true })).toContainText(invited.email);
  const invitedPage = await openPage(invited);
  await expect(invitationForm(invitedPage)).toHaveCount(0);
  await invitedPage.getByRole('button', { name:'Aceitar convite', exact:true }).click();
  await invitedPage.getByLabel('Link ou token do convite', { exact:true }).fill(link);
  await invitedPage.getByRole('button', { name:'Confirmar', exact:true }).click();
  await expect(invitedPage.getByLabel('Espaço financeiro ativo', { exact:true })).toHaveValue(shared);
  await expect(membersTable(invitedPage)).toContainText('Convidado pela interface');
  await page.getByRole('button', { name:'Atualizar', exact:true }).click();
  const revokedEmail = `revogar-${randomUUID().slice(0,8)}@test.local`;
  await invite.getByLabel(/^E-?mail convidado$/i).fill(revokedEmail);
  await invite.getByLabel('Apelido (opcional)', { exact:true }).fill('Convite para revogar');
  await invite.getByRole('button', { name:'Gerar convite', exact:true }).click();
  const pendingRow = page.getByRole('table', { name:'Convites pendentes', exact:true }).getByRole('row').filter({ hasText:revokedEmail });
  await expect(pendingRow).toBeVisible();
  await pendingRow.getByRole('button', { name:`Revogar convite de ${revokedEmail}`, exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Convite revogado' })).toBeVisible();
  await expect(pendingRow).toHaveCount(0);
  assert.equal(await cash(personal,bank),beforeInvitationCash,'Membership invitations do not move cash');

  stage = 'admin, member and viewer permissions';
  const adminPage = await openPage(administrator);
  await expect(invitationForm(adminPage)).toBeVisible();
  await expect(invitationForm(adminPage).getByLabel('Papel no espaço', { exact:true }).locator('option[value="owner"]')).toHaveCount(0);
  await expect(adminPage.getByRole('button', { name:'Configurar divisão', exact:true })).toBeEnabled();
  const adminDetails = await showMember(adminPage,'Membro local');
  await expect(adminDetails.getByRole('button', { name:'Remover', exact:true })).toBeEnabled();
  await expect(adminDetails.getByRole('button', { name:/^(Alterar papel|Transferir propriedade)$/ })).toHaveCount(0);
  const memberPage = await openPage(member);
  await expect(invitationForm(memberPage)).toHaveCount(0);
  await expect(memberPage.getByRole('button', { name:'Configurar divisão', exact:true })).toHaveCount(0);
  await expect(memberPage.getByRole('button', { name:'Registrar acerto feito fora do app', exact:true })).toBeEnabled();
  const memberDetails = await showMember(memberPage,'Administrador local');
  await expect(memberDetails.getByRole('button', { name:/^(Remover|Alterar papel|Transferir propriedade)$/ })).toHaveCount(0);
  const ownDetails = await showMember(memberPage,'Membro local');
  await expect(ownDetails.getByRole('button', { name:'Sair deste espaço', exact:true })).toBeEnabled();
  const viewerPage = await openPage(viewer);
  await expect(invitationForm(viewerPage)).toHaveCount(0);
  await expect(viewerPage.getByRole('button', { name:/^(Configurar divisão|Registrar acerto feito fora do app|Transferir entre espaços|Paguei uma despesa de outro espaço|Revogar convite)/ })).toHaveCount(0);
  const viewerDetails = await showMember(viewerPage,'Membro local');
  await expect(viewerDetails.getByRole('button', { name:/^(Remover|Alterar papel|Transferir propriedade)$/ })).toHaveCount(0);
  await viewerPage.screenshot({ path:'out/sharing-layout-test/viewer-desktop-dark.png', fullPage:true });

  stage = 'personal workspace and idempotent paired transfer retry';
  await switchSpace(personal);
  await expect(invitationForm(page)).toHaveCount(0);
  await switchSpace(shared);
  await expect(invitationForm(page)).toBeVisible();
  await page.getByRole('button', { name:'Transferir entre espaços', exact:true }).click();
  await page.getByLabel('Espaço pessoal / origem do aporte', { exact:true }).selectOption(personal);
  await page.getByLabel('Espaço de destino / compartilhado', { exact:true }).selectOption(shared);
  await page.getByLabel('Conta da origem / pessoal', { exact:true }).selectOption(bank);
  await page.getByLabel('Conta do destino / compartilhado', { exact:true }).selectOption(sharedBank);
  await page.getByLabel('Valor (R$)', { exact:true }).fill('100,00');
  let committedTransfer, lostResponse = false;
  const transferRequestIds = [];
  await page.route('**/rest/v1/rpc/create_space_transfer', async route => {
    transferRequestIds.push(route.request().postDataJSON().p_client_uuid);
    if (lostResponse) return route.continue();
    lostResponse = true;
    const response = await route.fetch();
    assert.equal(response.status(),200);
    committedTransfer = await response.json();
    return route.abort('failed');
  });
  await page.getByRole('button', { name:'Confirmar', exact:true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  assert.equal(await cash(personal,bank),90000,'Lost response occurs after the local transfer has committed once');
  assert.equal(await cash(shared,sharedBank),10000);
  // Typing in the independent invitation form must not replace the pending
  // financial request or the UUID whose result was lost above.
  await invitationForm(page).getByLabel(/^E-?mail convidado$/i).fill('nao-enviar-retry@test.local');
  await invitationForm(page).getByLabel('Apelido (opcional)', { exact:true }).fill('Convite ainda não enviado');
  await expect(page.getByRole('button', { name:'Confirmar', exact:true })).toBeEnabled();
  await confirm();
  await page.unroute('**/rest/v1/rpc/create_space_transfer');
  assert.equal(await cash(personal,bank),90000,'Retry retains the original client UUID and does not post twice');
  assert.equal(transferRequestIds.length,2,'The transfer is submitted once and retried once');
  assert.equal(transferRequestIds[1],transferRequestIds[0],'Editing an unsent invitation preserves the financial retry UUID');
  assert.equal((await summary()).invitations.some(item => item.email==='nao-enviar-retry@test.local'),false,'Typing an invitation does not send it');
  assert.equal((await summary(personal)).transfers.filter(item => item.id === committedTransfer).length,1);
  let transfer = await showTransfer(committedTransfer);
  await transfer.getByRole('button', { name:'Corrigir valor / data', exact:true }).click();
  await page.getByLabel('Valor (R$)', { exact:true }).fill('90,00');
  await page.getByLabel('Motivo da correção / cancelamento', { exact:true }).fill('Conferir correção das duas pontas');
  await confirm();
  assert.equal(await cash(personal,bank),91000); assert.equal(await cash(shared,sharedBank),9000);
  transfer = await showTransfer(committedTransfer);
  await transfer.getByRole('button', { name:'Cancelar as duas pontas', exact:true }).click();
  await page.getByLabel('Motivo da correção / cancelamento', { exact:true }).fill('Conferir cancelamento das duas pontas');
  await confirm();
  assert.equal(await cash(personal,bank),100000); assert.equal(await cash(shared,sharedBank),0);
  assert.ok((await summary(personal)).transfers.find(item => item.id === committedTransfer).cancelled_at,'Cancelled transfer remains in its history table');

  stage = 'personally paid expense preserves paired obligations';
  await switchSpace(personal);
  await page.getByRole('button', { name:'Paguei uma despesa de outro espaço', exact:true }).click();
  await page.getByLabel('Espaço de destino / compartilhado', { exact:true }).selectOption(shared);
  await page.getByLabel('Pagamento pessoal', { exact:true }).selectOption(`account:${bank}`);
  await page.getByLabel('Categoria da despesa no destino', { exact:true }).selectOption(category);
  await page.getByLabel('Descrição da despesa', { exact:true }).fill('Jantar pago pessoalmente');
  await page.getByLabel('Valor (R$)', { exact:true }).fill('120,00');
  await confirm();
  assert.equal(await cash(personal,bank),88000); assert.equal(await cash(shared,sharedBank),0,'Personal payment does not move the destination cash account');
  const expense = (await summary(personal)).transfers.find(item => item.kind === 'personal_expense' && !item.cancelled_at);
  transfer = await showTransfer(expense.id);
  await expect(transfer.getByRole('button', { name:'Corrigir valor / data', exact:true })).toHaveCount(0);
  await transfer.getByRole('button', { name:'Cancelar as duas pontas', exact:true }).click();
  await page.getByLabel('Motivo da correção / cancelamento', { exact:true }).fill('Conferir preservação e estorno da despesa pessoal');
  await confirm();
  assert.equal(await cash(personal,bank),100000); assert.equal(await cash(shared,sharedBank),0);

  stage = 'split rules and external settlement preserve account balances';
  await switchSpace(shared);
  const beforeSplit = await snapshot(shared);
  const rulesBefore = (await summary()).rule_versions.length;
  await page.getByRole('button', { name:'Configurar divisão', exact:true }).click();
  await page.getByLabel('Como dividir', { exact:true }).selectOption('equal');
  await confirm();
  assert.equal((await summary()).rule_versions.length,rulesBefore+1,'Rule changes append immutable division history');
  assert.deepEqual((await snapshot(shared)).transactions,beforeSplit.transactions,'Changing a rule creates no financial transaction');
  await page.getByRole('button', { name:'Registrar acerto feito fora do app', exact:true }).click();
  await page.getByLabel('Quem pagou o Pix fora do app', { exact:true }).selectOption(regularMember.id);
  await page.getByLabel('Quem recebeu o Pix fora do app', { exact:true }).selectOption(ownerMember.id);
  await page.getByLabel('Valor (R$)', { exact:true }).fill('10,00');
  await confirm();
  assert.deepEqual((await snapshot(shared)).accounts,beforeSplit.accounts,'Recording external Pix changes no account cash balance');
  await expect(page.getByRole('table', { name:'Acerto do período', exact:true })).toContainText('R$ 10,00');

  stage = 'private values and responsive themes';
  await page.getByRole('button', { name:'Ocultar valores', exact:true }).click();
  const acerto = page.getByRole('table', { name:'Acerto do período', exact:true });
  const transfers = page.getByRole('table', { name:'Transferências entre espaços', exact:true });
  await expect(acerto).toContainText('••••'); await expect(acerto).not.toContainText(/R\$\s*\d/);
  await expect(transfers).not.toContainText(/R\$\s*\d/);
  await page.getByRole('button', { name:'Mostrar valores', exact:true }).click();
  for (const theme of ['light','dark']) {
    await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode==='dark'),theme);
    await page.setViewportSize({width:1663,height:1000});
    await page.screenshot({path:`out/sharing-layout-test/desktop-${theme}.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await expect(invitationForm(page).getByLabel(/^E-?mail convidado$/i)).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true,'Sharing has no horizontal page overflow on a phone');
    for (const detailsButton of await transfers.getByRole('button', {name:/^Ver detalhes da transferência /}).all()) {
      assert.equal(await detailsButton.evaluate(element => element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight)+1),true,'Mobile transfer action text stays on one line');
    }
    await page.screenshot({path:`out/sharing-layout-test/mobile-${theme}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[],'Sharing flows produce no uncaught browser exceptions');
  console.log('Sharing layout passed: compact invitation form/tables, copy/accept/revoke, owner/admin/member/viewer permissions, personal restrictions, lost-response idempotent transfer retry, paired edit/cancel, personally paid expense, immutable division history, external settlement without moving cash, privacy and desktop/mobile themes.');
} catch (failure) {
  await page?.screenshot({path:'out/sharing-layout-test/failure.png',fullPage:true});
  console.log(`Sharing layout failed at ${stage}.`);
  if (page) console.log((await page.locator('main').innerText()).slice(-5000));
  throw failure;
} finally {
  await browser?.close(); await server.close();
  for (const user of identities) await user.client.auth.signOut();
}
