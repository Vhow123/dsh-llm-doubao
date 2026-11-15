/**
 * 豆包登录态（cookie）来源管理。
 *
 * 优先级：插件配置 cookie > 环境变量 DOUBAO_COOKIE > cookie 文件（默认 .data/doubao-cookies.json）。
 * cookie 文件由 `node bin/login.mjs` 从豆包客户端 CDP 端口导出。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const REQUIRED = 'sessionid';

/** 粗略校验 cookie 是否可以拿去做请求。 */
export function looksUsable(cookie) {
  const value = String(cookie || '');
  if (!value.includes(`${REQUIRED}=`)) return false;
  // sessionid 值不能为空
  const m = value.match(/sessionid=([^;]*)/);
  return Boolean(m && m[1] && m[1].length > 8);
}

/** 从 cookie 串里解析出若干关键值（用于 query 参数）。 */
export function parseCookieIds(cookie) {
  const get = (name) => {
    const m = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : '';
  };
  const deviceId = get('device_id') || get('_tea_web_id') || '885522549225145';
  return {
    deviceId: deviceId || '885522549225145',
    webId: get('web_id') || '7691453857067959859',
    teaUuid: get('tea_uuid') || deviceId || '885522549225145',
  };
}

/** 读取 cookie 文件。 */
export function readCookieFile(file) {
  if (!file || !existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (typeof parsed === 'string') return parsed;
    if (typeof parsed?.cookieHeader === 'string') return parsed.cookieHeader;
    if (Array.isArray(parsed?.cookies)) {
      return parsed.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    }
    return null;
  } catch {
    return null;
  }
}

/** 写 cookie 文件（bin/login.mjs 与插件共用）。 */
export function writeCookieFile(file, cookieHeader, cookies = []) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const payload = {
    savedAt: new Date().toISOString(),
    cookieHeader,
    cookieLength: cookieHeader.length,
    usable: looksUsable(cookieHeader),
    cookies: cookies.length ? cookies : cookieHeader.split('; ').map((pair) => {
      const idx = pair.indexOf('=');
      return { name: pair.slice(0, idx), value: pair.slice(idx + 1) };
    }),
  };
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

/**
 * 创建一个带缓存与失效重读的 cookie 提供者。
 * @param {object} opts
 * @param {string} [opts.cookie] 配置里直接写的 cookie
 * @param {string} [opts.cookieEnv] 环境变量名
 * @param {string} [opts.cookieFile] cookie 文件路径
 * @param {number} [opts.ttlMs] 文件缓存时长
 * @param {(level:string,msg:string)=>void} [opts.logger]
 */
export function createCookieProvider(opts = {}) {
  const ttlMs = Number(opts.ttlMs) || 30_000;
  const logger = opts.logger || (() => {});
  let cached = null;
  let cachedAt = 0;
  let fileStamp = 0;

  function readSources({ force = false } = {}) {
    if (opts.cookie && looksUsable(opts.cookie)) return { cookie: String(opts.cookie), source: 'config' };
    const envName = opts.cookieEnv || 'DOUBAO_COOKIE';
    const env = process.env[envName];
    if (env && looksUsable(env)) return { cookie: String(env), source: `env:${envName}` };
    const fromFile = readCookieFile(opts.cookieFile);
    if (fromFile && looksUsable(fromFile)) return { cookie: fromFile, source: 'file' };
    if (fromFile) {
      logger('warn', 'cookie 文件存在但没有可用的 sessionid');
    }
    return { cookie: '', source: 'none' };
  }

  return {
    /** 拿 cookie（带 TTL 缓存）。 */
    get({ force = false } = {}) {
      const now = Date.now();
      if (!force && cached && now - cachedAt < ttlMs) return cached;
      const result = readSources({ force });
      if (result.cookie) {
        cached = result;
        cachedAt = now;
      } else {
        cached = null;
      }
      return result;
    },
    /** 强制重读（例如上游 401 后）。 */
    refresh() {
      const result = readSources({ force: true });
      cached = result.cookie ? result : null;
      cachedAt = Date.now();
      return result;
    },
    /** 直接覆盖内存里的 cookie（配置变更时用）。 */
    set(cookie) {
      cached = { cookie: String(cookie || ''), source: 'config' };
      cachedAt = Date.now();
    },
    get file() {
      return opts.cookieFile;
    },
  };
}

/** 默认 cookie 文件路径：插件目录下 .data/doubao-cookies.json。 */
export function defaultCookieFile(pluginRoot) {
  return join(pluginRoot, '.data', 'doubao-cookies.json');
}
