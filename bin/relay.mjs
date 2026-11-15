#!/usr/bin/env node
/**
 * 脱离 DSH 单独跑豆包反代，方便用 curl / 其它客户端验证。
 *
 *   node bin/relay.mjs                       # 127.0.0.1:8790，cookie 取 .data/doubao-cookies.json
 *   node bin/relay.mjs --port 8791
 *   node bin/relay.mjs --cookie "sessionid=..." 
 *   node bin/relay.mjs --login               # 先从豆包客户端导出 cookie 再启动
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { startRelay } from '../lib/relay.js';
import { createCookieProvider, defaultCookieFile } from '../lib/cookie.js';
import { MODELS, exposeModels, modelTable } from '../lib/catalog.js';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const PREF_FILE = join(process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'), 'dsh-llm-doubao.json');
const DEFAULT_LIST = ['deepseek-v4-pro', 'deepseek-v4.1-flash', 'kimi-k3.1-pro', 'glm-5.3', 'doubao-2.1-pro'];

function readPrefs() {
  try {
    return JSON.parse(readFileSync(PREF_FILE, 'utf8').replace(/^\uFEFF/, '')) ?? {};
  } catch {
    return {};
  }
}

function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  try {
    mkdirSync(dirname(PREF_FILE), { recursive: true });
    writeFileSync(PREF_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

const prefs = readPrefs();
const exposeState = {
  mode: typeof prefs.exposeMode === 'string' ? prefs.exposeMode : 'custom',
  list: Array.isArray(prefs.exposeList) ? prefs.exposeList : DEFAULT_LIST,
  autoRoute: prefs.autoRoute === true,
};

if (flag('--login')) {
  execFileSync(process.execPath, [join(HERE, 'bin', 'login.mjs')], { stdio: 'inherit' });
}

const cookieFile = value('--cookie-file', defaultCookieFile(HERE));
const provider = createCookieProvider({
  cookie: value('--cookie', ''),
  cookieEnv: value('--cookie-env', 'DOUBAO_COOKIE'),
  cookieFile,
  logger: { warn: (m) => console.warn(`[warn] ${m}`) },
});

const relay = await startRelay({
  host: value('--host', '127.0.0.1'),
  port: Number(value('--port', '8790')),
  localToken: value('--token', 'dsh-llm-doubao-local'),
  logDir: value('--log', join(HERE, '.data')),
  getCookie: () => provider.get().cookie,
  autoRoute: exposeState.autoRoute,
  listModelIds: () => exposeModels(exposeState.mode, exposeState.list).map((model) => model.id),
  onExpose: async (body) => {
    if (body?.__peek === true) {
      return {
        mode: exposeState.mode,
        shown: exposeModels(exposeState.mode, exposeState.list).map((model) => ({ id: model.id, name: model.name })),
        all: MODELS.map((model) => ({ id: model.id, name: model.name, tag: model.tag ?? '' })),
        autoRoute: exposeState.autoRoute,
        prefsFile: PREF_FILE,
      };
    }
    if (typeof body?.mode === 'string' && body.mode) exposeState.mode = body.mode;
    if (Array.isArray(body?.models)) {
      exposeState.list = body.models;
      exposeState.mode = 'custom';
    }
    if (typeof body?.autoRoute === 'boolean') exposeState.autoRoute = body.autoRoute;
    const saved = writePrefs({ exposeMode: exposeState.mode, exposeList: exposeState.list, autoRoute: exposeState.autoRoute });
    return {
      mode: exposeState.mode,
      shown: exposeModels(exposeState.mode, exposeState.list).map((model) => ({ id: model.id, name: model.name })),
      all: MODELS.map((model) => ({ id: model.id, name: model.name, tag: model.tag ?? '' })),
      autoRoute: exposeState.autoRoute,
      saved,
      prefsFile: PREF_FILE,
    };
  },
  logger: { info: (m) => console.log(`[info] ${m}`), warn: (m) => console.warn(`[warn] ${m}`), error: (m) => console.error(`[error] ${m}`) },
});

const cookie = provider.get();
const shownIds = new Set(exposeModels(exposeState.mode, exposeState.list).map((model) => model.id));
console.log(`反代已启动：${relay.baseURL}`);
console.log(`上游：https://www.doubao.com/chat/completion`);
console.log(`登录态：${cookie.cookie ? `${cookie.source}，${cookie.cookie.length} 字符` : '缺失（先跑 node bin/login.mjs）'}`);
console.log(`本地口令：Bearer ${value('--token', 'dsh-llm-doubao-local')}`);
console.log(`显示设置面板：http://127.0.0.1:${relay.port}/doubao/panel`);
console.log('');
console.log('模型（✓ = 当前显示在列表里）：');
for (const row of modelTable()) {
  const mark = shownIds.has(row.id) ? '✓' : ' ';
  console.log(`  [${mark}] ${row.id.padEnd(26)} ${row.name.padEnd(20)} ${String(row.tag).padEnd(16)} key=${row.key}`);
}
console.log('');
console.log('试试：');
console.log(`  curl -s ${relay.baseURL}/models -H "authorization: Bearer dsh-llm-doubao-local" | head -c 300`);
console.log(`  curl -s ${relay.baseURL}/chat/completions -H "authorization: Bearer dsh-llm-doubao-local" -H "content-type: application/json" -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"你是谁"}],"stream":true}'`);
console.log('');
console.log('改显示哪些模型：打开上面的面板，或 node bin/expose.mjs --set a,b,c');

const shutdown = async () => {
  await relay.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
