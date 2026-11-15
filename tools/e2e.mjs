/**
 * 端到端测试：直接打本机反代，覆盖非流式、流式、工具调用、多模型。
 *
 *   node tools/e2e.mjs                        # 全部
 *   node tools/e2e.mjs --only stream
 *   node tools/e2e.mjs --model kimi-k3.1-pro
 */

const BASE = process.env.DOUBAO_RELAY_URL ?? 'http://127.0.0.1:8790/v1';
const TOKEN = process.env.DOUBAO_RELAY_TOKEN ?? 'dsh-llm-doubao-local';
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const only = value('--only', '');
const model = value('--model', 'deepseek-v4-pro');

const headers = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name} —— ${detail}`);
};

async function nonStream() {
  const started = Date.now();
  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'user', content: '用一句话说明什么是二叉搜索树' }],
    }),
  });
  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content ?? '';
  record('非流式', response.ok && text.length > 10, `${Date.now() - started}ms，${text.length} 字：${text.slice(0, 80)}`);
}

async function stream() {
  const started = Date.now();
  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: 'user', content: '用三句话解释为什么需要索引' }],
    }),
  });
  if (!response.ok) {
    record('流式', false, `HTTP ${response.status}`);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let chunks = 0;
  let firstTokenMs = 0;
  let finishReason = '';
  let usage = null;
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\n\n');
      const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data || data === '[DONE]') continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (parsed.error) {
        record('流式', false, `上游错误：${parsed.error.message}`);
        return;
      }
      const choice = parsed.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) {
        if (!firstTokenMs) firstTokenMs = Date.now() - started;
        text += delta;
        chunks += 1;
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (parsed.usage) usage = parsed.usage;
    }
  }
  record(
    '流式',
    text.length > 20 && finishReason === 'stop',
    `首字 ${firstTokenMs}ms，共 ${Date.now() - started}ms，${chunks} 片，${text.length} 字，finish=${finishReason}，usage=${JSON.stringify(usage)}`,
  );
  console.log(`  正文：${text.slice(0, 120).replace(/\n/g, ' ')}…`);
}

async function tools() {
  const started = Date.now();
  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: '你是一个严谨的助手。' },
        { role: 'user', content: '帮我读一下 F:/杂项/README.md 的内容，然后告诉我文件多大。' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: '读取本机文件的文本内容',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string', description: '绝对路径' } },
              required: ['path'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'stat_file',
            description: '查询文件大小与修改时间',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
        },
      ],
      tool_choice: 'auto',
    }),
  });
  if (!response.ok) {
    record('工具调用', false, `HTTP ${response.status}`);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  const calls = [];
  let text = '';
  let finishReason = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\n\n');
      const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data || data === '[DONE]') continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const choice = parsed.choices?.[0];
      if (choice?.delta?.content) text += choice.delta.content;
      for (const call of choice?.delta?.tool_calls ?? []) {
        calls.push(call);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }
  }
  const detail = calls.length > 0
    ? `${Date.now() - started}ms，${calls.length} 个调用：${calls.map((c) => `${c.function?.name}(${c.function?.arguments})`).join(' | ')}`
    : `${Date.now() - started}ms，没有产生工具调用，正文 ${text.length} 字：${text.slice(0, 100)}`;
  record('工具调用', calls.length > 0, detail);
}

async function modelList() {
  const response = await fetch(`${BASE}/models`, { headers });
  const body = await response.json();
  record('模型列表', Array.isArray(body?.data) && body.data.length >= 10, `${body?.data?.length ?? 0} 个模型`);
}

async function multiModel() {
  const list = ['kimi-k3.1-pro', 'glm-5.3', 'doubao-2.1-lite', 'deepseek-v4.1-flash'];
  for (const name of list) {
    const started = Date.now();
    try {
      const response = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: name,
          stream: false,
          messages: [{ role: 'user', content: '只回答一个数字：7 乘 6 等于几？' }],
        }),
      });
      const body = await response.json();
      const text = String(body?.choices?.[0]?.message?.content ?? '').trim().replace(/\s+/g, ' ');
      record(`模型 ${name}`, response.ok && text.length > 0, `${Date.now() - started}ms：${text.slice(0, 40)}`);
    } catch (error) {
      record(`模型 ${name}`, false, String(error?.message ?? error));
    }
  }
}

const all = [
  ['models', modelList],
  ['nonstream', nonStream],
  ['stream', stream],
  ['tools', tools],
  ['multi', multiModel],
];

for (const [name, fn] of all) {
  if (only && only !== name) continue;
  console.log(`\n—— ${name} ——`);
  try {
    await fn();
  } catch (error) {
    record(name, false, String(error?.message ?? error));
  }
}

console.log('\n=== 汇总 ===');
const okCount = results.filter((r) => r.ok).length;
console.log(`${okCount}/${results.length} 通过`);
process.exit(okCount === results.length ? 0 : 1);
