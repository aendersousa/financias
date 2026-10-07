import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SharingInvitationTable, SharingMemberTable, SharingSettlementTable, SharingTransferTable } from '../components/SharingTables';
import { ledgerRpc, selectFinancialSpace, type LedgerWorkspace } from '../lib/ledgerRepository';
import { parseBrlCents } from '../../../shared/finance/money';
import { CurrencyInput } from '../components/CurrencyInput';

interface Member { id: string; user_id: string; role: string; status: string; version: number; nickname: string | null; person_id: string | null }
interface Share { member_id: string; nickname: string | null; contribution_cents: number; share_cents: number; surplus_share_cents: number; settlement_cents: number; person_balance_cents: number; carry_in_cents: number; carry_settled_cents: number; carry_remaining_cents: number }
interface Transfer { id: string; origin_space_id: string; destination_space_id: string; amount_cents: number; occurred_on: string; kind: string; version: number; cancelled_at: string | null }
interface Space { id: string; name: string; role: string; accounts: { id: string; name: string }[] }
interface Sharing { space_id: string; space_kind: string; person_balances: { person_id: string; nickname: string; kind: string; balance_cents: number }[]; current_user_id: string; split_version: number; members: Member[]; invitations: { id: string; email: string; role: string; version: number; expires_at: string }[]; rule_versions: { id: string; version_number: number; effective_on: string; mode: string; weights: { member_id: string; weight: number }[] }[]; settlement: { from: string; to: string; closed_through: string | null; checkpoint_id: string | null; cost_cents: number; contributions_cents: number; surplus_cents: number; members: Share[] }; transfers: Transfer[]; spaces: Space[] }
const panel = 'card p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';
const input = 'w-full min-w-0 field-input';
const button = 'btn-primary disabled:opacity-50';
const roles: Record<string,string> = { owner:'Proprietário',admin:'Administrador',member:'Membro',viewer:'Somente leitura' };
const centsText = (amount: number) => (amount/100).toFixed(2).replace('.',',');
function percentWeight(text: string): number {
  if (!/^\d{1,3}(?:[,.]\d{1,4})?$/.test(text.trim())) throw new Error('Informe percentuais com até quatro casas decimais.');
  const [integer,fraction = ''] = text.trim().split(/[,.]/);
  return Number(integer)*10000+Number(fraction.padEnd(4,'0'));
}
export default function LedgerSharing({ workspace,money,onChanged }: { workspace: LedgerWorkspace; money: (value: number) => string; onChanged: () => Promise<void> }) {
  const [summary,setSummary] = useState<Sharing | null>(null),[busy,setBusy] = useState(false),[error,setError] = useState(''),[notice,setNotice] = useState('');
  const [from,setFrom] = useState(workspace.space.today.slice(0,7)+'-01'),[to,setTo] = useState(workspace.space.today);
  const [token,setToken] = useState(() => window.location.hash.startsWith('#invite=') ? decodeURIComponent(window.location.hash.slice(8)) : '');
  const [inviteLink,setInviteLink] = useState(''),[action,setAction] = useState(window.location.hash.startsWith('#invite=') ? 'accept' : ''),[selectedMember,setSelectedMember] = useState<Member | null>(null),[selectedTransfer,setSelectedTransfer] = useState<Transfer | null>(null);
  const [origin,setOrigin] = useState(workspace.space.id),[destination,setDestination] = useState(''),[splitMode,setSplitMode] = useState('equal');
  const [destinationCategories,setDestinationCategories] = useState<{ id: string; name: string; kind: string; ledger_account_id: string | null }[]>([]);
  const requestId = useRef(crypto.randomUUID()),pending = useRef<{ action: string; name: string; args: Record<string,unknown> } | null>(null),saving = useRef(false);
  const canWrite = workspace.role !== 'viewer',canAdmin = ['owner','admin'].includes(workspace.role),canOwn = workspace.role === 'owner';
  async function load() { setSummary(await ledgerRpc<Sharing>('sharing_summary',{ p_space:workspace.space.id,p_from:from,p_to:to })); }
  useEffect(() => { setSummary(null); setAction(window.location.hash.startsWith('#invite=') ? 'accept' : ''); setOrigin(workspace.space.id); void load().catch(failure => setError(failure.message)); },[workspace.space.id]);
  useEffect(() => {
    setDestinationCategories([]);
    if (action === 'personal_expense' && destination) void ledgerRpc<{ categories: typeof destinationCategories }>('management_data',{ p_space:destination }).then(data => setDestinationCategories(data.categories)).catch(failure => setError(failure.message));
  },[destination,action]);
  function edited() { requestId.current = crypto.randomUUID(); pending.current = null; }
  function invitationEdited() { if(pending.current?.action==='invite')pending.current=null; }
  function open(nextAction: string,member: Member | null = null,transfer: Transfer | null = null) {
    setAction(nextAction); setSelectedMember(member); setSelectedTransfer(transfer); setError(''); setNotice(''); setOrigin(workspace.space.id); setDestination(summary?.spaces.find(space => space.id !== workspace.space.id && space.role !== 'viewer')?.id ?? ''); edited();
  }
  async function refreshPeriod(event: FormEvent) { event.preventDefault(); if(saving.current)return; saving.current=true; setBusy(true); setError(''); try { await load(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível consultar.'); } finally { saving.current=false; setBusy(false); } }
  async function submit(event: FormEvent<HTMLFormElement>,requestedAction=action) {
    event.preventDefault(); if (saving.current || !summary) return false;
    const action=requestedAction;
    const data = new FormData(event.currentTarget),text = (key: string) => String(data.get(key) ?? '').trim(),amount = (key = 'amount') => parseBrlCents(text(key));
    saving.current=true; setBusy(true); setError(''); setNotice('');
    try {
      let name: string,args: Record<string,unknown>;
      if (pending.current?.action===action) ({ name,args } = pending.current);
      else {
        if (action === 'invite') { name = 'invite_space_member'; args = { p_space:workspace.space.id,p_email:text('email'),p_role:text('role'),p_nickname:text('nickname') || null }; }
        else if (action === 'accept') { name = 'accept_space_invitation'; args = { p_token:token.includes('#invite=') ? token.split('#invite=')[1] : token }; }
        else if (action === 'revoke') { name = 'revoke_space_invitation'; args = { p_space:workspace.space.id,p_invitation:text('invitation'),p_version:Number(text('version')) }; }
        else if (['role','remove','leave','transfer_ownership'].includes(action)) {
          if (!selectedMember) throw new Error('Selecione um membro.');
          name = 'manage_space_member'; args = { p_space:workspace.space.id,p_member:selectedMember.id,p_version:selectedMember.version,p_action:action,p_role:action === 'role' ? text('role') : null };
        } else if (action === 'split') {
          const weights = splitMode === 'equal' ? null : summary.members.filter(member => member.status === 'active').map(member => ({ member_id:member.id,weight:percentWeight(text('weight-'+member.id)) }));
          name = 'configure_space_split'; args = { p_space:workspace.space.id,p_version:summary.split_version,p_effective_on:text('date'),p_mode:splitMode,p_weights:weights,p_client_uuid:requestId.current };
        } else if (action === 'settle') { name = 'record_member_settlement'; args = { p_space:workspace.space.id,p_from_member:text('fromMember'),p_to_member:text('toMember'),p_on:text('date'),p_amount_cents:amount(),p_client_uuid:requestId.current }; }
        else if (action === 'edit_transfer' || action === 'cancel_transfer') {
          if (!selectedTransfer) throw new Error('Selecione uma transferência.');
          name = action === 'edit_transfer' ? 'edit_space_transfer' : 'cancel_space_transfer'; args = { p_transfer:selectedTransfer.id,p_version:selectedTransfer.version,p_reason:text('reason'),...(action === 'edit_transfer' ? { p_on:text('date'),p_amount_cents:amount(),p_client_uuid:requestId.current } : {}) };
        } else if (action === 'personal_expense') {
          name = 'create_space_personal_expense'; args = { p_origin_space:workspace.space.id,p_destination_space:destination,p_category:text('category'),p_on:text('date'),p_amount_cents:amount(),p_description:text('description'),p_account:text('payment').startsWith('account:') ? text('payment').slice(8) : null,p_card:text('payment').startsWith('card:') ? text('payment').slice(5) : null,p_client_uuid:requestId.current };
        } else { name = 'create_space_transfer'; args = { p_origin_space:origin,p_destination_space:destination,p_origin_account:text('originAccount'),p_destination_account:text('destinationAccount'),p_on:text('date'),p_amount_cents:amount(),p_mode:text('mode'),p_client_uuid:requestId.current }; }
        pending.current = { action,name,args };
      }
      const result = await ledgerRpc<unknown>(name,args);
      if (action === 'invite') {
        const invitation = result as { token: string };
        setInviteLink(window.location.origin+window.location.pathname+'#invite='+encodeURIComponent(invitation.token));
      }
      if (action === 'accept') { await selectFinancialSpace(result as string); window.history.replaceState(null,'',window.location.pathname); await onChanged(); }
      else if (action === 'leave') { await onChanged(); }
      else { await load(); await onChanged(); }
      setAction(''); setSelectedMember(null); setSelectedTransfer(null); pending.current = null; requestId.current = crypto.randomUUID(); setNotice(action === 'invite' ? 'Convite criado. Copie o link e compartilhe com a pessoa.' : 'Alteração registrada.');
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível concluir.'); return false; }
    finally { saving.current=false; setBusy(false); }
  }
  const label = (text: string,id: string) => <label className="field-label" htmlFor={id}>{text}</label>;
  const activeMembers = summary?.members.filter(member => member.status === 'active') ?? [];
  const ownMember = activeMembers.find(member => member.user_id === summary?.current_user_id);
  const originSpace = summary?.spaces.find(space => space.id === origin),destinationSpace = summary?.spaces.find(space => space.id === destination);
  const latestRule = summary?.rule_versions.at(-1);
  const nestedAction=['role','transfer_ownership','remove','leave','edit_transfer','cancel_transfer'].includes(action);
  const actionTitle=({accept:'Aceitar convite',split:'Regra de divisão',settle:'Acerto externo entre membros',personal_expense:'Despesa paga com dinheiro pessoal',transfer:'Transferir entre espaços',edit_transfer:'Corrigir transferência pareada',cancel_transfer:'Cancelar transferência pareada',role:'Permissões do membro',transfer_ownership:'Transferir propriedade',remove:'Remover membro',leave:'Sair do espaço'} as Record<string,string>)[action]??'Compartilhamento';
  const actionForm=summary&&action?<form aria-label={actionTitle} onSubmit={submit} onChange={edited} key={action+(selectedMember?.id ?? '')+(selectedTransfer?.id ?? '')} className={`${nestedAction?'':panel} min-w-0 space-y-4`}><fieldset disabled={busy} className="min-w-0 space-y-4"><h2 className="font-semibold">{action === 'invite' ? 'Convidar membro' : action === 'accept' ? 'Aceitar convite' : action === 'split' ? 'Regra de divisão' : action === 'settle' ? 'Acerto externo entre membros' : action === 'personal_expense' ? 'Despesa paga com dinheiro pessoal' : action === 'transfer' ? 'Transferir entre espaços' : action === 'edit_transfer' ? 'Corrigir transferência pareada' : action === 'cancel_transfer' ? 'Cancelar transferência pareada' : action === 'role' ? `Permissões de ${selectedMember?.nickname}` : action === 'transfer_ownership' ? 'Transferir propriedade' : action === 'remove' ? 'Remover membro' : 'Sair do espaço'}</h2>
            {action === 'role' && <div className="grid max-w-xl gap-2">{label('Papel no espaço','share-role')}<select id="share-role" name="role" defaultValue={selectedMember?.role ?? 'member'} className={input}>{Object.entries(roles).filter(([role]) => canOwn || role !== 'owner').map(([role,title]) => <option key={role} value={role}>{title}</option>)}</select></div>}
      {action === 'accept' && <div className="grid gap-2">{label('Link ou token do convite','accept-token')}<input id="accept-token" required value={token} onChange={event => setToken(event.target.value.trim())} className={input}/><p className="text-sm text-slate-500">Entre com a conta do e-mail que recebeu o convite. Após aceitar, você será levado ao espaço.</p></div>}
      {['remove','leave'].includes(action) && <p className="text-sm text-slate-500">O acerto até hoje será convertido em dívida com a pessoa {selectedMember?.nickname || 'do membro'}. Os lançamentos e a autoria serão preservados. O acesso será revogado assim que confirmar. O último proprietário precisa transferir a propriedade antes de sair.</p>}
      {action === 'transfer_ownership' && <p className="text-sm text-slate-500">{selectedMember?.nickname} se tornará proprietário. Seu papel será alterado para administrador.</p>}
      {action === 'split' && <><div className="grid max-w-xl gap-2">{label('Como dividir','share-split-mode')}<select id="share-split-mode" value={splitMode} onChange={event => setSplitMode(event.target.value)} className={input}><option value="equal">Igualmente entre membros ativos</option><option value="percentage">Por percentuais</option></select></div>{splitMode === 'percentage' && <div className="grid gap-3 sm:grid-cols-2">{activeMembers.map(member => <div key={member.id} className="grid gap-2">{label(`Percentual de ${member.nickname || 'membro'} (%)`,'weight-'+member.id)}<input id={'weight-'+member.id} name={'weight-'+member.id} inputMode="decimal" defaultValue={latestRule?.mode === 'percentage' ? String((latestRule.weights.find(weight => weight.member_id === member.id)?.weight ?? 0)/10000).replace('.',',') : ''} required className={input}/></div>)}</div>}<p className="text-sm text-slate-500">A soma deve ser 100%. A regra só calcula o acerto e mantém o histórico dos lançamentos.</p></>}
      {action === 'settle' && <div className="grid gap-3 sm:grid-cols-2">{[['fromMember','Quem pagou o Pix fora do app'],['toMember','Quem recebeu o Pix fora do app']].map(([key,title]) => <div key={key} className="grid gap-2">{label(title,'settlement-'+key)}<select id={'settlement-'+key} name={key} required className={input}><option value="">Selecione</option>{activeMembers.map(member => <option key={member.id} value={member.id}>{member.nickname || 'Membro'}</option>)}</select></div>)}</div>}
      {['transfer','personal_expense'].includes(action) && <><div className="grid gap-3 sm:grid-cols-2">{action === 'transfer' && <div className="grid gap-2">{label('Espaço pessoal / origem do aporte','transfer-origin')}<select id="transfer-origin" value={origin} onChange={event => setOrigin(event.target.value)} className={input}>{summary.spaces.filter(space => space.role !== 'viewer').map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></div>}<div className="grid gap-2">{label('Espaço de destino / compartilhado','transfer-destination')}<select id="transfer-destination" value={destination} required onChange={event => setDestination(event.target.value)} className={input}><option value="">Selecione</option>{summary.spaces.filter(space => space.id !== origin && space.role !== 'viewer').map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></div></div>{action === 'transfer' ? <><div className="grid max-w-xl gap-2">{label('Finalidade','transfer-mode')}<select id="transfer-mode" name="mode" className={input}><option value="contribution">Aporte: origem → destino</option><option value="withdrawal">Retirada: destino → origem</option><option value="debt_settlement">Reembolso: quitar os saldos pessoais entre os espaços</option></select></div><div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2">{label('Conta da origem / pessoal','transfer-origin-account')}<select id="transfer-origin-account" name="originAccount" required className={input}><option value="">Selecione</option>{originSpace?.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div><div className="grid gap-2">{label('Conta do destino / compartilhado','transfer-destination-account')}<select id="transfer-destination-account" name="destinationAccount" required className={input}><option value="">Selecione</option>{destinationSpace?.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div></div></> : <><p className="text-sm text-slate-500">O pagamento sai de {workspace.space.name}. A despesa e a dívida com você serão registradas no destino; no seu espaço, o valor fica a receber.</p><div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2">{label('Pagamento pessoal','personal-expense-payment')}<select id="personal-expense-payment" name="payment" required className={input}><option value="">Selecione</option>{workspace.accounts.filter(account => account.liquidity === 'cash').map(account => <option key={account.id} value={'account:'+account.id}>{account.name}</option>)}{workspace.cards.map(card => <option key={card.id} value={'card:'+card.id}>Cartão {card.name}</option>)}</select></div><div className="grid gap-2">{label('Categoria da despesa no destino','personal-expense-category')}<select id="personal-expense-category" name="category" required className={input}><option value="">Selecione</option>{destinationCategories.filter(category => category.kind === 'expense' && category.ledger_account_id).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div><div className="grid gap-2 sm:col-span-2">{label('Descrição da despesa','personal-expense-description')}<input id="personal-expense-description" name="description" required maxLength={200} className={input}/></div></div></>}</>}
      {['split','settle','transfer','personal_expense','edit_transfer'].includes(action) && <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2">{label(action === 'split' ? 'Válida a partir de' : 'Data','share-action-date')}<input id="share-action-date" name="date" type="date" required defaultValue={selectedTransfer?.occurred_on ?? workspace.space.today} className={input}/></div>{action !== 'split' && <div className="grid gap-2">{label('Valor','share-action-amount')}<CurrencyInput id="share-action-amount" name="amount" required defaultValue={selectedTransfer ? centsText(selectedTransfer.amount_cents) : ''} className={input}/></div>}</div>}
      {['edit_transfer','cancel_transfer'].includes(action) && <><p className="text-sm text-slate-500">A operação altera as duas pontas juntas e exige acesso de escrita nos dois espaços. Meses fechados precisam ser reabertos.</p><div className="grid gap-2">{label('Motivo da correção / cancelamento','share-reason')}<textarea id="share-reason" name="reason" required maxLength={1000} className={input}/></div></>}
      <div className="flex gap-4"><button disabled={busy} className={button}>{busy ? 'Registrando…' : 'Confirmar'}</button><button type="button" disabled={busy} onClick={() => { setAction(''); edited(); }} className="text-sm">Voltar</button></div>
    </fieldset></form>:null;
  function toggleMember(member:Member) {
    if(busy)return;
    setSelectedMember(selectedMember?.id===member.id?null:member);
    setSelectedTransfer(null); setAction(''); setError(''); edited();
  }
  function toggleTransfer(transfer:Transfer) {
    if(busy)return;
    setSelectedTransfer(selectedTransfer?.id===transfer.id?null:transfer);
    setSelectedMember(null); setAction(''); setError(''); edited();
  }
  const memberAction=['role','transfer_ownership','remove','leave'].includes(action);
  const transferAction=['edit_transfer','cancel_transfer'].includes(action);
  const debtBalances=summary?.person_balances.filter(person=>person.balance_cents!==0)??[];
  return <div className="space-y-6">
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice&&<p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    {!summary&&!error&&<p role="status" className="text-sm text-slate-500 dark:text-slate-400">Carregando compartilhamento…</p>}
    {canAdmin&&summary?.space_kind==='shared'&&<form aria-label="Convidar membro" onChange={invitationEdited} onSubmit={async event=>{const form=event.currentTarget;if(await submit(event,'invite'))form.reset();}} className="card flex flex-wrap items-end gap-3 p-4">
      <fieldset disabled={busy} className="contents">
        <div className="flex w-full flex-col gap-1 sm:w-auto">{label('E-mail convidado','invite-email')}<input id="invite-email" name="email" type="email" required placeholder="pessoa@email.com" className="field-input w-full sm:w-64"/></div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">{label('Apelido (opcional)','invite-nickname')}<input id="invite-nickname" name="nickname" maxLength={100} placeholder="Ex: Ana" className="field-input"/></div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">{label('Papel no espaço','invite-role')}<select id="invite-role" name="role" defaultValue="member" className="field-input">{Object.entries(roles).filter(([role])=>canOwn||role!=='owner').map(([role,title])=><option key={role} value={role}>{title}</option>)}</select></div>
        <button disabled={busy} className={button}>Gerar convite</button>
      </fieldset>
    </form>}
    <div className="space-y-3">
      <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">Os participantes veem as contas, os lançamentos e o histórico deste espaço. Use seu espaço pessoal para informações privadas.</p>
      {summary?.space_kind==='personal'&&<p className="text-sm text-slate-500 dark:text-slate-400">Os convites ficam disponíveis nos espaços compartilhados.</p>}
      <button type="button" disabled={busy||!summary} onClick={()=>open('accept')} aria-expanded={action==='accept'} className="text-sm font-semibold text-brand-700 dark:text-brand-400">Aceitar convite</button>
      {action==='accept'&&actionForm}
    </div>
    {inviteLink&&<section aria-label="Link do convite" className={panel+' space-y-3'}>
      <h2 className="text-sm font-semibold">Link do convite · válido por 7 dias</h2>
      <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">Copie e envie à pessoa. O aceite exige login com o e-mail convidado e pode ser feito uma vez.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1">{label('Link para aceitar o convite','share-invite-link')}<input id="share-invite-link" value={inviteLink} readOnly className={input}/></div>
        <button type="button" onClick={()=>void navigator.clipboard.writeText(inviteLink).then(()=>setNotice('Link copiado.')).catch(()=>setError('Selecione e copie o link acima.'))} className={button}>Copiar link</button>
      </div>
    </section>}
    {summary&&<>
      <section aria-label="Participantes do espaço" className="space-y-3">
        <h2 className="text-sm font-semibold">Membros e permissões</h2>
        <SharingMemberTable members={summary.members}
          renderActions={member=><button type="button" disabled={busy} onClick={()=>toggleMember(member)} aria-label={'Ver detalhes de '+(member.nickname||'Membro')} aria-expanded={selectedMember?.id===member.id} className="text-xs font-semibold text-brand-700 dark:text-brand-400">Detalhes</button>}
          renderEditor={member=>selectedMember?.id===member.id?<section aria-label={'Detalhes do membro '+(member.nickname||'Membro')} className={panel+' min-w-0 space-y-4'}>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0 [overflow-wrap:anywhere]"><h3 className="font-semibold">{member.nickname||'Membro'}</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{roles[member.role]} · {member.status==='active'?'Ativo':'Saiu do espaço'}</p></div><button type="button" disabled={busy} onClick={()=>{setSelectedMember(null);setAction('');edited();}} className="text-sm text-slate-500 dark:text-slate-400">Fechar</button></div>
            {member.status==='active'?<div className="flex flex-wrap gap-x-4 gap-y-3 text-sm font-semibold text-brand-700 dark:text-brand-400">
              {canOwn&&<button type="button" disabled={busy} onClick={()=>open('role',member)}>Alterar papel</button>}
              {canOwn&&member.user_id!==summary.current_user_id&&<button type="button" disabled={busy} onClick={()=>open('transfer_ownership',member)}>Transferir propriedade</button>}
              {canAdmin&&member.user_id!==summary.current_user_id&&(canOwn||['member','viewer'].includes(member.role))&&<button type="button" disabled={busy} onClick={()=>open('remove',member)} className="text-red-700 dark:text-red-300">Remover</button>}
              {ownMember?.id===member.id&&<button type="button" disabled={busy} onClick={()=>open('leave',member)}>Sair deste espaço</button>}
            </div>:<p className="text-sm text-slate-500 dark:text-slate-400">O histórico e a autoria dos lançamentos foram preservados.</p>}
            {memberAction&&actionForm}
          </section>:null}/>
      </section>
      {summary.invitations.length>0&&<section className="space-y-3">
        <h2 className="text-sm font-semibold">Convites pendentes</h2>
        <SharingInvitationTable invitations={summary.invitations} renderActions={invitation=>canAdmin?<button type="button" disabled={busy} onClick={()=>void submitRevoke(invitation)} aria-label={'Revogar convite de '+invitation.email} className="text-xs font-semibold text-red-700 dark:text-red-300">Revogar</button>:null}/>
      </section>}
      <section aria-label="Divisão e acerto entre membros" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Divisão e acerto entre membros</h2><div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-brand-700 dark:text-brand-400">
          {canAdmin&&summary.space_kind==='shared'&&<button type="button" disabled={busy} onClick={()=>open('split')} aria-expanded={action==='split'}>Configurar divisão</button>}
          {canWrite&&activeMembers.length>1&&<button type="button" disabled={busy} onClick={()=>open('settle')} aria-expanded={action==='settle'}>Registrar acerto feito fora do app</button>}
        </div></div>
        <form aria-label="Consultar acerto" onSubmit={refreshPeriod} className="card flex flex-wrap items-end gap-3 p-4">
          <div className="flex w-full flex-col gap-1 sm:w-auto">{label('Início do período','share-from')}<input id="share-from" type="date" required disabled={busy} value={from} onChange={event=>setFrom(event.target.value)} className="field-input"/></div>
          <div className="flex w-full flex-col gap-1 sm:w-auto">{label('Fim do período','share-to')}<input id="share-to" type="date" required disabled={busy} value={to} onChange={event=>setTo(event.target.value)} className="field-input"/></div>
          <button disabled={busy} className={button}>Consultar acerto</button>
        </form>
        {['split','settle'].includes(action)&&actionForm}
        <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div><dt className="text-xs text-slate-500 dark:text-slate-400">Despesas líquidas</dt><dd className="mt-1 font-medium">{money(summary.settlement.cost_cents)}</dd></div>
          <div><dt className="text-xs text-slate-500 dark:text-slate-400">Aportes líquidos</dt><dd className="mt-1 font-medium">{money(summary.settlement.contributions_cents)}</dd></div>
          <div><dt className="text-xs text-slate-500 dark:text-slate-400">Sobra</dt><dd className="mt-1 font-medium">{money(summary.settlement.surplus_cents)}</dd></div>
        </dl>
        {summary.settlement.checkpoint_id&&<p className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">Divisão anterior encerrada até {summary.settlement.closed_through}. Este segmento começa em {summary.settlement.from}; os saldos pendentes dos membros restantes foram trazidos e aparecem abaixo.</p>}
        <SharingSettlementTable members={summary.settlement.members} money={money}/>
        <p className="max-w-2xl text-xs text-slate-500 dark:text-slate-400">O acerto considera as regras vigentes em cada lançamento e divide a sobra pela regra no fim do período. Dívidas do espaço com pessoas ficam separadas.</p>
        <details className="text-sm text-slate-500 dark:text-slate-400"><summary className="cursor-pointer">Histórico de regras ({summary.rule_versions.length})</summary><ul className="mt-3 space-y-2">{summary.rule_versions.map(rule=><li key={rule.id}>Versão {rule.version_number} · desde {rule.effective_on} · {rule.mode==='equal'?'Igual':'Percentuais'}</li>)}</ul></details>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Valores pagos pessoalmente / dívida com o espaço</h2>
        <div className="table-shell">
          <table aria-label="Dívidas pessoais com o espaço" className="w-full table-fixed text-sm text-slate-900 dark:text-slate-100">
            <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50"><tr><th scope="col" className="w-[65%] px-3 py-2.5 sm:px-4">Pessoa e situação</th><th scope="col" className="px-3 py-2.5 text-right sm:px-4">Saldo</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {debtBalances.map(person=><tr key={person.person_id} className="table-row-hover transition-[background-color]"><td className="px-3 py-2.5 [overflow-wrap:anywhere] sm:px-4"><p>{person.nickname}</p><p className={'mt-1 text-xs '+(person.balance_cents<0?'text-rose-600 dark:text-rose-400':'text-brand-600 dark:text-brand-400')}>{person.balance_cents<0?'O espaço deve à pessoa':'A pessoa deve ao espaço'}</p></td><td className="px-3 py-2.5 text-right font-medium [overflow-wrap:anywhere] sm:px-4">{money(Math.abs(person.balance_cents))}</td></tr>)}
              {debtBalances.length===0&&<tr><td colSpan={2} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">Nenhuma dívida pessoal em aberto.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-label="Transferências e despesas entre espaços" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Transferências e despesas entre espaços</h2>
          {canWrite&&summary.spaces.filter(space=>space.role!=='viewer').length>1&&<div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-brand-700 dark:text-brand-400"><button type="button" disabled={busy} onClick={()=>open('transfer')} aria-expanded={action==='transfer'}>Transferir entre espaços</button><button type="button" disabled={busy} onClick={()=>open('personal_expense')} aria-expanded={action==='personal_expense'}>Paguei uma despesa de outro espaço</button></div>}
        </div>
        {['transfer','personal_expense'].includes(action)&&actionForm}
        <SharingTransferTable transfers={summary.transfers} money={money}
          renderRoute={transfer=><>{summary.spaces.find(space=>space.id===transfer.origin_space_id)?.name} ↔ {summary.spaces.find(space=>space.id===transfer.destination_space_id)?.name}</>}
          renderActions={transfer=><button type="button" disabled={busy} onClick={()=>toggleTransfer(transfer)} aria-label={'Ver detalhes da transferência '+transfer.id} aria-expanded={selectedTransfer?.id===transfer.id} className="text-xs font-semibold text-brand-700 dark:text-brand-400">Detalhes</button>}
          renderEditor={transfer=>selectedTransfer?.id===transfer.id?<section aria-label="Detalhes da transferência" className={panel+' min-w-0 space-y-4'}>
            <div className="flex items-start justify-between gap-3"><h3 className="font-semibold">Transferência entre espaços</h3><button type="button" disabled={busy} onClick={()=>{setSelectedTransfer(null);setAction('');edited();}} className="text-sm text-slate-500 dark:text-slate-400">Fechar</button></div>
            <p className="text-sm [overflow-wrap:anywhere]">{summary.spaces.find(space=>space.id===transfer.origin_space_id)?.name} ↔ {summary.spaces.find(space=>space.id===transfer.destination_space_id)?.name}: {money(transfer.amount_cents)}</p>
            {canWrite&&!transfer.cancelled_at&&summary.spaces.filter(space=>[transfer.origin_space_id,transfer.destination_space_id].includes(space.id)).every(space=>space.role!=='viewer')&&<div className="flex flex-wrap gap-4 text-sm font-semibold text-brand-700 dark:text-brand-400">
              {transfer.kind!=='personal_expense'&&<button type="button" disabled={busy} onClick={()=>open('edit_transfer',null,transfer)}>Corrigir valor / data</button>}
              <button type="button" disabled={busy} onClick={()=>open('cancel_transfer',null,transfer)} className="text-red-700 dark:text-red-300">Cancelar as duas pontas</button>
            </div>}
            {transferAction&&actionForm}
          </section>:null}/>
      </section>
    </>}
  </div>;
  async function submitRevoke(invitation: Sharing['invitations'][number]) {
    if(saving.current)return; saving.current=true; setBusy(true); setError('');
    try { await ledgerRpc('revoke_space_invitation',{ p_space:workspace.space.id,p_invitation:invitation.id,p_version:invitation.version }); await load(); setNotice('Convite revogado.'); setAction(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível revogar.'); }
    finally { saving.current=false; setBusy(false); }
  }
}
