/**
 * 专项诊断：区分 STREAM_CHUNK 的文本块与 CHUNK_DELTA 的 text 到底是同一内容的
 * 两种视图还是互相补齐，决定反代该以哪一路为准。
 */

import { readFileSync } from 'node:fs';
import { buildDoubaoBody, buildQuery } from '../lib/relay.js';
import { getModel } from '../lib/catalog.js';

const cookie = JSON.parse(readFileSync('F:/杂项/dsh-llm-doubao/.data/doubao-cookies.json', 'utf8').replace(/^\uFEFF/, '')).cookieHeader;
const modelName = process.argv[2] ?? 'deepseek-v4-pro';
const prompt = process.argv[3] ?? '用三句话说明什么是索引';

const body = buildDoubaoBody({
  messages: [{ role: 'user', content: prompt }],
  model: getModel(modelName).model,
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

const decoder = new TextDecoder();
let buffer = '';
let chunkAcc = '';
let deltaAcc = '';
let brief = '';
const deltas = [];
let chunkCount = 0;
let seq = 0;

function handle(raw) {
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
    return;
  }
  if (event === 'STREAM_CHUNK') {
    for (const op of payload?.patch_op ?? []) {
      for (const block of op?.patch_value?.content_block ?? []) {
        if (Number(block?.block_type) !== 10000) continue;
        const text = block?.content?.text_block?.text;
        if (typeof text === 'string' && text.length > 0) {
          chunkAcc += text;
          chunkCount += 1;
          console.log(`#${seq} CHUNK-BLOCK +${text.length} 「${text}」`);
        }
      }
    }
  } else if (event === 'CHUNK_DELTA') {
    const text = typeof payload?.text === 'string' ? payload.text : '';
    if (text) {
      deltas.push(text);
      deltaAcc += text;
      console.log(`#${seq} DELTA +${text.length} ${JSON.stringify(text)}`);
    } else {
      console.log(`#${seq} DELTA keys=${Object.keys(payload).join(',')} raw=${data.slice(0, 200)}`);
    }
  } else if (event === 'SSE_REPLY_END') {
    const b = payload?.msg_finish_attr?.brief;
    if (typeof b === 'string' && b.length > brief.length) brief = b;
  }
}

for await (const chunk of response.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let index = buffer.indexOf('\n\n');
  while (index >= 0) {
    handle(buffer.slice(0, index));
    buffer = buffer.slice(index + 2);
    index = buffer.indexOf('\n\n');
  }
}

console.log('\n=== 结果对比 ===');
console.log(`CHUNK 块数 ${chunkCount}，长度 ${chunkAcc.length}`);
console.log(`DELTA 片段 ${deltas.length}，长度 ${deltaAcc.length}`);
console.log(`BRIEF 长度 ${brief.length}`);
console.log(`chunkAcc === deltaAcc ? ${chunkAcc === deltaAcc}`);
console.log(`deltaAcc 包含 chunkAcc ? ${deltaAcc.includes(chunkAcc)}`);
console.log(`chunkAcc 前缀于 deltaAcc ? ${deltaAcc.startsWith(chunkAcc)}`);
console.log(`deltaAcc 前缀于 chunkAcc ? ${chunkAcc.startsWith(deltaAcc)}`);
console.log(`deltaAcc === brief ? ${deltaAcc === brief}`);
console.log(`chunkAcc === brief ? ${chunkAcc === brief}`);
console.log('\n--- CHUNK ---\n' + chunkAcc);
console.log('\n--- DELTA ---\n' + deltaAcc);
console.log('\n--- BRIEF ---\n' + brief);
