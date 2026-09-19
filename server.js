#!/usr/bin/env node
/**
 * 本地开发服务器（不需要 Cloudflare 账号）
 *
 *   node server.js            # 内存数据库（重启即重置）
 *   node server.js --file     # 落盘到 data/learnhub.db（重启不丢）
 *
 * 它用 Node 的 http 模块 + 一个 Fetch 适配器，把「和 Workers 完全相同」的应用跑起来。
 * 真正部署到 Cloudflare 用 `npx wrangler dev`（走真 D1），代码一行不用改。
 */
import path from 'node:path';

import { bootstrap, ROOT } from './src/bootstrap.js';
import { createNodeServer, makeStaticReader } from './src/node-adapter.js';

const useFile = process.argv.includes('--file');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const dbFile = useFile ? path.join(ROOT, 'data', 'learnhub.db') : ':memory:';

const { app, env, statements } = await bootstrap({
  file: dbFile,
  readStatic: makeStaticReader(path.join(ROOT, 'public')),
  env: {
    LEARNHUB_SECRET: process.env.LEARNHUB_SECRET || 'dev-only-change-me-in-production',
    LEARNHUB_PLATFORM_API_KEY: process.env.LEARNHUB_PLATFORM_API_KEY || '',
    LEARNHUB_DAILY_AI_LIMIT: process.env.LEARNHUB_DAILY_AI_LIMIT || '3',
  },
});

console.log(`[db] 已应用建表脚本（${statements} 条语句）→ ${useFile ? dbFile : '内存数据库'}`);
console.log('[seed] 演示数据就绪：admin@ / teacher@ / student@demo.edu（密码 demo1234），邀请码 DEMO01');

await createNodeServer(app, { env, port: PORT, host: HOST });

console.log(`\n  LearnHub (local dev)  →  http://${HOST}:${PORT}`);
console.log('  演示账号：admin@demo.edu / teacher@demo.edu / student@demo.edu');
console.log('  密码：demo1234    课程邀请码：DEMO01');
console.log('  生产部署：npx wrangler dev（走真 D1）\n');
