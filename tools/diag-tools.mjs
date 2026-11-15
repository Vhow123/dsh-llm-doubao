/**
 * 诊断：带 tools 的直连豆包请求，逐个事件打印，定位「只回 15 字」的原因。
 */

import { readFileSync } from 'node:fs';
import { buildDoubaoBody, buildQuery } from '../lib/relay.js';
import { getModel } from '../lib/catalog.js';

const cookie = JSON.parse(readFileSync('F:/杂项/dsh-llm-doubao/.data/doubao-cookies.json', 'utf8').replace(/^\uFEFF/, '')).cookieHeader;
const modelName = process.argv[2] ?? 'deepseek-v4-pro';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取本机文件的文本内容',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stat_file',
      description: '查询文件大小与修改时间',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
];

const body = buildDoubaoBody({
  messages: [
    { role: 'system', content: '你是一个严谨的助手。' },
    { role: 'user', content: '帮我读一下 F:/杂项/package.json 的内容，然后告诉我文件多大。' },
  ],
  tools: TOOLS,
  model: getModel(modelName).model,
  effort: 3,
});

console.log('=== 请求体摘要 ===');
console.log('messages 条数', body.messages.length);
console.log('option.agent_mode', body.option.agent_mode);
console.log('option.conversation_mode', body.option.conversation_mode);
console.log('model_item_key', body.option.model_config.model_item_key);
console.log('第一条消息前 300 字：');
console.log(body.messages[0]?.content_block?.[0]?.content?.text_block?.text?.slice(0, 300));

const url = `https://www.doubao.com/chat/completion?${buildQuery({ cookie, deviceId: '885522549225145' })}`;
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

console.log('\nstatus', response.status);
const decoder = new TextDecoder();
let buffer = '';
let seq = 0;
let text = '';

const handle = (raw) => {
  let event = '';
  const dataLines = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  const data = dataLines.join('\n');
  if (!event && !data) return;
  seq += 1;
  let payload = null;
  try {
    payload = JSON.parse(data);
  } catch {
    payload = null;
  }
  const parts = [];
  if (event === 'CHUNK_DELTA') {
    if (typeof payload?.text === 'string') {
      parts.push(`delta=${JSON.stringify(payload.text)}`);
      text += payload.text;
    }
  } else if (event === 'STREAM_CHUNK') {
    for (const op of payload?.patch_op ?? []) {
      for (const block of op?.patch_value?.content_block ?? []) {
        if (Number(block?.block_type) !== 10000) continue;
        const value = block?.content?.text_block?.text;
        if (typeof value === 'string' && value.length > 0) {
          parts.push(`block=${JSON.stringify(value)}`);
          text += value;
        }
        if (block?.is_finish) parts.push('block-finish');
      }
      const ext = op?.patch_value?.ext;
      if (ext?.finish_reason_chat) parts.push(`finish=${ext.finish_reason_chat}`);
      if (ext?.ext?.finish_reason_chat) parts.push(`finish2=${ext.ext.finish_reason_chat}`);
    }
  } else if (event === 'SSE_REPLY_END') {
    parts.push(`end=${payload?.end_type} brief=${String(payload?.msg_finish_attr?.brief ?? '').length}`);
  } else if (event === 'STREAM_MSG_NOTIFY') {
    const blocks = payload?.content?.content_block ?? [];
    for (const block of blocks) {
      const value = block?.content?.text_block?.text;
      if (typeof value === 'string' && value.length > 0) parts.push(`notify=${JSON.stringify(value)}`);
    }
    if (process.env.DUMP_NOTIFY) console.log('    NOTIFY_JSON ' + JSON.stringify(payload).slice(0, 1800));
    const err = payload?.content?.ext?.error_msg;
    if (err) parts.push(`ERR=${err}`);
  }
  const keys = payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 5).join(',') : '';
  if (parts.length > 0 || event !== 'SSE_HEARTBEAT') {
    console.log(`${String(seq).padStart(3)} ${event.padEnd(22)} ${parts.join(' ') || '-'}`);
  } else {
    console.log(`${String(seq).padStart(3)} ${event.padEnd(22)} (heartbeat)`);
  }
};

for await (const chunk of response.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let index = buffer.indexOf('\n\n');
  while (index >= 0) {
    handle(buffer.slice(0, index));
    buffer = buffer.slice(index + 2);
    index = buffer.indexOf('\n\n');
  }
}

console.log('\n=== 累积 ===');
console.log(text);
