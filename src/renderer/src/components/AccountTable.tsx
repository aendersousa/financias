import { Fragment, type ReactNode } from 'react'

export const accountKindLabels: Record<string, string> = {
  checking: 'Conta corrente', payment: 'Conta de pagamento', savings: 'Poupança',
  wallet: 'Carteira', investment: 'Investimento', benefit: 'Benefício VR/VA', property: 'Bem'
}

interface AccountItem {
  id: string | number
  name: string
  type: string
  color?: string | null
  balance: ReactNode
}

export default function AccountTable<T extends AccountItem>({ accounts, renderName, renderActions, renderEditor }: {
  accounts: T[]
  renderName?: (account: T) => ReactNode
  renderActions?: (account: T) => ReactNode
  renderEditor?: (account: T) => ReactNode
}) {
  return <div className="table-shell">
    <table aria-label="Contas" className="w-full text-sm">
      <thead className="table-head uppercase tracking-wide dark:bg-slate-800/50">
        <tr><th scope="col" className="px-4 py-2.5">Conta</th><th scope="col" className="hidden px-4 py-2.5 sm:table-cell">Tipo</th><th scope="col" className="px-4 py-2.5 text-right">Saldo atual</th><th scope="col"><span className="sr-only">Ações</span></th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {accounts.map(account => {
          const editor = renderEditor?.(account)
          return <Fragment key={account.id}>
            <tr className="table-row-hover">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="account-color-dot h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: account.color ?? '#0ea5e9' }} />
                  {renderName ? renderName(account) : <span className="break-words">{account.name}</span>}
                </span>
              </td>
              <td className="hidden px-4 py-2.5 text-slate-500 dark:text-slate-400 sm:table-cell">{account.type}</td>
              <td className="px-4 py-2.5 text-right font-medium">{account.balance}</td>
              <td className="px-4 py-2.5 text-right">{renderActions?.(account)}</td>
            </tr>
            {editor && <tr><td colSpan={4} className="p-4">{editor}</td></tr>}
          </Fragment>
        })}
        {!accounts.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">Nenhuma conta cadastrada.</td></tr>}
      </tbody>
    </table>
  </div>
}
