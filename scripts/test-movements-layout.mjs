import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// Every fixture and browser mutation uses isolated identities on local Supabase.
const status = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'npx supabase status -o json 2>$null'], { encoding:'utf8', windowsHide:true }));
assert.equal(new URL(status.API_URL).hostname, '127.0.0.1', 'Movement checks must never mutate production');
process.env.VITE_SUPABASE_URL = status.API_URL;
process.env.VITE_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.VITE_FINANCIAL_MODEL = 'ledger';
const options = { auth:{ persistSession:false, autoRefreshToken:false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
async function identity(label) {
  const email = `movements-${label}-${randomUUID().slice(0,8)}@test.local`, password = randomUUID();
  const { error:creation } = await admin.auth.admin.createUser({ email, password, email_confirm:true });
  if (creation) throw new Error(`Local fixture creation failed: ${creation.status ?? 'unknown status'} ${creation.code ?? ''} ${creation.message}`);
  const client = createClient(status.API_URL, status.ANON_KEY, options);
  const { data,error } = await client.auth.signInWithPassword({ email,password });
  if (error) throw new Error(error.message);
  return { email,client,session:data.session };
}
const owner = await identity('owner'), viewer = await identity('viewer');
async function rpc(name,args={},user=owner) {
  const { data,error } = await user.client.schema('api').rpc(name,args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}
await rpc('create_personal_space');
const space = await rpc('create_space', { p_name:'Movimentações de referência', p_kind:'shared', p_timezone:'America/Sao_Paulo' });
const snapshot = () => rpc('workspace_snapshot', { p_space:space });
const today = (await snapshot()).space.today;
const bank = await rpc('create_financial_account', { p_space:space,p_name:'Banco local',p_kind:'checking',p_opening_cents:100000,p_opening_on:today });
const category = await rpc('create_category', { p_space:space,p_name:'Mercado local',p_kind:'expense' });
const card = await rpc('create_credit_card', { p_space:space,p_name:'Cartão local',p_limit_cents:300000,p_closing_day:1,p_due_day:10,p_payment_account:bank });
const fixture = await snapshot();
const bankLedger = fixture.accounts.find(item => item.id===bank).ledger_account_id;
const categoryLedger = fixture.categories.find(item => item.id===category).ledger_account_id;
const matchTransaction = await rpc('post_transaction', { p_space:space,p_payload:{ kind:'expense',description:'CONCILIACAO LOCAL',occurred_on:today,competence_month:today.slice(0,7)+'-01',client_uuid:randomUUID(),entries:[{ ledger_account_id:categoryLedger,amount_cents:2000 },{ ledger_account_id:bankLedger,amount_cents:-2000 }] } });
const invite = await rpc('invite_space_member', { p_space:space,p_email:viewer.email,p_role:'viewer',p_nickname:'Leitor local' });
await rpc('accept_space_invitation', { p_token:invite.token },viewer);
for (const user of [owner,viewer]) {
  const settings = await rpc('get_user_settings', {},user);
  await rpc('update_user_settings', { p_version:settings.version,p_changes:{ active_financial_space_id:space,theme:'dark' } },user);
}
const cash = async () => (await snapshot()).accounts.find(item=>item.id===bank).balance_cents;
const foreign = () => rpc('foreign_currency_summary', { p_space:space });
const server = await createServer({ configFile:'vite.pwa.config.ts',server:{ host:'127.0.0.1',port:4190,strictPort:true } });
await server.listen();
await mkdir('out/movements-layout-test', { recursive:true });
let browser,page;
const errors=[];
let stage='startup';
try {
  browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true });
  async function openPage(user) {
    const context=await browser.newContext({ viewport:{ width:1663,height:1000 } });
    const next=await context.newPage();
    next.on('pageerror',error=>errors.push(error.message));
    await next.route('**/rest/v1/rpc/**', route=>{
      assert.equal(new URL(route.request().url()).hostname,'127.0.0.1','Browser mutations must remain local');
      return route.continue();
    });
    await next.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),user.session);
    await next.goto('http://127.0.0.1:4190/financias/');
    await expect(next.getByRole('heading',{ name:'Visão geral',exact:true })).toBeVisible();
    return next;
  }
  page=await openPage(owner);
  async function navigate(label,target=page) {
    await target.getByRole('button',{ name:label,exact:true }).click();
    await expect(target.getByRole('heading',{ name:label,exact:true })).toBeVisible();
    await expect(target.getByRole('alert')).toHaveCount(0);
  }
  const transactionForm=()=>page.getByRole('form',{ name:'Adicionar lançamento',exact:true });
  const transactions=target=>target.getByRole('table',{ name:'Lançamentos',exact:true });
  const transactionDetails=target=>target.getByRole('region',{ name:'Detalhes do lançamento',exact:true });
  const internationalForm=()=>page.getByRole('form',{ name:'Nova compra internacional',exact:true });
  const internationalDetails=()=>page.getByRole('region',{ name:'Detalhes da compra Compra USD local',exact:true });
  const importTable=target=>target.getByRole('table',{ name:'Linhas do extrato',exact:true });
  async function importLine(number,target=page) {
    const trigger=target.getByRole('button',{ name:`Ver detalhes da linha ${number}`,exact:true });
    if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
    const detail=target.getByRole('region',{ name:`Detalhes da linha ${number}`,exact:true });
    await expect(detail).toBeVisible();
    return detail;
  }
  async function capture(label,tables) {
    for(const theme of ['light','dark']) {
      await page.evaluate(mode=>document.documentElement.classList.toggle('dark',mode==='dark'),theme);
      for(const [size,width,height] of [['desktop',1663,1000],['mobile',390,844]]) {
        await page.setViewportSize({ width,height });
        await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
        for(const table of tables)await expect(table).toHaveCSS('color',theme==='dark'?'rgb(237, 241, 243)':'rgb(20, 30, 37)');
        await page.screenshot({ path:`out/movements-layout-test/${label}-${size}-${theme}.png`,fullPage:true });
      }
    }
    await page.setViewportSize({ width:1663,height:1000 });
  }

  stage='transactions compact form and actual expense';console.log(`Movement layout: ${stage}`);
  await navigate('Lançamentos');
  await expect(transactionForm()).toBeVisible();
  for(const label of ['Operação','Nome ou descrição','Conta','Categoria','Valor (R$)','Data'])await expect(transactionForm().getByLabel(label,{ exact:true })).toBeVisible();
  await expect(page.getByRole('button',{ name:'Cadastrar',exact:true })).toHaveCount(0);
  await expect(page.getByRole('region',{ name:'Lançamento rápido e fila de envio',exact:true })).not.toBeVisible();
  const beforeExpense=await cash();
  await transactionForm().getByLabel('Nome ou descrição',{ exact:true }).fill('Despesa local');
  await transactionForm().getByLabel('Conta',{ exact:true }).selectOption(bank);
  await transactionForm().getByLabel('Categoria',{ exact:true }).selectOption(category);
  await transactionForm().getByLabel('Valor (R$)',{ exact:true }).fill('12,34');
  await transactionForm().getByRole('button',{ name:'Adicionar lançamento',exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:/Salvo|Lançamento adicionado/ })).toBeVisible();
  assert.equal(await cash(),beforeExpense-1234,'BRL creation moves exact integer cents');
  await transactionForm().getByLabel('Nome ou descrição',{ exact:true }).fill('Novo lançamento ainda não salvo');
  await transactions(page).getByRole('button',{ name:'Ver detalhes de Despesa local',exact:true }).click();
  await transactionDetails(page).getByRole('button',{ name:'Marcar como conferido',exact:true }).click();
  await expect(transactionDetails(page).getByRole('button',{ name:'Desfazer conferência',exact:true })).toBeVisible();
  await transactionDetails(page).getByLabel('Ação sobre o lançamento',{ exact:true }).selectOption('edit');
  await transactionDetails(page).getByLabel('Valor corrigido (R$)',{ exact:true }).fill('10,34');
  await transactionDetails(page).getByRole('checkbox').check();
  await transactionDetails(page).getByLabel('Motivo da alteração',{ exact:true }).fill('Conferência do valor local');
  await transactionDetails(page).getByRole('button',{ name:'Salvar alteração',exact:true }).click();
  await expect(transactionDetails(page).getByRole('status')).toContainText('Alteração registrada');
  assert.equal(await cash(),beforeExpense-1034,'Correction preserves the account and adjusts only the difference');
  await transactionDetails(page).getByLabel('Ação sobre o lançamento',{ exact:true }).selectOption('refund');
  await transactionDetails(page).getByLabel('Valor devolvido (R$)',{ exact:true }).fill('2,00');
  await transactionDetails(page).getByLabel('Conta que recebeu a devolução',{ exact:true }).selectOption(bank);
  await transactionDetails(page).getByRole('button',{ name:'Salvar alteração',exact:true }).click();
  await expect(transactionDetails(page).getByRole('status')).toContainText('Alteração registrada');
  assert.equal(await cash(),beforeExpense-834,'Refund returns exact cents without replacing the original expense');
  await expect(transactionForm().getByLabel('Nome ou descrição',{ exact:true })).toHaveValue('Novo lançamento ainda não salvo');
  await page.getByRole('button',{ name:'Ocultar valores',exact:true }).click();
  await expect(transactionDetails(page)).not.toContainText(/R\$\s*-?\d/);
  await page.getByRole('button',{ name:'Mostrar valores',exact:true }).click();
  await capture('transactions-details',[transactions(page)]);
  await transactionDetails(page).getByRole('button',{ name:'Fechar detalhes',exact:true }).click();

  stage='transaction creation retry after a lost response';console.log(`Movement layout: ${stage}`);
  await transactionForm().getByLabel('Nome ou descrição',{ exact:true }).fill('Lançamento resposta perdida');
  await transactionForm().getByLabel('Conta',{ exact:true }).selectOption(bank);
  await transactionForm().getByLabel('Categoria',{ exact:true }).selectOption(category);
  await transactionForm().getByLabel('Valor (R$)',{ exact:true }).fill('5,00');
  const mainBeforeLost=await cash(),mainRequests=[];
  let loseMainResponse=true;
  const mainLostRoute=async route=>{
    assert.equal(new URL(route.request().url()).hostname,'127.0.0.1');
    mainRequests.push(route.request().postDataJSON());
    if(loseMainResponse) {
      loseMainResponse=false;
      const response=await route.fetch();
      assert.equal(response.status(),200);
      await route.abort('failed');
    } else await route.continue();
  };
  await page.route('**/rest/v1/rpc/post_transaction',mainLostRoute);
  await transactionForm().getByRole('button',{ name:'Adicionar lançamento',exact:true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  assert.equal(await cash(),mainBeforeLost-500,'The lost response follows a real local transaction');
  await transactions(page).getByRole('button',{ name:'Ver detalhes de Despesa local',exact:true }).click();
  await expect(transactionDetails(page)).toBeVisible();
  await transactionForm().getByLabel('Valor (R$)',{ exact:true }).fill('6,00');
  await transactionForm().getByLabel('Valor (R$)',{ exact:true }).fill('5,00');
  await transactionForm().getByRole('button',{ name:'Adicionar lançamento',exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:/Salvo|Lançamento adicionado/ })).toBeVisible();
  await page.unroute('**/rest/v1/rpc/post_transaction',mainLostRoute);
  assert.equal(mainRequests.length,2);
  assert.equal(mainRequests[1].p_payload.client_uuid,mainRequests[0].p_payload.client_uuid,'Opening details and reverting a draft edit preserves the original request UUID');
  assert.deepEqual(mainRequests[1].p_payload,mainRequests[0].p_payload);
  assert.equal(await cash(),mainBeforeLost-500,'An acknowledged retry never spends the same money twice');
  assert.equal((await snapshot()).transactions.filter(item=>item.description==='Lançamento resposta perdida').length,1);

  await page.getByLabel('Buscar lançamento',{ exact:true }).fill('Despesa local');
  await expect(transactions(page).getByRole('button',{ name:/Ver detalhes de/ })).toHaveCount(2);
  await expect(transactions(page)).not.toContainText('CONCILIACAO LOCAL');
  await page.getByLabel('Situação do lançamento',{ exact:true }).selectOption('cancelled');
  await expect(transactions(page)).toContainText('Nenhum lançamento encontrado');
  await page.getByLabel('Situação do lançamento',{ exact:true }).selectOption('all');
  await page.getByLabel('Buscar lançamento',{ exact:true }).fill('');

  stage='foreign purchase details preserve new form draft';console.log(`Movement layout: ${stage}`);
  await navigate('Compras internacionais');
  await expect(internationalForm()).toBeVisible();
  await expect(page.getByRole('button',{ name:'Cadastrar compra internacional',exact:true })).toHaveCount(0);
  await internationalForm().getByLabel('Descrição',{ exact:true }).fill('Compra USD local');
  await internationalForm().getByLabel('Valor original (USD)',{ exact:true }).fill('10,00');
  await internationalForm().getByLabel('Cartão',{ exact:true }).selectOption(card);
  await internationalForm().getByLabel('Categoria',{ exact:true }).selectOption(category);
  await internationalForm().getByLabel('Taxa: reais por unidade da moeda',{ exact:true }).fill('5,00');
  await internationalForm().getByLabel('IOF em reais (opcional)',{ exact:true }).fill('1,00');
  await internationalForm().getByRole('button',{ name:'Registrar compra',exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Compra registrada' })).toBeVisible();
  const estimate=(await foreign()).purchases.find(item=>item.description==='Compra USD local');
  assert.equal(estimate.current_brl_cents,5000);assert.equal(estimate.iof_cents,100);
  await internationalForm().getByLabel('Descrição',{ exact:true }).fill('Compra seguinte não salva');
  await internationalForm().getByLabel('Valor original (USD)',{ exact:true }).fill('25,00');
  await page.getByRole('button',{ name:'Ver detalhes da compra Compra USD local',exact:true }).click();
  await internationalDetails().getByRole('button',{ name:'Atualizar taxa estimada',exact:true }).click();
  const reestimate=page.getByRole('form',{ name:'Atualizar estimativa cambial',exact:true });
  await reestimate.getByLabel('Taxa: reais por unidade da moeda',{ exact:true }).fill('5,10');
  await reestimate.getByRole('button',{ name:'Salvar estimativa',exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Estimativa atualizada' })).toBeVisible();
  assert.equal((await foreign()).purchases.find(item=>item.id===estimate.id).current_brl_cents,5100);
  await expect(internationalForm().getByLabel('Descrição',{ exact:true })).toHaveValue('Compra seguinte não salva');
  await internationalDetails().getByRole('button',{ name:'Confirmar conversão',exact:true }).click();
  const confirmation=page.getByRole('form',{ name:'Confirmar conversão',exact:true });
  await confirmation.getByLabel('Valor da compra em reais (sem IOF)',{ exact:true }).fill('52,00');
  await confirmation.getByLabel('IOF final em reais (informe 0 se não houve)',{ exact:true }).fill('1,20');
  await confirmation.getByRole('button',{ name:'Confirmar valor cobrado',exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Conversão confirmada' })).toBeVisible();
  await page.getByLabel('Mostrar compras',{ exact:true }).selectOption('confirmed');
  const confirmed=(await foreign()).purchases.find(item=>item.id===estimate.id);
  assert.equal(confirmed.current_brl_cents,5200);assert.equal(confirmed.iof_cents,120);
  assert.equal((await snapshot()).cards.find(item=>item.id===card).used_cents,5320,'Conversion and separate IOF preserve card accounting');
  await expect(internationalForm().getByLabel('Descrição',{ exact:true })).toHaveValue('Compra seguinte não salva');
  await expect(internationalForm().getByLabel('Valor original (USD)',{ exact:true })).toHaveValue('25,00');
  if(!await internationalDetails().isVisible())await page.getByRole('button',{ name:'Ver detalhes da compra Compra USD local',exact:true }).click();
  await page.getByRole('button',{ name:'Ocultar valores',exact:true }).click();
  await expect(internationalDetails()).not.toContainText(/R\$\s*-?\d/);
  await expect(internationalDetails()).not.toContainText('52,00');
  await page.getByRole('button',{ name:'Mostrar valores',exact:true }).click();
  await capture('foreign-details',[page.getByRole('table',{ name:'Compras internacionais',exact:true })]);

  stage='foreign creation retry after a lost response and detail navigation';console.log(`Movement layout: ${stage}`);
  await internationalForm().getByLabel('Descrição',{ exact:true }).fill('Compra resposta perdida');
  await internationalForm().getByLabel('Valor original (USD)',{ exact:true }).fill('25,00');
  await internationalForm().getByLabel('Cartão',{ exact:true }).selectOption(card);
  await internationalForm().getByLabel('Categoria',{ exact:true }).selectOption(category);
  await internationalForm().getByLabel('Taxa: reais por unidade da moeda',{ exact:true }).fill('5,00');
  const createRequests=[];
  let loseFirstResponse=true;
  const lostResponseRoute=async route=>{
    assert.equal(new URL(route.request().url()).hostname,'127.0.0.1');
    createRequests.push(route.request().postDataJSON());
    if(loseFirstResponse) {
      loseFirstResponse=false;
      const response=await route.fetch();
      assert.equal(response.status(),200,'The simulated lost response follows a real successful local commit');
      await route.abort('failed');
    } else await route.continue();
  };
  await page.route('**/rest/v1/rpc/record_foreign_purchase',lostResponseRoute);
  await internationalForm().getByRole('button',{ name:'Registrar compra',exact:true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  assert.equal((await foreign()).purchases.filter(item=>item.description==='Compra resposta perdida').length,1);
  await expect(internationalForm().getByLabel('Descrição',{ exact:true })).toHaveValue('Compra resposta perdida');
  const previousDetails=page.getByRole('button',{ name:'Ver detalhes da compra Compra USD local',exact:true });
  if(await previousDetails.getAttribute('aria-expanded')==='true')await previousDetails.click();
  await previousDetails.click();
  await expect(internationalDetails()).toBeVisible();
  await internationalForm().getByRole('button',{ name:'Registrar compra',exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Compra registrada' })).toBeVisible();
  await page.unroute('**/rest/v1/rpc/record_foreign_purchase',lostResponseRoute);
  assert.equal(createRequests.length,2);
  assert.equal(createRequests[1].p_client_uuid,createRequests[0].p_client_uuid,'Detail navigation preserves the idempotency key of an unacknowledged creation');
  assert.deepEqual(createRequests[1].p_payload,createRequests[0].p_payload,'A retry preserves the exact creation payload');
  assert.equal((await foreign()).purchases.filter(item=>item.description==='Compra resposta perdida').length,1,'A successful creation followed by a lost response is never duplicated');

  stage='statement reconciliation, creation, duplicates and undo';console.log(`Movement layout: ${stage}`);
  await navigate('Importar extrato');
  await expect(page.getByRole('form',{ name:'Preparar importação',exact:true })).toBeVisible();
  await expect(page.getByRole('table',{ name:'Histórico de importações',exact:true })).toBeVisible();
  const csv=`Data;Descrição;Valor\n${today.split('-').reverse().join('/')};CONCILIACAO LOCAL;-20,00\n${today.split('-').reverse().join('/')};NOVO CAFE LOCAL;-8,50`;
  async function readStatement(name,content=csv) {
    await page.getByLabel('Conta ou cartão do arquivo',{ exact:true }).selectOption(bank);
    await page.getByLabel('Arquivo OFX ou CSV',{ exact:true }).setInputFiles({ name,mimeType:'text/csv',buffer:Buffer.from(content,'utf8') });
    await page.getByRole('button',{ name:'Conferir arquivo',exact:true }).click();
    await page.getByRole('checkbox',{ name:'Conferi os sinais e os valores do arquivo',exact:true }).check();
    await page.getByRole('button',{ name:'Ler extrato e revisar',exact:true }).click();
    await expect(page.getByRole('heading',{ name:`Revisão: ${name}`,exact:true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  const beforeRead=await cash();
  await readStatement('movimentacoes-local.csv');
  assert.equal(await cash(),beforeRead,'Reading a file keeps all balances unchanged');
  const matchingLine=await importLine(1);
  const matchingSelect=matchingLine.getByLabel('O que fazer',{ exact:true });
  const matchingOption=await matchingSelect.locator('option').filter({ hasText:'Conciliar lançamento: CONCILIACAO LOCAL' }).getAttribute('value');
  assert.ok(matchingOption?.startsWith('transaction:'),'The existing expense is offered as a reconciliation');
  await matchingSelect.selectOption(matchingOption);
  const newLine=await importLine(2);
  await newLine.getByLabel('O que fazer',{ exact:true }).selectOption('create');
  await newLine.getByLabel('Categoria, pessoa ou conta',{ exact:true }).selectOption(categoryLedger);
  await capture('imports-review',[importTable(page),page.getByRole('table',{ name:'Histórico de importações',exact:true })]);
  await page.getByRole('button',{ name:'Confirmar 2 linhas',exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Decisões aplicadas' })).toBeVisible();
  assert.equal(await cash(),beforeRead-850,'Matched line changes no money; only the new expense is posted');
  const firstBatch=(await rpc('import_overview',{ p_space:space })).batches.find(item=>item.file_name==='movimentacoes-local.csv');
  const applied=await rpc('import_review',{ p_space:space,p_batch:firstBatch.id });
  assert.equal(applied.candidates.find(item=>item.line_number===1).status,'matched');
  assert.equal(applied.candidates.find(item=>item.line_number===2).status,'created');
  assert.ok((await rpc('transaction_detail',{ p_space:space,p_transaction:matchTransaction })).entries.some(item=>item.reconciliation_status==='reconciled'));
  await navigate('Lançamentos');await navigate('Importar extrato');
  // A byte-identical file is rejected at the file-hash boundary. A harmless
  // trailing blank line produces a new file and exercises row deduplication.
  await readStatement('movimentacoes-repetido.csv',csv+'\n');
  await page.getByLabel('Mostrar linhas',{ exact:true }).selectOption('duplicate');
  await expect(importTable(page)).toContainText('CONCILIACAO LOCAL');
  await expect(importTable(page)).toContainText('NOVO CAFE LOCAL');
  assert.equal(await cash(),beforeRead-850,'Re-reading the same rows cannot duplicate movements');
  await page.getByRole('button',{ name:'Abrir importação movimentacoes-local.csv',exact:true }).click();
  await page.getByRole('button',{ name:'Desfazer lote',exact:true }).click();
  await page.getByLabel('Motivo para desfazer',{ exact:true }).fill('Verificação local do desfazer');
  await page.getByRole('button',{ name:'Confirmar desfazer lote',exact:true }).click();
  await expect(page.getByRole('status').filter({ hasText:'Lote desfeito' })).toBeVisible();
  assert.equal(await cash(),beforeRead,'Undo cancels the imported expense and preserves the original expense');
  assert.ok((await rpc('transaction_detail',{ p_space:space,p_transaction:matchTransaction })).entries.every(item=>item.reconciliation_status!=='reconciled'),'Undo restores the original reconciliation');
  await page.getByLabel('Mostrar linhas',{ exact:true }).selectOption('all');
  await page.getByRole('button',{ name:'Ocultar valores',exact:true }).click();
  await expect(importTable(page)).not.toContainText(/R\$\s*-?\d/);
  await page.getByRole('button',{ name:'Mostrar valores',exact:true }).click();

  stage='viewer read-only access on all movement tabs';console.log(`Movement layout: ${stage}`);
  const reader=await openPage(viewer);
  await navigate('Lançamentos',reader);
  await expect(reader.getByRole('form',{ name:'Adicionar lançamento',exact:true })).toHaveCount(0);
  await transactions(reader).getByRole('button',{ name:'Ver detalhes de Despesa local',exact:true }).click();
  await expect(transactionDetails(reader)).toBeVisible();
  await expect(transactionDetails(reader).getByRole('form')).toHaveCount(0);
  await expect(transactionDetails(reader).getByRole('button',{ name:/conferência|conferido|Salvar/ })).toHaveCount(0);
  await navigate('Compras internacionais',reader);
  await expect(reader.getByRole('form',{ name:'Nova compra internacional',exact:true })).toHaveCount(0);
  await reader.getByLabel('Mostrar compras',{ exact:true }).selectOption('confirmed');
  await reader.getByRole('button',{ name:'Ver detalhes da compra Compra USD local',exact:true }).click();
  await expect(reader.getByRole('button',{ name:/Confirmar conversão|Atualizar taxa estimada|Salvar percentual/ })).toHaveCount(0);
  await navigate('Importar extrato',reader);
  await expect(reader.getByRole('form',{ name:'Preparar importação',exact:true })).toHaveCount(0);
  await reader.getByRole('button',{ name:'Abrir importação movimentacoes-local.csv',exact:true }).click();
  await reader.getByLabel('Mostrar linhas',{ exact:true }).selectOption('all');
  await importLine(1,reader);
  await expect(reader.getByLabel('O que fazer',{ exact:true })).toHaveCount(0);
  await expect(reader.getByRole('button',{ name:/Confirmar \d|Desfazer lote|Desfazer conciliação/ })).toHaveCount(0);
  await reader.context().close();

  stage='offline table and FIFO queue preserve canonical balances';console.log(`Movement layout: ${stage}`);
  await navigate('Lançamentos');
  const beforeQueue=await cash();
  const queueOrder=[];
  page.on('request',request=>{
    if(new URL(request.url()).pathname.endsWith('/rpc/post_transaction')) {
      const description=request.postDataJSON()?.p_payload?.description;
      if(description?.startsWith('Fila local'))queueOrder.push(description);
    }
  });
  await page.context().setOffline(true);
  await expect(page.getByRole('status').filter({ hasText:'Sem conexão' })).toBeVisible();
  await expect(transactionForm()).toHaveCount(1);
  await expect(transactions(page).getByRole('button')).toHaveCount(0);
  const quick=page.getByRole('region',{ name:'Modelos, rascunhos e envio pendente',exact:true });
  await page.getByText('Modelos, rascunhos e envio pendente',{exact:true}).click();
  await expect(quick).toBeVisible();
  for(const [description,amount] of [['Fila local um','1,00'],['Fila local dois','2,00']]) {
    await transactionForm().locator('input[name="amount"]').fill(amount);
    await transactionForm().locator('input[name="name"]').fill(description);
    await transactionForm().getByRole('combobox',{name:'Categoria',exact:true}).selectOption(category);
    await transactionForm().getByRole('combobox',{name:'Conta',exact:true}).selectOption(bank);
    await transactionForm().getByRole('button',{ name:'Salvar para enviar depois',exact:true }).click();
  }
  await expect(quick.getByText(/2 lançamentos pendentes de envio/)).toBeVisible();
  assert.equal(await cash(),beforeQueue,'Pending offline entries never alter server balances');
  await page.setViewportSize({ width:390,height:844 });
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Offline queue remains usable on a phone');
  await page.screenshot({ path:'out/movements-layout-test/offline-queue-mobile-dark.png',fullPage:true });
  await page.context().setOffline(false);
  await expect.poll(cash,{ timeout:20000 }).toBe(beforeQueue-300);
  await expect(quick.getByText(/lançamentos pendentes de envio/)).toHaveCount(0);
  assert.deepEqual(queueOrder,['Fila local um','Fila local dois'],'Queued entries reach the server in FIFO order');
  const afterQueue=await snapshot();
  assert.equal(afterQueue.transactions.filter(item=>item.description==='Fila local um').length,1);
  assert.equal(afterQueue.transactions.filter(item=>item.description==='Fila local dois').length,1);
  assert.deepEqual(errors,[],'All three screens must produce no uncaught browser errors');
  console.log('Movement layout passed: compact forms and tables, desktop/mobile light/dark, details/edit/refund, privacy, FX estimate/confirmation with draft preservation, import reconciliation/duplicates/undo, read-only viewers, offline canonical balances and FIFO sync.');
} catch(failure) {
  await page?.screenshot({ path:'out/movements-layout-test/failure.png',fullPage:true });
  console.log(`Movement layout failed at ${stage}.`);
  if(page)console.log((await page.locator('body').innerText()).slice(-6000));
  throw failure;
} finally {
  await browser?.close();await server.close();
  await owner.client.auth.signOut();await viewer.client.auth.signOut();
}
