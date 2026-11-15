#!/usr/bin/env node
/**
 * 从豆包桌面客户端导出登录态（cookie）到插件数据目录。
 *
 * 用法：
 *   node bin/login.mjs                # 自动探测 CDP 端口；没有就带调试端口重启豆包客户端
 *   node bin/login.mjs --no-restart   # 只探测，不重启客户端
 *   node bin/login.mjs --port 9222
 *   node bin/login.mjs --print        # 额外打印 cookie 长度与关键字段（不打印完整值）
 *
 * 原理：豆包客户端是 Chromium 壳，用 --remote-debugging-port 启动后可以用
 * CDP 的 Network.getAllCookies 一次性拿到全部 HttpOnly cookie。
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksUsable, parseCookieIds } from '../lib/cookie.js';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_FILE = join(HERE, '.data', 'doubao-cookies.json');
const DOUBAO_EXE = 'D:\\Doubao\\app\\Doubao.exe';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const port = Number(value('--port', '9222'));
const allowRestart = !flag('--no-restart');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpTargets(p) {
  try {
    const response = await fetch(`http://127.0.0.1:${p}/json/list`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function restartDoubao() {
  console.log('→ 豆包客户端没有开调试端口，正在带 --remote-debugging-port 重启…');
  try {
    execFileSync('taskkill', ['/F', '/IM', 'Doubao.exe'], { stdio: 'ignore' });
  } catch {
    /* 没在跑也无所谓 */
  }
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Start-Process -FilePath '${DOUBAO_EXE}' -ArgumentList '--remote-debugging-port=${port}','--remote-allow-origins=*'`,
  ], { stdio: 'ignore' });
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('CDP 连接超时')), 8000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); res(); }, { once: true });
      this.ws.addEventListener('error', (event) => { clearTimeout(timer); rej(new Error(`CDP 连接失败：${event?.message ?? 'error'}`)); }, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
      } catch {
        return;
      }
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve: res, reject: rej } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) rej(new Error(payload.error.message ?? 'cdp error'));
        else res(payload.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`CDP ${method} 超时`));
        }
      }, 15_000);
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* 忽略 */
    }
  }
}

function pickCookieDomain(cookie) {
  const domain = String(cookie?.domain ?? '');
  return domain.includes('doubao.com') || domain.includes('bytedance.com') || domain.endsWith('.volces.com');
}

async function main() {
  let targets = await cdpTargets(port);
  if (targets === null && allowRestart) {
    restartDoubao();
    for (let i = 0; i < 30; i += 1) {
      await sleep(1000);
      targets = await cdpTargets(port);
      if (targets !== null) break;
    }
  }
  if (targets === null) {
    console.error(`✗ 连不上豆包客户端调试端口 127.0.0.1:${port}`);
    console.error('  先启动：Start-Process "D:\\Doubao\\app\\Doubao.exe" -ArgumentList "--remote-debugging-port=9222"');
    process.exit(1);
  }

  const page = targets.find((t) => t.type === 'page' && String(t.url).includes('doubao-chat/chat'))
    ?? targets.find((t) => t.type === 'page');
  if (!page?.webSocketDebuggerUrl) {
    console.error('✗ 没找到可用的豆包页面 target');
    process.exit(1);
  }
  console.log(`→ 已连接页面：${page.url}`);

  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Network.enable');
  const { cookies } = await cdp.send('Network.getAllCookies');
  cdp.close();

  const wanted = (cookies ?? []).filter(pickCookieDomain);
  if (wanted.length === 0) {
    console.error('✗ 没有拿到 doubao.com 域 cookie，确认客户端已登录');
    process.exit(1);
  }

  // 相同 name 只保留一条（服务端按 path 优先，这里取最长 path）
  const merged = new Map();
  for (const cookie of wanted) {
    const prev = merged.get(cookie.name);
    if (!prev || String(cookie.path ?? '').length > String(prev.path ?? '').length) merged.set(cookie.name, cookie);
  }
  const list = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  const cookieHeader = list.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');

  if (!looksUsable(cookieHeader)) {
    console.error('✗ 导出的 cookie 里没有可用的 sessionid —— 客户端可能未登录');
    process.exit(1);
  }

  mkdirSync(dirname(DATA_FILE), { recursive: true });
  const payload = {
    savedAt: new Date().toISOString(),
    cookieHeader,
    cookieLength: cookieHeader.length,
    usable: true,
    ids: parseCookieIds(cookieHeader),
    cookies: list.map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expires: cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : 'session',
      valueLength: String(cookie.value).length,
    })),
  };
  writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`✓ 已导出 ${list.length} 条 cookie（${cookieHeader.length} 字符）→ ${DATA_FILE}`);
  const ids = parseCookieIds(cookieHeader);
  console.log(`  device_id=${ids.deviceId}  web_id=${ids.webId}`);
  const sessionid = list.find((cookie) => cookie.name === 'sessionid');
  if (sessionid) {
    const expires = sessionid.expires > 0 ? new Date(sessionid.expires * 1000).toISOString() : 'session';
    console.log(`  sessionid 长度 ${String(sessionid.value).length}，过期 ${expires}`);
  }
  if (flag('--print')) {
    console.log('  关键 cookie：', list.filter((c) => ['sessionid', 'sessionid_ss', 's_v_web_id', 'ttwid', 'sid_guard'].includes(c.name)).map((c) => c.name).join(', '));
  }
  console.log('  接下来：重启 DSH 或调用 POST /api/dsh-llm-doubao/cookie 让插件重读。');
}

main().catch((error) => {
  console.error(`✗ ${String(error?.message ?? error)}`);
  process.exit(1);
});
