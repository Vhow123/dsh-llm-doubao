/**
 * OpenAI 请求 → 豆包 `/chat/completion` 请求体。
 *
 * 豆包的消息数组没有 role 字段，靠 `message_status` 区分（0 = 用户，1 = 助手）。
 * 系统提示与工具定义统一并入首条用户消息（每次都是新建会话，不存在累积问题）。
 */

import crypto from 'node:crypto';
import { APP_VERSION, CHROMIUM_VERSION, DOUBAO_BOT_ID, RUNTIME_VERSION } from './catalog.js';

const uuid = () => crypto.randomUUID();

/** 把 OpenAI content（字符串或分块数组）拍平成纯文本。 */
export function flattenContent(content) {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text);
      else if (part.type === 'input_text' && typeof part.text === 'string') parts.push(part.text);
      else if (part.type === 'image_url') parts.push('[图片]');
    }
    return parts.join('\n');
  }
  return String(content);
}

/** 工具定义 → 豆包可读的文本说明。 */
export function describeTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return '';
  const lines = [
    '',
    '# 可用工具',
    '你可以调用下列工具。需要调用时，**只输出**下面格式的标签，不要包裹在代码块里，不要在标签外写额外解释：',
    '<tool_call>{"name": "工具名", "arguments": { ... }}</tool_call>',
    '一次可以输出多个 tool_call 标签。工具执行结果会以 <tool_result> 标签返回给你。',
    '',
  ];
  for (const tool of tools) {
    const fn = tool?.function ?? tool;
    if (!fn?.name) continue;
    const params = fn.parameters ? JSON.stringify(fn.parameters) : '{}';
    lines.push(`## ${fn.name}`);
    if (fn.description) lines.push(String(fn.description).trim());
    lines.push(`参数 JSON Schema：${params}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** 把一轮 OpenAI 消息拍平成豆包的单条消息文本。 */
function messageText(message) {
  const role = message.role;
  const text = flattenContent(message.content);

  if (role === 'tool') {
    const name = message.name ? `（${message.name}）` : '';
    return `<tool_result${name}>\n${text}\n</tool_result>`;
  }
  if (role === 'assistant') {
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const callText = calls
      .map((call) => {
        const fn = call?.function ?? {};
        return `<tool_call>${JSON.stringify({ name: fn.name, arguments: safeJson(fn.arguments) })}</tool_call>`;
      })
      .join('\n');
    return [text, callText].filter(Boolean).join('\n');
  }
  return text;
}

function safeJson(value) {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/**
 * 构造豆包请求体。
 * @param {object} payload OpenAI chat/completions 请求体
 * @param {{toolsSupported?: boolean}} options
 */
export function buildPrompt(payload, options = {}) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (messages.length === 0) throw new Error('messages 不能为空');

  const tools = options.toolsSupported !== false && Array.isArray(payload.tools) ? payload.tools : [];

  const systemParts = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') {
      const text = flattenContent(message.content);
      if (text) systemParts.push(text);
    }
  }
  const system = systemParts.join('\n\n').trim();
  const toolBlock = describeTools(tools);

  const turns = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue;
    const text = messageText(message);
    if (!text) continue;
    turns.push({ role: message.role === 'assistant' ? 'assistant' : 'user', text });
  }
  if (turns.length === 0) throw new Error('messages 里没有可发送的内容');

  // 合并连续的同角色消息（豆包按 message_status 区分，连续 user 会显得奇怪）
  const merged = [];
  for (const turn of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) last.text += '\n\n' + turn.text;
    else merged.push({ ...turn });
  }

  // 系统提示 + 工具说明前置到首条 user 消息
  const preamble = [system, toolBlock].filter(Boolean).join('\n');
  if (preamble) {
    const first = merged[0];
    if (first.role === 'user') first.text = `${preamble}\n\n---\n\n${first.text}`;
    else merged.unshift({ role: 'user', text: preamble });
  }

  return { messages: merged, tools, system };
}

/** 构造豆包 `/chat/completion` 的完整请求体。 */
export function buildDoubaoBody({ entry, effort, messages, conversationId = '', localConversationId = '' }) {
  const now = Date.now();
  const agentMode = entry.agentMode ?? 1;
  const convMode = agentMode === 1 ? 2 : 1;
  const modeId = entry.modeId ?? (agentMode === 1 ? '3' : '1');
  const needDeepThink = agentMode === 1 ? 10_001 : 0;

  const blocks = messages.map((message) => ({
    local_message_id: uuid(),
    content_block: [
      {
        block_type: 10_000,
        content: {
          text_block: { text: message.text, icon_url: '', icon_url_dark: '', summary: '' },
          pc_event_block: '',
        },
        block_id: uuid(),
        parent_id: '',
        meta_info: [],
        extra_info: {},
        append_fields: [],
      },
    ],
    message_status: message.role === 'assistant' ? 1 : 0,
  }));

  const extra = entry.extraParams ?? {};

  return {
    client_meta: {
      local_conversation_id: localConversationId || `local_${now}`,
      conversation_id: conversationId,
      bot_id: DOUBAO_BOT_ID,
      last_section_id: '',
      last_message_index: null,
      local_permissions: [{ permission_name: 'ACCESS_COARSE_LOCATION', status: 2 }],
    },
    messages: blocks,
    option: {
      send_message_scene: '',
      create_time_ms: now,
      collect_id: '',
      is_audio: false,
      answer_with_suggest: false,
      agent_mode: agentMode,
      tts_switch: false,
      need_deep_think: needDeepThink,
      click_clear_context: false,
      from_suggest: false,
      is_regen: false,
      is_replace: false,
      is_from_click_option: false,
      is_from_click_softlink: false,
      disable_sse_cache: false,
      select_text_action: '',
      is_select_text: false,
      resend_for_regen: false,
      scene_type: 0,
      unique_key: uuid(),
      start_seq: 0,
      need_create_conversation: !conversationId,
      conversation_init_option: { project_id: '', need_ack_conversation: true },
      conversation_init_ext: { model_item_key: entry.key, reasoning_effort: String(effort), mode_id: modeId },
      regen_query_id: [],
      edit_query_id: [],
      regen_instruction: '',
      no_replace_for_regen: false,
      message_from: 0,
      shared_app_name: '',
      shared_app_id: '',
      sse_recv_event_options: { support_chunk_delta: true },
      support_lazy_fetch_stream: true,
      is_ai_playground: false,
      is_old_user: true,
      recovery_option: { is_recovery: false, req_create_time_sec: Math.floor(now / 1000), append_sse_event_scene: 0 },
      message_storage_type: 0,
      related_deleted_message_ids: {},
      connector_info_list: [],
      model_config: {
        model_item_key: entry.key,
        model_extra_params: extra,
        reasoning_effort: effort,
      },
      aggregate_params: {
        mention_skill_list: '[]',
        mention_plugin_list: '[]',
        mention_ext: '[{}]',
        conversation_mode: String(convMode),
        mode_id: modeId,
        model_item_key: entry.key,
        agent_mode: String(agentMode),
        reasoning_effort: String(effort),
        provider_id: '',
      },
      conversation_mode: convMode,
    },
    user_context: [],
    ext: {
      agent_mode: String(agentMode),
      use_deep_think: String(needDeepThink),
      collection_id: '',
      is_finish: '1',
      commerce_credit_config_enable: '0',
    },
  };
}

/** 构造 `/chat/completion` 的 query 串。 */
export function buildQuery({ deviceId, webId, teaUuid }) {
  const params = {
    aid: '582478',
    real_aid: '582478',
    device_platform: 'web',
    doubao_device_platform: 'desktop',
    pkg_type: 'release_version',
    device_id: deviceId,
    pc_version: APP_VERSION,
    doubao_pc_version: APP_VERSION,
    web_id: webId,
    tea_uuid: teaUuid,
    region: 'CN',
    sys_region: 'CN',
    samantha_web: '1',
    web_platform: 'desktop',
    'use-olympus-account': '1',
    runtime: 'web',
    runtime_version: RUNTIME_VERSION,
    client_platform: 'pc_client',
    chromium_version: CHROMIUM_VERSION,
    channel: 'win',
    language: 'zh',
    version_code: '20800',
    fp: `verify_${deviceId}`,
  };
  return new URLSearchParams(params).toString();
}
