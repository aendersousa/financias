export interface Migration {
  version: number
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('corrente','poupanca','carteira','investimento')),
        saldo_inicial REAL NOT NULL DEFAULT 0,
        cor TEXT NOT NULL DEFAULT '#64748b'
      );

      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('receita','despesa')),
        cor TEXT NOT NULL DEFAULT '#64748b',
        icone TEXT
      );

      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        tipo TEXT NOT NULL CHECK (tipo IN ('receita','despesa')),
        valor REAL NOT NULL,
        data TEXT NOT NULL,
        descricao TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('pago','pendente')) DEFAULT 'pago',
        cartao_id INTEGER,
        recorrencia_id INTEGER
      );
      CREATE INDEX idx_transactions_account ON transactions(account_id);
      CREATE INDEX idx_transactions_category ON transactions(category_id);
      CREATE INDEX idx_transactions_data ON transactions(data);

      CREATE TABLE credit_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        limite REAL NOT NULL DEFAULT 0,
        dia_fechamento INTEGER NOT NULL,
        dia_vencimento INTEGER NOT NULL,
        conta_pagamento_id INTEGER REFERENCES accounts(id)
      );

      CREATE TABLE bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        descricao TEXT NOT NULL,
        valor REAL NOT NULL,
        vencimento TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('pagar','receber')),
        status TEXT NOT NULL CHECK (status IN ('pendente','pago')) DEFAULT 'pendente',
        recorrencia TEXT,
        conta_id INTEGER REFERENCES accounts(id)
      );

      CREATE TABLE budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        categoria_id INTEGER NOT NULL REFERENCES categories(id),
        mes_ano TEXT NOT NULL,
        valor_planejado REAL NOT NULL,
        UNIQUE(categoria_id, mes_ano)
      );

      CREATE TABLE goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        valor_alvo REAL NOT NULL,
        valor_atual REAL NOT NULL DEFAULT 0,
        prazo TEXT
      );
    `
  }
]
