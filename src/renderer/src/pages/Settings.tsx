import { useState } from 'react'
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Info,
  RotateCcw,
  Settings as SettingsIcon
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { buildTransactionsCsv, downloadTextFile } from '../lib/download'
import { supabase } from '../lib/supabaseClient'
import PageHeader from '../components/PageHeader'
import {
  countEnabledModules,
  MODULE_DEFINITIONS,
  type ModuleKey
} from '../lib/modules'

type SettingsTab = 'general' | 'modules'

export default function Settings() {
  const accounts = useAppStore((s) => s.accounts)
  const categories = useAppStore((s) => s.categories)
  const transactions = useAppStore((s) => s.transactions)
  const creditCards = useAppStore((s) => s.creditCards)
  const bills = useAppStore((s) => s.bills)
  const goals = useAppStore((s) => s.goals)

  const modules = useAppStore((s) => s.modules)
  const isPageEnabled = useAppStore((s) => s.isPageEnabled)
  const disabledPages = useAppStore((s) => s.disabledPages)
  const toggleModule = useAppStore((s) => s.toggleModule)
  const enableAllModules = useAppStore((s) => s.enableAllModules)
  const resetModules = useAppStore((s) => s.resetModules)

  const [activeTab, setActiveTab] = useState<SettingsTab>('modules')
  const [moduleNotice, setModuleNotice] = useState('')

  const [csvMessage, setCsvMessage] = useState('')
  const [jsonMessage, setJsonMessage] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)

  const totalEnabled = MODULE_DEFINITIONS.filter((m) => isPageEnabled(m.key)).length

  function handleToggleModule(key: ModuleKey) {
    setModuleNotice('')
    const ok = toggleModule(key)
    if (!ok) {
      setModuleNotice('Pelo menos um módulo deve permanecer ativo para navegação no aplicativo.')
    }
  }

  function handleEnableAll() {
    enableAllModules()
    setModuleNotice('Todos os módulos foram ativados com sucesso.')
    setTimeout(() => setModuleNotice(''), 3000)
  }

  function handleResetDefaults() {
    resetModules()
    setModuleNotice('Configuração padrão dos módulos restaurada.')
    setTimeout(() => setModuleNotice(''), 3000)
  }

  function handleExportCsv() {
    const csv = buildTransactionsCsv(transactions)
    downloadTextFile(`transacoes-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8')
    setCsvMessage('Arquivo CSV baixado.')
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError('')
    setPasswordMessage('')
    setPasswordSubmitting(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        setPasswordError(error.message)
      } else {
        setPasswordMessage('Senha atualizada com sucesso.')
        setNewPassword('')
      }
    } finally {
      setPasswordSubmitting(false)
    }
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
      <PageHeader
        icon={SettingsIcon}
        title="Configurações"
        subtitle="Gerencie os módulos do sistema, exportação de dados e conta"
      />

      {/* Navegação por Abas */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'modules'}
          onClick={() => setActiveTab('modules')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
            activeTab === 'modules'
              ? 'border-emerald-500 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <Boxes size={17} />
          Módulos
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              activeTab === 'modules'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            {totalEnabled}/{MODULE_DEFINITIONS.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'general'}
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
            activeTab === 'general'
              ? 'border-emerald-500 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <SettingsIcon size={17} />
          Geral e Conta
        </button>
      </div>

      {/* Aba de Módulos */}
      {activeTab === 'modules' && (
        <div className="flex flex-col gap-5">
          <div className="card p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  Gerenciamento de Módulos
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Personalize sua experiência habilitando apenas os recursos que utiliza. Os módulos desativados são ocultados do menu lateral e do painel inicial.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={handleEnableAll}
                  className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  <CheckCircle2 size={14} />
                  Ativar todos
                </button>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:underline dark:text-slate-400"
                >
                  <RotateCcw size={14} />
                  Restaurar padrão
                </button>
              </div>
            </div>
          </div>

          {moduleNotice && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <AlertCircle size={18} className="shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{moduleNotice}</span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {MODULE_DEFINITIONS.map((mod) => {
              const Icon = mod.icon
              const isEnabled = isPageEnabled(mod.key)

              return (
                <div
                  key={mod.key}
                  className={`card flex flex-col justify-between p-4 transition-all ${
                    isEnabled
                      ? 'border-slate-200 dark:border-slate-800'
                      : 'border-slate-200/60 bg-slate-50/50 opacity-75 dark:border-slate-800/60 dark:bg-slate-900/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                          isEnabled
                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                            : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                        }`}
                      >
                        <Icon size={18} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {mod.name}
                        </h3>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                          {mod.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isEnabled}
                        aria-label={`${isEnabled ? 'Desabilitar' : 'Habilitar'} módulo ${mod.name}`}
                        onClick={() => handleToggleModule(mod.key)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-2 focus-visible:outline-emerald-500 ${
                          isEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                            isEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs dark:border-slate-800">
                    <span className="text-slate-400 dark:text-slate-500">Status</span>
                    <span
                      className={`font-semibold ${
                        isEnabled
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {isEnabled ? 'Habilitado' : 'Desabilitado'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
            <Info size={16} className="mt-0.5 shrink-0 text-slate-500" />
            <p>
              <strong>Segurança dos dados:</strong> Desabilitar um módulo apenas oculta seus acessos visuais no menu lateral e nos painéis. Todas as suas contas, transações, categorias e demais registros permanecem salvos com segurança no banco de dados.
            </p>
          </div>
        </div>
      )}

      {/* Aba Geral e Conta */}
      {activeTab === 'general' && (
        <div className="flex flex-col gap-6">
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
            <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Trocar senha</h2>
            <p className="mb-3 text-sm text-slate-500">Defina uma nova senha para sua conta.</p>
            <form onSubmit={handleChangePassword} className="flex flex-wrap items-end gap-3">
              <div className="flex w-full flex-col gap-1 sm:w-auto">
                <label className="field-label">Nova senha</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={6}
                  placeholder="••••••••"
                  className="field-input"
                  required
                />
              </div>
              <button type="submit" disabled={passwordSubmitting} className="btn-primary">
                {passwordSubmitting ? 'Salvando...' : 'Atualizar senha'}
              </button>
            </form>
            {passwordError && <p className="mt-2 text-xs text-red-500">{passwordError}</p>}
            {passwordMessage && <p className="mt-2 text-xs text-emerald-600">{passwordMessage}</p>}
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
      )}
    </div>
  )
}
