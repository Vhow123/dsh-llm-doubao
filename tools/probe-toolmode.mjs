/**
 * 实验：豆包在不同 agent_mode / conversation_mode 下，是否会遵守外挂的
 * 「函数调用标记协议」，而不是去用它自己的本地电脑工具。
 *
 * 结论用来决定 relay 里 tools 场景该用哪组模式字段。
 */

import { readFileSync } from 'node:fs';
import { buildDoubaoBody, buildQuery } from '../lib/relay.js';
import { getModel } from '../lib/catalog.js';

const cookie = JSON.parse(readFileSync('F:/杂项/dsh-llm-doubao/.data/doubao-cookies.json', 'utf8').replace(/^\uFEFF/, '')).cookieHeader;
const TEST_MODEL = process.argv[2] ?? 'deepseek-v4-pro';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取本机文件的文本内容',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
];

const PROMPT = '把 F:/杂项/package.json 的第一行内容读出来告诉我。';

const combos = [
  { label: 'agent1-office', agentMode: 1, convMode: 'office' },
  { label: 'agent2-office', agentMode: 2, convMode: 'office' },
  { label: 'agent1-chat', agentMode: 1, convMode: 'chat' },
  { label: 'agent2-chat', agentMode: 2, convMode: 'chat' },
];

function summarize(text) {
  const marked = text.includes('<<<DSH_TOOL_CALL>>>');
  const head = text.replace(/\s+/g, ' ').slice(0, 160);
  return { marked, head, length: text.length };
}

async function run(combo) {
  const base = getModel(TEST_MODEL).model;
  const model = { ...base, agentMode: combo.agentMode, convMode: combo.convMode };
  const body = buildDoubaoBody({
    messages: [{ role: 'user', content: PROMPT }],
    tools: TOOLS,
    model,
    effort: 3,
  });
  const url = `https://www.doubao.com/chat/completion?${buildQuery({ cookie, deviceId: '885522549225145' })}`;
  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'agw-js-conv': 'str',
      cookie,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.149 Safari/537.36 SamanthaDoubao/2.35.12',
      referer: 'chrome://doubao-chat/',
      origin: 'https://www.doubao.com',
      accept: 'application/json, text/plain, */*',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.log(`✗ ${combo.label}：HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let modelType = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\n\n');
      let event = '';
      const dataLines = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      const data = dataLines.join('\n');
      if (!data) continue;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === 'CHUNK_DELTA') {
        if (typeof payload?.text === 'string') text += payload.text;
      } else if (event === 'STREAM_CHUNK') {
        for (const op of payload?.patch_op ?? []) {
          for (const block of op?.patch_value?.content_block ?? []) {
            if (Number(block?.block_type) !== 10000) continue;
            const value = block?.content?.text_block?.text;
            if (typeof value === 'string') text += value;
          }
          const ext = op?.patch_value?.ext;
          if (ext?.model_type) modelType = String(ext.model_type);
        }
      } else if (event === 'STREAM_MSG_NOTIFY') {
        const ext = payload?.content?.ext;
        if (ext?.model_type) modelType = String(ext.model_type);
      }
    }
  }
  const info = summarize(text);
  console.log(`\n${info.marked ? '✓' : '✗'} ${combo.label}  ${Date.now() - started}ms  长度 ${info.length}  model_type=${modelType}`);
  console.log(`   标记：${info.marked ? '有' : '无'}`);
  console.log(`   正文：${info.head}`);
}

for (const combo of combos) {
  try {
    await run(combo);
  } catch (error) {
    console.log(`✗ ${combo.label} 异常：${String(error?.message ?? error)}`);
  }
}
