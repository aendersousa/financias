import { useState, type FormEvent } from 'react';
import { Plus, Search, Tag } from 'lucide-react';
import type { LedgerWorkspace, WorkspaceMetadata } from '../lib/ledgerRepository';

const input = 'field-input w-full min-w-0';
const panel = 'card min-w-0 p-4 sm:p-5';

export default function LedgerTags({ workspace, metadata, busy, canWrite, canManage, run, submitTag, transaction, setTransaction, selectedTags, setSelectedTags }: {
  workspace: LedgerWorkspace; metadata: WorkspaceMetadata; busy: boolean; canWrite: boolean; canManage: boolean;
  run: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  submitTag: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  transaction: string; setTransaction: (value: string) => void;
  selectedTags: string[]; setSelectedTags: (value: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const tags = metadata.tags.filter(tag => Boolean(tag.archived_at) === archived && tag.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return <div className="min-w-0 space-y-5">
    <section className={`${panel} space-y-4`}>
      <div className="flex items-center gap-3"><span className="rounded-xl bg-brand-500/10 p-3 text-brand-600 dark:text-brand-400"><Tag size={22}/></span><div><h2 className="font-semibold">Suas etiquetas</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Agrupe lançamentos por viagem, projeto ou outro assunto.</p></div></div>
      {canWrite && <form onSubmit={event => void submitTag(event)} className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-end dark:border-slate-700">
        <div className="min-w-0 flex-1"><label htmlFor="tag-name" className="field-label">Nova tag</label><input id="tag-name" name="name" maxLength={100} required disabled={busy} placeholder="Ex.: Viagem, Casa, Trabalho" className={`${input} mt-1`}/></div>
        <button disabled={busy} className="btn-primary inline-flex items-center justify-center gap-2"><Plus size={17}/>Criar tag</button>
      </form>}
    </section>
    <section className={`${panel} space-y-4`} aria-label="Lista de tags">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-slate-500/10 p-1">{[false, true].map(value => <button key={String(value)} type="button" aria-pressed={archived === value} onClick={() => setArchived(value)} className={`rounded-lg px-3 py-2 text-sm font-medium ${archived === value ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'}`}>{value ? 'Arquivadas' : 'Ativas'} <span className="ml-1 text-xs">{metadata.tags.filter(tag => Boolean(tag.archived_at) === value).length}</span></button>)}</div>
        <div className="relative w-full sm:w-64"><Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-500"/><input aria-label="Buscar tag" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar tag" className={`${input} pl-9`}/></div>
      </div>
      {tags.length === 0 && <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{search ? 'Nenhuma tag encontrada para essa busca.' : archived ? 'Nenhuma tag arquivada.' : 'Crie sua primeira tag para organizar os lançamentos.'}</p>}
      <div className="grid min-w-0 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{tags.map(tag => {
        const count = metadata.transaction_tags.filter(item => item.tag_id === tag.id).length;
        return <article key={`${tag.id}-${tag.version}`} className="min-w-0 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-start gap-2"><Tag size={17} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400"/><div className="min-w-0"><h3 className="break-words font-semibold">{tag.name}</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{count} {count === 1 ? 'lançamento' : 'lançamentos'}{tag.archived_at ? ' · Arquivada' : ''}</p></div></div>
          {canManage && <details className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700"><summary className="cursor-pointer text-xs font-semibold text-brand-700 dark:text-brand-400">Gerenciar</summary>
            <form onSubmit={event => { event.preventDefault(); void run('manage_tag', { p_tag: tag.id, p_version: tag.version, p_action: 'rename', p_name: String(new FormData(event.currentTarget).get('name')) }); }} className="mt-3 space-y-3">
              <label className="block text-xs">Nome da tag<input name="name" aria-label={`Nome da tag ${tag.name}`} defaultValue={tag.name} disabled={busy} required maxLength={100} className={`${input} mt-1`}/></label>
              <button disabled={busy} className="text-sm font-semibold text-brand-700 dark:text-brand-400">Salvar nome</button>
              <select aria-label={`Mesclar ${tag.name} em outra tag`} defaultValue="" disabled={busy} className={input} onChange={event => { if (event.target.value) void run('manage_tag', { p_tag: tag.id, p_version: tag.version, p_action: 'merge', p_destination: event.target.value }); }}><option value="">Mesclar com outra tag…</option>{metadata.tags.filter(item => item.id !== tag.id && !item.archived_at).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              <div className="flex justify-between gap-3"><button type="button" disabled={busy} onClick={() => void run('manage_tag', { p_tag: tag.id, p_version: tag.version, p_action: tag.archived_at ? 'restore' : 'archive' })} className="text-sm text-slate-600 dark:text-slate-300">{tag.archived_at ? 'Restaurar' : 'Arquivar'}</button><button type="button" disabled={busy} onClick={() => void run('manage_tag', { p_tag: tag.id, p_version: tag.version, p_action: 'delete' })} className="text-sm text-red-600 dark:text-red-400">Excluir</button></div>
            </form>
          </details>}
        </article>;
      })}</div>
    </section>
    {canWrite && <details className={panel}><summary className="cursor-pointer font-semibold">Aplicar tags a um lançamento</summary><div className="mt-4 space-y-4"><label htmlFor="tag-transaction" className="field-label">Lançamento</label><select id="tag-transaction" disabled={busy} value={transaction} onChange={event => setTransaction(event.target.value)} className={input}><option value="">Selecione um lançamento</option>{workspace.transactions.map(item => <option key={item.id} value={item.id}>{item.occurred_on.split('-').reverse().join('/')} · {item.description}</option>)}</select>
      {transaction && <><div className="flex flex-wrap gap-2">{metadata.tags.filter(tag => !tag.archived_at || selectedTags.includes(tag.id)).map(tag => <label key={tag.id} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${selectedTags.includes(tag.id) ? 'border-brand-500 bg-brand-500/10' : 'border-slate-200 dark:border-slate-700'}`}><input type="checkbox" disabled={busy} checked={selectedTags.includes(tag.id)} onChange={event => setSelectedTags(event.target.checked ? [...selectedTags, tag.id] : selectedTags.filter(id => id !== tag.id))}/>{tag.name}</label>)}</div><button disabled={busy} onClick={() => void run('set_transaction_tags', { p_transaction: transaction, p_tags: selectedTags, p_expected_tags: metadata.transaction_tags.filter(item => item.ledger_transaction_id === transaction).map(item => item.tag_id) })} className="btn-primary">Salvar tags do lançamento</button></>}
    </div></details>}
  </div>;
}
