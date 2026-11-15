/**
 * dsh-llm-doubao —— 把豆包桌面客户端的全部模型反代进 DSH Desktop。
 *
 * 结构：
 *   1. 本机起一个 OpenAI 兼容反代（默认 http://127.0.0.1:8790/v1），把
 *      /v1/chat/completions 与 /v1/models 转给豆包的 /chat/completion（用客户端登录态）；
 *   2. 用 settings 服务把 provider 热注入内置的 llm-pi-ai 插件，于是 DSH 的
 *      模型下拉里立刻出现豆包客户端那一整排模型，无需重启、无需手改 yml；
 *   3. 反代只监听回环地址，豆包 cookie 留在宿主进程里，DSH 侧永远拿不到。
 *
 * 模型别名（「自动」「DeepSeek V4 Pro」「Kimi K3.1 Pro 高速」等客户端显示名）由
 * lib/catalog.js 统一归一，DSH 与任意 OpenAI 客户端都可以直接用这些名字。
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { startRelay } from './lib/relay.js';
import { AUTO_DISPLAY_NAME, AUTO_ID, MODELS, exposeModels, piAiModels } from './lib/catalog.js';
import { createCookieProvider, defaultCookieFile, looksUsable, parseCookieIds, writeCookieFile } from './lib/cookie.js';

export { MODELS, piAiModels, exposeModels, pickAutoModel, AUTO_ID } from './lib/catalog.js';
export { startRelay } from './lib/relay.js';

export const name = 'dsh-llm-doubao';
export const inject = ['webServer'];

const API = '/api/dsh-llm-doubao';
const LOCAL_AUTH = 'Bearer dsh-llm-doubao-local';
const HERE = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  host: '127.0.0.1',
  port: 8790,
  cookie: '',
  cookieEnv: 'DOUBAO_COOKIE',
  cookieFile: '',
  providerId: 'doubao',
  displayName: '豆包 · 客户端',
  injectInto: 'llm-pi-ai',
  autoInject: true,
  // custom = 只显示 exposeList 里点名的模型（默认）；all = 12 个全显示
  exposeMode: 'custom',
  // 默认显示的 5 个常用模型，用 bin/expose.mjs 或 POST /expose 随时改
  exposeList: ['deepseek-v4-pro', 'deepseek-v4.1-flash', 'kimi-k3.1-pro', 'glm-5.3', 'doubao-2.1-pro'],
  // 是否让 auto 入口按请求特征自动挑模型（默认关，auto 就是豆包自己的自动档）
  autoRoute: false,
  logRequests: true,
  logDir: '',
  localToken: 'dsh-llm-doubao-local',
  upstreamTimeoutMs: 600_000,
  streamIdleMs: 600_000,
};

/** 用户自己的显示列表存在这里，重启后仍然生效。 */
const PREF_FILE = join(process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'), 'dsh-llm-doubao.json');

function readPrefs() {
  try {
    const text = readFileSync(PREF_FILE, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
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

function resolved(config) {
  const merged = { ...DEFAULTS };
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value !== undefined && value !== null && value !== '') merged[key] = value;
  }
  // 用户偏好文件优先级最高（GUI/CLI 改过的列表要能盖住 yml 默认值）
  const prefs = readPrefs();
  if (Array.isArray(prefs.exposeList)) merged.exposeList = prefs.exposeList;
  if (typeof prefs.exposeMode === 'string' && prefs.exposeMode) merged.exposeMode = prefs.exposeMode;
  if (typeof prefs.autoRoute === 'boolean') merged.autoRoute = prefs.autoRoute;
  if (typeof merged.port !== 'number' || !Number.isInteger(merged.port) || merged.port < 0) merged.port = 8790;
  if (!merged.cookieFile) merged.cookieFile = defaultCookieFile(HERE);
  if (!merged.logDir) merged.logDir = join(HERE, '.data');
  return merged;
}

function loopback(req) {
  const address = req.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 262_144) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim().length === 0) return {};
  return JSON.parse(text);
}

function route(path, methods, handler) {
  return {
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!loopback(req)) {
        writeJson(res, 403, { ok: false, message: '仅允许本机回环请求' });
        return;
      }
      if (!methods.includes(req.method)) {
        writeJson(res, 405, { ok: false, message: `仅支持 ${methods.join('/')}` });
        return;
      }
      try {
        await handler(req, res);
      } catch (error) {
        writeJson(res, 200, { ok: false, message: String(error?.message ?? error) });
      }
    },
  };
}

/** 当前要暴露给 DSH 的模型列表。 */
function exposedModels(cfg) {
  const picked = exposeModels(cfg.exposeMode, cfg.exposeList);
  const models = piAiModels(picked);
  if (cfg.exposeMode === 'auto' && picked.length === 1 && picked[0].id === AUTO_ID) {
    models[0].name = AUTO_DISPLAY_NAME;
  }
  return models;
}

/** pi-ai 侧的 provider profile：baseURL 指向本机反代，不带任何上游凭据。 */
function buildProfile(cfg, relayBaseUrl) {
  return {
    displayName: cfg.displayName,
    api: 'openai-completions',
    baseURL: relayBaseUrl,
    headers: { authorization: LOCAL_AUTH },
    defaultContextWindow: 300_000,
    defaultMaxTokens: 32_768,
    streamIdleTimeoutMs: cfg.streamIdleMs,
    models: exposedModels(cfg),
  };
}

/** 手工兜底片段：settings 注入失败时贴进 profile 的 cordis.patch.yml 即可。 */
function manualPatch(cfg, relayBaseUrl) {
  const profile = buildProfile(cfg, relayBaseUrl);
  const lines = [
    '    providers:',
    `      ${cfg.providerId}:`,
    `        displayName: ${JSON.stringify(profile.displayName)}`,
    '        api: openai-completions',
    `        baseURL: ${profile.baseURL}`,
    '        headers:',
    `          authorization: ${JSON.stringify(LOCAL_AUTH)}`,
    '        defaultContextWindow: 300000',
    '        defaultMaxTokens: 32768',
    '        models:',
  ];
  for (const model of profile.models) {
    lines.push(`          - id: ${model.id}`);
    lines.push(`            name: ${JSON.stringify(model.name)}`);
    lines.push(`            contextWindow: ${model.contextWindow}`);
    lines.push(`            maxTokens: ${model.maxTokens}`);
    lines.push('            input:');
    for (const modality of model.input) lines.push(`              - ${modality}`);
  }
  return lines.join('\n');
}

export function apply(ctx, config) {
  const cfg = resolved(config);
  const state = {
    relay: null,
    error: null,
    injected: null,
    injectError: null,
    injectAttempts: 0,
    manualPatch: '',
    startedAt: Date.now(),
  };

  const log = (level, ...args) => {
    try {
      const sink = ctx.logger?.[level];
      if (typeof sink === 'function') sink.call(ctx.logger, '[dsh-llm-doubao]', ...args);
      else console.log('[dsh-llm-doubao]', ...args);
    } catch {
      /* 日志失败不影响功能 */
    }
  };

  const cookies = createCookieProvider({
    cookie: cfg.cookie,
    cookieEnv: cfg.cookieEnv,
    cookieFile: cfg.cookieFile,
    logger: { warn: (m) => log('warn', m) },
  });

  const getCookie = () => {
    const hit = cookies.get();
    if (!hit.cookie) throw new Error('没有可用的豆包登录态（cookie）');
    return hit.cookie;
  };

  const injectProvider = async () => {
    state.injectAttempts += 1;
    const relay = state.relay;
    if (relay === null) throw new Error('反代尚未启动');
    const settings = ctx.get('settings');
    if (settings === undefined) throw new Error('settings 服务不可用');
    const ns = cfg.injectInto;
    const descriptor = (settings.describe?.() ?? []).find((row) => row.ns === ns);
    if (descriptor === undefined) throw new Error(`配置条目 "${ns}" 不存在（未安装或未启用 llm-pi-ai）`);
    const profile = buildProfile(cfg, relay.baseURL);
    const current = descriptor.value?.providers?.[cfg.providerId];
    const sameIds = Array.isArray(current?.models)
      && current.models.length === profile.models.length
      && current.models.every((model, index) => model?.id === profile.models[index]?.id);
    const same = current !== undefined
      && current.baseURL === profile.baseURL
      && current.displayName === profile.displayName
      && sameIds;
    if (same) {
      state.injected = true;
      state.injectError = null;
      return { changed: false };
    }
    await settings.update(ns, { providers: { [cfg.providerId]: profile } }, descriptor.revision);
    state.injected = true;
    state.injectError = null;
    log('info', `已把 provider "${cfg.providerId}"（${profile.models.length} 个模型）注入 ${ns}`);
    return { changed: true };
  };

  const scheduleInject = () => {
    let attempt = 0;
    const tick = async () => {
      attempt += 1;
      try {
        await injectProvider();
      } catch (error) {
        state.injected = false;
        state.injectError = String(error?.message ?? error);
        if (attempt < 10 && state.relay !== null) {
          setTimeout(() => { void tick(); }, 1000 * attempt);
          return;
        }
        state.manualPatch = state.relay === null ? '' : manualPatch(cfg, state.relay.baseURL);
        log('warn', `provider 注入失败：${state.injectError}`);
      }
    };
    setTimeout(() => { void tick(); }, 400);
  };

  const boot = async () => {
    try {
      state.relay = await startRelay({
        host: cfg.host,
        port: cfg.port,
        getCookie,
        localToken: cfg.localToken,
        autoRoute: cfg.autoRoute,
        listModelIds: () => exposedModels(cfg).map((model) => model.id),
        onExpose: async (body) => {
          if (body?.__peek === true) {
            return {
              mode: cfg.exposeMode,
              shown: exposedModels(cfg).map((model) => ({ id: model.id, name: model.name })),
              all: MODELS.map((model) => ({ id: model.id, name: model.name, tag: model.tag ?? '' })),
              autoRoute: cfg.autoRoute,
              prefsFile: PREF_FILE,
            };
          }
          if (typeof body?.mode === 'string' && body.mode) {
            if (!['custom', 'all', 'auto'].includes(body.mode)) throw new Error('mode 只能是 custom / all / auto');
            cfg.exposeMode = body.mode;
          }
          if (Array.isArray(body?.models)) {
            cfg.exposeList = body.models;
            cfg.exposeMode = 'custom';
          }
          if (typeof body?.autoRoute === 'boolean') cfg.autoRoute = body.autoRoute;
          const saved = writePrefs({ exposeMode: cfg.exposeMode, exposeList: cfg.exposeList, autoRoute: cfg.autoRoute });
          const models = exposedModels(cfg);
          let changed = false;
          try {
            changed = (await injectProvider()).changed;
          } catch (error) {
            state.injectError = String(error?.message ?? error);
          }
          return {
            mode: cfg.exposeMode,
            shown: models.map((model) => ({ id: model.id, name: model.name })),
            all: MODELS.map((model) => ({ id: model.id, name: model.name, tag: model.tag ?? '' })),
            autoRoute: cfg.autoRoute,
            changed,
            saved,
            prefsFile: PREF_FILE,
          };
        },
        logDir: cfg.logRequests ? cfg.logDir : '',
        logRequests: cfg.logRequests,
        upstreamTimeoutMs: cfg.upstreamTimeoutMs,
        streamIdleMs: cfg.streamIdleMs,
        logger: { info: (...a) => log('info', ...a), warn: (...a) => log('warn', ...a), error: (...a) => log('warn', ...a) },
      });
      log('info', `反代就绪 ${state.relay.baseURL} → 豆包 /chat/completion`);
      if (cfg.autoInject) scheduleInject();
    } catch (error) {
      state.error = String(error?.message ?? error);
      log('warn', `反代启动失败：${state.error}`);
    }
  };

  const bootPromise = boot();

  const statusHandler = async (_req, res) => {
    const relay = state.relay;
    const snapshot = relay?.snapshot?.() ?? null;
    const cookieHit = cookies.get();
    writeJson(res, 200, {
      ok: relay !== null,
      config: {
        port: relay?.port ?? cfg.port,
        providerId: cfg.providerId,
        injectInto: cfg.injectInto,
        autoInject: cfg.autoInject,
        exposeMode: cfg.exposeMode,
        exposeList: cfg.exposeList,
        exposedModels: exposedModels(cfg).map((model) => model.id),
        cookieSource: cookieHit.source,
        cookieFile: cfg.cookieFile,
        localToken: cfg.localToken ? 'set' : '',
      },
      relayUrl: relay?.url ?? null,
      relayBaseURL: relay?.baseURL ?? null,
      relayError: state.error,
      injected: state.injected,
      injectError: state.injectError,
      injectAttempts: state.injectAttempts,
      manualPatch: state.manualPatch,
      cookie: {
        usable: looksUsable(cookieHit.cookie),
        source: cookieHit.source,
        length: String(cookieHit.cookie || '').length,
        ids: cookieHit.cookie ? parseCookieIds(cookieHit.cookie) : null,
      },
      models: MODELS.map((model) => ({
        id: model.id,
        name: model.name,
        modelItemKey: model.key,
        tag: model.tag ?? '',
        contextWindow: model.window,
      })),
      stats: snapshot,
      startedAt: state.startedAt,
    });
  };

  const modelsHandler = async (_req, res) => {
    writeJson(res, 200, {
      ok: true,
      relayUrl: state.relay?.baseURL ?? null,
      models: MODELS.map((model) => ({
        id: model.id,
        name: model.name,
        modelItemKey: model.key,
        tag: model.tag ?? '',
        contextWindow: model.window,
        vision: model.vision,
        reasoning: model.reasoning,
        efforts: model.efforts,
      })),
    });
  };

  const injectHandler = async (_req, res) => {
    await bootPromise;
    try {
      const result = await injectProvider();
      writeJson(res, 200, { ok: true, changed: result.changed });
    } catch (error) {
      state.manualPatch = state.relay === null ? '' : manualPatch(cfg, state.relay.baseURL);
      writeJson(res, 200, { ok: false, message: String(error?.message ?? error), manualPatch: state.manualPatch });
    }
  };

  /**
   * 查看 / 修改「哪些模型显示在 DSH 模型选择列表里」。
   *   GET  → { all: [...12 个], shown: [...当前显示], mode, prefsFile }
   *   POST { models: ['deepseek-v4-pro', ...] }  → 只显示这些
   *   POST { mode: 'all' }                       → 全部显示
   *   POST { models: [] }                        → 恢复默认 5 个
   */
  const exposeHandler = async (req, res) => {
    await bootPromise;
    if (req.method === 'GET') {
      writeJson(res, 200, {
        ok: true,
        mode: cfg.exposeMode,
        shown: exposedModels(cfg).map((model) => ({ id: model.id, name: model.name })),
        all: MODELS.map((model) => ({ id: model.id, name: model.name, tag: model.tag ?? '' })),
        prefsFile: PREF_FILE,
      });
      return;
    }
    const body = await readJson(req);
    if (typeof body.mode === 'string' && body.mode) {
      if (!['custom', 'all', 'auto'].includes(body.mode)) {
        writeJson(res, 200, { ok: false, message: 'mode 只能是 custom / all / auto' });
        return;
      }
      cfg.exposeMode = body.mode;
    }
    if (Array.isArray(body.models)) {
      cfg.exposeList = body.models;
      cfg.exposeMode = 'custom';
    }
    if (typeof body.autoRoute === 'boolean') cfg.autoRoute = body.autoRoute;
    const saved = writePrefs({
      exposeMode: cfg.exposeMode,
      exposeList: cfg.exposeList,
      autoRoute: cfg.autoRoute,
    });
    const models = exposedModels(cfg);
    try {
      const result = await injectProvider();
      writeJson(res, 200, {
        ok: true,
        mode: cfg.exposeMode,
        shown: models.map((model) => ({ id: model.id, name: model.name })),
        changed: result.changed,
        saved,
        prefsFile: PREF_FILE,
      });
    } catch (error) {
      state.manualPatch = state.relay === null ? '' : manualPatch(cfg, state.relay.baseURL);
      writeJson(res, 200, {
        ok: false,
        mode: cfg.exposeMode,
        shown: models.map((model) => ({ id: model.id, name: model.name })),
        message: String(error?.message ?? error),
        manualPatch: state.manualPatch,
      });
    }
  };

  /** 设置 / 刷新 cookie。body: { cookie?, file? }，无 body 时从文件重读。 */
  const cookieHandler = async (req, res) => {
    const body = await readJson(req);
    if (typeof body.cookie === 'string' && body.cookie.trim()) {
      const value = body.cookie.trim();
      if (!looksUsable(value)) {
        writeJson(res, 200, { ok: false, message: 'cookie 里没有可用的 sessionid' });
        return;
      }
      cookies.set(value);
      const saved = writeCookieFile(cfg.cookieFile, value);
      log('info', '已更新豆包 cookie（来自请求体）');
      writeJson(res, 200, { ok: true, source: 'config', saved });
      return;
    }
    const hit = cookies.refresh();
    writeJson(res, 200, {
      ok: looksUsable(hit.cookie),
      source: hit.source,
      length: String(hit.cookie || '').length,
      cookieFile: cfg.cookieFile,
    });
  };

  const probeHandler = async (req, res) => {
    await bootPromise;
    const relay = state.relay;
    if (relay === null) {
      writeJson(res, 200, { ok: false, message: state.error ?? '反代未启动' });
      return;
    }
    const body = await readJson(req);
    const model = typeof body.model === 'string' && body.model.length > 0 ? body.model : 'deepseek-v4-pro';
    const prompt = typeof body.prompt === 'string' && body.prompt ? body.prompt : '只回复两个字：可用';
    const started = Date.now();
    try {
      const response = await fetch(`${relay.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: LOCAL_AUTH },
        body: JSON.stringify({ model, stream: false, max_tokens: 64, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(180_000),
      });
      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      writeJson(res, 200, {
        ok: response.ok,
        status: response.status,
        model,
        elapsedMs: Date.now() - started,
        reply: parsed?.choices?.[0]?.message?.content ?? text.slice(0, 800),
        usage: parsed?.usage ?? null,
        error: response.ok ? null : (parsed?.error?.message ?? text.slice(0, 500)),
      });
    } catch (error) {
      writeJson(res, 200, {
        ok: false,
        model,
        elapsedMs: Date.now() - started,
        message: String(error?.message ?? error),
      });
    }
  };

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register(route(`${API}/status`, ['GET'], statusHandler)),
      ctx.webServer.register(route(`${API}/models`, ['GET'], modelsHandler)),
      ctx.webServer.register(route(`${API}/inject`, ['POST'], injectHandler)),
      ctx.webServer.register(route(`${API}/probe`, ['POST'], probeHandler)),
      ctx.webServer.register(route(`${API}/expose`, ['GET', 'POST'], exposeHandler)),
      ctx.webServer.register(route(`${API}/cookie`, ['POST'], cookieHandler)),
    ];
    return () => {
      for (const dispose of disposers) {
        try {
          dispose?.();
        } catch {
          /* 已卸载 */
        }
      }
      void state.relay?.close?.();
      state.relay = null;
    };
  });
}
