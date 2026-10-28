import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// Every financial mutation below uses isolated identities on local Supabase.
const status=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','npx supabase status -o json 2>$null'],{encoding:'utf8',windowsHide:true}));
assert.equal(new URL(status.API_URL).hostname,'127.0.0.1','Planning checks must never mutate production');
process.env.VITE_SUPABASE_URL=status.API_URL;
process.env.VITE_SUPABASE_ANON_KEY=status.ANON_KEY;
process.env.VITE_FINANCIAL_MODEL='ledger';
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options);
async function identity(label){
  const email=`planning-${label}-${randomUUID().slice(0,8)}@test.local`,password=randomUUID();
  const {error:creation}=await admin.auth.admin.createUser({email,password,email_confirm:true});if(creation)throw new Error(creation.message);
  const client=createClient(status.API_URL,status.ANON_KEY,options);
  const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw new Error(error.message);
  return {email,client,session:data.session};
}
const owner=await identity('owner'),viewer=await identity('viewer');
async function rpc(name,args={},user=owner){const {data,error}=await user.client.schema('api').rpc(name,args);if(error)throw new Error(`${name}: ${error.message}`);return data;}
await rpc('create_personal_space');
const space=await rpc('create_space',{p_name:'Planejamento local',p_kind:'shared',p_timezone:'America/Sao_Paulo'});
const snapshot=()=>rpc('workspace_snapshot',{p_space:space});
const today=(await snapshot()).space.today,month=today.slice(0,7);
const bank=await rpc('create_financial_account',{p_space:space,p_name:'Banco do plano',p_kind:'checking',p_opening_cents:1000000,p_opening_on:today});
const investment=await rpc('create_financial_account',{p_space:space,p_name:'Investimento do plano',p_kind:'investment',p_opening_cents:100000,p_opening_on:today});
const expense=await rpc('create_category',{p_space:space,p_name:'Despesa do plano',p_kind:'expense'});
await rpc('create_category',{p_space:space,p_name:'Receita do plano',p_kind:'income',p_income_class:'extraordinary'});
const person=await rpc('create_person',{p_space:space,p_nickname:'Contato do plano'});
await rpc('create_credit_card',{p_space:space,p_name:'Cartão do plano',p_limit_cents:300000,p_closing_day:1,p_due_day:10,p_payment_account:bank});
const loan=await rpc('create_loan',{p_space:space,p_name:'Empréstimo do plano',p_kind:'loan',p_opening_cents:100000,p_on:today,p_lender:'Credor local',p_client_uuid:randomUUID()});
const future=new Date(today+'T12:00:00Z');future.setUTCMonth(future.getUTCMonth()+3);const futureDate=future.toISOString().slice(0,10);
const provision=await rpc('create_reserve',{p_space:space,p_payload:{reserve_type:'provision',name:'Provisão do plano',holding_mode:'virtual',financial_account_id:bank,category_id:expense,target_amount_cents:60000,target_date:futureDate,contribution_mode:'manual'}});
const originalProvisionCommitments=(await snapshot()).commitments.filter(item=>item.reserve_id===provision);
assert.equal(originalProvisionCommitments.length,1,'The original provision has one scheduled commitment');
const invitation=await rpc('invite_space_member',{p_space:space,p_email:viewer.email,p_role:'viewer',p_nickname:'Leitor do plano'});
await rpc('accept_space_invitation',{p_token:invitation.token},viewer);
for(const user of [owner,viewer]){const settings=await rpc('get_user_settings',{},user);await rpc('update_user_settings',{p_version:settings.version,p_changes:{active_financial_space_id:space,theme:'dark'}},user);}
const cash=async()=> (await snapshot()).accounts.find(account=>account.id===bank).balance_cents;
const reserves=()=>rpc('reserve_summary',{p_space:space});
const portfolio=()=>rpc('portfolio_summary',{p_space:space});
const server=await createServer({configFile:'vite.pwa.config.ts',server:{host:'127.0.0.1',port:4194,strictPort:true}});await server.listen();
await mkdir('out/planning-layout-test',{recursive:true});
let browser,page,stage='startup';const errors=[];
try{
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  async function open(user){
    const context=await browser.newContext({viewport:{width:1663,height:1000}}),target=await context.newPage();
    target.on('pageerror',error=>errors.push(error.message));
    await target.route('**/rest/v1/rpc/**',route=>{assert.equal(new URL(route.request().url()).hostname,'127.0.0.1');return route.continue();});
    await target.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),user.session);
    await target.goto('http://127.0.0.1:4194/financias/');await expect(target.getByRole('heading',{name:'Visão geral',exact:true})).toBeVisible();return target;
  }
  page=await open(owner);
  async function navigate(name,target=page){await target.getByRole('button',{name,exact:true}).click();await expect(target.getByRole('heading',{name,exact:true})).toBeVisible();await expect(target.getByRole('alert')).toHaveCount(0);await expect(target.getByRole('button',{name:'Cadastrar',exact:true})).toHaveCount(0);await expect(target.getByRole('region',{name:'Lançamento rápido e fila de envio',exact:true})).toHaveCount(0);assert.equal(await target.locator('form form').count(),0);}
  const table=name=>page.getByRole('table',{name,exact:true});
  async function details(tableName,name){const label=tableName==='Itens da Agenda'?'Detalhes do item '+name:tableName==='Orçamentos'?'Detalhes do orçamento '+name:tableName==='Valores informados'?'Ver detalhes do valor de '+name+' em '+today:'Ver detalhes de '+name;await table(tableName).getByRole('button',{name:label,exact:true}).click();}
  async function capture(label){
    await expect(page.locator('fieldset:disabled')).toHaveCount(0);
    await expect(page.getByRole('button',{name:/^(Salvando…|Carregando…|Registrando…|Cancelando…)$/})).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    for(const theme of ['light','dark'])for(const width of [1663,390]){
      await page.setViewportSize({width,height:width===390?844:1000});
      await page.evaluate(async theme=>{document.documentElement.classList.toggle('dark',theme==='dark');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},theme);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${label} fits ${width}px`);
      await page.screenshot({path:`out/planning-layout-test/${label}-${width}-${theme}.png`,fullPage:true});
    }
    await page.setViewportSize({width:1663,height:1000});
  }
  function start(value){stage=value;console.log('Planning layout: '+value);}

  start('Agenda creates an item and a reminder, edits and partially pays exact cents');
  await navigate('Agenda');
  const agendaForm=page.getByRole('form',{name:'Adicionar item à Agenda',exact:true});
  await agendaForm.getByLabel('Nome ou descrição',{exact:true}).fill('Compromisso do plano');
  await agendaForm.getByLabel('Conta',{exact:true}).selectOption(bank);
  await agendaForm.getByLabel('Categoria',{exact:true}).selectOption(expense);
  await agendaForm.getByLabel('Valor (R$)',{exact:true}).fill('20,00');
  await agendaForm.getByRole('button',{name:'Adicionar item',exact:true}).click();
  await expect(table('Itens da Agenda')).toContainText('Compromisso do plano');
  const commitment=(await snapshot()).commitments.find(item=>item.title==='Compromisso do plano');
  assert.equal(commitment.remaining_cents,2000);assert.equal(await cash(),1000000,'Scheduling never posts cash');
  await agendaForm.getByLabel('Nome ou descrição',{exact:true}).fill('Rascunho da Agenda');
  await details('Itens da Agenda','Compromisso do plano');
  await page.getByRole('button',{name:'Editar este item',exact:true}).click();
  await page.getByLabel('Valor previsto (R$)',{exact:true}).fill('22,00');
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect.poll(async()=> (await snapshot()).commitments.find(item=>item.id===commitment.id).remaining_cents).toBe(2200);
  await page.getByRole('button',{name:'Informar valor e data',exact:true}).click();
  await page.getByLabel('Valor recebido ou pago (R$)',{exact:true}).fill('5,00');
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect.poll(cash).toBe(999500);
  assert.equal((await snapshot()).commitments.find(item=>item.id===commitment.id).remaining_cents,1700);
  await expect(agendaForm.getByLabel('Nome ou descrição',{exact:true})).toHaveValue('Rascunho da Agenda');
  await capture('agenda');
  await agendaForm.getByLabel('Tipo de item da Agenda',{exact:true}).selectOption('reminder');
  await agendaForm.getByLabel('Nome ou descrição',{exact:true}).fill('Lembrete do plano');
  await agendaForm.getByLabel('Pessoa do lembrete',{exact:true}).selectOption(person);
  await agendaForm.getByRole('button',{name:'Adicionar item',exact:true}).click();
  await expect(table('Itens da Agenda')).toContainText('Lembrete do plano');
  await details('Itens da Agenda','Lembrete do plano');
  await page.getByRole('button',{name:'Concluir lembrete',exact:true}).click();
  assert.equal(await cash(),999500,'A reminder never changes cash');

  start('Budgets create and adjust a single month without changing the next month');
  await navigate('Orçamentos');
  const budgetForm=page.getByRole('form',{name:'Adicionar orçamento',exact:true});
  await budgetForm.getByLabel('Categoria',{exact:true}).selectOption(expense);
  await budgetForm.getByLabel('Valor (R$)',{exact:true}).fill('500,00');
  await budgetForm.getByRole('button',{name:'Adicionar orçamento',exact:true}).click();
  await expect(table('Orçamentos')).toContainText('Despesa do plano');
  const budget=(await rpc('budget_management_summary',{p_space:space,p_month:month+'-01'})).budgets.find(item=>item.category_name==='Despesa do plano');
  await details('Orçamentos','Despesa do plano');
  await page.getByRole('button',{name:'Ajustar ou encerrar orçamento',exact:true}).click();
  await page.getByLabel('Novo limite (R$)',{exact:true}).fill('650,00');
  await page.getByRole('button',{name:'Salvar ajuste do orçamento',exact:true}).click();
  await expect.poll(async()=> (await rpc('budget_management_summary',{p_space:space,p_month:month+'-01'})).summary.find(item=>item.id===budget.id).amount_cents).toBe(65000);
  const nextMonth=new Date(month+'-01T12:00:00Z');nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1);
  assert.equal((await rpc('budget_management_summary',{p_space:space,p_month:nextMonth.toISOString().slice(0,10)})).summary.find(item=>item.id===budget.id).amount_cents,50000);
  await capture('budgets');

  start('Recurrences preserve the creation draft while changing a series');
  await navigate('Recorrências');
  const recurrenceForm=page.getByRole('form',{name:'Adicionar recorrência',exact:true});
  await recurrenceForm.getByLabel('Descrição',{exact:true}).fill('Recorrência do plano');
  await recurrenceForm.getByLabel('Valor (R$)',{exact:true}).fill('40,00');
  await recurrenceForm.getByLabel('Categoria',{exact:true}).selectOption(expense);
  await recurrenceForm.getByLabel('Conta',{exact:true}).selectOption(bank);
  await recurrenceForm.getByRole('button',{name:'Adicionar recorrência',exact:true}).click();
  await expect(table('Recorrências')).toContainText('Recorrência do plano');
  await recurrenceForm.getByLabel('Descrição',{exact:true}).fill('Rascunho da recorrência');
  await details('Recorrências','Recorrência do plano');
  await page.getByRole('button',{name:'Editar série',exact:true}).click();
  const recurrenceEdit=page.getByRole('form',{name:'Editar recorrência Recorrência do plano',exact:true});
  await recurrenceEdit.getByLabel('Valor (R$)',{exact:true}).fill('45,00');
  await recurrenceEdit.getByRole('button',{name:'Salvar recorrência',exact:true}).click();
  await expect.poll(async()=> (await rpc('workspace_metadata',{p_space:space})).recurrences.find(item=>item.title==='Recorrência do plano').current_version.amount_cents).toBe(4500);
  await expect(recurrenceForm.getByLabel('Descrição',{exact:true})).toHaveValue('Rascunho da recorrência');
  await capture('recurrences');

  start('Goals and provision funding never move cash');
  await navigate('Metas e provisões');
  const reserveForm=page.getByRole('form',{name:'Adicionar reserva',exact:true});
  await reserveForm.getByLabel('Nome da reserva',{exact:true}).fill('Meta do plano');
  await reserveForm.getByLabel('Conta da reserva',{exact:true}).selectOption(bank);
  await reserveForm.getByLabel('Valor-alvo (R$)',{exact:true}).fill('200,00');
  await reserveForm.getByRole('button',{name:'Adicionar reserva',exact:true}).click();
  await expect(table('Metas e provisões')).toContainText('Meta do plano');
  await details('Metas e provisões','Meta do plano');
  await page.getByRole('button',{name:'Separar dinheiro',exact:true}).click();
  await page.getByLabel('Valor da movimentação (R$)',{exact:true}).fill('100,00');
  await page.getByRole('button',{name:'Registrar aporte',exact:true}).click();
  await expect.poll(async()=> (await reserves()).reserves.find(item=>item.name==='Meta do plano').balance_cents).toBe(10000);
  assert.equal(await cash(),999500);
  await expect(table('Planejamento de aportes')).toContainText('Provisão do plano');
  await capture('reserves');

  start('Provision quota replacement preserves the cancelled schedule and funds the current cycle without moving cash');
  const futureMonth=offset=>new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7))-1+offset,1)).toISOString().slice(0,10);
  const planRegion=page.getByRole('region',{name:'Planejamento de aportes',exact:true});
  await table('Planejamento de aportes').getByRole('button',{name:'Ver detalhes do plano Provisão do plano',exact:true}).click();
  const provisionPlan=page.getByRole('region',{name:'Detalhes do plano Provisão do plano',exact:true});
  await provisionPlan.getByRole('button',{name:'Configurar plano e cotas',exact:true}).click();
  await provisionPlan.getByLabel('Prioridade do aporte (maior primeiro)',{exact:true}).fill('5');
  await provisionPlan.getByRole('checkbox',{name:'Substituir o valor, as datas ou as cotas da provisão',exact:true}).check();
  await provisionPlan.getByLabel('Vencimento da cota 1',{exact:true}).fill(futureMonth(2));
  await provisionPlan.getByLabel('Valor da cota 1 (R$)',{exact:true}).fill('200,00');
  await provisionPlan.getByRole('button',{name:'Adicionar cota',exact:true}).click();
  await provisionPlan.getByLabel('Vencimento da cota 2',{exact:true}).fill(futureMonth(3));
  await provisionPlan.getByLabel('Valor da cota 2 (R$)',{exact:true}).fill('400,00');
  await provisionPlan.getByRole('button',{name:'Salvar plano de aportes',exact:true}).click();
  await expect(planRegion.getByRole('status')).toContainText('Plano de aportes atualizado');
  let funding=await rpc('reserve_funding_summary',{p_space:space});
  const provisionFunding=funding.plans.find(item=>item.reserveId===provision);
  assert.deepEqual(provisionFunding.targets.map(item=>item.remainingCents),[20000,40000]);
  const effectiveQuotas=(await snapshot()).commitments.filter(item=>item.reserve_id===provision&&item.settlement_status!=='cancelled').sort((a,b)=>a.nominal_due_on.localeCompare(b.nominal_due_on));
  assert.deepEqual(effectiveQuotas.map(item=>item.nominal_due_on),[futureMonth(2),futureMonth(3)],'Quota dates retain the dates entered by the user');
  assert.deepEqual(provisionFunding.targets.map(item=>item.dueOn),effectiveQuotas.map(item=>item.effective_due_on),'Funding targets use the calendar-adjusted due dates');
  assert.ok(provisionFunding.dates.every(on=>on<provisionFunding.targets.at(-1).dueOn),'Funding dates stay before the final quota');
  const replacedCommitments=(await snapshot()).commitments.filter(item=>item.reserve_id===provision);
  for(const previous of originalProvisionCommitments){const preserved=replacedCommitments.find(item=>item.id===previous.id);assert.ok(preserved,'Replacing quotas preserves the original commitment identity');assert.equal(preserved.settlement_status,'cancelled');assert.equal(preserved.due_amount_cents,previous.due_amount_cents,'The cancelled historical amount is retained');}
  assert.deepEqual(replacedCommitments.filter(item=>item.settlement_status!=='cancelled').sort((a,b)=>a.effective_due_on.localeCompare(b.effective_due_on)).map(item=>item.due_amount_cents),[20000,40000]);
  assert.equal((await reserves()).reserves.find(item=>item.id===provision).priority,5);
  assert.equal(await cash(),999500,'Replacing a provision schedule does not post a financial entry');
  if(provisionFunding.dates.includes(today)&&!funding.events.some(item=>item.reserve_id===provision&&item.scheduled_for===today)){
    const cashBeforeFunding=await cash(),reserveBeforeFunding=(await reserves()).reserves.find(item=>item.id===provision).balance_cents;
    await provisionPlan.getByRole('button',{name:'Confirmar aporte do ciclo',exact:true}).click();
    await provisionPlan.getByLabel(`Valor a separar no ciclo de ${today.split('-').reverse().join('/')} (R$)`,{exact:true}).fill('100,00');
    await provisionPlan.getByRole('button',{name:'Confirmar valor do aporte',exact:true}).click();
    await expect.poll(async()=> (await reserves()).reserves.find(item=>item.id===provision).balance_cents).toBe(reserveBeforeFunding+10000);
    assert.equal(await cash(),cashBeforeFunding,'A confirmed funding contribution separates money without moving cash');
    funding=await rpc('reserve_funding_summary',{p_space:space});
    const confirmedCycle=funding.events.filter(item=>item.reserve_id===provision&&item.scheduled_for===today);
    assert.equal(confirmedCycle.length,1);assert.equal(confirmedCycle[0].contributed_cents,10000);assert.equal(confirmedCycle[0].origin,'confirmed');
  }
  await capture('provision-plan');

  start('A negative Livre contribution requires explicit approval, a changed amount invalidates it, and release preserves cash');
  const warningGoal=await rpc('create_reserve',{p_space:space,p_payload:{name:'Meta com aviso do plano',holding_mode:'virtual',financial_account_id:bank,target_amount_cents:2000000,contribution_mode:'manual'}});
  const beforeWarning=await snapshot();
  await page.getByRole('button',{name:'Atualizar',exact:true}).first().click();
  await expect(table('Metas e provisões')).toContainText('Meta com aviso do plano');
  await details('Metas e provisões','Meta com aviso do plano');
  const warningReserve=page.getByRole('region',{name:'Detalhes da reserva Meta com aviso do plano',exact:true});
  await warningReserve.getByRole('button',{name:'Separar dinheiro',exact:true}).click();
  await warningReserve.getByLabel('Valor da movimentação (R$)',{exact:true}).fill('10000,00');
  await warningReserve.getByRole('button',{name:'Registrar aporte',exact:true}).click();
  const warningText='Este aporte deixa o Livre para gastar conservador negativo.';
  await expect(warningReserve.getByText(warningText,{exact:true})).toBeVisible();
  const warningBalance=async()=> (await reserves()).reserves.find(item=>item.id===warningGoal).balance_cents;
  assert.equal(await warningBalance(),0,'An unapproved warning preview creates no reserve contribution');
  assert.equal((await snapshot()).transactions.length,beforeWarning.transactions.length,'Previewing a contribution creates no financial transaction');
  await warningReserve.getByRole('checkbox',{name:'Conferi o aviso e quero manter este aporte.',exact:true}).check();
  await warningReserve.getByLabel('Valor da movimentação (R$)',{exact:true}).fill('10001,00');
  await expect(warningReserve.getByRole('checkbox',{name:'Conferi o aviso e quero manter este aporte.',exact:true})).toHaveCount(0);
  assert.equal(await warningBalance(),0,'Changing the approved amount still creates no contribution');
  await warningReserve.getByRole('button',{name:'Registrar aporte',exact:true}).click();
  await expect(warningReserve.getByText(warningText,{exact:true})).toBeVisible();
  await warningReserve.getByRole('checkbox',{name:'Conferi o aviso e quero manter este aporte.',exact:true}).check();
  await warningReserve.getByRole('button',{name:'Confirmar aporte mesmo assim',exact:true}).click();
  await expect.poll(warningBalance).toBe(1000100);
  assert.equal(await cash(),beforeWarning.accounts.find(item=>item.id===bank).balance_cents,'Even an explicitly approved large contribution does not transfer cash');
  await warningReserve.getByRole('button',{name:'Liberar dinheiro',exact:true}).click();
  await warningReserve.getByLabel('Valor da movimentação (R$)',{exact:true}).fill('10001,00');
  await warningReserve.getByRole('button',{name:'Registrar liberação',exact:true}).click();
  await expect.poll(warningBalance).toBe(0);
  await expect(page.getByText('Reserva atualizada.',{exact:true})).toBeVisible();
  assert.equal(await cash(),999500,'Releasing the reserve also leaves the bank balance unchanged');

  start('Portfolio valuation, cancellation and loan schedule retain their exact financial effects');
  await navigate('Patrimônio');
  await page.getByLabel('Investimento ou bem',{exact:true}).selectOption(investment);
  await page.getByLabel('Valor da posição (R$)',{exact:true}).fill('1.080,00');
  await page.getByRole('button',{name:'Registrar operação patrimonial',exact:true}).click();
  await expect.poll(async()=> (await portfolio()).accounts.find(item=>item.id===investment).balance_cents).toBe(108000);
  await details('Valores informados','Investimento do plano');
  await page.getByRole('button',{name:'Cancelar valor informado',exact:true}).click();
  await page.getByLabel('Motivo do cancelamento do valor',{exact:true}).fill('Corrigir o valor no teste local');
  await page.getByRole('button',{name:'Confirmar cancelamento',exact:true}).click();
  await expect.poll(async()=> (await portfolio()).accounts.find(item=>item.id===investment).balance_cents).toBe(100000);
  await details('Empréstimos e financiamentos','Empréstimo do plano');
  await page.getByRole('button',{name:'Cadastrar cronograma',exact:true}).click();
  await page.getByLabel('Quantidade',{exact:true}).fill('2');
  await page.getByLabel('Taxa mensal (%)',{exact:true}).fill('0');
  await page.getByRole('button',{name:'Gerar sugestão',exact:true}).click();
  await page.getByLabel('Conta de pagamento das parcelas',{exact:true}).selectOption(bank);
  await page.getByRole('button',{name:'Confirmar cronograma conferido',exact:true}).click();
  await expect.poll(async()=> (await rpc('loan_summary',{p_space:space})).loans.find(item=>item.id===loan).installments.filter(item=>!item.superseded_at).length).toBe(2);
  await capture('portfolio');

  start('Forecast preserves the chart, server calculations and saved preference');
  await navigate('Previsão de saldo');
  const curve=page.getByRole('region',{name:'Curva diária de saldo',exact:true});await expect(curve).toBeVisible();
  await page.getByRole('combobox',{name:'Período da previsão',exact:true}).selectOption('30_days');
  await page.getByRole('button',{name:'Atualizar previsão',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Período da previsão salvo'})).toBeVisible();
  assert.equal((await rpc('get_user_settings')).preferences.cash_forecast.horizon,'30_days');
  assert.equal((await rpc('cash_forecast',{p_space:space,p_horizon:'30_days'})).series.length,30);
  assert.equal(await cash(),999500);await capture('forecast');

  start('Privacy, read-only access on all six screens and offline navigation');
  const names=['Agenda','Previsão de saldo','Orçamentos','Metas e provisões','Recorrências','Patrimônio'];
  for(const name of names){await navigate(name);await page.getByRole('button',{name:'Ocultar valores',exact:true}).click();await expect(page.locator('main')).not.toContainText(/R\$\s*-?\d/);await page.getByRole('button',{name:'Mostrar valores',exact:true}).click();}
  const reader=await open(viewer);
  for(const name of names){await navigate(name,reader);await expect(reader.getByRole('button',{name:/^(Adicionar (item|orçamento|reserva|recorrência)|Registrar operação patrimonial|Separar dinheiro|Cancelar valor informado|Editar série|Cadastrar cronograma)$/})).toHaveCount(0);assert.equal(await reader.locator('form form').count(),0);}
  await page.context().setOffline(true);await navigate('Agenda');await expect(page.locator('main')).toContainText('aba Lançamentos');await expect(page.getByRole('form',{name:'Adicionar item à Agenda',exact:true})).toHaveCount(0);
  assert.deepEqual(errors,[],'Planning screens produce no uncaught browser errors');
  console.log('Planning layout passed: six screens, compact creation, responsive tables, inline editors, exact cents and partial payments, monthly budget exceptions, provision quota replacement/history/funding, explicit negative-Livre approval and stale-approval invalidation, reserve cash invariance, valuation reversal, loan schedule, forecast preference, privacy and read-only roles.');
}catch(failure){await page?.screenshot({path:'out/planning-layout-test/failure.png',fullPage:true});console.log('Planning layout failed at '+stage);if(page)console.log((await page.locator('body').innerText()).slice(-5500));throw failure;}
finally{await browser?.close();await server.close();await owner.client.auth.signOut();await viewer.client.auth.signOut();}
