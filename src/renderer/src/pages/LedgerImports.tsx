import { useEffect, useRef, useState, type FormEvent } from 'react';
import { inspectCsvStatement, parseStatementFile, type CsvColumn, type CsvStatementPreview, type StatementCsvProfile, type StatementImportPayload } from '../../../shared/finance/statementImport';
import { ledgerRpc, type LedgerWorkspace } from '../lib/ledgerRepository';
import { useAppStore } from '../store/useAppStore';
import { parseBrlCents } from '../../../shared/finance/money';
import { ImportHistoryTable, ImportReviewTable } from '../components/ImportTables';

interface ImportAccount { id: string; name: string; liquidity: string; accountType?: 'card'; importProfile: StatementCsvProfile | null; fitidsUnreliable: boolean; institution: string | null; lastDigits: string | null }
interface ImportBatch { id: string; financial_account_id: string | null; credit_card_id?: string | null; ledger_account_id: string; accountName?: string; file_name: string; status: 'in_review' | 'completed' | 'undone'; version: number; created_at: string; lines_read: number; lines_new: number; lines_duplicate: number; fitids_regenerated: boolean; canUndo?: boolean }
interface Counterpart { id: string; name: string; accountClass: string; ownerType: string; liquidity: string | null }
interface Suggestion { kind: 'transaction' | 'commitment' | 'installment' | 'opening_coverage'; description: string; confidence: string; amountCents: number; on: string; entryId?: string; transactionVersion?: number; commitmentId?: string; commitmentVersion?: number }
interface Candidate { id: string; line_number: number; posted_on: string | null; amount_cents: number | null; description: string; status: string; error: string | null; suggestions: Suggestion[]; autoSelected: boolean; matched_entry_id: string | null; currentTransactionVersion: number | null; absent_in_import_batch_id: string | null; installment_number?: number | null; installment_count?: number | null }
interface ImportReview { batch: ImportBatch; candidates: Candidate[]; balanceCheck: { on: string; statementCents: number; ledgerCents: number; differenceCents: number; matches: boolean } | null; undoChoices: { id: string; kind: string; description: string }[]; retainedTransactions?: { transactionId: string; description: string; reason: string }[]; openingCoverage?: { openingCents: number; importedCents: number; differenceCents: number }; absentGroups: { fingerprintKey: string; postedOn: string; amountCents: number; existingCount: number; fileCount: number; candidates: { candidateId: string; batchId: string; description: string }[] }[] }
interface Overview { accounts: ImportAccount[]; counterparts: Counterpart[]; batches: ImportBatch[] }
interface Choice { action: string; counterpart: string; purchaseOn?: string; totalText?: string }
const panel = 'card p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900';
const input = 'w-full min-w-0 field-input';
const primary = 'btn-primary disabled:opacity-50';
const secondary = 'rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 disabled:opacity-50';
const statusLabels: Record<string, string> = { pending_review: 'Nova: definir destino', suggested: 'Possível correspondência', matched: 'Conciliada', created: 'Lançada', blocked_closed_period: 'Aguardando reabertura', ignored: 'Ignorada', duplicate: 'Já importada', pending_authorization: 'Em processamento', informational: 'Informativa', invalid: 'Com erro', undone: 'Desfeita' };
const columns: { key: CsvColumn; label: string; optional?: boolean }[] = [ { key: 'date', label: 'Data' }, { key: 'description', label: 'Descrição' }, { key: 'amount', label: 'Valor único' }, { key: 'debit', label: 'Débito' }, { key: 'credit', label: 'Crédito' }, { key: 'externalId', label: 'Identificador da linha', optional: true }, { key: 'balance', label: 'Saldo', optional: true }, { key: 'status', label: 'Situação', optional: true }, { key: 'documentNumber', label: 'Documento', optional: true } ];
const defaultProfile = (): StatementCsvProfile => ({ encoding: 'auto', delimiter: 'auto', header: true, decimalSeparator: 'auto', inverseSigns: false, columns: {} });
const awaiting = (row: Candidate) => ['pending_review', 'suggested', 'blocked_closed_period'].includes(row.status);
const decisionLabels: Record<string, string> = { create: 'Criar lançamento', opening_installments: 'Cadastrar parcelamento anterior', opening_coverage: 'Coberta pela abertura', card_charges: 'Registrar encargo financeiro', card_payment: 'Pagamento da fatura', card_refund: 'Estorno de uma compra', ignore: 'Ignorar esta linha', keep_absent: 'Manter: o banco não trouxe a linha', transaction: 'Conciliar lançamento', installment: 'Conciliar parcela', commitment: 'Quitar Agenda' };

export default function LedgerImports({ workspace, money, onChanged }: { workspace: LedgerWorkspace; money: (value: number) => string; onChanged: () => Promise<void> }) {
  const [overview, setOverview] = useState<Overview | null>(null), [review, setReview] = useState<ImportReview | null>(null);
  const [accountId, setAccountId] = useState(''), [bytes, setBytes] = useState<Uint8Array | null>(null), [fileName, setFileName] = useState('');
  const [profile, setProfile] = useState<StatementCsvProfile>(defaultProfile), [csvPreview, setCsvPreview] = useState<CsvStatementPreview | null>(null), [isOfx, setIsOfx] = useState(false);
  const [prepared, setPrepared] = useState<StatementImportPayload | null>(null), [signConfirmed, setSignConfirmed] = useState(false), [otherReason, setOtherReason] = useState('');
  const [choices, setChoices] = useState<Record<string, Choice>>({}), [undoOpen, setUndoOpen] = useState(false), [restoreChoices, setRestoreChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [filter, setFilter] = useState('review'), [page, setPage] = useState(0);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [referenceMonth, setReferenceMonth] = useState('');
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const privacy = useAppStore(state => state.privacyMode), canWrite = workspace.role !== 'viewer';
  const currentSpace = useRef(workspace.space.id); currentSpace.current = workspace.space.id;
  const account = overview?.accounts.find(item => item.id === accountId);
  async function loadOverview() { const space = workspace.space.id, data = await ledgerRpc<Overview>('import_overview', { p_space: space }); if (currentSpace.current === space) setOverview(data); }
  useEffect(() => {
    setOverview(null); setReview(null); setAccountId(''); setBytes(null); setFileName(''); setPrepared(null); setCsvPreview(null); setUndoOpen(false); setError(''); setNotice('');
    void loadOverview().catch(failure => setError(failure instanceof Error ? failure.message : 'Não foi possível carregar as importações.'));
  }, [workspace.space.id]);
  function setLoadedReview(next: ImportReview) {
    setReview(next); setFilter('review'); setPage(0); setUndoOpen(false); setRestoreChoices({});
    setExpandedLine(null);
    setChoices(Object.fromEntries(next.candidates.map(row => [row.id, { action: row.autoSelected && row.suggestions[0]?.entryId ? `${row.suggestions[0].kind}:${row.suggestions[0].entryId}` : 'skip', counterpart: '' }])));
  }
  async function openBatch(id: string) {
    if (busy) return; setBusy(true); setError('');
    try { const next = await ledgerRpc<ImportReview>('import_review', { p_space: workspace.space.id, p_batch: id }); setLoadedReview(next); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível abrir este lote.'); }
    finally { setBusy(false); }
  }
  function chooseAccount(id: string) {
    setAccountId(id); setBytes(null); setFileName(''); setPrepared(null); setCsvPreview(null); setSignConfirmed(false); setOtherReason(''); setReferenceMonth('');
    setProfile(overview?.accounts.find(item => item.id === id)?.importProfile ?? defaultProfile());
  }
  function updateProfile(next: StatementCsvProfile) {
    setProfile(next); setPrepared(null); setSignConfirmed(false);
    if (bytes && !isOfx) { try { const preview = inspectCsvStatement(bytes, next); setCsvPreview(preview); } catch (failure) { setError((failure as Error).message); } }
  }
  async function selectFile(file: File | undefined) {
    setError(''); setPrepared(null); setSignConfirmed(false); setOtherReason(''); if (!file) return;
    try {
      if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error('Selecione um arquivo OFX ou CSV de até 10 MB.');
      const data = new Uint8Array(await file.arrayBuffer()), ofx = /<OFX(?:\s[^>]*)?>/i.test(new TextDecoder().decode(data));
      setBytes(data); setFileName(file.name); setIsOfx(ofx);
      if (!ofx) { const preview = inspectCsvStatement(data, profile); setCsvPreview(preview); setProfile({ ...profile, columns: Object.keys(profile.columns).length ? profile.columns : preview.suggestedColumns }); }
      else setCsvPreview(null);
    } catch (failure) { setBytes(null); setCsvPreview(null); setError(failure instanceof Error ? failure.message : 'Não foi possível ler o arquivo.'); }
  }
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !bytes) return; setBusy(true); setError(''); setNotice('');
    try {
      const next = await parseStatementFile(bytes, { fileName, timeZone: workspace.space.timezone, generatedOn: isOfx ? undefined : workspace.space.today, profile: isOfx ? undefined : profile, inverseSigns: profile.inverseSigns });
      if (next.accountType === 'card' && account?.accountType !== 'card') throw new Error('Este arquivo é de cartão. Selecione o cartão correspondente.');
      if (next.format === 'ofx' && next.accountType === 'bank' && account?.accountType === 'card') throw new Error('Este arquivo é de conta bancária. Selecione a conta correspondente.');
      setPrepared(next); setClientId(crypto.randomUUID()); setSignConfirmed(Boolean(account?.importProfile));
    } catch (failure) { setPrepared(null); setError(failure instanceof Error ? failure.message : 'Confira o arquivo e o mapeamento.'); }
    finally { setBusy(false); }
  }
  async function readBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !prepared || !signConfirmed) return; setBusy(true); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const id = await ledgerRpc<string>('import_statement_read', { p_space: workspace.space.id, p_account: accountId, p_client_uuid: clientId, p_payload: { ...prepared, accountType: account?.accountType === 'card' ? 'card' : 'bank', referenceMonth: account?.accountType === 'card' && referenceMonth ? `${referenceMonth}-01` : undefined, periodStart: String(form.get('periodStart')) || null, periodEnd: String(form.get('periodEnd')) || null, profile: prepared.profile ?? { columns: {}, inverseSigns: profile.inverseSigns ?? false }, otherAccountReason: otherReason || undefined } });
      const next = await ledgerRpc<ImportReview>('import_review', { p_space: workspace.space.id, p_batch: id });
      setLoadedReview(next); setPrepared(null); setBytes(null); setFileName(''); setCsvPreview(null); await loadOverview();
      setNotice('Arquivo lido. Revise as linhas antes de confirmar os lançamentos.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível gravar a leitura.'); await loadOverview().catch(() => undefined); }
    finally { setBusy(false); }
  }
  function changeChoice(row: Candidate, action: string, counterpart = choices[row.id]?.counterpart ?? '') { setChoices(previous => ({ ...previous, [row.id]: { ...previous[row.id], action, counterpart } })); }
  async function confirm() {
    if (busy || !review) return; setBusy(true); setError(''); setNotice('');
    try {
      const decisions = review.candidates.filter(row => awaiting(row) && choices[row.id]?.action !== 'skip').map(row => {
        const choice = choices[row.id]; if (!choice) return null;
        if (choice.action === 'create') { if (!choice.counterpart) throw new Error(`Escolha o destino da linha ${row.line_number}.`); const fullPurchase = review.batch.credit_card_id && (row.installment_number ?? 1) > 1; if (fullPurchase && (!choice.purchaseOn || !choice.totalText)) throw new Error(`Informe a data original e o valor total da compra na linha ${row.line_number}.`); return { candidateId: row.id, action: 'create', counterpartAccountId: choice.counterpart, purchaseOn: fullPurchase ? choice.purchaseOn : undefined, totalCents: fullPurchase ? parseBrlCents(choice.totalText!) : undefined }; }
        if (choice.action === 'opening_installments' || choice.action === 'opening_coverage' || choice.action === 'card_charges') return { candidateId: row.id, action: choice.action };
        if (choice.action === 'card_payment') { if (!choice.counterpart) throw new Error(`Escolha a conta que pagou a linha ${row.line_number}.`); return { candidateId: row.id, action: 'card_payment', originAccountId: choice.counterpart }; }
        if (choice.action === 'card_refund') { if (!choice.counterpart) throw new Error(`Escolha a compra original da linha ${row.line_number}.`); return { candidateId: row.id, action: 'card_refund', originalTransactionId: choice.counterpart }; }
        if (choice.action === 'ignore' || choice.action === 'keep_absent') return { candidateId: row.id, action: choice.action };
        const [kind, id] = choice.action.split(':');
        const suggestion = row.suggestions.find(item => item.entryId === id || item.commitmentId === id);
        if (!suggestion) throw new Error('A correspondência mudou. Reabra o lote para atualizar as sugestões.');
        return kind === 'transaction' || kind === 'installment' ? { candidateId: row.id, action: kind === 'installment' ? 'match_installment' : 'match_transaction', entryId: id, transactionVersion: suggestion.transactionVersion } : { candidateId: row.id, action: 'match_commitment', commitmentId: id, commitmentVersion: suggestion.commitmentVersion };
      }).filter(Boolean);
      if (!decisions.length) throw new Error('Escolha pelo menos uma linha para confirmar.');
      const next = await ledgerRpc<ImportReview>('confirm_import', { p_space: workspace.space.id, p_batch: review.batch.id, p_version: review.batch.version, p_decisions: decisions });
      setLoadedReview(next); await loadOverview(); await onChanged(); setNotice('Decisões aplicadas. As linhas sem decisão continuam em revisão.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível confirmar o lote.'); }
    finally { setBusy(false); }
  }
  async function reject(row: Candidate, suggestion: Suggestion) {
    if (busy || !review) return; setBusy(true); setError('');
    try { const next = await ledgerRpc<ImportReview>('confirm_import', { p_space: workspace.space.id, p_batch: review.batch.id, p_version: review.batch.version, p_decisions: [{ candidateId: row.id, action: 'reject', matchKind: suggestion.kind, entryId: suggestion.entryId, commitmentId: suggestion.commitmentId }] }); setLoadedReview(next); await loadOverview(); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  async function unmatch(row: Candidate) {
    if (busy || !review) return; setBusy(true); setError('');
    try { await ledgerRpc('unmatch_import', { p_space: workspace.space.id, p_candidate: row.id, p_version: row.currentTransactionVersion }); setLoadedReview(await ledgerRpc<ImportReview>('import_review', { p_space: workspace.space.id, p_batch: review.batch.id })); await loadOverview(); await onChanged(); setNotice('Conciliação desfeita. O lançamento continua no financeiro.'); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  async function undo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !review) return; setBusy(true); setError('');
    try {
      if (review.undoChoices.some(item => !restoreChoices[item.id])) throw new Error('Escolha como tratar cada lançamento alterado depois da importação.');
      await ledgerRpc('undo_import', { p_space: workspace.space.id, p_batch: review.batch.id, p_version: review.batch.version, p_reason: String(new FormData(event.currentTarget).get('reason')).trim(), p_restore_choices: restoreChoices });
      setLoadedReview(await ledgerRpc<ImportReview>('import_review', { p_space: workspace.space.id, p_batch: review.batch.id })); await loadOverview(); await onChanged(); setNotice('Lote desfeito. Seu histórico continua disponível.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível desfazer o lote.'); }
    finally { setBusy(false); }
  }
  async function downloadOriginal() {
    if (busy || !review) return; setBusy(true); setError('');
    try { const file = await ledgerRpc<{ fileName: string; fileBytesBase64: string }>('import_original_file', { p_space: workspace.space.id, p_batch: review.batch.id }); const data = Uint8Array.from(atob(file.fileBytesBase64), char => char.charCodeAt(0)); const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' })); const link = document.createElement('a'); link.href = url; link.download = file.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  const selectedBatch = overview?.batches.find(item => item.id === review?.batch.id);
  const displayed = review?.candidates.filter(row => filter === 'all' || filter === 'review' && awaiting(row) || filter === 'applied' && ['created', 'matched', 'ignored', 'undone'].includes(row.status) || filter === 'duplicate' && row.status === 'duplicate' || filter === 'pending' && row.status === 'pending_authorization' || filter === 'error' && ['invalid', 'informational'].includes(row.status)) ?? [];
  const selectedCount = review?.candidates.filter(row => awaiting(row) && choices[row.id]?.action && choices[row.id].action !== 'skip').length ?? 0;
  return <div className="min-w-0 space-y-6">
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
      {canWrite ? <form aria-label="Preparar importação" onSubmit={event => void prepare(event)} className="card min-w-0 space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-64"><label htmlFor="import-account" className="field-label">Conta ou cartão do arquivo</label><select id="import-account" value={accountId} onChange={event => chooseAccount(event.target.value)} disabled={busy} required className={input}><option value="">Selecione a conta ou o cartão</option>{overview?.accounts.map(item => <option key={item.id} value={item.id}>{item.name}{item.liquidity === 'benefit' ? ' · Benefício' : item.accountType === 'card' ? ' · Cartão' : ''}</option>)}</select></div>
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-72"><label htmlFor="import-file" className="field-label">Arquivo OFX ou CSV</label><input id="import-file" key={accountId} type="file" accept=".ofx,.csv,text/csv,application/x-ofx" disabled={busy || !accountId} onChange={event => void selectFile(event.target.files?.[0])} className={input}/></div>
          <button disabled={busy || !bytes} className={primary}>{busy ? 'Preparando…' : 'Conferir arquivo'}</button>
        </div>
        <p className="max-w-prose text-xs text-slate-500 dark:text-slate-400">Escolha a conta, confira as colunas e revise o arquivo. Seus saldos só mudam quando você confirma as linhas.</p>
        {account?.accountType === 'card' && <div className="grid max-w-md gap-1 text-sm"><label htmlFor="import-statement-month" className="field-label">Mês da fatura (se o arquivo for de uma fatura)</label><input id="import-statement-month" type="month" value={referenceMonth} onChange={event => setReferenceMonth(event.target.value)} disabled={busy} className={input}/><span className="text-xs text-slate-500 dark:text-slate-400">Deixe vazio para atribuir cada linha pela data da compra.</span></div>}
        {account?.lastDigits && <p className="text-xs text-slate-500 dark:text-slate-400">Identificação da conta no banco: {account.institution} · final {account.lastDigits}</p>}
        {account?.fitidsUnreliable && <p className="text-sm text-amber-700 dark:text-amber-300">Este banco gerou identificadores novos para linhas antigas. A comparação usa data, valor e quantidade de linhas iguais.</p>}
        {bytes && <div className="grid min-w-0 gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2 dark:border-slate-800">
          {!isOfx && <>
            <div className="grid gap-2 text-sm"><label htmlFor="import-encoding">Codificação</label><select id="import-encoding" value={profile.encoding ?? 'auto'} disabled={busy} onChange={event => updateProfile({ ...profile, encoding: event.target.value as StatementCsvProfile['encoding'] })} className={input}><option value="auto">Detectar automaticamente</option><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option><option value="iso-8859-1">ISO-8859-1</option></select></div>
            <div className="grid gap-2 text-sm"><label htmlFor="import-delimiter">Separador das colunas</label><select id="import-delimiter" value={profile.delimiter ?? 'auto'} disabled={busy} onChange={event => updateProfile({ ...profile, delimiter: event.target.value as StatementCsvProfile['delimiter'] })} className={input}><option value="auto">Detectar automaticamente</option><option value=";">Ponto e vírgula</option><option value=",">Vírgula</option><option value={'\t'}>Tabulação</option></select></div>
            <div className="grid gap-2 text-sm"><label htmlFor="import-decimal">Separador decimal</label><select id="import-decimal" value={profile.decimalSeparator ?? 'auto'} disabled={busy} onChange={event => updateProfile({ ...profile, decimalSeparator: event.target.value as StatementCsvProfile['decimalSeparator'] })} className={input}><option value="auto">Detectar pelo valor</option><option value=",">Vírgula: 1.234,56</option><option value=".">Ponto: 1,234.56</option></select></div>
            <label htmlFor="import-header" className="flex items-center gap-2 text-sm"><input id="import-header" type="checkbox" checked={profile.header ?? true} disabled={busy} onChange={event => updateProfile({ ...profile, header: event.target.checked })}/>Primeira linha contém os nomes das colunas</label>
          </>}
          <label htmlFor="import-inverse" className="flex items-center gap-2 text-sm sm:col-span-2"><input id="import-inverse" type="checkbox" checked={profile.inverseSigns ?? false} disabled={busy} onChange={event => updateProfile({ ...profile, inverseSigns: event.target.checked })}/>Inverter os sinais: o arquivo mostra gastos como positivos</label>
          {csvPreview && <><div className="min-w-0 overflow-x-auto sm:col-span-2"><p className="mb-2 text-sm font-medium">Primeiras linhas do arquivo</p><table aria-label="Prévia das colunas do arquivo" className="w-full text-left text-sm"><thead className="table-head dark:bg-slate-800/50"><tr>{csvPreview.headers.map((heading, index) => <th key={index} scope="col" className="p-2">{heading || `Coluna ${index + 1}`}</th>)}</tr></thead><tbody>{csvPreview.sample.map((record, index) => <tr key={index} className="border-t border-slate-200 dark:border-slate-800">{record.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-pre-wrap p-2">{privacy ? '••••' : cell}</td>)}</tr>)}</tbody></table></div><fieldset className="grid min-w-0 gap-3 sm:col-span-2 sm:grid-cols-3"><legend className="mb-3 text-sm font-semibold">Defina as colunas · use valor único ou débito e crédito</legend>{columns.map(column => <div key={column.key} className="grid min-w-0 gap-1 text-sm"><label htmlFor={`import-column-${column.key}`}>{column.label}{column.optional ? ' (opcional)' : ''}</label><select id={`import-column-${column.key}`} value={profile.columns[column.key] ?? ''} disabled={busy} onChange={event => { const mapped = { ...profile.columns }; if (event.target.value === '') delete mapped[column.key]; else mapped[column.key] = Number(event.target.value); updateProfile({ ...profile, columns: mapped }); }} className={input}><option value="">Não utilizar</option>{csvPreview.headers.map((heading, index) => <option key={index} value={index}>{index + 1}. {heading || 'Sem nome'}</option>)}</select></div>)}</fieldset></>}
        </div>}
      </form> : <p className="text-sm text-slate-500 dark:text-slate-400">Seu acesso permite consultar os lotes já importados.</p>}
      {overview?.accounts.length === 0 && <p className="text-sm text-slate-500">Cadastre primeiro uma conta bancária ou de benefício.</p>}
    {prepared && <form onSubmit={event => void readBatch(event)} className={`${panel} space-y-4`}>
      <h2 className="font-semibold">Confira os valores antes de ler o extrato</h2><p className="text-sm text-slate-500">Saídas devem aparecer negativas e entradas positivas. O arquivo contém {prepared.rows.length} linhas.</p>
      <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1 text-sm"><label htmlFor="import-period-start">Início do período</label><input id="import-period-start" name="periodStart" type="date" defaultValue={prepared.periodStart ?? ''} className={input}/></div><div className="grid gap-1 text-sm"><label htmlFor="import-period-end">Fim do período</label><input id="import-period-end" name="periodEnd" type="date" defaultValue={prepared.periodEnd ?? ''} className={input}/></div></div>
      {prepared.rows.slice(0, 5).map(row => <div key={row.lineNumber} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 pb-2 text-sm dark:border-slate-800"><span>{row.postedOn} · {row.description}</span><strong>{row.amountCents === null ? row.error || statusLabels[row.status] : money(row.amountCents)}</strong></div>)}
      <label htmlFor="import-signs-confirmed" className="flex items-center gap-2 text-sm"><input id="import-signs-confirmed" type="checkbox" checked={signConfirmed} onChange={event => setSignConfirmed(event.target.checked)} required/>Conferi os sinais e os valores do arquivo</label>
      <div className="grid gap-2 text-sm"><label htmlFor="import-other-account-reason">Se a identificação do banco mudou, explique o motivo (opcional)</label><input id="import-other-account-reason" value={otherReason} onChange={event => setOtherReason(event.target.value)} maxLength={1000} className={input}/></div>
      <button disabled={busy || !signConfirmed} className={primary}>{busy ? 'Lendo…' : 'Ler extrato e revisar'}</button>
    </form>}
    {review && <section aria-label="Revisão do extrato" className="min-w-0 space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 [overflow-wrap:anywhere]"><h2 className="font-semibold">Revisão: {review.batch.file_name}</h2><p className="mt-1 text-sm text-slate-500">{review.batch.status === 'undone' ? 'Lote desfeito' : review.batch.status === 'completed' ? 'Revisão concluída' : 'Linhas aguardando sua decisão'}</p></div><div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => void downloadOriginal()} className={secondary}>Baixar arquivo original</button>{selectedBatch?.canUndo && <button disabled={busy} onClick={() => setUndoOpen(!undoOpen)} className={`${secondary} text-red-600`}>Desfazer lote</button>}</div></div>
      {review.batch.fitids_regenerated && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">O banco mudou os identificadores. As linhas foram comparadas por data, valor e quantidade para evitar duplicações.</p>}
      {review.openingCoverage && <p className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">Saldo inicial da fatura: {money(review.openingCoverage.openingCents)} · Linhas anteriores ao início: {money(review.openingCoverage.importedCents)} · Diferença: {money(review.openingCoverage.differenceCents)}</p>}
      {review.retainedTransactions?.map(item => <p key={item.transactionId} role="status" className="rounded-xl border border-amber-200 p-4 text-sm dark:border-amber-900">{item.description}: {item.reason}. O lançamento e a proteção contra duplicação permanecem ativos.</p>)}
      {review.balanceCheck && <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800"><p className="font-semibold">{review.balanceCheck.matches ? 'Saldo conferido' : 'Saldo divergente'} em {review.balanceCheck.on}</p><p className="mt-1">No extrato: {money(review.balanceCheck.statementCents)} · No aplicativo: {money(review.balanceCheck.ledgerCents)}</p>{!review.balanceCheck.matches && <p className="mt-1">Diferença: {money(review.balanceCheck.differenceCents)}. Revise as linhas e os lançamentos desta conta.</p>}</div>}
      {undoOpen && <form onSubmit={event => void undo(event)} className="grid gap-4 rounded-xl border border-red-200 p-4 dark:border-red-900"><p className="text-sm">Desfazer cancela os lançamentos criados pelo lote, desfaz suas conciliações e restaura os valores que ele alterou. O histórico permanece registrado.</p>{review.undoChoices.map(item => <div key={item.id} className="grid gap-1 text-sm"><label htmlFor={`import-restore-${item.id}`}>{item.description}: alterado depois da importação</label><select id={`import-restore-${item.id}`} required value={restoreChoices[item.id] ?? ''} onChange={event => setRestoreChoices(previous => ({ ...previous, [item.id]: event.target.value }))} className={input}><option value="">Escolha o que fazer</option><option value="restore">Restaurar o valor anterior ao lote</option><option value="keep">Manter o valor atual</option></select></div>)}<div className="grid gap-1 text-sm"><label htmlFor="import-undo-reason">Motivo para desfazer</label><textarea id="import-undo-reason" name="reason" required maxLength={1000} className={input}/></div><div className="flex gap-3"><button disabled={busy} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Desfazendo…' : 'Confirmar desfazer lote'}</button><button type="button" disabled={busy} onClick={() => setUndoOpen(false)} className={secondary}>Voltar</button></div></form>}
      {review.absentGroups.map(group => <div key={group.fingerprintKey} className="rounded-xl border border-amber-200 p-4 text-sm dark:border-amber-900"><p>{group.existingCount} lançamentos de {money(group.amountCents)} em {group.postedOn} no aplicativo; {group.fileCount} no extrato.</p><p className="mt-1 text-slate-500">Nenhum foi cancelado. Abra o lote original para decidir qual está ausente e se deseja manter o lançamento.</p><div className="mt-2 flex flex-wrap gap-3">{[...new Set(group.candidates.map(item => item.batchId))].map(id => <button key={id} disabled={busy} onClick={() => void openBatch(id)} className="font-semibold text-brand-700 dark:text-brand-300">Abrir lote original</button>)}</div></div>)}
      <div className="grid max-w-xs gap-1 text-sm"><label htmlFor="import-filter" className="field-label">Mostrar linhas</label><select id="import-filter" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); setExpandedLine(null); }} className={input}><option value="review">Aguardando revisão</option><option value="applied">Aplicadas e ignoradas</option><option value="duplicate">Já importadas</option><option value="pending">Em processamento</option><option value="error">Informativas e com erro</option><option value="all">Todas</option></select></div>
      <ImportReviewTable lines={displayed.slice(page * 50, page * 50 + 50)} money={money}
        renderSituation={row=><p>{statusLabels[row.status] ?? row.status}</p>}
        renderContext={row=><>
          {row.error&&<p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{row.error}</p>}
          {row.status==='blocked_closed_period'&&<p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Reabra o mês antes de criar ou alterar um lançamento desta linha.</p>}
          {awaiting(row)&&choices[row.id]?.action&&choices[row.id].action!=='skip'&&<p className="mt-1 text-xs text-brand-700 dark:text-brand-300">{row.autoSelected&&choices[row.id].action===`${row.suggestions[0]?.kind}:${row.suggestions[0]?.entryId}`?'Correspondência preselecionada':'Decisão'}: {decisionLabels[choices[row.id].action.split(':')[0]] ?? choices[row.id].action}</p>}
        </>}
        renderActions={row=><button type="button" disabled={busy} onClick={()=>setExpandedLine(expandedLine===row.id?null:row.id)} aria-label={`Ver detalhes da linha ${row.line_number}`} aria-expanded={expandedLine===row.id} className="text-xs font-semibold text-brand-700 dark:text-brand-400">Detalhes</button>}
        renderEditor={row=>expandedLine===row.id?<section aria-label={`Detalhes da linha ${row.line_number}`} className={`${panel} min-w-0 space-y-3`}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0 [overflow-wrap:anywhere]"><h3 className="text-sm font-semibold">{row.line_number}. {row.description}</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{row.posted_on || 'Data não identificada'} · {statusLabels[row.status] ?? row.status}</p></div><button type="button" disabled={busy} onClick={()=>setExpandedLine(null)} className="text-sm text-slate-500 dark:text-slate-400">Fechar</button></div>
          {row.error&&<p className="text-sm text-amber-700 dark:text-amber-300">{row.error}</p>}
          {row.status==='blocked_closed_period'&&<p className="text-sm text-amber-700 dark:text-amber-300">Reabra o mês antes de criar ou alterar um lançamento desta linha.</p>}
        {canWrite && awaiting(row) && review.batch.status !== 'undone' && <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1 text-sm"><label htmlFor={`import-action-${row.id}`}>O que fazer</label><select id={`import-action-${row.id}`} value={choices[row.id]?.action ?? 'skip'} disabled={busy} onChange={event => changeChoice(row, event.target.value)} className={input}>
            <option value="skip">Decidir depois</option>
            {row.absent_in_import_batch_id ? <option value="keep_absent">Manter: o banco não trouxe a linha</option> : <>
              {(!review.batch.credit_card_id || row.amount_cents! < 0) && <option value="create">{review.batch.credit_card_id && (row.installment_number ?? 1) > 1 ? 'Cadastrar compra parcelada completa' : 'Criar lançamento'}</option>}
              {review.batch.credit_card_id && row.installment_number && <option value="opening_installments">Cadastrar parcelamento anterior ao início do cartão</option>}
              {review.batch.credit_card_id && row.amount_cents! < 0 && !row.installment_number && <option value="card_charges">Registrar encargo financeiro</option>}
              {review.batch.credit_card_id && row.amount_cents! > 0 && <><option value="card_payment">Pagamento da fatura</option><option value="card_refund">Estorno de uma compra</option></>}
              {row.suggestions.map(suggestion => <option key={suggestion.entryId ?? suggestion.commitmentId ?? suggestion.kind} value={suggestion.kind === 'opening_coverage' ? 'opening_coverage' : `${suggestion.kind}:${suggestion.entryId ?? suggestion.commitmentId}`}>{suggestion.kind === 'commitment' ? 'Quitar Agenda' : suggestion.kind === 'opening_coverage' ? 'Coberta pela abertura' : 'Conciliar lançamento'}: {suggestion.description} · {money(suggestion.amountCents)}</option>)}
            </>}
            <option value="ignore">Ignorar esta linha</option>
          </select></div>
          {['create', 'card_payment', 'card_refund'].includes(choices[row.id]?.action) && <div className="grid gap-1 text-sm"><label htmlFor={`import-counterpart-${row.id}`}>{choices[row.id]?.action === 'card_payment' ? 'Conta que pagou' : choices[row.id]?.action === 'card_refund' ? 'Compra original' : review.batch.credit_card_id ? 'Categoria da compra' : 'Categoria, pessoa ou conta'}</label><select id={`import-counterpart-${row.id}`} value={choices[row.id]?.counterpart ?? ''} disabled={busy} onChange={event => changeChoice(row, choices[row.id].action, event.target.value)} className={input}><option value="">Selecione o destino</option>
            {choices[row.id]?.action === 'card_refund' ? workspace.transactions.filter(item => item.kind === 'card_purchase' && item.status === 'posted').map(item => <option key={item.id} value={item.id}>{item.description} · {item.occurred_on}</option>) : overview?.counterparts.filter(item => item.id !== review.batch.ledger_account_id && (choices[row.id]?.action === 'card_payment' ? item.ownerType === 'financial_account' && item.liquidity === 'cash' : review.batch.credit_card_id ? item.ownerType === 'category' && item.accountClass === 'expense' : item.ownerType !== 'category' || item.accountClass === (row.amount_cents! < 0 ? 'expense' : 'income'))).map(item => <option key={item.id} value={item.id}>{item.ownerType === 'category' ? 'Categoria' : item.ownerType === 'person' ? 'Pessoa' : 'Conta'} · {item.name}</option>)}
          </select></div>}
          {choices[row.id]?.action === 'create' && review.batch.credit_card_id && (row.installment_number ?? 1) > 1 && <><div className="grid gap-1 text-sm"><label htmlFor={`import-purchase-date-${row.id}`}>Data original da compra</label><input id={`import-purchase-date-${row.id}`} type="date" value={choices[row.id]?.purchaseOn ?? ''} onChange={event => setChoices(previous => ({ ...previous, [row.id]: { ...previous[row.id], purchaseOn: event.target.value } }))} className={input}/></div><div className="grid gap-1 text-sm"><label htmlFor={`import-purchase-total-${row.id}`}>Valor total da compra (R$)</label><input id={`import-purchase-total-${row.id}`} inputMode="decimal" value={choices[row.id]?.totalText ?? ''} onChange={event => setChoices(previous => ({ ...previous, [row.id]: { ...previous[row.id], totalText: event.target.value } }))} className={input}/></div></>}
          {row.suggestions.length > 0 && <div className="space-y-2 sm:col-span-2">{row.suggestions.map(suggestion => <div key={suggestion.entryId ?? suggestion.commitmentId ?? suggestion.kind} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{row.autoSelected ? 'Correspondência preselecionada' : 'Possível correspondência'}: {suggestion.description} · {suggestion.on} · {money(suggestion.amountCents)}</span>{suggestion.kind !== 'opening_coverage' && <button disabled={busy} onClick={() => void reject(row, suggestion)} className="font-semibold text-brand-700 dark:text-brand-300">Não é esta</button>}</div>)}</div>}
        </div>}
        {canWrite && row.matched_entry_id && row.currentTransactionVersion && review.batch.status !== 'undone' && <button disabled={busy} onClick={() => void unmatch(row)} className="mt-3 text-sm font-semibold text-brand-700 dark:text-brand-300">Desfazer conciliação desta linha</button>}
      </section>:null}/>
      {displayed.length > 50 && <div className="flex items-center justify-between gap-3 text-sm"><button disabled={page === 0} onClick={() => setPage(page - 1)} className={secondary}>Anteriores</button><span>Página {page + 1} de {Math.ceil(displayed.length / 50)}</span><button disabled={(page + 1) * 50 >= displayed.length} onClick={() => setPage(page + 1)} className={secondary}>Próximas</button></div>}
      {canWrite && review.batch.status !== 'undone' && <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 pt-4 dark:border-slate-800"><button disabled={busy || selectedCount === 0} onClick={() => void confirm()} className={primary}>{busy ? 'Confirmando…' : `Confirmar ${selectedCount} ${selectedCount === 1 ? 'linha' : 'linhas'}`}</button><p className="text-xs text-slate-500">As linhas marcadas para decidir depois continuam fora do financeiro.</p></div>}
    </section>}
    <section className="space-y-3"><h2 className="text-sm font-semibold">Histórico de importações</h2>{overview&&<ImportHistoryTable batches={overview.batches} busy={busy} selectedId={review?.batch.id} onOpen={id=>void openBatch(id)}/>} {!overview && !error && <p className="text-sm text-slate-500">Carregando importações…</p>}</section>
  </div>;
}
