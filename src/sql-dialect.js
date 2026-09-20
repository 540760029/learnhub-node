/**
 * SQLite → MySQL 方言转换（用于国内云部署）
 *
 * 维护两份手写 schema 迟早会漂移，所以这里把 migrations/0001_schema.sql
 * （SQLite / D1 方言）机械地翻译成 MySQL 版本，构建时生成到
 * migrations/mysql/0001_schema.sql，唯一事实来源仍是那一份 SQLite schema。
 *
 * 覆盖的差异（与我们的 schema 实际用到的语法一一对应）：
 *   PRAGMA ...                  → 删除
 *   INTEGER PRIMARY KEY AUTOINCREMENT → INT NOT NULL AUTO_INCREMENT PRIMARY KEY
 *   INTEGER / REAL              → INT / DOUBLE
 *   TEXT                        → LONGTEXT（索引列会被改成 VARCHAR）
 *   REFERENCES t(id) ON DELETE CASCADE/SET NULL → 同样的 MySQL 外键子句
 *   CREATE INDEX IF NOT EXISTS  → MySQL 不支持，改为忽略重复错误
 *   INSERT OR IGNORE INTO       → INSERT IGNORE INTO
 *   ON CONFLICT(...) DO UPDATE SET col = excluded.col
 *                               → ON DUPLICATE KEY UPDATE col = VALUES(col)
 */

/** 出现在索引 / UNIQUE / 外键里的列需要有限长度，TEXT 要变 VARCHAR */
function collectIndexedColumns(sql) {
  const cols = new Set();
  const add = (raw) => {
    raw.split(',').forEach((c) => {
      const name = c.trim().replace(/^["'`]|["'`]$/g, '').split(/\s+/)[0];
      if (name) cols.add(name);
    });
  };
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX[^(]*\(([^)]*)\)/gi)) add(m[1]);
  for (const m of sql.matchAll(/UNIQUE\s*\(([^)]*)\)/gi)) add(m[1]);
  for (const m of sql.matchAll(/REFERENCES\s+\w+\s*\(([^)]*)\)/gi)) add(m[1]);
  // 行内 UNIQUE（例如 email TEXT NOT NULL UNIQUE）也要算进去。
  // 注意必须用 [^\n,)]* 而不是 [^,)]*：后者会跨行匹配，导致把别的行的
  // 关键字当成当前列的后缀，从而认错列名。
  for (const m of sql.matchAll(/^\s*(\w+)\s+\w+[^\n,)]*\bUNIQUE\b/gim)) cols.add(m[1]);
  return cols;
}

/**
 * 带 DEFAULT 的列也必须是有长度的类型。
 * MySQL 会报：BLOB, TEXT, GEOMETRY or JSON column 'x' can't have a default value
 * 所以 `cover_emoji TEXT NOT NULL DEFAULT '📘'` 这类必须转成 VARCHAR。
 */
function collectDefaultedColumns(sql) {
  const cols = new Set();
  for (const m of sql.matchAll(/^\s*(\w+)\s+\w+[^\n,)]*\bDEFAULT\b/gim)) cols.add(m[1]);
  return cols;
}

/**
 * 行内 PRIMARY KEY 的 TEXT 列同样需要长度。
 * MySQL 报：BLOB/TEXT column 'key' used in key specification without a key length
 * （settings.key 就踩了这个，它没有 DEFAULT 也不是索引列，只靠这条规则兜住）
 */
function collectInlinePrimaryKeys(sql) {
  const cols = new Set();
  for (const m of sql.matchAll(/^\s*(\w+)\s+\w+[^\n,)]*\bPRIMARY\s+KEY\b/gim)) cols.add(m[1]);
  return cols;
}

/**
 * MySQL 保留字（只列我们 schema 里可能撞上的）。
 * 撞上的列名必须用反引号包起来，否则报 ER_PARSE_ERROR。
 * 实测踩坑：settings.key 是保留字，`key LONGTEXT PRIMARY KEY` 直接语法错误。
 */
const MYSQL_RESERVED = new Set([
  'key', 'keys', 'values', 'order', 'group', 'by', 'select', 'from', 'where',
  'table', 'index', 'read', 'write', 'status', 'condition', 'interval', 'range',
  'rank', 'system', 'usage', 'default', 'desc', 'asc', 'limit', 'long', 'match',
  'option', 'primary', 'references', 'to', 'using', 'year', 'day', 'hour', 'minute',
]);

/** 给保留字列名加反引号 */
function quoteReservedIdentifiers(sql) {
  let out = sql;
  for (const word of MYSQL_RESERVED) {
    // 列定义位置：行首缩进 + 列名 + 类型/关键字
    out = out.replace(
      new RegExp(`^([ \\t]+)(${word})(?=\\s+(?:INT|DOUBLE|LONGTEXT|VARCHAR|TEXT|REAL|INTEGER)\\b)`, 'gim'),
      '$1`$2`',
    );
    // 出现在括号内（索引列、唯一约束、外键引用）
    out = out.replace(
      new RegExp(`([(,]\\s*)(${word})(?=\\s*[,)])`, 'gi'),
      '$1`$2`',
    );
    // SET x = ? 形式（运行时 SQL 也走同一规则，见 toMysqlSql）
  }
  return out;
}

export function sqliteToMysql(sql) {
  const indexed = collectIndexedColumns(sql);
  const defaulted = collectDefaultedColumns(sql);
  const inlinePk = collectInlinePrimaryKeys(sql);
  const mustBeShort = (col) => indexed.has(col) || defaulted.has(col) || inlinePk.has(col);

  let out = sql;

  // 1) 去掉 PRAGMA
  out = out.replace(/^\s*PRAGMA[^;]*;\s*$/gim, '');

  // 2) INTEGER PRIMARY KEY AUTOINCREMENT → MySQL 自增主键
  out = out.replace(
    /(\w+)\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi,
    '$1 INT NOT NULL AUTO_INCREMENT PRIMARY KEY',
  );

  // 3) 类型映射：只处理"单词后跟分隔符"的情况，避免误伤列名或注释
  out = out.replace(/\bINTEGER\b/gi, 'INT');
  out = out.replace(/\bREAL\b/gi, 'DOUBLE');

  // 4) TEXT → VARCHAR(255) 或 LONGTEXT
  //    需要有限长度的情况：被索引/唯一/外键引用、带 DEFAULT、或行内 PRIMARY KEY
  out = out.replace(/(\w+)\s+TEXT\b/gi, (full, col) => (
    mustBeShort(col) ? `${col} VARCHAR(255)` : `${col} LONGTEXT`
  ));

  // 5) 保留字列名加反引号（settings.key 等）
  out = quoteReservedIdentifiers(out);

  // 6) CREATE INDEX：MySQL（含 8.1）不支持 IF NOT EXISTS，那是 MariaDB 的扩展。
  //    实测报错：ERROR 1064 ... near 'IF NOT EXISTS idx_users_email ON users(email)'
  //    所以这里剥掉 IF NOT EXISTS；可重复执行改由 scripts/migrate-mysql.js 保证
  //    （它容忍 ER_DUP_KEYNAME / ER_TABLE_EXISTS_ERROR）。
  out = out.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/gi, 'CREATE $1INDEX');

  return out;
}

/** 把种子 SQL（INSERT OR IGNORE ...）翻成 MySQL */
export function sqliteSeedToMysql(sql) {
  let out = sql.replace(/^\s*--.*$/gm, '');            // 去注释，避免注释里的词被误判
  out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT IGNORE INTO');
  out = out.replace(
    /ON\s+CONFLICT\s*\(([^)]*)\)\s*DO\s+UPDATE\s+SET\s+([\s\S]*?)(?=;|$)/gi,
    (full, cols, assignments) => {
      const parts = assignments.split(',').map((a) => {
        const m = a.match(/\s*(\w+)\s*=\s*excluded\.(\w+)\s*/i);
        return m ? `${m[1]} = VALUES(${m[2]})` : a.trim();
      }).filter(Boolean);
      return `ON DUPLICATE KEY UPDATE ${parts.join(', ')}`;
    },
  );
  return out;
}

/** 把整个 schema + seed 转成 MySQL 可执行的多语句脚本 */
export function buildMysqlScript({ schema, seed }) {
  const header = [
    '-- ============================================================',
    '--  LearnHub MySQL 建库脚本',
    '--  由 scripts/make-mysql-sql.js 从 migrations/0001_schema.sql 自动生成，请勿手改。',
    '-- ============================================================',
    '',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 1;',
    '',
  ].join('\n');
  const body = sqliteToMysql(schema);
  const seedPart = seed ? `\n\n-- ---------------- 种子数据 ----------------\n${sqliteSeedToMysql(seed)}` : '';
  return `${header}${body}${seedPart}`;
}
