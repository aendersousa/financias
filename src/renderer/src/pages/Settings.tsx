import { useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { buildTransactionsCsv, downloadTextFile } from '../lib/download'
import { supabase } from '../lib/supabaseClient'
import PageHeader from '../components/PageHeader'

export default function Settings() {
  const accounts = useAppStore((s) => s.accounts)
  const categories = useAppStore((s) => s.categories)
  const transactions = useAppStore((s) => s.transactions)
  const creditCards = useAppStore((s) => s.creditCards)
  const bills = useAppStore((s) => s.bills)
  const goals = useAppStore((s) => s.goals)

  const [csvMessage, setCsvMessage] = useState('')
  const [jsonMessage, setJsonMessage] = useState('')

  function handleExportCsv() {
    const csv = buildTransactionsCsv(transactions)
    downloadTextFile(`transacoes-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8')
    setCsvMessage('Arquivo CSV baixado.')
  }

  function handleExportJson() {
    const data = { accounts, categories, transactions, creditCards, bills, goals }
    downloadTextFile(
      `financas-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(data, null, 2),
      'application/json'
    )
    setJsonMessage('Arquivo JSON baixado.')
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={SettingsIcon} title="Configurações" subtitle="Exportação de dados e conta" />

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Exportar dados</h2>
        <p className="mb-3 text-sm text-slate-500">Exporta todos os lançamentos para um arquivo CSV.</p>
        <button onClick={handleExportCsv} className="btn-primary">
          Exportar transações (CSV)
        </button>
        {csvMessage && <p className="mt-2 text-xs text-emerald-600">{csvMessage}</p>}
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Backup</h2>
        <p className="mb-3 text-sm text-slate-500">
          Seus dados ficam salvos no Supabase (com backups automáticos do lado deles). Aqui você pode baixar uma
          cópia local de tudo em JSON.
        </p>
        <button onClick={handleExportJson} className="btn-primary">
          Exportar todos os dados (JSON)
        </button>
        {jsonMessage && <p className="mt-2 text-xs text-emerald-600">{jsonMessage}</p>}
      </div>

      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Conta</h2>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-red-500/20 transition-opacity hover:opacity-90"
        >
          Sair da conta
        </button>
      </div>
    </div>
  )
}
