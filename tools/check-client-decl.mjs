import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const roots = [
  'F:/AppData-Moved/.dsh/profiles/desktop/node_modules',
  'D:/deepseek/resources/app/dsh/node_modules',
]

function resolvePkg(name) {
  for (const r of roots) {
    const p = join(r, name, 'package.json')
    if (existsSync(p)) return p
  }
  return null
}

const target = 'F:/杂项/dsh-llm-doubao/package.json'
const pkg = JSON.parse(readFileSync(target, 'utf8'))
const decl = pkg.dsh?.client
console.log('包名:', pkg.name)
console.log('dsh.client:', JSON.stringify(decl))
if (!decl) { console.log('❌ 没有 dsh.client'); process.exit(1) }
if (typeof decl.platform !== 'string') { console.log('❌ platform 不是 string'); process.exit(1) }
if (decl.platform !== 'web') { console.log('❌ platform 不是 web'); process.exit(1) }
const clientRel = pkg.exports?.['./client']
console.log('exports["./client"]:', clientRel)
if (typeof clientRel !== 'string') { console.log('❌ 缺 ./client 导出'); process.exit(1) }
const clientPath = join('F:/杂项/dsh-llm-doubao', clientRel)
console.log('client 文件存在:', existsSync(clientPath))

let bad = 0
for (const dep of decl.inject ?? []) {
  const p = resolvePkg(dep)
  const hasClient = p ? Boolean(JSON.parse(readFileSync(p, 'utf8')).exports?.['./client']) : false
  console.log(`  inject ${dep}: ${p ? '存在' : '❌ 缺失'}${p ? (hasClient ? ' (有 client bundle)' : ' ⚠ 无 client bundle') : ''}`)
  if (!p) bad++
}
console.log(bad === 0 ? '✅ inject 全部可解析' : `❌ ${bad} 个 inject 包缺失`)
