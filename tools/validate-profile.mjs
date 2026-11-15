/**
 * 用 pi-ai 真实的 Config schema 校验本插件要注入的 provider profile。
 * 避免重启后才发现 settings.write 被判不合法。
 *
 *   node tools/validate-profile.mjs
 */

import { piAiModels } from '../lib/catalog.js';

const PI_AI = 'D:/deepseek/resources/app/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js';

const profile = {
  displayName: '豆包 · 火山方舟',
  api: 'openai-completions',
  baseURL: 'http://127.0.0.1:8790/v1',
  headers: { authorization: 'Bearer dsh-llm-doubao-local' },
  defaultContextWindow: 1_000_000,
  defaultMaxTokens: 32_768,
  streamIdleTimeoutMs: 600_000,
  models: piAiModels(),
};

const payload = { providers: { doubao: profile } };

let Config;
try {
  ({ Config } = await import(new URL(`file:///${PI_AI}`).href));
} catch (error) {
  console.error('无法加载 pi-ai 的 Config：', String(error?.message ?? error));
  process.exit(2);
}

console.log('Config 类型：', typeof Config);

const serialize = Config?.['~standard']?.validate ?? null;
if (typeof serialize === 'function') {
  const result = serialize.call(Config['~standard'], payload);
  if (result.issues) {
    console.error('❌ 校验未通过：');
    console.error(JSON.stringify(result.issues, null, 2));
    process.exit(1);
  }
  console.log('✅ 校验通过（~standard）');
} else if (typeof Config === 'function') {
  try {
    const out = Config(payload);
    console.log('✅ 校验通过（函数调用），归一化后 providers:', Object.keys(out.providers ?? {}));
    console.log('   doubao.models 数量：', out.providers?.doubao?.models?.length ?? 0);
    console.log('   第一条模型：', JSON.stringify(out.providers?.doubao?.models?.[0]));
  } catch (error) {
    console.error('❌ 校验失败：', String(error?.message ?? error));
    process.exit(1);
  }
} else {
  console.log('Config 既不是函数也没有 ~standard，跳过校验');
}

console.log('模型数：', profile.models.length);
