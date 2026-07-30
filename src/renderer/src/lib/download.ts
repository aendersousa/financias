export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function csvEscape(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function buildTransactionsCsv(
  transactions: {
    data: string
    descricao: string
    conta_nome: string
    categoria_nome: string
    cartao_nome: string | null
    tipo: string
    status: string
    valor: number
  }[]
): string {
  const header = ['Data', 'Descrição', 'Conta', 'Categoria', 'Cartão', 'Tipo', 'Status', 'Valor']
  const lines = [header.join(';')]
  for (const t of transactions) {
    lines.push(
      [
        t.data,
        csvEscape(t.descricao),
        csvEscape(t.conta_nome),
        csvEscape(t.categoria_nome),
        csvEscape(t.cartao_nome ?? ''),
        t.tipo,
        t.status,
        t.valor.toFixed(2).replace('.', ',')
      ].join(';')
    )
  }
  return '﻿' + lines.join('\r\n')
}
