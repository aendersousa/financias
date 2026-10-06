import { Fragment, type ReactNode } from 'react'
import { ArrowLeftRight, Mail, UserRound } from 'lucide-react'

export interface SharingMemberItem {
  id: string
  nickname: string | null
  role: string
  status: string
}

export interface SharingInvitationItem {
  id: string
  email: string
  role: string
  expires_at: string
}

export interface SharingSettlementItem {
  member_id: string
  nickname: string | null
  contribution_cents: number
  share_cents: number
  carry_remaining_cents: number
  settlement_cents: number
}

export interface SharingTransferItem {
  id: string
  amount_cents: number
  occurred_on: string
  kind: string
  cancelled_at: string | null
}

const roles: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Somente leitura',
}

const transferKinds: Record<string, string> = {
  personal_expense: 'Paga pessoalmente',
  withdrawal: 'Retirada',
  debt_settlement: 'Reembolso',
  contribution: 'Aporte',
}

const tableClass = 'w-full table-fixed text-sm text-slate-900 dark:text-slate-100'
const headClass = 'table-head uppercase tracking-wide dark:bg-slate-800/50'
const bodyClass = 'divide-y divide-slate-100 dark:divide-slate-800'
const rowClass = 'table-row-hover transition-[background-color]'
const mutedClass = 'text-slate-500 dark:text-slate-400'
const cellClass = 'px-3 py-2.5 [overflow-wrap:anywhere] sm:px-4'
const valueClass = `${cellClass} break-normal whitespace-normal text-right`

function dateText(value: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR')
}

export function SharingMemberTable<T extends SharingMemberItem>({ members, renderActions, renderEditor }: {
  members: T[]
  renderActions?: (member: T) => ReactNode
  renderEditor?: (member: T) => ReactNode
}) {
  return <div className="table-shell">
    <table aria-label="Membros e permissões" className={tableClass}>
      <thead className={headClass}>
        <tr>
          <th scope="col" className="w-[76%] px-3 py-2.5 sm:w-[40%] sm:px-4">Membro</th>
          <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Papel</th>
          <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Situação</th>
          <th scope="col" className="w-[24%] px-3 sm:w-24 sm:px-4"><span className="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody className={bodyClass}>
        {members.map(member => {
          const editor = renderEditor?.(member)
          const role = roles[member.role] ?? member.role
          const status = member.status === 'active' ? 'Ativo' : 'Saiu do espaço'
          return <Fragment key={member.id}>
            <tr className={rowClass}>
              <td className={cellClass}>
                <div className="flex items-start gap-2">
                  <UserRound aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
                  <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span>{member.nickname || 'Membro'}</span>
                    <p className={`mt-1 text-xs sm:hidden ${mutedClass}`}>{role} · {status}</p>
                  </div>
                </div>
              </td>
              <td className={`hidden sm:table-cell ${cellClass} ${mutedClass}`}>{role}</td>
              <td className={`hidden sm:table-cell ${cellClass} ${mutedClass}`}>{status}</td>
              <td className={`${cellClass} text-right`}>{renderActions?.(member)}</td>
            </tr>
            {editor && <tr><td colSpan={4} className="p-3 sm:p-4">{editor}</td></tr>}
          </Fragment>
        })}
        {!members.length && <tr><td colSpan={4} className={`px-4 py-6 text-center ${mutedClass}`}>Nenhum membro neste espaço.</td></tr>}
      </tbody>
    </table>
  </div>
}

export function SharingInvitationTable<T extends SharingInvitationItem>({ invitations, renderActions }: {
  invitations: T[]
  renderActions?: (invitation: T) => ReactNode
}) {
  return <div className="table-shell">
    <table aria-label="Convites pendentes" className={tableClass}>
      <thead className={headClass}>
        <tr>
          <th scope="col" className="w-[70%] px-3 py-2.5 sm:w-[44%] sm:px-4">E-mail</th>
          <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Papel</th>
          <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Validade</th>
          <th scope="col" className="w-[30%] px-3 sm:w-28 sm:px-4"><span className="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody className={bodyClass}>
        {invitations.map(invitation => <tr key={invitation.id} className={rowClass}>
          <td className={cellClass}>
            <div className="flex items-start gap-2">
              <Mail aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span>{invitation.email}</span>
                <div className={`mt-1 space-y-0.5 text-xs sm:hidden ${mutedClass}`}>
                  <p>{roles[invitation.role] ?? invitation.role}</p>
                  <p>Até {dateText(invitation.expires_at)}</p>
                </div>
              </div>
            </div>
          </td>
          <td className={`hidden sm:table-cell ${cellClass} ${mutedClass}`}>{roles[invitation.role] ?? invitation.role}</td>
          <td className={`hidden sm:table-cell ${cellClass} ${mutedClass}`}>{dateText(invitation.expires_at)}</td>
          <td className={`${cellClass} text-right`}>{renderActions?.(invitation)}</td>
        </tr>)}
        {!invitations.length && <tr><td colSpan={4} className={`px-4 py-6 text-center ${mutedClass}`}>Nenhum convite pendente.</td></tr>}
      </tbody>
    </table>
  </div>
}

export function SharingSettlementTable<T extends SharingSettlementItem>({ members, money }: {
  members: T[]
  money: (cents: number) => string
}) {
  return <div className="table-shell">
    <table aria-label="Acerto do período" className={tableClass}>
      <thead className={headClass}>
        <tr>
          <th scope="col" className="w-[60%] px-3 py-2.5 sm:w-[28%] sm:px-4">Membro</th>
          <th scope="col" className="hidden px-4 py-2.5 text-right sm:table-cell">Contribuiu</th>
          <th scope="col" className="hidden px-4 py-2.5 text-right sm:table-cell">Parte nas despesas</th>
          <th scope="col" className="hidden px-4 py-2.5 text-right sm:table-cell">Saldo anterior restante</th>
          <th scope="col" className="w-[40%] px-3 py-2.5 text-right sm:w-[20%] sm:px-4">Acerto</th>
        </tr>
      </thead>
      <tbody className={bodyClass}>
        {members.map(member => {
          const situation = member.settlement_cents > 0 ? 'a receber' : member.settlement_cents < 0 ? 'a pagar' : 'acertado'
          const situationClass = member.settlement_cents > 0
            ? 'text-brand-600 dark:text-brand-400'
            : member.settlement_cents < 0 ? 'text-rose-600 dark:text-rose-400' : mutedClass
          return <tr key={member.member_id} className={rowClass}>
            <td className={cellClass}>
              <div className="flex items-start gap-2">
                <UserRound aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span>{member.nickname || 'Membro'}</span>
                  <div className={`mt-1 space-y-1 text-xs sm:hidden ${mutedClass}`}>
                    <p>Contribuiu: {money(member.contribution_cents)}</p>
                    <p>Parte nas despesas: {money(member.share_cents)}</p>
                    <p>Saldo anterior restante: {money(member.carry_remaining_cents)}</p>
                  </div>
                </div>
              </div>
            </td>
            <td className={`hidden sm:table-cell ${valueClass}`}>{money(member.contribution_cents)}</td>
            <td className={`hidden sm:table-cell ${valueClass}`}>{money(member.share_cents)}</td>
            <td className={`hidden sm:table-cell ${valueClass}`}>{money(member.carry_remaining_cents)}</td>
            <td className={`${valueClass} font-medium ${situationClass}`}>
              <span>{money(Math.abs(member.settlement_cents))}</span>
              <span className="mt-1 block text-xs font-normal">{situation}</span>
            </td>
          </tr>
        })}
        {!members.length && <tr><td colSpan={5} className={`px-4 py-6 text-center ${mutedClass}`}>Nenhum membro para calcular o acerto.</td></tr>}
      </tbody>
    </table>
  </div>
}

export function SharingTransferTable<T extends SharingTransferItem>({ transfers, money, renderRoute, renderActions, renderEditor }: {
  transfers: T[]
  money: (cents: number) => string
  renderRoute: (transfer: T) => ReactNode
  renderActions?: (transfer: T) => ReactNode
  renderEditor?: (transfer: T) => ReactNode
}) {
  return <div className="table-shell">
    <table aria-label="Transferências entre espaços" className={tableClass}>
      <thead className={headClass}>
        <tr>
          <th scope="col" className="hidden w-[16%] px-4 py-2.5 sm:table-cell">Data</th>
          <th scope="col" className="w-[46%] px-3 py-2.5 sm:w-[34%] sm:px-4">Espaços</th>
          <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Tipo</th>
          <th scope="col" className="w-[30%] px-3 py-2.5 text-right sm:w-[20%] sm:px-4">Valor</th>
          <th scope="col" className="w-[24%] px-3 sm:w-24 sm:px-4"><span className="sr-only">Ações</span></th>
        </tr>
      </thead>
      <tbody className={bodyClass}>
        {transfers.map(transfer => {
          const editor = renderEditor?.(transfer)
          const kind = transferKinds[transfer.kind] ?? transfer.kind
          return <Fragment key={transfer.id}>
            <tr className={rowClass}>
              <td className={`hidden sm:table-cell ${cellClass} ${mutedClass}`}>{dateText(transfer.occurred_on)}</td>
              <td className={cellClass}>
                <div className="flex items-start gap-2">
                  <ArrowLeftRight aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
                  <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    {renderRoute(transfer)}
                    <div className={`mt-1 space-y-0.5 text-xs sm:hidden ${mutedClass}`}>
                      <p>{dateText(transfer.occurred_on)}</p>
                      <p>{kind}</p>
                    </div>
                    {transfer.cancelled_at && <p className={`mt-1 text-xs ${mutedClass}`}>Cancelada</p>}
                  </div>
                </div>
              </td>
              <td className={`hidden sm:table-cell ${cellClass} ${mutedClass}`}>{kind}</td>
              <td className={`${valueClass} font-medium`}>{money(transfer.amount_cents)}</td>
              <td className={`${cellClass} text-right`}>{renderActions?.(transfer)}</td>
            </tr>
            {editor && <tr><td colSpan={5} className="p-3 sm:p-4">{editor}</td></tr>}
          </Fragment>
        })}
        {!transfers.length && <tr><td colSpan={5} className={`px-4 py-6 text-center ${mutedClass}`}>Nenhuma transferência registrada entre seus espaços.</td></tr>}
      </tbody>
    </table>
  </div>
}
