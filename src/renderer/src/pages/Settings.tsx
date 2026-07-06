import { useState } from 'react'

export default function Settings() {
  const [csvMessage, setCsvMessage] = useState('')
  const [backupMessage, setBackupMessage] = useState('')

  async function handleExportCsv() {
    setCsvMessage('')
    const result = await window.api.exportData.transactionsCsv()
    if (result.canceled) return
    setCsvMessage(`Exportado para ${result.path}`)
  }

  async function handleBackup() {
    setBackupMessage('')
    const result = await window.api.backup.create()
    if (result.canceled) return
    setBackupMessage(`Backup salvo em ${result.path}`)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Exportar dados</h2>
        <p className="mb-3 text-sm text-slate-500">Exporta todos os lançamentos para um arquivo CSV.</p>
        <button
          onClick={handleExportCsv}
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
        >
          Exportar transações (CSV)
        </button>
        {csvMessage && <p className="mt-2 text-xs text-emerald-600">{csvMessage}</p>}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Backup</h2>
        <p className="mb-3 text-sm text-slate-500">Salva uma cópia do banco de dados (financas.db) onde você escolher.</p>
        <button
          onClick={handleBackup}
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
        >
          Fazer backup do banco de dados
        </button>
        {backupMessage && <p className="mt-2 text-xs text-emerald-600">{backupMessage}</p>}
      </div>
    </div>
  )
}
