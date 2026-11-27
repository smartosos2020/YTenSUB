import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { Env } from '../../server/src/index'

type D1Database = Env['DB']

interface SqliteStatement {
  get: (...params: unknown[]) => Record<string, unknown> | undefined
  all: (...params: unknown[]) => Record<string, unknown>[]
  run: (...params: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint }
}

interface SqliteDatabase {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (location: string) => SqliteDatabase
}

const migrationsDir = path.resolve(__dirname, '../../server/migrations')
const INIT_SQL = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
  .map((name) => fs.readFileSync(path.join(migrationsDir, name), 'utf8')).join('\n')

interface BoundStatement {
  sql: string
  params: unknown[]
}

export interface TestD1 {
  db: D1Database
  sqlite: SqliteDatabase
  /** 测试用故障注入：在 batch 中某条 SQL 上抛出错误，用于验证事务自动回滚 */
  failBatchOnSql?: (sql: string, index: number) => boolean
  close: () => void
}

/**
 * 基于 Node 内置 node:sqlite（真 SQLite 引擎）构建 Cloudflare D1 适配器：
 * - 按顺序执行所有真实 migrations/*.sql 建表语句与约束
 * - batch() 使用真 BEGIN IMMEDIATE / COMMIT / ROLLBACK 原子事务
 * - 每个异步方法插入微任务让步以真实触发 Promise.all 并发交错
 */
export function createSqliteD1(): TestD1 {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(INIT_SQL)

  const handle: TestD1 = {
    sqlite,
    db: null as unknown as D1Database,
    close: () => sqlite.close()
  }

  const execStatement = (stmt: BoundStatement) => {
    const prepared = sqlite.prepare(stmt.sql)
    const trimmed = stmt.sql.trim().toUpperCase()
    const returnsRows =
      trimmed.startsWith('SELECT') || /\bRETURNING\b/i.test(stmt.sql)
    if (returnsRows) {
      const results = prepared.all(...stmt.params)
      return {
        success: true,
        results,
        meta: { changes: results.length, duration: 0, rows_read: results.length, rows_written: 0 }
      }
    }
    const info = prepared.run(...stmt.params)
    const changes = Number(info.changes)
    return {
      success: true,
      results: [],
      meta: { changes, duration: 0, rows_read: 0, rows_written: changes }
    }
  }

  const makePrepared = (sql: string, params: unknown[] = []) => ({
    sql,
    params,
    bind(...next: unknown[]) {
      return makePrepared(sql, next)
    },
    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      await Promise.resolve()
      const row = sqlite.prepare(sql).get(...params)
      if (!row) return null
      if (colName) return (row[colName] as T) ?? null
      return row as T
    },
    async all<T = Record<string, unknown>>() {
      await Promise.resolve()
      const results = sqlite.prepare(sql).all(...params) as T[]
      return {
        success: true,
        results,
        meta: { changes: 0, duration: 0, rows_read: results.length, rows_written: 0 }
      }
    },
    async run() {
      await Promise.resolve()
      return execStatement({ sql, params })
    }
  })

  handle.db = {
    prepare: (sql: string) => makePrepared(sql),
    async batch(statements: BoundStatement[]) {
      await Promise.resolve()
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const out = []
        for (let i = 0; i < statements.length; i++) {
          const stmt = statements[i]
          if (handle.failBatchOnSql?.(stmt.sql, i)) {
            throw new Error('simulated SQL failure mid-transaction')
          }
          out.push(execStatement(stmt))
        }
        sqlite.exec('COMMIT')
        return out
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
    }
  } as unknown as D1Database

  return handle
}
