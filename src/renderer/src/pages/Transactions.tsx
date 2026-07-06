import { useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { formatCurrency, formatDate, todayIso } from '../lib/format'
import type { CategoryType, TransactionStatus } from '../../../shared/types'

export default function Transactions() {
  const accounts = useAppStore((s) => s.accounts)
  const categories = useAppStore((s) => s.categories)
  const transactions = useAppStore((s) => s.transactions)
  const creditCards = useAppStore((s) => s.creditCards)
  const addTransaction = useAppStore((s) => s.addTransaction)
  const addInstallmentPurchase = useAppStore((s) => s.addInstallmentPurchase)
  const removeTransaction = useAppStore((s) => s.removeTransaction)

  const [tipo, setTipo] = useState<CategoryType>('despesa')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [valor, setValor] = useState('')
  const [data, setData] = useState(todayIso())
  const [descricao, setDescricao] = useState('')
  const [status, setStatus] = useState<TransactionStatus>('pago')
  const [cartaoId, setCartaoId] = useState<number | ''>('')
  const [parcelas, setParcelas] = useState('1')
  const [submitting, setSubmitting] = useState(false)

  const [filtroInicio, setFiltroInicio] = useState('')
  const [filtroFim, setFiltroFim] = useState('')

  const categoriasFiltradas = useMemo(() => categories.filter((c) => c.tipo === tipo), [categories, tipo])

  const transacoesFiltradas = useMemo(
    () =>
      transactions.filter((t) => {
        if (filtroInicio && t.data < filtroInicio) return false
        if (filtroFim && t.data > filtroFim) return false
        return true
      }),
    [transactions, filtroInicio, filtroFim]
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!accountId || !categoryId || !valor) return
    const numParcelas = Number(parcelas) || 1
    setSubmitting(true)
    try {
      if (cartaoId && numParcelas > 1) {
        await addInstallmentPurchase({
          account_id: Number(accountId),
          category_id: Number(categoryId),
          cartao_id: Number(cartaoId),
          valor_total: Number(valor),
          parcelas: numParcelas,
          data,
          descricao,
          status
        })
      } else {
        await addTransaction({
          account_id: Number(accountId),
          category_id: Number(categoryId),
          tipo,
          valor: Number(valor),
          data,
          descricao,
          status,
          cartao_id: cartaoId ? Number(cartaoId) : null
        })
      }
      setValor('')
      setDescricao('')
      setParcelas('1')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Tipo</label>
          <select
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as CategoryType)
              setCategoryId('')
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Conta</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            required
          >
            <option value="">Selecione</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Categoria</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            required
          >
            <option value="">Selecione</option>
            {categoriasFiltradas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Valor {cartaoId && Number(parcelas) > 1 ? 'total' : ''}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="w-28 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Data</label>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Descrição</label>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            placeholder="Opcional"
          />
        </div>
        {tipo === 'despesa' && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Cartão</label>
              <select
                value={cartaoId}
                onChange={(e) => {
                  setCartaoId(e.target.value ? Number(e.target.value) : '')
                  if (!e.target.value) setParcelas('1')
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="">Nenhum</option>
                {creditCards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            {cartaoId && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Parcelas</label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={parcelas}
                  onChange={(e) => setParcelas(e.target.value)}
                  className="w-20 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            )}
          </>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TransactionStatus)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="pago">Pago</option>
            <option value="pendente">Pendente</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          Lançar
        </button>
      </form>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">De</label>
          <input
            type="date"
            value={filtroInicio}
            onChange={(e) => setFiltroInicio(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Até</label>
          <input
            type="date"
            value={filtroFim}
            onChange={(e) => setFiltroFim(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        {(filtroInicio || filtroFim) && (
          <button
            onClick={() => {
              setFiltroInicio('')
              setFiltroFim('')
            }}
            className="text-xs text-slate-500 hover:underline"
          >
            Limpar filtro
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2">Descrição</th>
              <th className="px-4 py-2">Conta</th>
              <th className="px-4 py-2">Categoria</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Valor</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {transacoesFiltradas.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-2 text-slate-500">{formatDate(t.data)}</td>
                <td className="px-4 py-2">{t.descricao || '-'}</td>
                <td className="px-4 py-2">
                  {t.conta_nome}
                  {t.cartao_nome && <span className="ml-1 text-xs text-slate-400">({t.cartao_nome})</span>}
                </td>
                <td className="px-4 py-2">{t.categoria_nome}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      t.status === 'pago'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                    }`}
                  >
                    {t.status === 'pago' ? 'Pago' : 'Pendente'}
                  </span>
                </td>
                <td className={`px-4 py-2 text-right font-medium ${t.tipo === 'receita' ? 'text-green-600' : 'text-red-500'}`}>
                  {t.tipo === 'receita' ? '+' : '-'}
                  {formatCurrency(t.valor)}
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => removeTransaction(t.id)} className="text-xs text-red-500 hover:underline">
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {transacoesFiltradas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Nenhum lançamento no período selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
