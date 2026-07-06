import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { listTransactions } from './db/repositories/transactions'

function csvEscape(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export async function exportTransactionsCsv(window: BrowserWindow | null): Promise<{ canceled: boolean; path?: string }> {
  const options = {
    title: 'Exportar transações',
    defaultPath: 'transacoes.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  }
  const { canceled, filePath } = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return { canceled: true }

  const header = ['Data', 'Descrição', 'Conta', 'Categoria', 'Cartão', 'Tipo', 'Status', 'Valor']
  const lines = [header.join(';')]
  for (const t of listTransactions()) {
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

  fs.writeFileSync(filePath, '﻿' + lines.join('\r\n'), 'utf-8')
  return { canceled: false, path: filePath }
}

export async function backupDatabase(window: BrowserWindow | null): Promise<{ canceled: boolean; path?: string }> {
  const options = {
    title: 'Salvar backup do banco de dados',
    defaultPath: `financas-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'Banco SQLite', extensions: ['db'] }]
  }
  const { canceled, filePath } = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return { canceled: true }

  const dbPath = path.join(app.getPath('userData'), 'financas.db')
  fs.copyFileSync(dbPath, filePath)
  return { canceled: false, path: filePath }
}
