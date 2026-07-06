import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import path from 'node:path'
import { migrations } from './migrations'
import { seedDefaultCategories } from './seed'

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'financas.db')
  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(db)
  seedDefaultCategories(db)
  return db
}

function runMigrations(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as unknown as
    | { version: number }
    | undefined
  let hasVersionRow = row !== undefined
  const currentVersion = row?.version ?? 0

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue
    db.exec(migration.sql)
    if (hasVersionRow) {
      db.prepare('UPDATE schema_version SET version = ?').run(migration.version)
    } else {
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version)
      hasVersionRow = true
    }
  }
}
