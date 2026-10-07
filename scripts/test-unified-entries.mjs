import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const mock=process.argv.includes('--mock');
const status=mock?{API_URL:'https://unified-test.supabase.co',ANON_KEY:'test-only',SERVICE_ROLE_KEY:'test-only'}:JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','npx supabase status -o json 2>$null'],{encoding:'utf8',windowsHide:true}));
assert.ok(mock||new URL(status.API_URL).hostname==='127.0.0.1','Fixtures must stay in local Supabase');
process.env.VITE_SUPABASE_URL=status.API_URL;process.env.VITE_SUPABASE_ANON_KEY=status.ANON_KEY;process.env.VITE_FINANCIAL_MODEL='ledger';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options),client=createClient(status.API_URL,status.ANON_KEY,options);
const email=`unified-${randomUUID()}@test.local`,password=randomUUID();
const user={id:randomUUID(),email};
const {data:created,error:creationError}=mock?{data:{user}}:await admin.auth.admin.createUser({email,password,email_confirm:true});
if(creationError)throw creationError;
const jwt=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+86400,role:'authenticated'})).toString('base64url'),'test'].join('.');
const {data:auth,error:authError}=mock?{data:{session:{access_token:jwt,refresh_token:'test-only',expires_at:Math.floor(Date.now()/1000)+86400,expires_in:86400,token_type:'bearer',user}}}:await client.auth.signInWithPassword({email,password});if(authError)throw authError;
const mocked={space:{id:randomUUID(),name:'Teste',today:'2026-10-07',timezone:'America/Sao_Paulo'},role:'owner',accounts:[],categories:[],cards:[],transactions:[],people:[],statements:[],commitments:[],budgets:[],totals:{cash_cents:0,benefit_cents:0,investment_cents:0,property_cents:0,card_used_cents:0,commitment_outflows_cents:0}};
const preferences={models:[],drafts:[]},seen=new Set();
function mockRpc(name,args) {
  if(name==='create_personal_space')return mocked.space.id;
  if(name==='create_financial_account'){const id=randomUUID();mocked.accounts.push({id,name:args.p_name,ledger_account_id:randomUUID(),kind:args.p_kind,liquidity:'cash',balance_cents:args.p_opening_cents});return id}
  if(name==='create_category'){const id=randomUUID();mocked.categories.push({id,name:args.p_name,kind:args.p_kind,ledger_account_id:randomUUID(),parent_id:null});return id}
  if(name==='create_credit_card'){const id=randomUUID();mocked.cards.push({id,name:args.p_name,granted_cents:args.p_limit_cents,used_cents:0,free_cents:args.p_limit_cents});return id}
  if(name==='workspace_snapshot')return structuredClone(mocked);
  if(name==='entry_preferences')return structuredClone(preferences);
  if(name==='suggest_entry_category')return [];
  if(name==='save_transaction_draft'){const id=args.p_draft??randomUUID();const draft={id,title:args.p_title,version:1,payload:args.p_payload};preferences.drafts=preferences.drafts.filter(d=>d.id!==id);preferences.drafts.push(draft);return id}
  if(name==='save_entry_model'){const id=randomUUID();preferences.models.push({id,name:args.p_name,version:1,payload:args.p_payload});return id}
  if(name==='delete_entry_preference'){const key=args.p_kind==='draft'?'drafts':'models';preferences[key]=preferences[key].filter(row=>row.id!==args.p_id);return null}
  if(name==='post_transaction'){const p=args.p_payload;if(seen.has(p.client_uuid))return null;seen.add(p.client_uuid);for(const entry of p.entries){const account=mocked.accounts.find(a=>a.ledger_account_id===entry.ledger_account_id);if(account)account.balance_cents+=entry.amount_cents}mocked.transactions.unshift({id:randomUUID(),description:p.description,kind:p.kind,occurred_on:p.occurred_on,status:'posted',version:1,amount_cents:Math.max(...p.entries.map(e=>e.amount_cents)),entries:[]});return randomUUID()}
  if(name==='transfer_between_accounts'){mocked.accounts.find(a=>a.id===args.p_from).balance_cents-=args.p_amount_cents;mocked.accounts.find(a=>a.id===args.p_to).balance_cents+=args.p_amount_cents;return randomUUID()}
  if(name==='record_card_purchase'){if(seen.has(args.p_client_uuid))return null;seen.add(args.p_client_uuid);mocked.transactions.unshift({id:randomUUID(),description:args.p_description,kind:'card_purchase',occurred_on:args.p_on,status:'posted',version:1,amount_cents:args.p_total_cents,entries:[]});return randomUUID()}
  throw new Error(`Unexpected mock RPC ${name}`);
}
async function rpc(name,args={}) {if(mock)return mockRpc(name,args);const {data,error}=await client.schema('api').rpc(name,args);if(error)throw new Error(`${name}: ${error.message}`);return data}
const space=await rpc('create_personal_space');
const bank=await rpc('create_financial_account',{p_space:space,p_name:'Conta unificada',p_kind:'checking',p_opening_cents:100000,p_opening_on:'2000-01-01'});
const destination=await rpc('create_financial_account',{p_space:space,p_name:'Destino unificado',p_kind:'wallet',p_opening_cents:0,p_opening_on:'2000-01-01'});
const category=await rpc('create_category',{p_space:space,p_name:'Categoria unificada',p_kind:'expense'});
const income=await rpc('create_category',{p_space:space,p_name:'Receita unificada',p_kind:'income'});
const card=await rpc('create_credit_card',{p_space:space,p_name:'Cartão unificado',p_limit_cents:300000,p_closing_day:1,p_due_day:10,p_payment_account:bank});
const snapshot=()=>rpc('workspace_snapshot',{p_space:space});
const cash=async()=> (await snapshot()).accounts.find(item=>item.id===bank).balance_cents;
const prefs=()=>rpc('entry_preferences',{p_space:space});
let server;
if(mock){
  const project=process.cwd().replaceAll('\\','/'),root=resolve('out/unified-entry-harness');await mkdir(root,{recursive:true});
  const css=(await readdir(resolve('out/pwa/assets'))).find(file=>file.endsWith('.css'));
  const styles=await readFile(resolve('out/pwa/assets',css),'utf8');
  await writeFile(resolve(root,'index.html'),`<html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><div id="root"></div><script type="module" src="./harness.tsx"></script></body></html>`);
  await writeFile(resolve(root,'harness.tsx'),`import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import LedgerTransactions from '${project}/src/renderer/src/pages/LedgerTransactions';import {ledgerRpc} from '${project}/src/renderer/src/lib/ledgerRepository';import {localIdentityCheck} from '${project}/src/renderer/src/lib/offlineStorage';import '${project}/src/renderer/src/index.css';await localIdentityCheck('${user.id}');function App(){const [workspace,setWorkspace]=useState(${JSON.stringify(mocked)}),[open,setOpen]=useState(location.search.includes('quick=expense')),[online,setOnline]=useState(navigator.onLine);useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update)}},[]);return <main style={{padding:16}}><h1>{open?'Lançamentos':'Visão geral'}</h1>{open?<LedgerTransactions workspace={workspace} money={c=>'R$ '+(c/100).toFixed(2)} reserves={null} online={online} onChanged={async()=>setWorkspace(await ledgerRpc('workspace_snapshot',{}))}/>:<button onClick={()=>setOpen(true)}>Adicionar lançamento</button>}</main>}createRoot(document.getElementById('root')!).render(<App/>);`);
  const harnessPath=resolve(root,'harness.tsx');
  await writeFile(harnessPath,(await readFile(harnessPath,'utf8')).replace(`import '${project}/src/renderer/src/index.css';`,''));
  server=await createServer({configFile:false,root,base:'/financias/',plugins:[react()],server:{host:'127.0.0.1',port:4198,strictPort:true,fs:{allow:[project]}}});
}else server=await createServer({configFile:'vite.pwa.config.ts',server:{host:'127.0.0.1',port:4198,strictPort:true}});
let browser,page;
try {
  await server.listen();browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(({session,key})=>localStorage.setItem(key,JSON.stringify(session)),{session:auth.session,key:mock?'sb-unified-test-auth-token':'sb-127-auth-token'});
  if(mock)await page.route('https://unified-test.supabase.co/**',async route=>{try{const result=mockRpc(new URL(route.request().url()).pathname.split('/').at(-1),route.request().postDataJSON()??{});await route.fulfill({json:result,headers:{'access-control-allow-origin':'*'}})}catch(error){await route.fulfill({status:400,json:{message:error.message,code:'23514'}})}});
  const exceptions=[];page.on('pageerror',error=>exceptions.push(error.message));
  await page.goto('http://127.0.0.1:4198/financias/');
  await expect(page.getByRole('heading',{name:'Visão geral',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Novo gasto rápido',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Adicionar lançamento',exact:true}).click();
  const form=page.getByRole('form',{name:'Adicionar lançamento',exact:true});
  const management=page.getByRole('region',{name:'Modelos, rascunhos e envio pendente',exact:true});
  await expect(form).toHaveCount(1);
  await expect(form).toHaveCSS('display','flex');
  await expect(form.locator('label').first()).toHaveCSS('width','176px');
  await page.getByText('Modelos, rascunhos e envio pendente',{exact:true}).click();
  await expect(management.locator('form')).toHaveCount(0);
  await form.locator('[name="name"]').fill('Rascunho unificado');
  await form.getByText('Modelo e rascunho',{exact:true}).click();
  await form.getByRole('button',{name:'Salvar como rascunho',exact:true}).click();
  await expect.poll(async()=> (await prefs()).drafts.length).toBe(1);
  assert.equal(await cash(),100000,'Incomplete drafts do not affect balances');
  await management.getByText('Meus rascunhos (1)',{exact:true}).click();
  await management.getByRole('button',{name:'Completar rascunho',exact:true}).click();
  await expect(form.locator('[name="name"]')).toHaveValue('Rascunho unificado');
  await form.locator('input[name="amount"]').fill('12,34');
  await form.getByRole('combobox',{name:'Conta',exact:true}).selectOption(bank);
  await form.getByRole('combobox',{name:'Categoria',exact:true}).selectOption(category);
  await form.getByText('Modelo e rascunho',{exact:true}).click();
  await form.getByRole('checkbox',{name:'Salvar também como meu modelo',exact:true}).check();
  await form.locator('[name="model_name"]').fill('Modelo unificado');
  await form.getByRole('button',{name:'Adicionar lançamento',exact:true}).click();
  await expect.poll(cash).toBe(98766);
  await expect.poll(async()=> (await prefs()).drafts.length).toBe(0);
  await expect.poll(async()=> (await prefs()).models.length).toBe(1);
  await management.getByRole('button',{name:'Modelo unificado',exact:true}).click();
  await expect(form.locator('input[name="amount"]')).toHaveValue('12,34');
  await expect(form.getByRole('combobox',{name:'Conta',exact:true})).toHaveValue(bank);
  await expect(form.getByRole('combobox',{name:'Categoria',exact:true})).toHaveValue(category);
  await form.getByRole('button',{name:'Adicionar lançamento',exact:true}).click();
  await expect.poll(cash).toBe(97532);
  assert.equal((await snapshot()).transactions.filter(t=>t.description==='Rascunho unificado').length,2,'Using a model creates an independent entry');
  await form.getByRole('combobox',{name:'Operação',exact:true}).selectOption('transfer');
  await form.getByRole('combobox',{name:'Conta',exact:true}).selectOption(bank);
  await form.getByRole('combobox',{name:'Conta de destino',exact:true}).selectOption(destination);
  await form.locator('input[name="amount"]').fill('10,00');
  await form.getByRole('button',{name:'Adicionar lançamento',exact:true}).click();
  await expect.poll(cash).toBe(96532);
  await form.getByRole('combobox',{name:'Operação',exact:true}).selectOption('card_purchase');
  await form.locator('[name="name"]').fill('Compra parcelada unificada');
  await form.locator('input[name="amount"]').fill('30,00');
  await form.getByRole('combobox',{name:'Cartão',exact:true}).selectOption(card);
  await form.getByRole('combobox',{name:'Categoria',exact:true}).selectOption(category);
  await form.locator('[name="installments"]').fill('2');
  await form.getByText('Modelo e rascunho',{exact:true}).click();
  await form.getByRole('button',{name:'Salvar como rascunho',exact:true}).click();
  await expect.poll(async()=> (await prefs()).drafts.length).toBe(1);
  assert.equal((await prefs()).drafts[0].payload.installments,2,'Draft retains installments');
  await management.getByText('Meus rascunhos (1)',{exact:true}).click();
  await management.getByRole('button',{name:'Completar rascunho',exact:true}).click();
  await expect(form.locator('[name="installments"]')).toHaveValue('2');
  await form.getByRole('button',{name:'Adicionar lançamento',exact:true}).click();
  await expect.poll(async()=> (await prefs()).drafts.length).toBe(0);
  await form.getByRole('combobox',{name:'Operação',exact:true}).selectOption('expense');
  await page.context().setOffline(true);
  await expect(form.getByRole('button',{name:'Salvar para enviar depois',exact:true})).toBeVisible();
  await form.locator('[name="name"]').fill('Despesa unificada offline');
  await form.locator('input[name="amount"]').fill('4,50');
  await form.getByRole('combobox',{name:'Conta',exact:true}).selectOption(bank);
  await form.getByRole('combobox',{name:'Categoria',exact:true}).selectOption(category);
  await form.getByRole('button',{name:'Salvar para enviar depois',exact:true}).click();
  await expect(management.getByText(/1 lançamentos pendentes de envio/)).toBeVisible();
  assert.equal(await cash(),96532,'Queued expense leaves server balances unchanged');
  await form.getByRole('combobox',{name:'Operação',exact:true}).selectOption('income');
  await form.locator('[name="name"]').fill('Receita unificada offline');
  await form.locator('input[name="amount"]').fill('7,00');
  await form.getByRole('combobox',{name:'Conta',exact:true}).selectOption(bank);
  await form.getByRole('combobox',{name:'Categoria',exact:true}).selectOption(income);
  await form.getByRole('button',{name:'Salvar para enviar depois',exact:true}).click();
  await expect(management.getByText(/2 lançamentos pendentes de envio/)).toBeVisible();
  await form.getByRole('combobox',{name:'Operação',exact:true}).selectOption('card_purchase');
  await form.locator('[name="name"]').fill('Compra unificada offline');
  await form.locator('input[name="amount"]').fill('6,00');
  await form.getByRole('combobox',{name:'Cartão',exact:true}).selectOption(card);
  await form.getByRole('combobox',{name:'Categoria',exact:true}).selectOption(category);
  await form.getByRole('button',{name:'Salvar para enviar depois',exact:true}).click();
  await expect(management.getByText(/3 lançamentos pendentes de envio/)).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Unified form fits mobile');
  await mkdir('out/unified-entries-test',{recursive:true});
  await page.screenshot({path:'out/unified-entries-test/mobile-offline.png',fullPage:true});
  await page.context().setOffline(false);
  await expect.poll(cash,{timeout:20000}).toBe(96782);
  await expect(management.getByText(/lançamentos pendentes de envio/)).toHaveCount(0);
  assert.equal((await snapshot()).transactions.filter(t=>t.description==='Despesa unificada offline').length,1);
  assert.equal((await snapshot()).transactions.filter(t=>t.description==='Receita unificada offline').length,1);
  assert.equal((await snapshot()).transactions.filter(t=>t.description==='Compra unificada offline').length,1);
  const fixture=await snapshot(),rejectedUuid=randomUUID();
  await page.evaluate(async item=>{await new Promise((resolve,reject)=>{const open=indexedDB.open('financias-offline');open.onsuccess=()=>{const db=open.result,tx=db.transaction('queue','readwrite');tx.objectStore('queue').put({...item,id:`${item.userId}:${item.spaceId}:${item.clientUuid}`});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}});window.dispatchEvent(new Event('financias-queue-changed'))},{clientUuid:rejectedUuid,userId:auth.session.user.id,spaceId:space,createdAt:new Date().toISOString(),state:'rejected',attempts:1,nextAttemptAt:null,lastReason:'Corrija os dados',content:{kind:'expense',amountCents:100,description:'Rejeitado unificado',occurredOn:fixture.space.today,categoryId:category,categoryLedgerId:fixture.categories.find(c=>c.id===category).ledger_account_id,accountId:bank,accountLedgerId:fixture.accounts.find(a=>a.id===bank).ledger_account_id}});
  await management.getByRole('button',{name:'Editar e reenviar',exact:true}).click();
  await expect(form.locator('[name="name"]')).toHaveValue('Rejeitado unificado');
  await form.locator('[name="name"]').fill('Rejeitado corrigido');
  await form.getByRole('button',{name:'Salvar e reenviar',exact:true}).click();
  await expect.poll(cash,{timeout:20000}).toBe(96682);
  assert.equal((await snapshot()).transactions.filter(t=>t.description==='Rejeitado corrigido').length,1,'Corrected pending entry sends exactly once');
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'out/unified-entries-test/desktop.png',fullPage:true});
  await page.goto('http://127.0.0.1:4198/financias/?quick=expense');
  await expect(page.getByRole('heading',{name:'Lançamentos',exact:true})).toBeVisible();
  await expect(form).toHaveCount(1);
  assert.deepEqual(exceptions,[]);
  console.log(`Passed unified entries (${mock?'component with mocked API':'local Supabase'}): one form, drafts, model save/reuse, transfers, offline expense/income, automatic sync exactly once, mobile and PWA shortcut.`);
}catch(failure){await page?.screenshot({path:'out/unified-entries-test/failure.png',fullPage:true}).catch(()=>undefined);throw failure}
finally{await browser?.close();await server.close();if(!mock)await admin.auth.admin.deleteUser(created.user.id).catch(()=>undefined)}
