/**
 * 数据库驱动层 —— 让同一份业务代码既能跑 D1，也能跑 MySQL
 *
 * 三种驱动，接口完全一致（all / first / run / batch / execScript / isDuplicateError）：
 *   · d1     Cloudflare D1（部署到 Cloudflare 时用；本地 wrangler dev 也是它）
 *   · sqlite 本地开发用（node:sqlite 内置模块，零依赖，仅 Node 有）
 *   · mysql  国内云部署用（mysql2，按需加载；不用就不会被 require）
 *
 * 业务代码（src/app.js、src/db.js）只依赖这套接口，不关心底层是谁。
 */

// ==================================================================== D1
class D1Statement {
  constructor(stmt, params = []) {
    this.stmt = stmt;
    this.params = params;
  }

  bind(...params) {
    return new D1Statement(this.stmt, params);
  }

  async first() {
    return (await this.stmt.bind(...this.params).first()) ?? null;
  }

  async all() {
    const r = await this.stmt.bind(...this.params).all();
    return r.results ?? [];
  }

  async run() {
    const r = await this.stmt.bind(...this.params).run();
    return { changes: r.meta?.changes ?? 0, lastRowId: r.meta?.last_row_id ?? null };
  }
}

class D1Driver {
  constructor(binding) {
    if (!binding) throw new Error('缺少 D1 绑定（env.DB）');
    this.kind = 'd1';
    this.dialect = 'sqlite';
    this.binding = binding;
  }

  prepare(sql) {
    return new D1Statement(this.binding.prepare(sql));
  }

  async batch(statements) {
    return this.binding.batch(statements.map((s) => s.stmt.bind(...s.params)));
  }

  /** D1 的 exec 不支持多语句，需按分号切分逐条执行 */
  async execScript(sql) {
    const statements = splitStatements(sql);
    const results = [];
    for (const s of statements) results.push(await this.binding.prepare(s).run());
    return results.length;
  }

  isDuplicateError(err) {
    const msg = String(err?.message || err || '');
    return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(msg);
  }
}

// ==================================================================== SQLite（本地开发）
class SqliteStatement {
  constructor(stmt, params = []) {
    this.stmt = stmt;
    this.params = params;
  }

  bind(...params) {
    return new SqliteStatement(this.stmt, params);
  }

  async first() {
    const row = this.stmt.get(...this.params);
    return row === undefined ? null : row;
  }

  async all() {
    return this.stmt.all(...this.params);
  }

  async run() {
    const r = this.stmt.run(...this.params);
    return { changes: Number(r.changes ?? 0), lastRowId: Number(r.lastInsertRowid ?? 0) };
  }
}

class SqliteDriver {
  /**
   * @param {object} db node:sqlite 的 DatabaseSync 实例
   * @param {boolean} ownsDb 是否由本驱动负责关闭
   */
  constructor(db, ownsDb = true) {
    this.kind = 'sqlite';
    this.dialect = 'sqlite';
    this.db = db;
    this.ownsDb = ownsDb;
  }

  prepare(sql) {
    return new SqliteStatement(this.db.prepare(sql));
  }

  async batch(statements) {
    const out = [];
    for (const s of statements) out.push(await s.run());
    return out;
  }

  async execScript(sql) {
    const statements = splitStatements(sql);
    for (const s of statements) this.db.exec(s);
    return statements.length;
  }

  isDuplicateError(err) {
    const msg = String(err?.message || err || '');
    return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(msg);
  }

  close() {
    if (this.ownsDb) this.db.close();
  }
}

/**
 * 异步创建本地 SQLite 驱动。
 * 用带变量的动态 import，避免 Cloudflare 打包时静态分析到 node:sqlite
 * （Workers 没有这个内置模块，静态引用会直接构建失败）。
 */
export async function createSqliteDriver(file = ':memory:') {
  const specifier = 'node:' + 'sqlite';
  const { DatabaseSync } = await import(specifier);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  return new SqliteDriver(db);
}

// ==================================================================== MySQL（国内云）
/**
 * 把 SQLite 风格 SQL 转成 MySQL 可用的 SQL：
 *   · 参数占位符 ? 保留（mysql2 原生支持）
 *   · INSERT OR IGNORE  → INSERT IGNORE
 *   · ON CONFLICT(...) DO UPDATE SET a = excluded.b → ON DUPLICATE KEY UPDATE a = VALUES(b)
 */
export function toMysqlSql(sql) {
  let out = sql;
  if (/INSERT\s+OR\s+IGNORE/i.test(out)) {
    out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT IGNORE INTO');
  }
  if (/ON\s+CONFLICT/i.test(out)) {
    out = out.replace(
      /ON\s+CONFLICT\s*\(([^)]*)\)\s*DO\s+UPDATE\s+SET\s+([\s\S]*)$/i,
      (full, cols, assignments) => {
        const parts = assignments.split(',').map((a) => {
          const m = a.match(/\s*(\w+)\s*=\s*excluded\.(\w+)\s*/i);
          return m ? `${m[1]} = VALUES(${m[2]})` : a.trim();
        }).filter(Boolean);
        return `ON DUPLICATE KEY UPDATE ${parts.join(', ')}`;
      },
    );
  }
  // SQLite 里 INSERT IGNORE 语义相同，MySQL 也认；其余语法通用
  return quoteReservedForMysql(out);
}

/**
 * 保留字列名加反引号。
 *
 * 只处理 `key` —— 它是我们 schema 里唯一撞上 MySQL 保留字的标识符
 * （settings.key，出现在 SELECT / INSERT / UPDATE / WHERE 里）。
 * 实测不加会直接 500（ER_PARSE_ERROR）。
 *
 * 注意区分：PRIMARY KEY / FOREIGN KEY 里的 KEY 必须保持原样，
 * 所以这里只在 `key` 紧跟 , ) = 或 FROM/IN 边界时才加反引号。
 */
export function quoteReservedForMysql(sql) {
  return sql
    .replace(/\b(SELECT\s+|\()key(?=\s*[,)]|\s+FROM\b)/gi, '$1`key`')
    .replace(/(\bINTO\s+\w+\s*\(\s*)key(?=\s*[,)])/gi, '$1`key`')
    .replace(/\b(SET\s+|WHERE\s+|AND\s+|OR\s+)key(?=\s*=)/gi, '$1`key`')
    .replace(/\bkey(?=\s+IN\s*\()/gi, '`key`');
}

class MysqlStatement {
  constructor(driver, sql, params = []) {
    this.driver = driver;
    this.sql = toMysqlSql(sql);
    this.params = params;
  }

  bind(...params) {
    return new MysqlStatement(this.driver, this.sql, params);
  }

  async all() {
    const [rows] = await this.driver.pool.query(this.sql, this.params);
    return Array.isArray(rows) ? rows : [];
  }

  async first() {
    const rows = await this.all();
    return rows.length ? rows[0] : null;
  }

  async run() {
    const [res] = await this.driver.pool.query(this.sql, this.params);
    return {
      changes: Number(res?.affectedRows ?? 0),
      lastRowId: res?.insertId != null ? Number(res.insertId) : null,
    };
  }
}

class MysqlDriver {
  /**
   * @param {object} pool mysql2/promise 连接池
   * 说明：所有自增主键统一通过 lastRowId 返回，业务层只认这个字段。
   */
  constructor(pool) {
    this.kind = 'mysql';
    this.dialect = 'mysql';
    this.pool = pool;
  }

  prepare(sql) {
    return new MysqlStatement(this, sql);
  }

  async batch(statements) {
    const conn = await this.pool.getConnection();
    const out = [];
    try {
      await conn.beginTransaction();
      for (const s of statements) {
        const [res] = await conn.query(s.sql, s.params);
        out.push({
          changes: Number(res?.affectedRows ?? 0),
          lastRowId: res?.insertId != null ? Number(res.insertId) : null,
        });
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
    return out;
  }

  /** 执行迁移脚本：按分号切分，容忍索引重复创建 */
  async execScript(sql) {
    const statements = splitStatements(sql);
    let executed = 0;
    for (const s of statements) {
      try {
        await this.pool.query(toMysqlSql(s));
        executed += 1;
      } catch (err) {
        if (this.isDuplicateError(err)) continue;    // 索引/表已存在
        throw err;
      }
    }
    return executed;
  }

  isDuplicateError(err) {
    const code = err?.code || '';
    return code === 'ER_DUP_ENTRY' || code === 'ER_DUP_KEYNAME'
      || code === 'ER_TABLE_EXISTS_ERROR' || code === 'ER_MULTIPLE_PRI_KEY';
  }

  async close() {
    await this.pool.end();
  }
}

/** 连接 MySQL 并返回驱动（mysql2 按需加载，不用它就不会被 require） */
export async function createMysqlDriver({
  host, port = 3306, user, password, database, connectionLimit = 5,
}) {
  const name = 'mysql2/promise';
  const mysql = await import(name);
  const pool = mysql.createPool({
    host, port, user, password, database,
    waitForConnections: true,
    connectionLimit,
    charset: 'utf8mb4',
    // 多语句交给 execScript 自己切分，避免注入面变大
    multipleStatements: false,
  });
  await pool.query('SELECT 1');      // 尽早暴露连接错误
  return new MysqlDriver(pool);
}

// ==================================================================== 工厂
/**
 * 根据环境创建驱动。
 * 优先级：显式传入的 d1 绑定 > LEARNHUB_DB_DRIVER 指定 > 本地 sqlite
 */
export async function createDriver({ d1 = null, env = {}, fallbackSqliteFile = ':memory:' } = {}) {
  if (d1) return new D1Driver(d1);

  const driver = String(env.LEARNHUB_DB_DRIVER || '').toLowerCase();
  if (driver === 'mysql') {
    const url = String(env.LEARNHUB_DB_URL || '');
    if (!url) throw new Error('LEARNHUB_DB_DRIVER=mysql 时必须提供 LEARNHUB_DB_URL');
    return createMysqlDriver(parseMysqlUrl(url));
  }
  if (driver === 'd1') {
    if (!d1) throw new Error('LEARNHUB_DB_DRIVER=d1 但未提供 D1 绑定');
    return new D1Driver(d1);
  }
  // 默认：本地 SQLite（本地开发 / 测试）
  return createSqliteDriver(fallbackSqliteFile);
}

/** 解析 mysql://user:pass@host:port/db 形式的连接串 */
export function parseMysqlUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

/**
 * 按分号切分多语句脚本（用于迁移）。
 * 简单但够用：我们的 schema 里没有存储过程 / 触发器等含分号的语句。
 */
export function splitStatements(sql) {
  return String(sql)
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
