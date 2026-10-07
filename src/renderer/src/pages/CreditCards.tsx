import { useCurrencyFormatter } from '../lib/useCurrencyFormatter'
import { useState } from 'react'
import { CreditCard as CreditCardIcon } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import PageHeader from '../components/PageHeader'
import CardTable from '../components/CardTable'
import CurrencyInput, { parseCurrencyToNumber } from '../components/CurrencyInput'

export default function CreditCards() {
  const formatCurrency = useCurrencyFormatter()
  const creditCards = useAppStore((s) => s.creditCards)
  const accounts = useAppStore((s) => s.accounts)
  const addCreditCard = useAppStore((s) => s.addCreditCard)
  const removeCreditCard = useAppStore((s) => s.removeCreditCard)

  const [nome, setNome] = useState('')
  const [tipoCartao, setTipoCartao] = useState<'both' | 'credit' | 'debit'>('both')
  const [limite, setLimite] = useState('')
  const [diaFechamento, setDiaFechamento] = useState('1')
  const [diaVencimento, setDiaVencimento] = useState('10')
  const [contaPagamentoId, setContaPagamentoId] = useState<number | ''>('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return
    setSubmitting(true)
    try {
      await addCreditCard({
        nome: nome.trim(),
        limite: tipoCartao === 'debit' ? 0 : parseCurrencyToNumber(limite),
        dia_fechamento: tipoCartao === 'debit' ? 1 : Number(diaFechamento),
        dia_vencimento: tipoCartao === 'debit' ? 10 : Number(diaVencimento),
        conta_pagamento_id: contaPagamentoId ? Number(contaPagamentoId) : null,
        tipo_cartao: tipoCartao
      })
      setNome('')
      setLimite('')
      setTipoCartao('both')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={CreditCardIcon} title="Cartões" subtitle="Cartões de crédito e faturas" />

      <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label htmlFor="legacy-card-name" className="field-label">Nome</label>
          <input
            id="legacy-card-name"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="field-input"
            placeholder="Ex: Nubank Mastercard"
            required
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label htmlFor="legacy-card-type" className="field-label">Tipo do cartão</label>
          <select
            id="legacy-card-type"
            value={tipoCartao}
            onChange={(e) => setTipoCartao(e.target.value as 'both' | 'credit' | 'debit')}
            className="field-input"
          >
            <option value="both">Débito e Crédito</option>
            <option value="credit">Apenas Crédito</option>
            <option value="debit">Apenas Débito</option>
          </select>
        </div>
        {tipoCartao !== 'debit' && (
          <>
            <div className="flex w-full flex-col gap-1 sm:w-auto">
              <label htmlFor="legacy-card-limit" className="field-label">Limite</label>
              <CurrencyInput
                id="legacy-card-limit"
                value={limite}
                onChange={(e) => setLimite(e.target.value)}
                className="w-full sm:w-32"
              />
            </div>
            <div className="flex w-full flex-col gap-1 sm:w-auto">
              <label htmlFor="legacy-card-closing-day" className="field-label">Dia fechamento</label>
              <input
                id="legacy-card-closing-day"
                type="number"
                min="1"
                max="31"
                value={diaFechamento}
                onChange={(e) => setDiaFechamento(e.target.value)}
                className="field-input w-full sm:w-24"
              />
            </div>
            <div className="flex w-full flex-col gap-1 sm:w-auto">
              <label htmlFor="legacy-card-due-day" className="field-label">Dia vencimento</label>
              <input
                id="legacy-card-due-day"
                type="number"
                min="1"
                max="31"
                value={diaVencimento}
                onChange={(e) => setDiaVencimento(e.target.value)}
                className="field-input w-full sm:w-24"
              />
            </div>
          </>
        )}
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label htmlFor="legacy-card-payment-account" className="field-label">
            {tipoCartao === 'debit' ? 'Conta vinculada (débito)' : 'Conta de pagamento'}
          </label>
          <select
            id="legacy-card-payment-account"
            value={contaPagamentoId}
            onChange={(e) => setContaPagamentoId(e.target.value ? Number(e.target.value) : '')}
            className="field-input"
            required={tipoCartao === 'debit'}
          >
            <option value="">{tipoCartao === 'debit' ? 'Selecione a conta' : 'Nenhuma'}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={submitting} className="btn-primary">
          Adicionar cartão
        </button>
      </form>

      <CardTable
        cards={creditCards.map(card => ({
          id: card.id,
          name: card.nome,
          cardType: card.tipo_cartao ?? 'both',
          limit: formatCurrency(card.limite),
          used: <span className={card.fatura_atual > card.limite ? 'font-medium text-red-500' : 'font-medium'}>{formatCurrency(card.fatura_atual)}</span>,
          available: <span className={card.fatura_atual > card.limite ? 'text-red-500' : undefined}>{formatCurrency(card.limite - card.fatura_atual)}</span>,
          closingDay: card.dia_fechamento,
          dueDay: card.dia_vencimento,
          paymentAccount: accounts.find(account => account.id === card.conta_pagamento_id)?.nome,
          period: `${card.fatura_inicio} a ${card.fatura_fim}`
        }))}
        renderName={card => <div>
          <span>{card.name}</span>
          {card.paymentAccount && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{card.paymentAccount}</p>}
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{card.period}</p>
        </div>}
        renderActions={card => <button type="button" onClick={() => removeCreditCard(card.id)} className="btn-danger-text">Excluir</button>}
      />
    </div>
  )
}
