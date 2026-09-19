/**
 * Cloudflare Workers 入口
 *
 *   请求 → Fetch 风格路由（createApp）
 *            ├─ /api/*   → D1 数据库
 *            └─ 其他路径 → ASSETS 绑定（Workers Static Assets，即 public/ 目录）
 *
 * wrangler.jsonc 关键配置：
 *   "main": "src/worker.js"
 *   "assets": { "directory": "./public/", "binding": "ASSETS", "run_worker_first": true }
 *   "d1_databases": [{ "binding": "DB", ... }]
 *
 * 说明：不使用 Express —— 它依赖 req.socket，而 Workers 的 Request 没有 socket，
 * 实测任何 Express 应用在 Workers 上都会 500。这里用 Fetch 标准 API，零依赖。
 */
import { createApp } from './app.js';
import { Db } from './db.js';

// 同一 isolate 内 env 是稳定的，缓存应用实例可省掉每请求的重复构造
let cachedApp = null;
let cachedKey = '';

export default {
  async fetch(request, env, ctx) {
    const key = `${env?.LEARNHUB_SECRET || ''}|${env?.LEARNHUB_SEED || ''}`;
    if (!cachedApp || cachedKey !== key) {
      cachedApp = createApp({ db: new Db(env.DB), env });
      cachedKey = key;
    }
    return cachedApp.handle(request, env, ctx);
  },
};
