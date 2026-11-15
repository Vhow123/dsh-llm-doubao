/**
 * 诊断：直连豆包 /chat/completion，打印每个 SSE 事件的类型与抽出的文本，
 * 用于确认正文增量语义（增量 vs 全量快照）与结束时机。
 */

import { readFileSync } from 'node:fs';
import { buildDoubaoBody, buildQuery } from '../lib/relay.js';
import { getModel } from '../lib/catalog.js';

const cookieFile = 'F:/杂项/dsh-llm-doubao/.data/doubao-cookies.json';
const cookie = JSON.parse(readFileSync(cookieFile, 'utf8').replace(/^\uFEFF/, '')).cookieHeader;

const model = process.argv[2] ?? 'deepseek-v4-pro';
const prompt = process.argv[3] ?? '用一句话介绍你自己';

const body = buildDoubaoBody({
  messages: [{ role: 'user', content: prompt }],
  model: getModel(model).model,
  effort: 3,
});
const url = `https://www.doubao.com/chat/completion?${buildQuery({ cookie, deviceId: '885522549225145', webId: '7691453857067959859' })}`;

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

console.log('status', response.status, response.headers.get('content-type'));

const decoder = new TextDecoder();
let buffer = '';
let seq = 0;
let acc = '';

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
  const texts = [];
  const pushBlocks = (blocks) => {
    for (const block of blocks ?? []) {
      const type = Number(block?.block_type);
      const text = block?.content?.text_block?.text;
      if (typeof text === 'string' && text.length > 0) texts.push(`[${type}]${JSON.stringify(text)}`);
    }
  };
  let finish = '';
  if (event === 'STREAM_MSG_NOTIFY' || event === 'FULL_MSG_NOTIFY') {
    pushBlocks((payload?.content ?? payload?.message?.content)?.content_block);
  } else if (event === 'STREAM_CHUNK') {
    for (const op of payload?.patch_op ?? []) {
      pushBlocks(op?.patch_value?.content_block);
      const f = op?.patch_value?.ext?.finish_reason_chat;
      if (typeof f === 'string' && f) finish = f;
    }
  } else if (event === 'CHUNK_DELTA') {
    const t = typeof payload?.text === 'string' ? payload.text : '';
    if (t) texts.push();
  } else if (event === 'SSE_REPLY_END') {
    finish = `END(${payload?.end_type}) brief=${String(payload?.msg_finish_attr?.brief ?? '').length}`;
  }
  for (const text of texts) {
    // texts 里带引号，取原始值
    const value = JSON.parse(text.slice(text.indexOf(']') + 1));
    acc += value;
  }
  const keys = payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 6).join(',') : '';
  console.log(`${String(seq).padStart(3)} ${event.padEnd(24)} ${finish ? `FINISH=${finish}` : ''} texts=${texts.length ? texts.join(' ') : '-'} keys=${keys}`);
};

for await (const chunk of response.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let index = buffer.indexOf('\n\n');
  while (index >= 0) {
    const raw = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    handle(raw);
    index = buffer.indexOf('\n\n');
  }
}

console.log('\n=== 累积正文 ===');
console.log(acc);
console.log(`\n长度 ${acc.length}`);
