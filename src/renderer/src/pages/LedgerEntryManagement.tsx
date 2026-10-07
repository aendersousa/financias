import { useEffect, useState } from 'react'
import { sumCents } from '../../../shared/finance/money'
import type { QueueItem } from '../../../shared/finance/offlineQueue'
import { activeUserId, offlineQueue, queueChanged, sendLocalQueue } from '../lib/offlineStorage'
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository'
import { loadEntryPreferences, type EntryPreferences, type EntryPreset } from '../lib/entryPreferences'
import LedgerQueueConflict from './LedgerQueueConflict'
import LedgerModelManagement from './LedgerModelManagement'

export interface EntrySelection { preset: EntryPreset; draft?: { id: string; version: number }; item?: QueueItem }

export default function LedgerEntryManagement({ workspace, money, onChanged, onUse, refreshKey=0, disabled=false }: {
  workspace: LedgerWorkspace; money: (cents:number)=>string; onChanged:()=>Promise<void>
  onUse?:(selection:EntrySelection)=>void; refreshKey?:number; disabled?:boolean
}) {
  const [rows,setRows]=useState<QueueItem[]>([])
  const [preferences,setPreferences]=useState<EntryPreferences>({models:[],drafts:[]})
  const [connected,setConnected]=useState(navigator.onLine),[expanded,setExpanded]=useState(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [deleteItem,setDeleteItem]=useState<QueueItem|null>(null)
  const canWrite=workspace.role!=='viewer',blocked=busy||disabled
  async function load() { setRows(await offlineQueue.list(await activeUserId())) }
  async function loadPreferences() { setPreferences(await loadEntryPreferences(workspace.space.id)) }
  useEffect(()=>{let live=true; void loadEntryPreferences(workspace.space.id).then(value=>{if(live)setPreferences(value)}).catch(()=>undefined); return()=>{live=false}},[workspace.space.id,refreshKey])
  async function sync(force=false) {
    if(!navigator.onLine)return
    try {
      const user=await activeUserId(),before=await offlineQueue.list(user)
      if(force)for(const row of before)if(row.state==='pending')await offlineQueue.put({...row,nextAttemptAt:null})
      await sendLocalQueue(); const after=await offlineQueue.list(user);setRows(after)
      if(before.some(row=>!after.some(next=>next.spaceId===row.spaceId&&next.clientUuid===row.clientUuid))) {
        await onChanged();setNotice('Envio confirmado. Os dados foram atualizados.')
      }
    }catch(failure){setError(failure instanceof Error?failure.message:'Não foi possível enviar.')}
  }
  useEffect(()=>{
    const update=()=>{void load().catch(failure=>setError(failure.message))}
    const reconnect=()=>{setConnected(navigator.onLine);void sync()}
    const visible=()=>{if(document.visibilityState==='visible')reconnect()}
    update();reconnect()
    window.addEventListener('financias-queue-changed',update);window.addEventListener('online',reconnect);window.addEventListener('offline',reconnect);document.addEventListener('visibilitychange',visible)
    const timer=window.setInterval(reconnect,30_000)
    return()=>{window.removeEventListener('financias-queue-changed',update);window.removeEventListener('online',reconnect);window.removeEventListener('offline',reconnect);document.removeEventListener('visibilitychange',visible);window.clearInterval(timer)}
  },[workspace.space.id])
  useEffect(()=>{if(rows.length||error||notice)setExpanded(true)},[rows.length,error,notice])
  async function retry(item:QueueItem) {
    if(blocked)return;setBusy(true);setError('')
    try {await offlineQueue.put({...item,state:'pending',nextAttemptAt:null});queueChanged();await load();await sync()}
    catch(failure){setError(failure instanceof Error?failure.message:'Não foi possível reenviar.')}
    finally{setBusy(false)}
  }
  const pending=rows.filter(row=>row.state!=='rejected'),rejected=rows.filter(row=>row.state==='rejected')
  return <details open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)} className="text-sm">
    <summary className="cursor-pointer font-medium text-slate-500 dark:text-slate-400">{onUse?'Modelos, rascunhos e envio pendente':'Envio pendente'}{rows.length>0?` (${rows.length})`:''}</summary>
    <section aria-label="Modelos, rascunhos e envio pendente" className="card mt-3 min-w-0 space-y-4 p-4">
      {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {notice&&<p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
      {canWrite&&onUse&&preferences.models.length>0&&<div className="space-y-2"><p className="field-label">Usar um modelo</p><div className="flex flex-wrap gap-2">{preferences.models.map(model=><button type="button" disabled={blocked} key={model.id} onClick={()=>onUse({preset:model.payload})} className="rounded-full border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 disabled:opacity-50 dark:border-brand-800 dark:text-brand-300">{model.name}</button>)}</div></div>}
      {canWrite&&onUse&&preferences.drafts.length>0&&<details><summary className="cursor-pointer font-medium">Meus rascunhos ({preferences.drafts.length})</summary><div className="mt-3 space-y-3">{preferences.drafts.map(draft=><div key={draft.id} className="flex flex-wrap justify-between gap-3"><span>{draft.title}</span><div className="flex gap-3"><button type="button" disabled={blocked} onClick={()=>onUse({preset:draft.payload,draft})} className="font-semibold text-brand-700 dark:text-brand-300">Completar rascunho</button><button type="button" disabled={blocked||!connected} onClick={()=>{void ledgerRpc('delete_entry_preference',{p_space:workspace.space.id,p_id:draft.id,p_version:draft.version,p_kind:'draft'}).then(loadPreferences).catch(failure=>setError(failure.message))}} className="text-red-600">Excluir rascunho</button></div></div>)}</div></details>}
      {rows.length>0?<div aria-live="polite" className="space-y-2"><p>{pending.length} lançamentos pendentes de envio · {money(sumCents(pending.map(row=>row.content.amountCents)))}{rejected.length?` · ${rejected.length} não enviados`:''}</p><p className="text-xs text-slate-500">Os pendentes entram nos saldos quando forem enviados.</p><button type="button" disabled={blocked||!connected} onClick={()=>void sync(true)} className="font-semibold text-brand-700 disabled:opacity-50 dark:text-brand-300">Enviar agora</button></div>:<p className="text-xs text-slate-500">Nenhum lançamento pendente de envio neste aparelho.</p>}
      {rows.map(item=><article key={`${item.spaceId}:${item.clientUuid}`} className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800"><div className="flex flex-wrap justify-between gap-3"><div className="min-w-0 [overflow-wrap:anywhere]"><p>{item.content.description||'Lançamento'}</p><p className="text-xs text-slate-500">{item.state==='rejected'?'Não enviado':item.state==='sending'?'Enviando…':'Pendente de envio'}{item.spaceId!==workspace.space.id?' · outro espaço':''} · {item.content.occurredOn}</p></div><strong>{money(item.content.amountCents)}</strong></div>{item.lastReason&&<p className="text-xs text-amber-800 dark:text-amber-300">{item.lastReason}</p>}<div className="flex flex-wrap gap-3 text-xs font-semibold">{canWrite&&item.state==='rejected'&&<><button type="button" disabled={blocked||!connected} onClick={()=>void retry(item)}>Reenviar</button>{onUse&&item.spaceId===workspace.space.id&&<button type="button" disabled={blocked} onClick={()=>onUse({preset:item.content,item})}>Editar e reenviar</button>}<LedgerQueueConflict item={item} money={money} onResolved={async()=>{await load();await onChanged()}}/></>}<button type="button" disabled={blocked||item.state==='sending'} onClick={()=>setDeleteItem(item)}>{item.state==='rejected'?'Excluir do aparelho / manter servidor':'Desfazer pendente'}</button></div></article>)}
      {deleteItem&&<div role="dialog" aria-label="Excluir lançamento do aparelho" className="space-y-3 rounded-xl border border-amber-300 p-4"><p>Excluir este lançamento da fila deste aparelho? Se o servidor já o recebeu, o registro no servidor será preservado.</p><div className="flex gap-4"><button type="button" onClick={()=>{void offlineQueue.remove(deleteItem).then(()=>{setDeleteItem(null);queueChanged();void load()}).catch(failure=>setError(failure.message))}}>Confirmar exclusão do aparelho</button><button type="button" onClick={()=>setDeleteItem(null)}>Cancelar</button></div></div>}
      {canWrite&&onUse&&<LedgerModelManagement key={refreshKey} workspace={workspace} money={money} onChanged={loadPreferences}/>}
    </section>
  </details>
}
