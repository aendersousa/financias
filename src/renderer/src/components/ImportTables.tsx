import { Fragment, type ReactNode } from 'react'
import { FileText } from 'lucide-react'

interface ImportLineItem {
  id: string
  line_number: number
  posted_on: string | null
  amount_cents: number | null
  description: string
}

interface ImportBatchItem {
  id: string
  file_name: string
  accountName?: string
  status: string
  created_at: string
}

const muted = 'text-slate-500 dark:text-slate-400'
const cell = 'px-3 py-2.5 [overflow-wrap:anywhere] sm:px-4'
const table = 'w-full table-fixed text-sm text-slate-900 dark:text-slate-100'

function dateText(value: string | null) {
  if (!value) return 'Data não identificada'
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : new Date(value).toLocaleDateString('pt-BR')
}

export function ImportReviewTable<T extends ImportLineItem>({ lines, money, renderSituation, renderContext, renderActions, renderEditor }: {
  lines: T[]
  money: (cents: number) => string
  renderSituation: (line: T) => ReactNode
  renderContext?: (line: T) => ReactNode
  renderActions: (line: T) => ReactNode
  renderEditor: (line: T) => ReactNode
}) {
  return <div className="table-shell">
    <table aria-label="Linhas do extrato" className={table}>
      <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50">
        <tr>
          <th scope="col" className="hidden w-[14%] px-4 py-2.5 sm:table-cell">Data</th>
          <th scope="col" className="w-[46%] px-3 py-2.5 sm:w-[36%] sm:px-4">Descrição</th>
          <th scope="col" className="w-[30%] px-3 py-2.5 text-right sm:w-[18%] sm:px-4">Valor</th>
          <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Situação</th>
          <th scope="col" className="w-[24%] px-3 sm:w-24 sm:px-4"><span className="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {lines.map(line => {
          const editor = renderEditor(line)
          return <Fragment key={line.id}>
            <tr className="table-row-hover">
              <td className={`hidden sm:table-cell ${cell} ${muted}`}>{dateText(line.posted_on)}</td>
              <td className={cell}>
                <p className="font-medium">{line.line_number}. {line.description}</p>
                <div className={`mt-1 space-y-1 text-xs sm:hidden ${muted}`}><p>{dateText(line.posted_on)}</p>{renderSituation(line)}</div>
                {renderContext?.(line)}
              </td>
              <td className={`${cell} text-right font-medium`}>{line.amount_cents === null ? '—' : money(line.amount_cents)}</td>
              <td className={`hidden sm:table-cell ${cell} ${muted}`}>{renderSituation(line)}</td>
              <td className={`${cell} text-right`}>{renderActions(line)}</td>
            </tr>
            {editor && <tr><td colSpan={5} className="p-3 sm:p-4">{editor}</td></tr>}
          </Fragment>
        })}
        {!lines.length && <tr><td colSpan={5} className={`px-4 py-6 text-center ${muted}`}>Nenhuma linha neste grupo.</td></tr>}
      </tbody>
    </table>
  </div>
}

export function ImportHistoryTable<T extends ImportBatchItem>({ batches, busy, selectedId, onOpen }: {
  batches: T[]
  busy: boolean
  selectedId?: string
  onOpen: (id: string) => void
}) {
  const statusText = (status: string) => status === 'undone' ? 'Desfeito' : status === 'completed' ? 'Concluído' : 'Em revisão'
  return <div className="table-shell">
    <table aria-label="Histórico de importações" className={table}>
      <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50">
        <tr>
          <th scope="col" className="w-[76%] px-3 py-2.5 sm:w-[40%] sm:px-4">Arquivo</th>
          <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Conta ou cartão</th>
          <th scope="col" className="hidden w-[15%] px-4 py-2.5 sm:table-cell">Data</th>
          <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Situação</th>
          <th scope="col" className="w-[24%] px-3 sm:w-24 sm:px-4"><span className="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {batches.map(batch => <tr key={batch.id} className="table-row-hover">
          <td className={cell}>
            <div className="flex items-start gap-2">
              <FileText aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <button type="button" disabled={busy} onClick={() => onOpen(batch.id)} aria-expanded={selectedId === batch.id} className="break-words text-left font-medium">{batch.file_name}</button>
                <div className={`mt-1 space-y-1 text-xs sm:hidden ${muted}`}><p>{batch.accountName}</p><p>{dateText(batch.created_at)} · {statusText(batch.status)}</p></div>
              </div>
            </div>
          </td>
          <td className={`hidden sm:table-cell ${cell} ${muted}`}>{batch.accountName}</td>
          <td className={`hidden sm:table-cell ${cell} ${muted}`}>{dateText(batch.created_at)}</td>
          <td className={`hidden sm:table-cell ${cell} ${muted}`}>{statusText(batch.status)}</td>
          <td className={`${cell} text-right`}><button type="button" disabled={busy} onClick={() => onOpen(batch.id)} aria-label={`Abrir importação ${batch.file_name}`} aria-expanded={selectedId === batch.id} className="text-xs font-semibold text-brand-700 dark:text-brand-400">Detalhes</button></td>
        </tr>)}
        {!batches.length && <tr><td colSpan={5} className={`px-4 py-6 text-center ${muted}`}>Nenhum extrato importado neste espaço.</td></tr>}
      </tbody>
    </table>
  </div>
}
