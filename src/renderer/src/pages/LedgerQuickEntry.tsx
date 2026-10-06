import { useEffect,useRef,useState,type FormEvent } from 'react';
import { todayInSpace } from '../../../shared/finance/calendar';
import { parseBrlCents,sumCents } from '../../../shared/finance/money';
import { validateQuickEntry,type QueueItem } from '../../../shared/finance/offlineQueue';
import { activeUserId,offlineQueue,queueChanged,sendLocalQueue } from '../lib/offlineStorage';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { loadEntryPreferences, type EntryPreferences, type EntryPreset } from '../lib/entryPreferences';
import LedgerQueueConflict from './LedgerQueueConflict';
import LedgerModelManagement from './LedgerModelManagement';

const input='w-full field-input px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800';
export default function LedgerQuickEntry({ workspace,money,onChanged }: { workspace: LedgerWorkspace; money: (value: number) => string; onChanged: () => Promise<void> }) {
  const [rows,setRows]=useState<QueueItem[]>([]),[open,setOpen]=useState(() => new URLSearchParams(location.search).get('quick')==='expense'),[kind,setKind]=useState<'expense'|'income'|'card_purchase'>('expense');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[clientUuid,setClientUuid]=useState(() => crypto.randomUUID());
  const [editing,setEditing]=useState<QueueItem | null>(null),[deleteItem,setDeleteItem]=useState<QueueItem | null>(null);
  const [preferences,setPreferences]=useState<EntryPreferences>({models:[],drafts:[]}),[preset,setPreset]=useState<EntryPreset | null>(null),[sourceDraft,setSourceDraft]=useState<{id:string;version:number} | null>(null),[suggestions,setSuggestions]=useState<{categoryId:string;name:string}[]>([]);
  const formRef=useRef<HTMLFormElement>(null);
  const canWrite=workspace.role!=='viewer';
  async function load() { setRows(await offlineQueue.list(await activeUserId())); }
  async function loadPreferences() { setPreferences(await loadEntryPreferences(workspace.space.id)); }
  useEffect(() => { void loadPreferences().catch(() => undefined); },[workspace.space.id]);
  async function sync(force=false) {
    if (!navigator.onLine) return;
    try {
      const userId=await activeUserId(),before=await offlineQueue.list(userId);
      if (force) for (const row of before) if (row.state==='pending') await offlineQueue.put({ ...row,nextAttemptAt:null });
      await sendLocalQueue(); const after=await offlineQueue.list(userId); setRows(after);
      if(before.some(row => !after.some(next => next.spaceId===row.spaceId && next.clientUuid===row.clientUuid))) {
        setNotice('Envio confirmado. Os dados foram atualizados.');
        await onChanged();
      }
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível enviar.'); }
  }
  useEffect(() => {
    const update=() => { void load().catch(failure => setError(failure.message)); };
    const reconnect=() => { void sync(); };
    const visible=() => { if (document.visibilityState==='visible') reconnect(); };
    update(); reconnect();
    window.addEventListener('financias-queue-changed',update); window.addEventListener('online',reconnect); document.addEventListener('visibilitychange',visible);
    const timer=window.setInterval(reconnect,30_000);
    return () => { window.removeEventListener('financias-queue-changed',update); window.removeEventListener('online',reconnect); document.removeEventListener('visibilitychange',visible); window.clearInterval(timer); };
  },[workspace.space.id]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      const values=new FormData(event.currentTarget),get=(key: string) => String(values.get(key) ?? '').trim();
      const category=workspace.categories.find(row => row.id===get('category') && row.ledger_account_id && row.kind===(kind==='income' ? 'income' : 'expense'));
      const account=workspace.accounts.find(row => row.id===get('account') && ['cash','benefit'].includes(row.liquidity));
      const card=workspace.cards.find(row => row.id===get('account'));
      if (!category?.ledger_account_id || (kind==='card_purchase' ? !card : !account)) throw new Error('Escolha uma categoria e uma conta ou cartão ativos.');
      const content={ kind,amountCents:parseBrlCents(get('amount')),description:get('description'),occurredOn:get('date'),categoryId:category.id,categoryLedgerId:category.ledger_account_id,accountId:account?.id,accountLedgerId:account?.ledger_account_id,cardId:card?.id };
      validateQuickEntry(content);
      const item: QueueItem={ clientUuid:editing?.clientUuid ?? clientUuid,userId:await activeUserId(),spaceId:workspace.space.id,createdAt:editing?.createdAt ?? new Date().toISOString(),state:'pending',attempts:0,nextAttemptAt:null,lastReason:null,content };
      await offlineQueue.put(item); queueChanged(); await load(); setOpen(false); setEditing(null); setClientUuid(crypto.randomUUID());
      if (values.get('save_model')==='on' && navigator.onLine) {
        await ledgerRpc('save_entry_model',{p_space:workspace.space.id,p_name:get('model_name') || get('description') || 'Meu lançamento',p_payload:{kind,amountCents:content.amountCents,description:content.description,categoryId:content.categoryId,...(kind==='card_purchase' ? {cardId:content.cardId} : {accountId:content.accountId})},p_client_uuid:crypto.randomUUID()}).then(loadPreferences).catch(() => setError('O lançamento ficou salvo na fila, mas o modelo não foi salvo.'));
      }
      if (sourceDraft && navigator.onLine) await ledgerRpc('delete_entry_preference',{p_space:workspace.space.id,p_id:sourceDraft.id,p_version:sourceDraft.version,p_kind:'draft'}).then(loadPreferences).catch(() => undefined);
      setPreset(null); setSourceDraft(null);
      setNotice('Lançamento salvo no aparelho. Será enviado com o mesmo identificador quando houver conexão.');
      if (navigator.onLine) await sync();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar no aparelho.'); }
    finally { setBusy(false); }
  }
  async function retry(item: QueueItem) {
    setError('');
    try {
      await offlineQueue.put({ ...item,state:'pending',nextAttemptAt:null });
      queueChanged(); await load(); await sync();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível reenviar.'); }
  }
  const pending=rows.filter(row => row.state!=='rejected'),rejected=rows.filter(row => row.state==='rejected');
  const total=sumCents(pending.map(row => row.content.amountCents));
  function usePreset(value: EntryPreset,draft?: {id:string;version:number}) { setPreset(value); setSourceDraft(draft ?? null); setEditing(null); setKind(value.kind ?? 'expense'); setClientUuid(crypto.randomUUID()); setSuggestions([]); setOpen(true); setError(''); }
  async function saveDraft() {
    if (!formRef.current || !navigator.onLine || busy) return; setBusy(true); setError('');
    try { const values=new FormData(formRef.current),get=(key:string) => String(values.get(key) ?? '').trim(); const payload={kind,description:get('description'),occurredOn:get('date'),categoryId:get('category') || undefined,...(kind==='card_purchase' ? {cardId:get('account') || undefined} : {accountId:get('account') || undefined}),...(get('amount') ? {amountCents:parseBrlCents(get('amount'))} : {})}; await ledgerRpc('save_transaction_draft',{p_space:workspace.space.id,p_title:get('description') || 'Lançamento por completar',p_payload:payload,p_draft:sourceDraft?.id ?? null,p_version:sourceDraft?.version ?? null,p_client_uuid:sourceDraft ? null : clientUuid}); await loadPreferences(); setOpen(false); setPreset(null); setSourceDraft(null); setNotice('Rascunho salvo. Ele não altera saldos.'); }
    catch(failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar o rascunho.'); } finally {setBusy(false);}
  }
  async function suggest(description:string) {
    if(!navigator.onLine || description.trim().length<3) {setSuggestions([]);return;}
    try {setSuggestions(await ledgerRpc('suggest_entry_category',{p_space:workspace.space.id,p_description:description,p_kind:kind}));} catch {setSuggestions([]);}
  }
  function chooseSuggestion(id:string) { const target=formRef.current?.elements.namedItem('category'); if(target instanceof HTMLSelectElement) {target.value=id; setSuggestions([]);} }
  return <section className="space-y-4 card p-5 dark:border-slate-800 dark:bg-slate-900" aria-label="Lançamento rápido e fila de envio">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Lançamento rápido</h2><p className="mt-1 text-xs text-slate-500">Despesa ou receita à vista; compra no cartão em uma vez.</p></div>{canWrite && <button onClick={() => { setEditing(null); setPreset(null); setSourceDraft(null); setSuggestions([]); setKind('expense'); setClientUuid(crypto.randomUUID()); setOpen(true); setError(''); }} className="btn-primary px-4 py-2 text-sm font-semibold text-white">Novo gasto rápido</button>}</div>
    {canWrite && preferences.models.length>0 && <div className="flex flex-wrap gap-2" aria-label="Meus modelos de lançamento">{preferences.models.map(model => <button key={model.id} onClick={() => usePreset(model.payload)} className="rounded-full border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:border-brand-800 dark:text-brand-300">{model.name}</button>)}</div>}
    {canWrite && preferences.drafts.length>0 && <details><summary className="cursor-pointer text-sm font-medium">Meus rascunhos ({preferences.drafts.length})</summary><div className="mt-3 space-y-3">{preferences.drafts.map(draft => <div key={draft.id} className="flex flex-wrap justify-between gap-3 text-sm"><span>{draft.title}</span><div className="flex gap-3"><button onClick={() => usePreset(draft.payload,draft)} className="font-semibold text-brand-700 dark:text-brand-300">Completar rascunho</button><button disabled={!navigator.onLine} onClick={() => {void ledgerRpc('delete_entry_preference',{p_space:workspace.space.id,p_id:draft.id,p_version:draft.version,p_kind:'draft'}).then(loadPreferences).catch(failure=>setError(failure.message));}} className="text-red-600">Excluir rascunho</button></div></div>)}</div></details>}
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}{notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    {rows.length>0 && <div aria-live="polite" className="space-y-2 text-sm"><p>{pending.length} lançamentos pendentes de envio · {money(total)}{rejected.length>0 ? ` · ${rejected.length} não enviados` : ''}</p><p className="text-xs text-slate-500">Os números do painel são os últimos recebidos do servidor. Os pendentes entram quando forem enviados.</p><button disabled={busy || !navigator.onLine} onClick={() => void sync(true)} className="font-semibold text-brand-700 disabled:opacity-50 dark:text-brand-300">Enviar agora</button></div>}
    {rows.map(item => <article key={`${item.spaceId}:${item.clientUuid}`} className="space-y-2 border-t border-slate-200 pt-3 text-sm dark:border-slate-800"><div className="flex justify-between gap-3"><div><p>{item.content.description || 'Lançamento rápido'}</p><p className="text-xs text-slate-500">{item.state==='rejected' ? 'Não enviado' : item.state==='sending' ? 'Enviando…' : 'Pendente de envio'}{item.spaceId!==workspace.space.id ? ' · outro espaço' : ''} · {item.content.occurredOn}</p></div><strong>{money(item.content.amountCents)}</strong></div>{item.lastReason && <p className="text-xs text-amber-800 dark:text-amber-300">{item.lastReason}</p>}<div className="flex flex-wrap gap-3 text-xs font-semibold">{item.state==='rejected' && <><button onClick={() => void retry(item)}>Reenviar</button>{item.spaceId===workspace.space.id && <button onClick={() => { setEditing(item); setPreset(null); setSourceDraft(null); setSuggestions([]); setKind(item.content.kind); setOpen(true); }}>Editar e reenviar</button>}<LedgerQueueConflict item={item} money={money} onResolved={async () => {await load(); await onChanged();}}/></>}<button disabled={item.state==='sending'} onClick={() => setDeleteItem(item)}>{item.state==='rejected' ? 'Excluir do aparelho / manter servidor' : 'Desfazer pendente'}</button></div></article>)}
    {deleteItem && <div role="dialog" aria-label="Excluir lançamento do aparelho" className="space-y-3 rounded-xl border border-amber-300 p-4 text-sm"><p>Excluir este lançamento da fila deste aparelho? Se o servidor já o recebeu, o registro no servidor será preservado.</p><div className="flex gap-4"><button onClick={() => { void offlineQueue.remove(deleteItem).then(() => { setDeleteItem(null); queueChanged(); void load(); }).catch(failure => setError(failure.message)); }}>Confirmar exclusão do aparelho</button><button onClick={() => setDeleteItem(null)}>Cancelar</button></div></div>}
    {canWrite && open && <form ref={formRef} onSubmit={save} key={editing?.clientUuid ?? clientUuid} className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1"><label htmlFor="quick-kind" className="text-sm">Tipo de lançamento rápido</label><select id="quick-kind" value={kind} onChange={event => setKind(event.target.value as typeof kind)} className={input}><option value="expense">Despesa</option><option value="income">Receita</option><option value="card_purchase">Compra no cartão em 1x</option></select></div><div className="grid gap-1"><label htmlFor="quick-amount" className="text-sm">Valor rápido (R$)</label><input id="quick-amount" name="amount" inputMode="decimal" required defaultValue={editing || preset?.amountCents ? `${Math.floor((editing?.content.amountCents ?? preset?.amountCents ?? 0)/100)},${String((editing?.content.amountCents ?? preset?.amountCents ?? 0)%100).padStart(2,'0')}` : ''} className={input}/></div><div className="grid gap-1"><label htmlFor="quick-description" className="text-sm">Descrição rápida (opcional)</label><input id="quick-description" name="description" maxLength={100} defaultValue={editing?.content.description ?? preset?.description} onBlur={event => void suggest(event.target.value)} className={input}/></div><div className="grid gap-1"><label htmlFor="quick-category" className="text-sm">Categoria do lançamento rápido</label><select id="quick-category" name="category" required defaultValue={editing?.content.categoryId ?? preset?.categoryId ?? ''} className={input}><option value="">Selecione</option>{workspace.categories.filter(row => row.ledger_account_id && row.kind===(kind==='income' ? 'income' : 'expense')).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div><div className="grid gap-1"><label htmlFor="quick-account" className="text-sm">Conta ou cartão do lançamento rápido</label><select id="quick-account" name="account" required defaultValue={editing?.content.cardId ?? editing?.content.accountId ?? preset?.cardId ?? preset?.accountId ?? ''} className={input}><option value="">Selecione</option>{kind==='card_purchase' ? workspace.cards.map(row => <option key={row.id} value={row.id}>{row.name}</option>) : workspace.accounts.filter(row => ['cash','benefit'].includes(row.liquidity)).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div><div className="grid gap-1"><label htmlFor="quick-date" className="text-sm">Data do lançamento rápido</label><input id="quick-date" name="date" type="date" required defaultValue={editing?.content.occurredOn ?? preset?.occurredOn ?? todayInSpace(workspace.space.timezone)} className={input}/></div>{suggestions.length>0 && <div className="flex flex-wrap items-center gap-2 text-xs sm:col-span-2"><span className="text-slate-500">Categorias sugeridas pelo histórico:</span>{suggestions.map(category => <button type="button" key={category.categoryId} onClick={() => chooseSuggestion(category.categoryId)} className="rounded-full border border-brand-300 px-3 py-1 font-semibold text-brand-700 dark:text-brand-300">{category.name}</button>)}</div>}<label className="flex gap-2 text-sm"><input name="save_model" type="checkbox" disabled={!navigator.onLine}/>Salvar também como meu modelo</label><div className="grid gap-1"><label htmlFor="quick-model-name" className="text-sm">Nome do modelo (opcional)</label><input id="quick-model-name" name="model_name" maxLength={100} disabled={!navigator.onLine} className={input}/></div><div className="flex flex-wrap gap-4 sm:col-span-2"><button type="button" disabled={busy || !navigator.onLine} onClick={() => void saveDraft()} className="text-sm font-semibold text-brand-700 dark:text-brand-300">Salvar como rascunho</button></div><div className="flex gap-4 sm:col-span-2"><button disabled={busy} className="btn-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Salvar lançamento rápido</button><button type="button" onClick={() => { setOpen(false); setEditing(null); }} className="text-sm">Cancelar cadastro rápido</button></div></form>}
    {canWrite && <LedgerModelManagement workspace={workspace} money={money} onChanged={loadPreferences}/>}
  </section>;
}
