import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseBrlCents } from '../../../shared/finance/money';
import { loadEntryPreferences, type EntryPreferences, type EntryPreset } from '../lib/entryPreferences';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';

type Model = EntryPreferences['models'][number];
interface Editor {
  id: string | null;
  version: number | null;
  clientUuid: string;
  name: string;
  kind: EntryPreset['kind'];
  description: string;
  amount: string;
  category: string;
  payment: string;
}
const input = 'w-full field-input px-3 py-2.5 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800';
const primary = 'btn-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const kinds: Record<EntryPreset['kind'], string> = { expense: 'Despesa', income: 'Receita', card_purchase: 'Compra no cartão em 1x' };
const decimal = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;

export default function LedgerModelManagement({ workspace, money, onChanged }: {
  workspace: LedgerWorkspace;
  money: (value: number) => string;
  onChanged: () => Promise<void>;
}) {
  const [models, setModels] = useState<{ space: string; rows: Model[] }>({ space: workspace.space.id, rows: [] });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removing, setRemoving] = useState<Model | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const revision = useRef(0);
  const activeSpace = useRef(workspace.space.id);
  activeSpace.current = workspace.space.id;

  async function refresh(space: string) {
    const request = ++revision.current;
    const preferences = await loadEntryPreferences(space);
    if (request === revision.current && activeSpace.current === space) setModels({ space, rows: preferences.models });
  }

  useEffect(() => {
    const space = workspace.space.id;
    let live = true;
    setEditor(null); setRemoving(null); setError(''); setNotice(''); setLoading(true);
    void refresh(space).catch(failure => {
      if (live) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar seus modelos.');
    }).finally(() => { if (live) setLoading(false); });
    const connection = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void refresh(space).catch(failure => {
        if (live) setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar seus modelos.');
      });
    };
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    return () => { live = false; revision.current++; window.removeEventListener('online', connection); window.removeEventListener('offline', connection); };
  }, [workspace.space.id]);

  const visibleModels = models.space === workspace.space.id ? models.rows : [];
  const categories = workspace.categories.filter(category => category.ledger_account_id && category.kind === (editor?.kind === 'income' ? 'income' : 'expense'));
  const accounts = workspace.accounts.filter(account => ['cash', 'benefit'].includes(account.liquidity));
  const payments = editor?.kind === 'card_purchase' ? workspace.cards : accounts;
  const editing = Boolean(editor?.id);
  const suffix = editing ? 'do modelo a editar' : 'do novo modelo';
  const disabled = busy || !online;

  function open(model?: Model) {
    setRemoving(null); setError(''); setNotice('');
    setEditor({ id: model?.id ?? null, version: model?.version ?? null, clientUuid: crypto.randomUUID(), name: model?.name ?? '', kind: model?.payload.kind ?? 'expense', description: model?.payload.description ?? '', amount: model?.payload.amountCents ? decimal(model.payload.amountCents) : '', category: model?.payload.categoryId ?? '', payment: model?.payload.cardId ?? model?.payload.accountId ?? '' });
  }

  function change(field: 'name' | 'description' | 'amount' | 'category' | 'payment', value: string) {
    setEditor(current => current && ({ ...current, [field]: value, clientUuid: crypto.randomUUID() }));
  }

  function changeKind(kind: EntryPreset['kind']) {
    setEditor(current => current && ({ ...current, kind, category: (current.kind === 'income') === (kind === 'income') ? current.category : '', payment: (current.kind === 'card_purchase') === (kind === 'card_purchase') ? current.payment : '', clientUuid: crypto.randomUUID() }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy || !navigator.onLine) return;
    const request = editor, space = workspace.space.id;
    setBusy(true); setError(''); setNotice('');
    try {
      const name = request.name.trim();
      if (!name) throw new Error('Informe um nome para o modelo.');
      const amount = request.amount.trim() ? parseBrlCents(request.amount) : undefined;
      if (amount !== undefined && amount < 1) throw new Error('Informe um valor maior que zero ou deixe o valor em branco.');
      if (request.category && !categories.some(category => category.id === request.category)) throw new Error('Escolha uma categoria disponível ou deixe para escolher ao usar o modelo.');
      if (request.payment && !payments.some(payment => payment.id === request.payment)) throw new Error('Escolha uma conta ou cartão disponível ou deixe para escolher ao usar o modelo.');
      const payload: EntryPreset = {
        kind: request.kind,
        ...(request.description.trim() ? { description: request.description.trim() } : {}),
        ...(amount !== undefined ? { amountCents: amount } : {}),
        ...(request.category ? { categoryId: request.category } : {}),
        ...(request.payment ? request.kind === 'card_purchase' ? { cardId: request.payment } : { accountId: request.payment } : {})
      };
      await ledgerRpc('save_entry_model', { p_space: space, p_name: name, p_payload: payload, p_model: request.id, p_version: request.version, p_client_uuid: request.id ? null : request.clientUuid });
      await refresh(space);
      await onChanged();
      if (activeSpace.current === space) { setEditor(null); setNotice(request.id ? 'Modelo atualizado.' : 'Modelo adicionado.'); }
    } catch (failure) {
      if (activeSpace.current === space) {
        const message = failure instanceof Error ? failure.message : 'Não foi possível salvar o modelo.';
        if (/changed; reload|not found/.test(message)) {
          setEditor(null); await refresh(space).catch(() => undefined);
          setError('Este modelo mudou em outro acesso. Abra a edição novamente com os dados atuais.');
        } else setError(message);
      }
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!removing || busy || !navigator.onLine) return;
    const model = removing, space = workspace.space.id;
    setBusy(true); setError(''); setNotice('');
    try {
      await ledgerRpc('delete_entry_preference', { p_space: space, p_id: model.id, p_version: model.version, p_kind: 'model' });
      await refresh(space);
      await onChanged();
      if (activeSpace.current === space) { setRemoving(null); setNotice('Modelo excluído.'); }
    } catch (failure) {
      if (activeSpace.current === space) {
        const message = failure instanceof Error ? failure.message : 'Não foi possível excluir o modelo.';
        if (/changed; reload|not found/.test(message)) {
          setRemoving(null); await refresh(space).catch(() => undefined);
          setError('Este modelo mudou em outro acesso. Confira a lista antes de excluir novamente.');
        } else setError(message);
      }
    } finally { setBusy(false); }
  }

  function context(model: Model) {
    const category = workspace.categories.find(item => item.id === model.payload.categoryId)?.name;
    const payment = model.payload.kind === 'card_purchase'
      ? workspace.cards.find(item => item.id === model.payload.cardId)?.name
      : workspace.accounts.find(item => item.id === model.payload.accountId)?.name;
    return [kinds[model.payload.kind], category, payment].filter(Boolean).join(' · ');
  }

  return <details onToggle={event => { if (event.currentTarget.open) void refresh(workspace.space.id).catch(failure => setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar seus modelos.')); }} className="border-t border-slate-200 pt-3 dark:border-slate-800">
    <summary className="cursor-pointer text-sm font-medium">Gerenciar meus modelos</summary>
    <div className="mt-4 space-y-4" aria-label="Gestão dos meus modelos">
      <p className="max-w-prose text-xs text-slate-500">Modelos guardam os campos que você costuma repetir. Adicionar, editar ou excluir um modelo preserva seus lançamentos.</p>
      {!online && <p role="status" className="text-sm text-amber-800 dark:text-amber-300">Conecte à internet para gerenciar seus modelos.</p>}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="text-sm text-teal-700 dark:text-teal-300">{notice}</p>}
      {loading && <p className="text-sm text-slate-500">Carregando seus modelos…</p>}
      {!loading && visibleModels.length === 0 && <p className="text-sm text-slate-500">Nenhum modelo cadastrado neste espaço.</p>}
      {visibleModels.map(model => <article key={model.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
        <div><h3 className="font-medium">{model.name}</h3><p className="mt-1 text-xs text-slate-500">{context(model)}</p>{model.payload.description && <p className="mt-1 text-xs text-slate-500">{model.payload.description}</p>}<p className="mt-1 font-medium">{typeof model.payload.amountCents === 'number' ? money(model.payload.amountCents) : 'Valor escolhido ao usar'}</p></div>
        <div className="flex gap-4 text-xs font-semibold"><button type="button" disabled={disabled} aria-label={`Editar modelo ${model.name}`} onClick={() => open(model)} className="text-teal-700 disabled:opacity-50 dark:text-teal-300">Editar modelo</button><button type="button" disabled={disabled} aria-label={`Excluir modelo ${model.name}`} onClick={() => { setRemoving(model); setEditor(null); setError(''); setNotice(''); }} className="text-red-700 disabled:opacity-50 dark:text-red-300">Excluir modelo</button></div>
      </article>)}
      {!editor && <button type="button" disabled={disabled} onClick={() => open()} className={primary}>Adicionar modelo</button>}
      {editor && <form aria-label={editing ? 'Editar meu modelo' : 'Adicionar meu modelo'} onSubmit={event => void save(event)} className="space-y-3">
        <h3 className="text-sm font-semibold">{editing ? 'Editar modelo' : 'Adicionar modelo'}</h3>
        <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm"><span>Nome {suffix}</span><input aria-label={`Nome ${suffix}`} value={editor.name} onChange={event => change('name', event.target.value)} required maxLength={100} className={input}/></label>
          <label className="grid gap-1 text-sm"><span>Tipo {suffix}</span><select aria-label={`Tipo ${suffix}`} value={editor.kind} onChange={event => changeKind(event.target.value as EntryPreset['kind'])} className={input}>{Object.entries(kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
          <label className="grid gap-1 text-sm"><span>Descrição {suffix} (opcional)</span><input aria-label={`Descrição ${suffix} (opcional)`} value={editor.description} onChange={event => change('description', event.target.value)} maxLength={100} className={input}/></label>
          <label className="grid gap-1 text-sm"><span>Valor {suffix} (R$, opcional)</span><input aria-label={`Valor ${suffix} (R$, opcional)`} value={editor.amount} onChange={event => change('amount', event.target.value)} inputMode="decimal" placeholder="Escolher ao usar" className={input}/></label>
          <label className="grid gap-1 text-sm"><span>Categoria {suffix}</span><select aria-label={`Categoria ${suffix}`} value={editor.category} onChange={event => change('category', event.target.value)} className={input}><option value="">Escolher ao usar</option>{editor.category && !categories.some(category => category.id === editor.category) && <option value={editor.category} disabled>Categoria indisponível; escolha outra</option>}{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm"><span>Conta ou cartão {suffix}</span><select aria-label={`Conta ou cartão ${suffix}`} value={editor.payment} onChange={event => change('payment', event.target.value)} className={input}><option value="">Escolher ao usar</option>{editor.payment && !payments.some(payment => payment.id === editor.payment) && <option value={editor.payment} disabled>Conta ou cartão indisponível; escolha outro</option>}{payments.map(payment => <option key={payment.id} value={payment.id}>{payment.name}</option>)}</select></label>
        </fieldset>
        <div className="flex gap-4"><button disabled={disabled} className={primary}>{busy ? 'Salvando…' : editing ? 'Salvar alterações do modelo' : 'Salvar novo modelo'}</button><button type="button" disabled={busy} onClick={() => setEditor(null)} className="text-sm">Cancelar edição do modelo</button></div>
      </form>}
      {removing && <div role="alertdialog" aria-label="Confirmar exclusão do modelo" className="space-y-3 rounded-xl border border-amber-300 p-4 text-sm dark:border-amber-800">
        <p>Excluir o modelo <strong>{removing.name}</strong> da sua lista? Os lançamentos já registrados serão preservados.</p>
        <div className="flex gap-4"><button type="button" disabled={disabled} onClick={() => void remove()} className="font-semibold text-red-700 disabled:opacity-50 dark:text-red-300">Confirmar exclusão do modelo</button><button type="button" disabled={busy} onClick={() => setRemoving(null)}>Manter modelo</button></div>
      </div>}
    </div>
  </details>;
}
