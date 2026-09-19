#!/usr/bin/env node
/**
 * 本地开发服务器（不需要 Cloudflare 账号）
 *
 *   node server.js                 # 内存 SQLite（重启即重置）
 *   node server.js --file          # 落盘 data/learnhub.db（重启不丢）
 *   node server.js --mysql         # 连 MySQL（国内云同款配置，需 LEARNHUB_DB_URL）
 *
 * 业务代码与 Cloudflare Workers 完全一致，只是换了个驱动。
 */
import path from 'node:path';

import { bootstrap, ROOT } from './src/bootstrap.js';
import { createNodeServer, makeStaticReader } from './src/node-adapter.js';

const args = process.argv.slice(2);
const useFile = args.includes('--file');
const useMysql = args.includes('--mysql');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const env = {
  LEARNHUB_SECRET: process.env.LEARNHUB_SECRET || 'dev-only-change-me-in-production',
  LEARNHUB_PLATFORM_API_KEY: process.env.LEARNHUB_PLATFORM_API_KEY || '',
  LEARNHUB_DAILY_AI_LIMIT: process.env.LEARNHUB_DAILY_AI_LIMIT || '3',
  LEARNHUB_DEFAULT_PROVIDER: process.env.LEARNHUB_DEFAULT_PROVIDER || 'deepseek',
};

let driver = null;
let dbLabel;

if (useMysql) {
  const url = process.env.LEARNHUB_DB_URL;
  if (!url) {
    console.error('❌ --mysql 需要设置 LEARNHUB_DB_URL，例如：');
    console.error('   set LEARNHUB_DB_URL=mysql://user:pass@127.0.0.1:3306/learnhub');
    process.exit(1);
  }
  env.LEARNHUB_DB_DRIVER = 'mysql';
  env.LEARNHUB_DB_URL = url;
  dbLabel = `MySQL（${url.replace(/:[^:@/]*@/, ':***@')}）`;
} else {
  dbLabel = useFile ? path.join(ROOT, 'data', 'learnhub.db') : '内存 SQLite';
}

const { app, env: bootEnv, statements, driver: drv } = await bootstrap({
  file: useFile ? path.join(ROOT, 'data', 'learnhub.db') : ':memory:',
  readStatic: makeStaticReader(path.join(ROOT, 'public')),
  env,
  // MySQL 的表结构需要先执行 npm run db:mysql，这里不重复建表
  schema: !useMysql,
});
driver = drv;

console.log(`[db] 驱动=${driver.kind}（方言 ${driver.dialect}）→ ${dbLabel}`);
if (statements) console.log(`[db] 已应用建表脚本（${statements} 条语句）`);
console.log('[seed] 演示数据就绪：admin@ / teacher@ / student@demo.edu（密码 demo1234），邀请码 DEMO01');

await createNodeServer(app, { env: bootEnv, port: PORT, host: HOST });

console.log(`\n  LearnHub (local dev)  →  http://${HOST}:${PORT}`);
console.log('  演示账号：admin@demo.edu / teacher@demo.edu / student@demo.edu');
console.log('  密码：demo1234    课程邀请码：DEMO01');
console.log('  部署：Cloudflare 用 `npm run dev:worker`；国内云见 README 第十节\n');
