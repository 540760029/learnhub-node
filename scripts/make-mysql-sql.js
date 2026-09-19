#!/usr/bin/env node
/**
 * 生成 MySQL 建库脚本（国内云部署用）
 *
 *   node scripts/make-mysql-sql.js
 *
 * 从 migrations/0001_schema.sql（SQLite/D1 方言，唯一事实来源）自动翻译出
 * migrations/mysql/0001_schema.sql，避免两份手写 schema 长期漂移。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMysqlScript } from '../src/sql-dialect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const schema = fs.readFileSync(path.join(ROOT, 'migrations', '0001_schema.sql'), 'utf8');
const seedPath = path.join(ROOT, 'migrations', '0002_seed.sql');
const seed = fs.existsSync(seedPath) ? fs.readFileSync(seedPath, 'utf8') : '';

const outDir = path.join(ROOT, 'migrations', 'mysql');
fs.mkdirSync(outDir, { recursive: true });

const full = buildMysqlScript({ schema, seed });
const outFile = path.join(outDir, '0001_schema.sql');
fs.writeFileSync(outFile, full, 'utf8');

console.log(`已生成 ${path.relative(ROOT, outFile)}`);
console.log(`  schema ${schema.length} 字节 → 脚本 ${full.length} 字节${seed ? '（含种子数据）' : ''}`);

// 顺手做一个自检：不该再出现 SQLite 专有语法
const leftovers = [
  ['AUTOINCREMENT', /AUTOINCREMENT/i],
  ['PRAGMA', /PRAGMA/i],
  ['ON CONFLICT', /ON\s+CONFLICT/i],
  ['INSERT OR IGNORE', /INSERT\s+OR\s+IGNORE/i],
].filter(([, re]) => re.test(full)).map(([name]) => name);

if (leftovers.length) {
  console.warn(`⚠️  转换后仍残留 SQLite 语法：${leftovers.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('  自检通过：无 AUTOINCREMENT / PRAGMA / ON CONFLICT 残留');
}
