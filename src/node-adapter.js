/**
 * Node HTTP ↔ Fetch 适配器
 *
 * 核心应用是 Fetch 风格的（function handle(request, env) -> Response），
 * 这样同一份代码既能跑在 Cloudflare Workers，也能跑在普通 Node 上。
 * 本文件只负责把 Node 的 http.IncomingMessage / ServerResponse 翻译成 Request/Response。
 *
 * 部署到 Cloudflare 时不需要它（Workers 原生就是 Fetch）。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * 构造本地静态资源读取器，交给 createApp 的 readStatic 选项。
 * 生产环境不需要它 —— Workers 由 ASSETS 绑定提供静态资源。
 *
 * 安全：解析后的绝对路径必须仍在 publicDir 之内，防止 ../ 穿越。
 */
export function makeStaticReader(publicDir) {
  const root = path.resolve(publicDir);
  return async function readStatic(relPath) {
    const clean = String(relPath || '/').split('?')[0];
    const target = path.resolve(root, '.' + (clean.startsWith('/') ? clean : '/' + clean));
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    try {
      if (!fs.statSync(target).isFile()) return null;
    } catch {
      return null;
    }
    const body = fs.readFileSync(target);
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': String(body.length),
      },
    });
  };
}

/** Node 请求 → 标准 Request */
export async function toFetchRequest(req, { origin = 'http://127.0.0.1' } = {}) {
  const url = new URL(req.url, origin);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, String(v));
  }

  const method = (req.method || 'GET').toUpperCase();
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
    if (body.length === 0) body = undefined;
  }
  return new Request(url.toString(), { method, headers, body });
}

/** 标准 Response → Node 响应 */
export async function sendFetchResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    // 避免与 Node 自带的 chunked/长度处理冲突
    if (key.toLowerCase() === 'content-encoding') return;
    try {
      res.setHeader(key, value);
    } catch { /* 忽略非法头 */ }
  });
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

/**
 * 启动一个 Node HTTP 服务器，把请求交给 Fetch 风格的 router
 * @returns {Promise<import('node:http').Server>}
 */
export function createNodeServer(router, { env = {}, port = 8787, host = '127.0.0.1' } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const request = await toFetchRequest(req, { origin: `http://${host}:${port}` });
      const response = await router.handle(request, env, {});
      await sendFetchResponse(res, response);
    } catch (err) {
      console.error('[node-adapter]', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify({ detail: '服务器内部错误' }));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}
