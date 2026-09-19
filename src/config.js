/**
 * 运行时配置
 *
 * 所有配置通过 Cloudflare Worker 的 vars / secrets 注入：
 *   生产：wrangler secret put LEARNHUB_SECRET
 *   本地：wrangler.jsonc 的 vars（.dev.vars 可放本地密钥，已在 .gitignore）
 *
 * 注意：Workers 没有文件系统，所以这里不读 .env 文件，只读 env 绑定。
 */

export const DEFAULT_SECRET = 'dev-only-change-me-in-production';

/** settings 表里的键名 */
export const SK = {
  platformProvider: 'platform_ai_provider',
  platformKeyEnc: 'platform_ai_api_key_enc',
  platformBaseUrl: 'platform_ai_base_url',
  platformModel: 'platform_ai_model',
  platformEnabled: 'platform_ai_enabled',
  dailyLimit: 'daily_ai_limit',
};

export function getConfig(env) {
  const e = env || {};
  const secret = String(e.LEARNHUB_SECRET || DEFAULT_SECRET);
  return {
    secret,
    usingDefaultSecret: secret === DEFAULT_SECRET,
    defaultProvider: String(e.LEARNHUB_DEFAULT_PROVIDER || 'deepseek'),
    platformApiKey: String(e.LEARNHUB_PLATFORM_API_KEY || '').trim(),
    dailyAiLimit: Number(e.LEARNHUB_DAILY_AI_LIMIT || 3),
    tokenTtl: Number(e.LEARNHUB_TOKEN_TTL || 7 * 24 * 3600),
    // 前端静态资源目录（wrangler assets binding 名）
    assetsBinding: 'ASSETS',
  };
}
