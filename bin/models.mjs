#!/usr/bin/env node
/**
 * 打印豆包全部模型，或在给定 baseURL 下做一次连通性探测。
 *
 *   node bin/models.mjs                     # 列出全部模型与别名
 *   node bin/models.mjs --resolve "自动"     # 看某个名字会落到哪个 Ark id
 *   node bin/models.mjs --probe deepseek-v4-pro
 */

import { MODELS, resolveModel, ARK_CODING_BASE, ARK_PAYG_BASE } from '../lib/catalog.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? '');
};

if (flag('--resolve') !== null) {
  const raw = flag('--resolve');
  const hit = resolveModel(raw);
  console.log(JSON.stringify({ input: raw, upstream: hit.upstream, rewritten: hit.rewritten, name: hit.entry?.name ?? null }, null, 2));
  process.exit(0);
}

const probeModel = flag('--probe');
if (probeModel !== null) {
  const base = (flag('--base') || process.env.DOUBAO_RELAY_URL || 'http://127.0.0.1:8790/v1').replace(/\/+$/, '');
  const token = process.env.DOUBAO_RELAY_TOKEN || 'dsh-llm-doubao-local';
  const started = Date.now();
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: probeModel,
      stream: false,
      max_tokens: 32,
      messages: [{ role: 'user', content: '只回复两个字：可用' }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log(JSON.stringify({
    status: response.status,
    elapsedMs: Date.now() - started,
    model: probeModel,
    reply: typeof body === 'object' ? (body?.choices?.[0]?.message?.content ?? null) : String(body).slice(0, 400),
    error: typeof body === 'object' ? (body?.error?.message ?? null) : null,
    usage: typeof body === 'object' ? (body?.usage ?? null) : null,
  }, null, 2));
  process.exit(response.ok ? 0 : 1);
}

const rows = MODELS.map((model) => ({
  id: model.id,
  name: model.name,
  client: model.clientName,
  tag: model.tag ?? '',
  context: model.context,
  maxOut: model.maxOut,
  vision: model.vision,
}));
console.log(`豆包模型 ${rows.length} 个（Coding Plan: ${ARK_CODING_BASE} / 后付费: ${ARK_PAYG_BASE}）`);
console.table(rows);
