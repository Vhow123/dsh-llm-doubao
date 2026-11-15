#!/usr/bin/env node
/**
 * 选择哪些豆包模型显示在 DSH 的模型选择列表里。
 *
 *   node bin/expose.mjs                       # 看当前显示哪些、全部有哪些
 *   node bin/expose.mjs --set deepseek-v4-pro,kimi-k3.1-pro
 *   node bin/expose.mjs --add glm-5.3
 *   node bin/expose.mjs --remove glm-5.3
 *   node bin/expose.mjs --all                 # 12 个全显示
 *   node bin/expose.mjs --default             # 恢复默认 5 个
 *   node bin/expose.mjs --auto-route on|off   # auto 入口是否按请求自动挑模型
 *
 * 直接打本机反代（默认 http://127.0.0.1:8790），改完立刻重新注入 DSH，无需重启。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RELAY = process.env.DOUBAO_RELAY_URL ?? 'http://127.0.0.1:8790';
const TOKEN = process.env.DOUBAO_RELAY_TOKEN ?? 'dsh-llm-doubao-local';
const PREF_FILE = join(process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'), 'dsh-llm-doubao.json');

const DEFAULT_LIST = ['deepseek-v4-pro', 'deepseek-v4.1-flash', 'kimi-k3.1-pro', 'glm-5.3', 'doubao-2.1-pro'];

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? '' : value;
}

function splitList(text) {
  return String(text ?? '')
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function call(body) {
  const response = await fetch(`${RELAY}/doubao/expose`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!response.ok || parsed === null) throw new Error(`反代返回 ${response.status}：${text.slice(0, 300)}`);
  return parsed;
}

async function current() {
  const response = await fetch(`${RELAY}/doubao/expose`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`反代返回 ${response.status}：${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function print(state) {
  const shown = new Set((state.shown ?? []).map((model) => model.id));
  console.log(`\n当前显示 ${shown.size} 个（mode=${state.mode ?? 'custom'}）：`);
  for (const model of state.all ?? []) {
    const mark = shown.has(model.id) ? '✓' : ' ';
    const tag = model.tag ? `  ${model.tag}` : '';
    console.log(`  [${mark}] ${model.id.padEnd(26)} ${model.name}${tag}`);
  }
  console.log(`\n偏好文件：${state.prefsFile ?? PREF_FILE}`);
  console.log('用法：node bin/expose.mjs --set a,b,c | --add x | --remove x | --all | --default\n');
}

async function main() {
  const set = arg('--set');
  const add = arg('--add');
  const remove = arg('--remove');
  const autoRoute = arg('--auto-route');

  if (process.argv.includes('--all')) {
    const result = await call({ mode: 'all' });
    console.log(`已改为全部显示（${result.shown.length} 个），changed=${result.changed}`);
    print(await current());
    return;
  }
  if (process.argv.includes('--default')) {
    const result = await call({ models: DEFAULT_LIST });
    console.log(`已恢复默认 ${result.shown.length} 个，changed=${result.changed}`);
    print(await current());
    return;
  }
  if (autoRoute !== null) {
    const on = autoRoute === 'on' || autoRoute === 'true' || autoRoute === '1';
    const result = await call({ autoRoute: on });
    console.log(`autoRoute = ${on ? 'on' : 'off'}，changed=${result.changed}`);
    print(await current());
    return;
  }
  if (set !== null) {
    const list = splitList(set);
    const result = await call({ models: list });
    console.log(`已设置 ${result.shown.length} 个：${result.shown.map((m) => m.id).join(', ')}，changed=${result.changed}`);
    print(await current());
    return;
  }
  if (add !== null || remove !== null) {
    const state = await current();
    const list = (state.shown ?? []).map((model) => model.id);
    for (const id of splitList(add)) if (!list.includes(id)) list.push(id);
    for (const id of splitList(remove)) {
      const index = list.indexOf(id);
      if (index >= 0) list.splice(index, 1);
    }
    const result = await call({ models: list });
    console.log(`已更新为 ${result.shown.length} 个：${result.shown.map((m) => m.id).join(', ')}，changed=${result.changed}`);
    print(await current());
    return;
  }

  print(await current());
}

main().catch((error) => {
  console.error(`失败：${String(error?.message ?? error)}`);
  console.error(`反代地址：${RELAY}（先确认 DSH 已启动，或 node bin/relay.mjs 单独跑）`);
  process.exitCode = 1;
});
