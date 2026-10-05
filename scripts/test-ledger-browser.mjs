import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

const status = JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','npx supabase status -o json 2>$null'],{ encoding:'utf8',windowsHide:true }));
assert.equal(new URL(status.API_URL).hostname,'127.0.0.1','Browser tests must use local Supabase');
process.env.VITE_SUPABASE_URL = status.API_URL;
process.env.VITE_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.VITE_FINANCIAL_MODEL = 'ledger';
const options = { auth:{ persistSession:false,autoRefreshToken:false } };
const admin = createClient(status.API_URL,status.SERVICE_ROLE_KEY,options);
const client = createClient(status.API_URL,status.ANON_KEY,options);
const email = `ledger-browser-${randomUUID()}@test.local`, password = randomUUID();
const { error: userError } = await admin.auth.admin.createUser({ email,password,email_confirm:true });
if (userError) throw new Error(userError.message);
const { data,error } = await client.auth.signInWithPassword({ email,password });
if (error) throw new Error(error.message);
const server = await createServer({ configFile:'vite.pwa.config.ts',server:{ host:'127.0.0.1',port:4179,strictPort:true } });
await server.listen();
let browser;
let page;
try {
  browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true });
  page = await browser.newPage({ viewport:{ width:1366,height:900 } });
  const exceptions = [];
  page.on('pageerror',failure => exceptions.push(failure.message));
  page.on('requestfailed',request => console.log(`Request failed: ${new URL(request.url()).origin}${new URL(request.url()).pathname} ${request.failure()?.errorText}`));
  page.on('console',message => { if (message.type() === 'error') console.log(`Browser: ${message.text()}`); });
  page.on('response',async response => { if (response.status() >= 400 && response.url().includes('/rest/v1/')) console.log(`API error ${response.status()}: ${await response.text()}`); });
  await page.addInitScript(session => { localStorage.setItem('sb-127-auth-token',JSON.stringify(session)); },data.session);
  await page.goto('http://127.0.0.1:4179/financias/');
  await expect(page.getByRole('heading',{ name:'Visão geral',exact:true })).toBeVisible();
  await expect(page.getByText('Minhas finanças',{ exact:true })).toBeVisible();
  async function navigate(label) { await page.getByRole('button',{ name:label,exact:true }).click(); }
  async function open() {
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button',{ name:'Cadastrar',exact:true }).click();
  }
  async function save() {
    await page.getByRole('button',{ name:'Salvar',exact:true }).click();
    await expect(page.getByRole('status')).toContainText('Salvo');
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await navigate('1. Contas'); await open();
  await page.getByLabel('Nome ou descrição').fill('Banco navegador');
  await page.getByLabel('Saldo inicial (R$)').fill('1.000,00'); await save();
  await expect(page.getByText('R$ 1.000,00',{ exact:true })).toBeVisible();
  await navigate('2. Categorias'); await open();
  await page.getByLabel('Nome ou descrição').fill('Mercado navegador'); await save();
  await navigate('3. Cartões'); await open();
  await page.getByLabel('Nome ou descrição').fill('Cartão navegador');
  await page.getByLabel('Conta',{ exact:true }).selectOption({ label:'Banco navegador' });
  await page.getByLabel('Limite (R$)').fill('2.000,00');
  await page.getByLabel('Dia de fechamento').fill('1');
  await page.getByLabel('Dia de vencimento').fill('10'); await save();
  await navigate('Lançamentos'); await open();
  await page.getByLabel('Operação').selectOption('card_purchase');
  await page.getByLabel('Nome ou descrição').fill('Compra navegador');
  await page.getByLabel('Categoria',{ exact:true }).selectOption({ label:'Mercado navegador' });
  await page.getByLabel('Cartão',{ exact:true }).selectOption({ label:'Cartão navegador' });
  await page.getByLabel('Parcelas').fill('2');
  await page.getByLabel('Valor (R$)').fill('200,00'); await save();
  await navigate('Agenda'); await open();
  await page.getByLabel('Nome ou descrição').fill('Conta navegador');
  await page.getByLabel('Conta',{ exact:true }).selectOption({ label:'Banco navegador' });
  await page.getByLabel('Categoria',{ exact:true }).selectOption({ label:'Mercado navegador' });
  await page.getByLabel('Valor (R$)').fill('150,00'); await save();
  await page.getByRole('button',{ name:'Registrar pagamento integral' }).click();
  await expect(page.getByText('Pago',{ exact:true })).toBeVisible();
  await navigate('Orçamentos'); await open();
  await page.getByLabel('Categoria',{ exact:true }).selectOption({ label:'Mercado navegador' });
  await page.getByLabel('Valor (R$)').fill('500,00'); await save();
  await expect(page.getByText('Restante: R$ 150,00',{ exact:true })).toBeVisible();
  await page.getByRole('button',{ name:'Ocultar valores' }).click();
  await expect(page.getByText('Restante: R$ ••••',{ exact:true })).toBeVisible();
  await expect(page.getByText('Restante: R$ 150,00',{ exact:true })).toHaveCount(0);
  await page.getByRole('button',{ name:'Mostrar valores' }).click();
  await mkdir('out/verification',{ recursive:true });
  await page.screenshot({ path:'out/verification/ledger-desktop.png',fullPage:true });
  await page.setViewportSize({ width:390,height:844 });
  await navigate('Visão geral');
  await expect(page.getByRole('heading',{ name:'Visão geral',exact:true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'Mobile page must not overflow horizontally');
  await page.screenshot({ path:'out/verification/ledger-mobile.png',fullPage:true });
  assert.deepEqual(exceptions,[],'Browser must not emit uncaught errors');
  console.log('Browser passed: account, category, card, installments, Agenda settlement, budget, privacy and mobile layout.');
} catch (failure) {
  await mkdir('out/verification',{ recursive:true });
  await page?.screenshot({ path:'out/verification/ledger-failure.png',fullPage:true });
  if (page) console.log((await page.locator('body').innerText()).slice(0,2500));
  throw failure;
} finally {
  await browser?.close();
  await server.close();
  await client.auth.signOut();
}
