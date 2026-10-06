import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve,sep,extname } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium,expect } from '@playwright/test';
import { build } from 'vite';
import assert from 'node:assert/strict';

const status=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','npx supabase status -o json 2>$null'],{ encoding:'utf8',windowsHide:true }));
assert.equal(new URL(status.API_URL).hostname,'127.0.0.1','Offline tests must use local Supabase');
process.env.VITE_SUPABASE_URL=status.API_URL;
process.env.VITE_SUPABASE_ANON_KEY=status.ANON_KEY;
process.env.VITE_FINANCIAL_MODEL='ledger';
const options={ auth:{ persistSession:false,autoRefreshToken:false } };
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options),client=createClient(status.API_URL,status.ANON_KEY,options);
const email=`pwa-offline-${randomUUID()}@test.local`,password=randomUUID();
const { error:created }=await admin.auth.admin.createUser({ email,password,email_confirm:true });
if (created) throw new Error(created.message);
const { data,error }=await client.auth.signInWithPassword({ email,password });
if (error) throw new Error(error.message);
async function rpc(name,args={}) { const { data:result,error:failure }=await client.schema('api').rpc(name,args); if (failure) throw new Error(failure.message); return result; }
const space=await rpc('create_personal_space');
await rpc('create_financial_account',{ p_space:space,p_name:'Carteira offline',p_kind:'wallet',p_opening_cents:10000,p_opening_on:'2000-01-01' });
await rpc('create_category',{ p_space:space,p_name:'Alimentação offline',p_kind:'expense' });
await build({ configFile:'vite.pwa.config.ts',build:{ outDir:'../../out/offline-pwa-test' } });
const root=resolve('out/offline-pwa-test'),prefix='/financias/';
const mime={ '.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json' };
let newWorker=false;
const server=createServer(async (request,response) => {
  try {
    const path=new URL(request.url,'http://127.0.0.2').pathname;
    if (!path.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const target=resolve(root,decodeURIComponent(path.slice(prefix.length) || 'index.html'));
    if (target!==root && !target.startsWith(root+sep)) { response.writeHead(403).end(); return; }
    let body=await readFile(target);
    // Test-only response permits the loopback API. Production artifacts retain
    // their original CSP. A separate loopback host exercises the public worker
    // registration path without changing XAMPP's no-cache development behavior.
    if (extname(target)==='.html') body=Buffer.from(body.toString().replace("connect-src 'self' https://*.supabase.co wss://*.supabase.co","connect-src 'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:54321"));
    if (target===resolve(root,'sw.js') && newWorker) body=Buffer.concat([body,Buffer.from('\n/* offline queue update verification */\n')]);
    response.writeHead(200,{ 'Content-Type':mime[extname(target)] ?? 'application/octet-stream','Cache-Control':'no-cache' }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(4181,'127.0.0.2',resolve); });
let browser,page;
const diagnostics={ browserErrors:[],consoleErrors:[],rpc:[],failedRequests:[] };
const rpcStarts=new Map();
function rpcPath(request) {
  const url=new URL(request.url());
  return url.origin===status.API_URL.replace(/\/$/,'') && url.pathname.startsWith('/rest/v1/') ? url.pathname : null;
}
try {
  browser=await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true });
  const context=await browser.newContext();
  page=await context.newPage();
  page.on('pageerror',error=>diagnostics.browserErrors.push(error.message));
  page.on('console',message=>{ if (message.type()==='error') diagnostics.consoleErrors.push(message.text()); });
  page.on('request',request=>{ if (rpcPath(request)) rpcStarts.set(request,performance.now()); });
  page.on('response',response=>{
    const request=response.request(),path=rpcPath(request);
    if (path) diagnostics.rpc.push({ path,status:response.status(),elapsedMs:Math.round(performance.now()-(rpcStarts.get(request) ?? performance.now())) });
  });
  page.on('requestfailed',request=>{
    const path=rpcPath(request);
    if (path) diagnostics.failedRequests.push({ path,error:request.failure()?.errorText });
    rpcStarts.delete(request);
  });
  page.on('requestfinished',request=>rpcStarts.delete(request));
  await page.addInitScript(session => localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),data.session);
  await page.goto('http://127.0.0.2:4181/financias/');
  await expect(page.getByRole('heading',{ name:'Visão geral',exact:true })).toBeVisible();
  assert.equal(await page.evaluate(() => isSecureContext),true,'Loopback test must support service workers');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByLabel('Livre para gastar conservador',{ exact:true })).toHaveText('R$ 100,00');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading',{ name:'Visão geral',exact:true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText:'Sem conexão' })).toBeVisible();
  await expect(page.getByLabel('Livre para gastar conservador',{ exact:true })).toHaveText('R$ 100,00');
  await page.getByRole('button',{ name:'Novo gasto rápido',exact:true }).click();
  await page.getByLabel('Valor rápido (R$)',{ exact:true }).fill('45,00');
  await page.getByLabel('Descrição rápida (opcional)',{ exact:true }).fill('Almoço PWA sem internet');
  await page.getByLabel('Categoria do lançamento rápido',{ exact:true }).selectOption({ label:'Alimentação offline' });
  await page.getByLabel('Conta ou cartão do lançamento rápido',{ exact:true }).selectOption({ label:'Carteira offline' });
  await page.getByRole('button',{ name:'Salvar lançamento rápido',exact:true }).click();
  await expect(page.getByText(/1 lançamentos pendentes de envio/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/1 lançamentos pendentes de envio/)).toBeVisible();
  await expect(page.getByLabel('Livre para gastar conservador',{ exact:true })).toHaveText('R$ 100,00');
  await page.route('**/rest/v1/**',route => route.abort());
  newWorker=true;
  await context.setOffline(false);
  await page.evaluate(async () => { const registration=await navigator.serviceWorker.ready; await registration.update(); });
  await expect(page.getByRole('button',{ name:'Atualizar aplicativo',exact:true })).toBeVisible();
  await page.getByRole('button',{ name:'Atualizar aplicativo',exact:true }).click();
  await expect(page.getByRole('heading',{ name:'Visão geral',exact:true })).toBeVisible();
  await expect(page.getByRole('button',{ name:'Atualizar aplicativo',exact:true })).toHaveCount(0);
  await expect(page.getByText(/1 lançamentos pendentes de envio/)).toBeVisible();
  await page.unroute('**/rest/v1/**');
  await page.getByRole('button',{ name:'Enviar agora',exact:true }).click();
  await expect.poll(async () => (await rpc('workspace_snapshot',{ p_space:space })).totals.cash_cents,{ timeout:15000 }).toBe(5500);
  await expect(page.getByText(/1 lançamentos pendentes de envio/)).toHaveCount(0);
  console.log('Built PWA passed: service-worker registration, full reload without internet, canonical cached values, queue preserved through an app update and reconnect sync.');
} catch (error) {
  const pageState=page && !page.isClosed() ? await page.evaluate(()=>({
    online:navigator.onLine,
    alerts:[...document.querySelectorAll('[role="alert"]')].map(node=>node.textContent),
    statuses:[...document.querySelectorAll('[role="status"]')].map(node=>node.textContent),
    projection:document.querySelector('[aria-label="Livre para gastar"]')?.textContent,
    worker:navigator.serviceWorker.controller?.scriptURL
  })).catch(()=>null) : null;
  const pendingRpc=[...rpcStarts].map(([request,start])=>({ path:rpcPath(request),elapsedMs:Math.round(performance.now()-start) }));
  console.error('Offline PWA diagnostic:',JSON.stringify({ ...diagnostics,pendingRpc,pageState },null,2));
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await client.auth.signOut();
}
