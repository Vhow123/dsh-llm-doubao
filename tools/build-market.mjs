#!/usr/bin/env node
/**
 * 生成插件市场索引 market/index.json，并用 DSH 自带的 parseMarketIndex 校验。
 *
 *   node tools/build-market.mjs            # 用当前 HEAD 提交生成
 *   node tools/build-market.mjs --check    # 只校验已有文件
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'market', 'index.json')
const REPO = 'https://github.com/Vhow123/dsh-llm-doubao'
const INDEX_URL = 'https://raw.githubusercontent.com/Vhow123/dsh-llm-doubao/main/market/index.json'

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

// 一个 32x32 的豆包风格图标（深色圆角底 + 白色对话气泡）
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#1f1f22"/>
<path d="M18 20h28a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H30l-9 7v-7h-3a4 4 0 0 1-4-4V24a4 4 0 0 1 4-4z" fill="#fff"/>
<circle cx="25" cy="32" r="2.6" fill="#1f1f22"/><circle cx="32" cy="32" r="2.6" fill="#1f1f22"/><circle cx="39" cy="32" r="2.6" fill="#1f1f22"/>
</svg>`
const ICON = `data:image/svg+xml;base64,${Buffer.from(ICON_SVG, 'utf8').toString('base64')}`

function build() {
  const commit = git('rev-parse', 'HEAD')
  const publishTimestamp = Number(git('log', '-1', '--format=%ct'))
  return {
    format: 1,
    title: { zh: 'DSH 插件市场', en: 'DSH Plugin Market' },
    description: {
      zh: '社区维护的 DeepSeek Harness 插件索引。',
      en: 'A community-maintained index of DeepSeek Harness plugins.',
    },
    metadata: {
      categories: {
        llm: { title: { zh: '模型接入', en: 'Model providers' } },
        tools: { title: { zh: '工具增强', en: 'Tools' } },
        ui: { title: { zh: '界面扩展', en: 'Interface' } },
      },
      labels: {
        doubao: { title: { zh: '豆包', en: 'Doubao' } },
        relay: { title: { zh: '反代', en: 'Relay' } },
        'openai-compatible': { title: { zh: 'OpenAI 兼容', en: 'OpenAI compatible' } },
      },
      sortKeys: {
        stars: { title: { zh: '星标', en: 'Stars' }, order: 'desc' },
      },
    },
    plugins: [
      {
        name: pkg.name,
        title: { zh: '豆包全模型反代', en: 'Doubao Relay' },
        description: {
          zh: '把豆包桌面客户端登录后可用的 12 个模型（DeepSeek V4 Pro / V4.1 Flash、Kimi K3.1 Pro、GLM 5.3、豆包 2.1 等）反代成本地 OpenAI 兼容端点，自动注入 DSH 的模型列表，并在设置页勾选显示哪些。不需要火山方舟 API Key。',
          en: 'Relays the 12 models available in the Doubao desktop client into a local OpenAI-compatible endpoint, injects them into the DSH model list, and lets you pick which ones show up in Settings. No Ark API key required.',
        },
        icon: ICON,
        author: 'Vhow123',
        homepage: `${REPO}#readme`,
        repository: { url: REPO },
        metadata: {
          category: 'llm',
          keywords: ['doubao', '豆包', 'relay', 'openai-compatible', 'deepseek', 'kimi', 'glm', 'llm'],
          labels: ['doubao', 'relay', 'openai-compatible'],
          sortKeys: { stars: 0 },
        },
        versions: [
          {
            version: pkg.version,
            publishTimestamp,
            source: { type: 'git', url: REPO, commit },
            engines: { dsh: '>=0.2.0' },
          },
        ],
      },
    ],
  }
}

async function validate(index) {
  const mod = await import(
    pathToFileURL('D:/deepseek/resources/app/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js').href
  )
  const parsed = mod.parseMarketIndex(index, INDEX_URL)
  const plugin = parsed.plugins[0]
  const version = plugin.versions[0]
  const target = mod.marketInstallTarget(plugin.name, version)
  return { parsed, target }
}

const checkOnly = process.argv.includes('--check')
const index = checkOnly ? JSON.parse(readFileSync(OUT, 'utf8')) : build()

const { parsed, target } = await validate(index)
if (!checkOnly) {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}

console.log('✅ 索引校验通过')
console.log('   索引 URL :', INDEX_URL)
console.log('   插件     :', parsed.plugins[0].name, parsed.plugins[0].versions[0].version)
console.log('   安装参数 :', target.spec)
console.log('   输出文件 :', OUT)
