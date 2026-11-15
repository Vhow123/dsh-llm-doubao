/**
 * 用 CDP 检查 DSH Desktop 渲染进程是否加载了 dsh-llm-doubao 的 client bundle。
 * 用法：node tools/verify-client.mjs [port]
 */
const PORT = Number(process.argv[2] || 9333)

async function json(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`)
  return res.json()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map() }
  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    const c = new CDP(ws)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id)
        c.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    }
    return c
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)) } }, 20000)
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result?.value
  }
  close() { try { this.ws.close() } catch {} }
}

const targets = await json('/json/list')
console.log('targets:')
for (const t of targets) console.log(`  [${t.type}] ${t.title} | ${t.url.slice(0, 90)}`)

const page = targets.find((t) => t.type === 'page' && t.url.includes('dsh-app://'))
if (!page) { console.log('❌ 没找到 dsh-app 页面'); process.exit(1) }

const cdp = await CDP.open(page.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')

const probe = await cdp.eval(`(() => {
  const out = { hasLoader: typeof window.__ModuleLoader__ !== 'undefined', keys: [], hasDoubao: false, slots: [] }
  try {
    const L = window.__ModuleLoader__
    if (L) {
      out.loaderKeys = Object.keys(L)
      const reg = L.registry || L.modules || L._modules
      if (reg && typeof reg === 'object') out.keys = Object.keys(reg).filter(k => k.includes('doubao') || k.includes('local'))
      out.hasDoubao = JSON.stringify(out.keys).includes('doubao')
    }
  } catch (e) { out.err = String(e) }
  out.bodyText = (document.body.innerText || '').slice(0, 200)
  return out
})()`)
console.log('\n=== loader 探测 ===')
console.log(JSON.stringify(probe, null, 2))

// 打开设置页：点侧栏设置按钮
const opened = await cdp.eval(`(() => {
  const btns = [...document.querySelectorAll('button, [role="button"], a')]
  const hit = btns.find(b => /设置|Settings/.test((b.getAttribute('aria-label') || '') + (b.textContent || '')))
  if (hit) { hit.click(); return 'clicked: ' + ((hit.getAttribute('aria-label') || hit.textContent || '').trim().slice(0, 30)) }
  return 'no settings button'
})()`)
console.log('\n设置按钮:', opened)
await sleep(1500)

const after = await cdp.eval(`(() => {
  const txt = document.body.innerText || ''
  return { hasDoubao: txt.includes('豆包模型'), tail: txt.slice(-600) }
})()`)
console.log('\n=== 设置页文本 ===')
console.log('含「豆包模型」:', after.hasDoubao)
console.log(after.tail)

cdp.close()
