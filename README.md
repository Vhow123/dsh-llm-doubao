# dsh-llm-doubao

[![GitHub](https://img.shields.io/badge/GitHub-Vhow123%2Fdsh--llm--doubao-181717?logo=github)](https://github.com/Vhow123/dsh-llm-doubao)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.2.0-4f46e5)](https://github.com/deepseek-ai)

把**豆包桌面客户端**里登录后可用的全部模型，反代成一个本机 OpenAI 兼容接口，并自动注入 DSH Desktop 的 `llm-pi-ai` provider，于是 DSH 的模型下拉里直接多出一组「豆包 · 客户端全模型」。

不需要火山方舟 API Key，不需要充值——用的是你已经登录的豆包客户端账号额度。

```
DSH Desktop
   └─ llm-pi-ai (provider: doubao, api: openai-completions)
        └─ http://127.0.0.1:8790/v1/chat/completions      ← 本插件
             └─ POST https://www.doubao.com/chat/completion  ← 豆包客户端同一套登录态
```

## 安装

**方式一：DSH 插件市场**（推荐）

DSH → 设置 → 插件市场 → 添加索引源：

```
https://raw.githubusercontent.com/Vhow123/dsh-llm-doubao/main/market/index.json
```

然后在「发现」里搜「豆包」，点安装。

**方式二：命令行**

```bash
dsh plugin install git+https://github.com/Vhow123/dsh-llm-doubao.git
```

**方式三：本地 link**（开发用）

```bash
git clone https://github.com/Vhow123/dsh-llm-doubao.git
cd dsh-llm-doubao
# 在 ~/.dsh/profiles/desktop/package.json 的 dependencies 里加：
#   "@local/dsh-llm-doubao": "link:<克隆路径>"
# 并把 "@local/dsh-llm-doubao" 加进 dsh.profile.bundles
```

装完重启一次 DSH，然后跑 `node bin/login.mjs` 取豆包登录态。

## 自己选哪些模型显示在列表里

DSH 的模型下拉里显示哪些豆包模型，由你自己勾。默认显示 5 个常用模型（`deepseek-v4-pro`、`deepseek-v4.1-flash`、`kimi-k3.1-pro`、`glm-5.3`、`doubao-2.1-pro`），其余 7 个不显示但依然可用（直接写模型名调用即可）。

**方式一：DSH 设置页**（推荐，装完插件就有）

DSH → 设置 → 左侧「豆包模型」→ 勾选要显示的模型 → 保存。

这是插件自带的客户端页面（`lib/client.js`），任何人装上插件后都能在设置里直接勾，不用碰命令行、不用开额外网址。保存后立刻重新注入 provider，模型下拉马上刷新，无需重启。

**方式二：网页面板**（不装 DSH 也能用）

```
http://127.0.0.1:8790/doubao/panel
```

勾选 → 保存，立刻重新注入 DSH，不用重启。

**方式三：命令行**

```bash
node bin/expose.mjs                                  # 看当前显示哪些
node bin/expose.mjs --set deepseek-v4-pro,kimi-k3.1-pro
node bin/expose.mjs --add glm-5.3
node bin/expose.mjs --remove glm-5.3
node bin/expose.mjs --all                            # 12 个全显示
node bin/expose.mjs --default                        # 恢复默认 5 个
```

**方式四：HTTP**

```bash
curl http://127.0.0.1:8790/doubao/expose -H 'authorization: Bearer dsh-llm-doubao-local'
curl -X POST http://127.0.0.1:8790/doubao/expose \
  -H 'authorization: Bearer dsh-llm-doubao-local' -H 'content-type: application/json' \
  -d '{"models":["deepseek-v4-pro","kimi-k3.1-pro"]}'
```

选择结果存在 `~/.dsh/dsh-llm-doubao.json`，重启后仍然生效。配置项 `exposeMode: all` 可以一次性全显示。

## 全部模型（12 个）

| id | 豆包里的名字 | 倍率 | 上下文 |
|---|---|---|---|
| `auto` | 自动 | 小额免费 | 256K |
| `doubao-2.1-lite` | 豆包 2.1 Lite | 0.01x | 256K |
| `doubao-2.1-pro` | 豆包 2.1 Pro | 0.65x | 256K |
| `doubao-fast` | 快速 | — | 256K |
| `doubao-expert` | 专家 | — | 256K |
| `deepseek-v4.1-flash` | DeepSeek V4.1 Flash | 0.01x | 300K |
| `deepseek-v4-pro` | DeepSeek V4 Pro | 0.46x | 300K |
| `kimi-k3.1-pro` | Kimi K3.1 Pro | 0.95x | 300K |
| `kimi-k3.1-pro-highspeed` | Kimi K3.1 Pro 高速 | 1.44x | 300K |
| `kimi-k3` | Kimi K3 | 1.48x | 300K |
| `glm-5.3` | GLM 5.3 | 0.80x | 300K |
| `glm-5.3-flash` | GLM 5.3 Flash | 0.08x | 300K |

别名可用中文：`DeepSeek V4 Pro`、`Kimi K3.1 Pro 高速`、`豆包 2.1 Lite`……也接受 `deepseek-v4.1-pro` 这种误写（落到 `deepseek-v4-pro`）。

思考强度按模型支持 5 档：`3` 低 / `4` 中 / `5` 高 / `6` 极高 / `7` 最高，转发成 OpenAI 的 `reasoning_effort`。

## 登录态

登录态从豆包客户端现取：

```bash
node bin/login.mjs
```

它会连豆包客户端的 CDP（没有调试端口就先带 `--remote-debugging-port=9222` 重启一次，`--no-restart` 可禁用），把 doubao/bytedance 域下的 cookie 写到 `.data/doubao-cookies.json`。重新登录豆包后重跑一次即可。

## 单独跑反代

```bash
node bin/relay.mjs                 # 默认 127.0.0.1:8790
node bin/relay.mjs --port 8800     # 换端口
curl http://127.0.0.1:8790/healthz # 看 cookie / 模型数 / 统计
```

请求要带本地口令（默认 `dsh-llm-doubao-local`）：

```bash
curl http://127.0.0.1:8790/v1/chat/completions \
  -H 'authorization: Bearer dsh-llm-doubao-local' \
  -H 'content-type: application/json' \
  -d '{"model":"deepseek-v4-pro","stream":true,"messages":[{"role":"user","content":"你好"}]}'
```

## HTTP 接口

| 路径 | 说明 |
|---|---|
| `POST /v1/chat/completions` | OpenAI 兼容，支持 `stream` |
| `GET /v1/models` | 只列当前选中的模型 |
| `GET /healthz` | 统计、cookie 长度、模型数 |
| `GET /doubao/panel` | 模型显示选择面板（浏览器打开） |
| `GET/POST /doubao/expose` | 查看 / 修改显示哪些模型 |
| `GET /api/dsh-llm-doubao/status` | 插件状态（relay 地址、注入结果） |
| `POST /api/dsh-llm-doubao/inject` | 立即重新注入 provider |
| `GET/POST /api/dsh-llm-doubao/expose` | 同 `/doubao/expose`，走 DSH 网关 |
| `POST /api/dsh-llm-doubao/probe` | 打一次真实请求验证链路 |
| `POST /api/dsh-llm-doubao/cookie` | `{"cookie":"..."}` 写入并落盘；空 body 从文件重读 |

## 配置项

| 项 | 默认 | 说明 |
|---|---|---|
| `host` / `port` | `127.0.0.1` / `8790` | 被占用会自动 +1 重试 |
| `cookie` | — | 直接写 cookie 字符串 |
| `cookieEnv` | `DOUBAO_COOKIE` | 从环境变量取 |
| `cookieFile` | `.data/doubao-cookies.json` | 从文件取（优先级最低） |
| `providerId` | `doubao` | 注入到 DSH 的 provider 名 |
| `displayName` | `豆包 · 客户端` | GUI 里显示的名字 |
| `exposeMode` | `custom` | `custom` 只显示 `exposeList` / `all` 全显示 / `auto` 只出一个自动入口 |
| `exposeList` | 5 个常用模型 | `exposeMode: custom` 时要显示的模型 id |
| `autoRoute` | `false` | 是否让 `auto` 入口按请求特征自动挑模型 |
| `autoInject` | `true` | 启动时自动写进 `llm-pi-ai` |
| `localToken` | `dsh-llm-doubao-local` | 本机调用口令，空则不校验 |
| `upstreamTimeoutMs` / `streamIdleMs` | `600000` | 上游超时 / 空闲超时 |

## 几个实现上的坑（都已在代码里处理）

1. **不需要 msToken / a_bogus**。浏览器里的 XHR 由 webmssdk 自动签名，但 `/chat/completion` 服务端并不强制校验，纯 Node fetch 就能通。
2. **正文有两条通道**：`STREAM_CHUNK` 的 `content_block[]`（block_type 10000）和 `CHUNK_DELTA` 的 `payload.text` 互补出现，必须都拼；再用尾部重叠去重防止重发。
3. **先来一条任务播报**（「这个问题我需要花点时间来处理。」），它自带 `succeed:completion` 和 `end_type=1`，不能当答案。判据：`ext.llm_intention_detail === 'Agent-TaskHead'` / `ext.disable_action_view === '1'` / `content_type === 9999` → 丢弃。
4. **收尾要等 `end_type === 3`**，否则会在播报处就把回答掐断。
5. **工具调用**：豆包自己带本地电脑工具，`agent_mode=1` 时会拒绝外挂协议（还会判定成注入攻击），所以带 tools 的请求强制 `agent_mode=2`，它就会老老实实按标记输出。
6. 豆包原生不支持 OpenAI tools，所以工具协议走文本标记 `<<<DSH_TOOL_CALL>>>{...}<<<END_DSH_TOOL_CALL>>>`，由 relay 翻译成标准 `tool_calls`。模型偶尔少写一个尖括号，解析用宽松正则。

## 排错

- `missing_cookie` / 未登录 → `node bin/login.mjs` 重取
- 回答很短只有一句播报 → 上游改了播报字段，看 `tools/diag-tools.mjs` 的逐事件输出
- 模型下拉没出现 → `POST /api/dsh-llm-doubao/inject`，或看 `/status` 的 `injectError`
- 全量自检：`node tools/e2e.mjs`（models / nonstream / stream / tools / multi）
