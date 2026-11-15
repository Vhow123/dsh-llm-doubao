/**
 * 豆包 `/chat/completion` 流式客户端。
 *
 * 上游 SSE 事件：
 *   SSE_HEARTBEAT / SSE_ACK / FULL_MSG_NOTIFY / STREAM_TIMEOUT_CONTROL /
 *   STREAM_MSG_NOTIFY / STREAM_CHUNK / SSE_REPLY_END
 *
 * 正文增量出现在两处，必须都处理并按重复去重：
 *   1. STREAM_MSG_NOTIFY 的 content.content_block[].content.text_block.text
 *   2. STREAM_CHUNK 的 patch_op[].patch_value.content_block[].content.text_block.text
 *
 * 结束标记：STREAM_CHUNK 的 patch_op[patch_object=50].patch_value.ext.finish_reason_chat
 */

import crypto from 'node:crypto';
import { DOUBAO_CHAT_PATH, DOUBAO_ORIGIN, DOUBAO_UA } from './catalog.js';
import { buildDoubaoBody, buildQuery } from './prompt.js';

const TOOL_OPEN = '<tool_call>';
const TOOL_CLOSE = '</tool_call>';
const uuid = () => crypto.randomUUID();

/** 文本块类型 */
const BLOCK_TEXT = 10_000;
const BLOCK_THINKING = 10_040;

/** 判断字符串尾部是否可能是 TOOL_OPEN 的前缀（避免标签被切断时误发）。 */
function partialTagSuffix(text) {
  const max = Math.min(TOOL_OPEN.length - 1, text.length);
  for (let len = max; len > 0; len -= 1) {
    if (TOOL_OPEN.startsWith(text.slice(-len))) return len;
  }
  return 0;
}

/**
 * 流式解析文本里的 `<tool_call>` 标签，其余作为正文下发。
 */
function createTextSplitter({ onText, onToolCall }) {
  let buffer = '';

  function drain(final) {
    for (;;) {
      const open = buffer.indexOf(TOOL_OPEN);
      if (open === -1) {
        if (final) {
          if (buffer) onText(buffer);
          buffer = '';
          return;
        }
        const hold = partialTagSuffix(buffer);
        const safe = buffer.length - hold;
        if (safe > 0) {
          onText(buffer.slice(0, safe));
          buffer = buffer.slice(safe);
        }
        return;
      }
      if (open > 0) {
        onText(buffer.slice(0, open));
        buffer = buffer.slice(open);
      }
      const close = buffer.indexOf(TOOL_CLOSE);
      if (close === -1) {
        if (final) {
          // 标签没闭合，按正文处理
          onText(buffer);
          buffer = '';
        }
        return;
      }
      const inner = buffer.slice(TOOL_OPEN.length, close).trim();
      buffer = buffer.slice(close + TOOL_CLOSE.length);
      let parsed = null;
      try {
        parsed = JSON.parse(inner);
      } catch {
        // 尝试从内层提取第一个 JSON 对象
        const m = inner.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            parsed = JSON.parse(m[0]);
          } catch {
            parsed = null;
          }
        }
      }
      if (parsed && typeof parsed === 'object' && parsed.name) {
        let args = parsed.arguments ?? parsed.parameters ?? {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        onToolCall({ id: `call_${uuid().replace(/-/g, '').slice(0, 24)}`, name: String(parsed.name), arguments: args });
      } else {
        // 解析不了就原样当正文，不吞内容
        onText(TOOL_OPEN + inner + TOOL_CLOSE);
      }
    }
  }

  return {
    push(text) {
      if (!text) return;
      buffer += text;
      drain(false);
    },
    flush() {
      drain(true);
    },
  };
}

function readBlockText(block) {
  if (!block || typeof block !== 'object') return null;
  if (block.block_type !== BLOCK_TEXT) return null;
  const t = block.content?.text_block;
  if (!t || typeof t !== 'object') return null;
  const text = typeof t.text === 'string' ? t.text : '';
  return { text, finished: block.is_finish === true };
}

function readBlockThinking(block) {
  if (!block || typeof block !== 'object') return null;
  if (block.block_type !== BLOCK_THINKING) return null;
  const t = block.content?.thinking_block;
  if (!t || typeof t !== 'object') return null;
  const text =
    (typeof t.text === 'string' && t.text) ||
    (typeof t.content === 'string' && t.content) ||
    (typeof t.detail === 'string' && t.detail) ||
    '';
  return text || null;
}

/** 从响应里抽取 device_id / web_id 等 query 参数（缺失时用默认值）。 */
export function defaultQueryIds() {
  return { deviceId: '885522549225145', webId: '7691453857067959859', teaUuid: '885522549225145' };
}

/**
 * 发起一次豆包对话，流式回调。
 * @param {object} params
 * @param {string} params.cookie
 * @param {object} params.entry catalog MODELS 条目
 * @param {number} params.effort
 * @param {{role:string,text:string}[]} params.messages
 * @param {(text:string)=>void} [params.onText]
 * @param {(text:string)=>void} [params.onThinking]
 * @param {(call:{id:string,name:string,arguments:object})=>void} [params.onToolCall]
 * @param {(info:{finishReason:string,usage:object|null,conversationId:string})=>void} [params.onFinish]
 * @param {AbortSignal} [params.signal]
 * @param {number} [params.upstreamTimeoutMs]
 * @param {number} [params.streamIdleMs]
 * @param {{deviceId?:string,webId?:string,teaUuid?:string}} [params.ids]
 */
export async function streamDoubao(params) {
  const {
    cookie,
    entry,
    effort,
    messages,
    onText = () => {},
    onThinking = () => {},
    onToolCall = () => {},
    onFinish = () => {},
    signal,
    upstreamTimeoutMs = 600_000,
    streamIdleMs = 600_000,
    ids = defaultQueryIds(),
  } = params;

  const body = buildDoubaoBody({ entry, effort, messages });
  const query = buildQuery(ids);
  const url = `${DOUBAO_ORIGIN}${DOUBAO_CHAT_PATH}?${query}`;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new Error('上游请求超时')), upstreamTimeoutMs);
  let idleTimer = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => timeoutController.abort(new Error('上游流空闲超时')), streamIdleMs);
  };
  const combined = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  armIdle();

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'agw-js-conv': 'str',
        cookie,
        'user-agent': DOUBAO_UA,
        referer: 'chrome://doubao-chat/',
        origin: DOUBAO_ORIGIN,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9',
      },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (idleTimer) clearTimeout(idleTimer);
    throw Object.assign(new Error(`连接豆包上游失败：${error?.message || error}`), { code: 'upstream_unreachable' });
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    if (idleTimer) clearTimeout(idleTimer);
    const text = await response.text().catch(() => '');
    const snippet = text.slice(0, 400);
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error(`豆包登录态已失效（HTTP ${response.status}）：请重新导出 cookie。${snippet}`), {
        code: 'cookie_expired',
      });
    }
    throw Object.assign(new Error(`豆包上游返回 HTTP ${response.status}：${snippet}`), {
      code: `upstream_${response.status}`,
    });
  }

  const splitter = createTextSplitter({ onText, onToolCall });
  const seen = new Set();
  let finishReason = 'stop';
  let conversationId = '';
  let usage = null;
  let sawToolCall = false;

  const handleBlock = (block, markSeen) => {
    const think = readBlockThinking(block);
    if (think) {
      onThinking(think);
      return;
    }
    const body = readBlockText(block);
    if (!body) return;
    if (!body.text) return;
    if (markSeen) {
      const key = `${block.block_id}|${body.text}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    splitter.push(body.text);
  };

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let event = null;
  let replyEnded = false;

  const handleEvent = (ev, data) => {
    if (ev === 'SSE_ACK') {
      const cid = data?.ack_client_meta?.conversation_id;
      if (cid) conversationId = String(cid);
      return;
    }
    if (ev === 'SSE_REPLY_END') {
      if (data?.end_type === 1) replyEnded = true;
      return;
    }
    if (ev === 'STREAM_MSG_NOTIFY') {
      const blocks = data?.content?.content_block;
      for (const block of blocks || []) handleBlock(block, false);
      return;
    }
    if (ev === 'STREAM_CHUNK') {
      let sawFinish = false;
      for (const op of data?.patch_op || []) {
        for (const block of op?.patch_value?.content_block || []) {
          sawToolCall = sawToolCall || false;
          handleBlock(block, true);
        }
        const ext = op?.patch_value?.ext;
        if (ext) {
          const reason = ext.finish_reason_chat;
          if (typeof reason === 'string' && reason) {
            finishReason = reason.includes('succeed') ? 'stop' : reason;
          }
          const ctx = ext.context_window_usage;
          if (typeof ctx === 'string') {
            try {
              const parsed = JSON.parse(ctx);
              if (Number.isFinite(parsed.messages)) {
                usage = {
                  prompt_tokens: Math.round(parsed.system_prompt + parsed.messages + (parsed.tools || 0)),
                  completion_tokens: 0,
                  total_tokens: Math.round(parsed.system_prompt + parsed.messages + (parsed.tools || 0)),
                };
              }
            } catch {
              // 忽略
            }
          }
          if (ext.is_finish === '1') sawFinish = true;
        }
        if (op?.patch_value?.tts_content) {
          // tts 是正文的语音镜像，不重复下发
        }
      }
      return;
    }
  };

  try {
    if (!response.body) throw Object.assign(new Error('豆包上游没有返回流'), { code: 'empty_stream' });
    for await (const chunk of response.body) {
      armIdle();
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const raw = line.slice(5).trim();
          if (!raw) continue;
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            continue;
          }
          handleEvent(event, parsed);
        }
      }
      if (replyEnded) break;
    }
    splitter.flush();
  } finally {
    clearTimeout(timeoutId);
    if (idleTimer) clearTimeout(idleTimer);
  }

  onFinish({ finishReason: sawToolCall ? 'tool_calls' : finishReason, usage, conversationId });
}
