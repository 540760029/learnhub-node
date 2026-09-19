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
  // 行内 UNIQUE（例如 email TEXT NOT NULL UNIQUE）也要算进去
  for (const m of sql.matchAll(/^\s*(\w+)\s+\w+[^,)]*\bUNIQUE\b/gim)) cols.add(m[1]);
  return cols;
}

export function sqliteToMysql(sql) {
  const indexed = collectIndexedColumns(sql);

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

  // 4) TEXT：索引/主键/外键用到的列必须是 VARCHAR(255)
  out = out.replace(/(\w+)\s+TEXT\b/gi, (full, col) => (
    indexed.has(col) ? `${col} VARCHAR(255)` : `${col} LONGTEXT`
  ));

  // 5) 外键：MySQL 语法与 SQLite 基本一致，保留 ON DELETE 子句
  //    （SQLite 的 ON DELETE SET NULL 也能被 MySQL 接受）

  // 6) CREATE INDEX：MySQL 没有 IF NOT EXISTS，改普通形式（重复会报错，由迁移器忽略）
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
