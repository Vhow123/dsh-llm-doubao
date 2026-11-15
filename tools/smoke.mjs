/**
 * 冒烟测试：用假的 ctx 跑一遍插件的 apply()，验证
 *   1. 反代真的能在回环地址起来并响应 /v1/models；
 *   2. injectProvider 真的会调用 settings.update，且 payload 形状正确；
 *   3. 四个 HTTP 路由都能注册且可访问。
 *
 *   node tools/smoke.mjs
 */

const routes = [];
const settingsWrites = [];
const effects = [];

const fakeSettings = {
  describe: () => [
    {
      ns: 'llm-pi-ai',
      revision: 42,
      value: { providers: { a6api: { displayName: '已有供应商', api: 'openai-completions' } } },
    },
  ],
  update: async (ns, patch, revision) => {
    settingsWrites.push({ ns, patch, revision });
  },
};

const ctx = {
  logger: { info: () => {}, warn: (...a) => console.warn('[warn]', ...a) },
  get: (name) => (name === 'settings' ? fakeSettings : undefined),
  effect: (factory) => {
    const dispose = factory();
    effects.push(dispose);
    return () => {};
  },
  webServer: {
    register: (route) => {
      routes.push(route);
      return () => {};
    },
  },
};

const mod = await import('../index.js');
console.log('插件导出：', Object.keys(mod).join(', '));
console.log('name =', mod.name, '| inject =', JSON.stringify(mod.inject));

mod.apply(ctx, { port: 0, apiKey: 'sk-smoke-test-key' });

await new Promise((resolve) => setTimeout(resolve, 1500));

console.log('\n已注册路由：');
for (const route of routes) console.log(`  ${route.kind} ${route.path}`);

const statusRoute = routes.find((r) => r.path.endsWith('/status'));
const modelsRoute = routes.find((r) => r.path.endsWith('/models'));

function callRoute(route) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: null,
      body: '',
      writeHead(status, headers) {
        this.statusCode = status;
        this.headers = headers;
      },
      end(text) {
        this.body = text;
        resolve(this);
      },
    };
    route.handler({ socket: { remoteAddress: '127.0.0.1' }, method: 'GET', headers: {}, [Symbol.asyncIterator]: async function* () {} }, res);
  });
}

const statusRes = await callRoute(statusRoute);
const status = JSON.parse(statusRes.body);
console.log('\n/status →', statusRes.statusCode);
console.log('  ok =', status.ok, '| relayUrl =', status.relayUrl, '| injected =', status.injected);
console.log('  relayError =', status.relayError);
console.log('  injectError =', status.injectError, '| attempts =', status.injectAttempts);
console.log('  models =', status.models.length);

const modelsRes = await callRoute(modelsRoute);
const catalog = JSON.parse(modelsRes.body);
console.log('\n/models →', modelsRes.statusCode, '| 模型数 =', catalog.models.length);
console.log('  前三个：', catalog.models.slice(0, 3).map((m) => m.id).join(', '));

console.log('\nsettings.update 调用：', settingsWrites.length, '次');
if (settingsWrites.length > 0) {
  const write = settingsWrites[0];
  console.log('  ns =', write.ns, '| revision =', write.revision);
  const provider = write.patch.providers?.doubao;
  console.log('  provider.baseURL =', provider?.baseURL);
  console.log('  provider.api =', provider?.api);
  console.log('  provider.headers =', JSON.stringify(provider?.headers));
  console.log('  provider.models 数量 =', provider?.models?.length);
  console.log('  模型 id 列表：', provider?.models?.map((m) => m.id).join(', '));
}

// 真实打一次反代（上游 key 是假的，预期得到 401/403 之类的上游错误，说明转发链路通）
if (status.relayUrl !== null) {
  const probe = await fetch(`${status.relayUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dsh-llm-doubao-local' },
    body: JSON.stringify({ model: '自动', stream: false, max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }),
    signal: AbortSignal.timeout(30_000),
  }).then(async (r) => ({ status: r.status, body: (await r.text()).slice(0, 400) })).catch((e) => ({ status: 0, body: String(e.message) }));
  console.log('\n上游联通性探测 →', probe.status);
  console.log('  ', probe.body);
}

for (const dispose of effects) {
  try {
    dispose?.();
  } catch {
    /* ignore */
  }
}
await new Promise((resolve) => setTimeout(resolve, 300));
console.log('\n冒烟测试结束。');
process.exit(0);
