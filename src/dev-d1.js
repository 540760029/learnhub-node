/**
 * 让 Express 应用也能在普通 Node 里跑起来（本地开发 / 自动化测试用）
 *
 * 把 node:sqlite 包装成和 Cloudflare D1 一样的接口：
 *   prepare(sql).bind(...).first() / .all() / .run()   +  batch([...])
 *
 * 这样 src/app.js 只认 D1 接口，本地和线上行为一致；
 * 用 wrangler dev 时走的是真 D1（miniflare 模拟），用 node 时走这里。
 *
 * 注意：仅开发用途。生产部署到 Cloudflare 时用的是 D1 binding，与本文件无关。
 */
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  constructor(stmt, params = []) {
    this.stmt = stmt;
    this.params = params;
  }

  bind(...params) {
    return new Stmt(this.stmt, params);
  }

  async first() {
    const row = this.stmt.get(...this.params);
    return row === undefined ? null : row;
  }

  async all() {
    return { results: this.stmt.all(...this.params), success: true, meta: {} };
  }

  async run() {
    const r = this.stmt.run(...this.params);
    return {
      success: true,
      meta: { changes: Number(r.changes ?? 0), last_row_id: Number(r.lastInsertRowid ?? 0) },
    };
  }
}

export class LocalD1 {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql) {
    return new Stmt(this.db.prepare(sql));
  }

  async batch(statements) {
    const out = [];
    for (const s of statements) out.push(await s.run());
    return out;
  }

  /** 执行多语句脚本（建表 / 种子数据） */
  exec(sql) {
    this.db.exec(sql);
  }

  close() {
    this.db.close();
  }
}

/** 把 .sql 文件按 D1 的方式执行：D1 的 exec 不支持多语句，所以按分号切分逐条跑 */
export function runSqlScript(d1, sql) {
  const cleaned = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = cleaned
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) d1.db.exec(stmt);
  return statements.length;
}
