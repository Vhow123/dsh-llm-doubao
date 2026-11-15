/**
 * 豆包桌面客户端的模型目录（与客户端模型下拉一一对应）。
 *
 * 数据来源：豆包客户端 `POST /alice/slot/action_bar_v3/brief_list` 的
 * `data.entry_list[0].active_switch_conf.menu_conf.item_list`，抓包样本见
 * `F:\杂项\_doubao_recon\model-menu.json`。
 *
 * 每条模型反代时只需要三样东西：`model_item_key`、`mode_id`、`conversation_mode`。
 * 其余（窗口大小、倍率 tag、推理档位）只用于展示与参数校验。
 */

/** 豆包 PC 客户端版本号，用于拼 /chat/completion 的 query 参数。 */
export const CLIENT_VERSION = '2.35.12';
export const CHROMIUM_VERSION = '147.0.7727.149';
export const BOT_ID = '7338286299411103781';

/** conversation_mode 的数字枚举（与前端一致）。 */
export const CONV_MODE = { chat: 1, office: 2, creation: 3 };

/** 推理强度档位（客户端下拉里的 5 档，person-* 模型全支持）。 */
export const EFFORT_LEVELS = [
  { level: 3, id: 'low', name: '低' },
  { level: 4, id: 'medium', name: '中' },
  { level: 5, id: 'high', name: '高' },
  { level: 6, id: 'xhigh', name: '极高' },
  { level: 7, id: 'max', name: '最高' },
];

/**
 * 全部可选模型。
 * - `id`：反代对外暴露的模型名（DSH 与任意 OpenAI 客户端都用它）
 * - `name`：展示名（与客户端下拉文字一致）
 * - `key`：豆包 model_item_key
 * - `modeId` / `agentMode` / `convMode`：拼请求体所需的模式字段
 * - `window`：上下文窗口（客户端声明值）
 * - `tag`：客户端显示的倍率/优惠标签
 * - `efforts`：可用推理档位（level 数组）
 */
export const MODELS = [
  {
    id: 'auto',
    name: '自动',
    key: '9',
    modeId: '3',
    agentMode: 1,
    convMode: 'office',
    window: 256_000,
    tag: '小额免费',
    efforts: [3, 4, 5, 6, 7],
    vision: true,
    reasoning: true,
  },
  {
    id: 'doubao-2.1-lite',
    name: '豆包 2.1 Lite',
    key: 'seed-lite-7b',
    modeId: '3',
    agentMode: 1,
    convMode: 'office',
    window: 256_000,
    tag: '限时优惠 0.01x',
    efforts: [3, 4, 5, 6, 7],
    vision: true,
    reasoning: true,
  },
  {
    id: 'doubao-2.1-pro',
    name: '豆包 2.1 Pro',
    key: '5',
    modeId: '3',
    agentMode: 1,
    convMode: 'office',
    window: 256_000,
    tag: '0.65x',
    efforts: [3, 4, 5, 6, 7],
    vision: true,
    reasoning: true,
  },
  {
    id: 'doubao-fast',
    name: '豆包 快速',
    key: '0',
    modeId: '1',
    agentMode: 2,
    convMode: 'chat',
    window: 256_000,
    tag: '',
    efforts: [3, 4, 5],
    vision: true,
    reasoning: false,
  },
  {
    id: 'doubao-expert',
    name: '豆包 专家',
    key: '3',
    modeId: '1',
    agentMode: 2,
    convMode: 'chat',
    window: 256_000,
    tag: '',
    efforts: [3, 4, 5],
    vision: true,
    reasoning: true,
  },
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    key: 'person-deepseek-v4-1-flash-261017',
    modeId: '3',
    agentMode: 1,
    convMode: 'office',
    window: 300_000,
    tag: '限时优惠 0.01x',
    efforts: [3, 4, 5, 6, 7],
    vision: true,
    reasoning: true,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    key: 'person-deepseek-v4-pro-ga-260813',
    modeId: '3',
    agentMode: 1,
    convMode: 'office',
    window: 300_000,
    tag: '0.46x',
    efforts: [3, 4, 5, 6, 7],
    vision: true,
    reasoning: true,
  },
  {
    id: 'kimi-k3.1-pro',
    name: 'Kimi K3.1 Pro',
    key: 'person-kimi-k3-1-pro-261111',
    modeId: '3',
    agentMode: 1,
    convMode: 'office',
    window: 300_000,
    tag: '0.95x',
    efforts: [3, 4, 5, 6, 7],
    vision: true,
    reasoning: true,
  },
  {
    id: 'kimi-k3.1-pro-highspeed',
    name: 'Kimi K3.1 Pro 高速',
    key: 'person-kimi-k3-1-pro-highspeed-261111',
    modeId: '3',
    agentMode: 1,
    convMode: 'office',
    window: 300_000,
    tag: '1.44x',
    efforts: [3, 4, 5, 6, 7],
    vision: true,
    reasoning: true,
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    key: 'person-kimi-k3-261111',
    modeId: '3',
    agentMode: 1,
    convMode: 'office',
    window: 300_000,
    tag: '1.48x',
    efforts: [3, 4, 5, 6, 7],
    vision: true,
    reasoning: true,
  },
  {
    id: 'glm-5.3',
    name: 'GLM 5.3',
    key: 'person-glm-5-3-261111',
    modeId: '3',
    agentMode: 1,
    convMode: 'office',
    window: 300_000,
    tag: '0.80x',
    efforts: [3, 4, 5, 6, 7],
    vision: true,
    reasoning: true,
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM 5.3 Flash',
    key: 'person-glm-5-3-flash-261111',
    modeId: '3',
    agentMode: 1,
    convMode: 'office',
    window: 300_000,
    tag: '0.08x',
    efforts: [3, 4, 5, 6, 7],
    vision: true,
    reasoning: true,
  },
];

/** 默认模型（用户最初点名要的那一个）。 */
export const DEFAULT_MODEL = 'deepseek-v4-pro';

/** 名称归一表：中文显示名、常见误写、原始 key 全部映射到标准 id。 */
const ALIAS_SOURCE = [
  ['自动', 'auto'],
  ['工作任务 Auto', 'auto'],
  ['工作任务Auto', 'auto'],
  ['豆包 2.1 Lite', 'doubao-2.1-lite'],
  ['豆包2.1 Lite', 'doubao-2.1-lite'],
  ['豆包 2.1 Pro', 'doubao-2.1-pro'],
  ['豆包2.1 Pro', 'doubao-2.1-pro'],
  ['快速', 'doubao-fast'],
  ['豆包快速', 'doubao-fast'],
  ['豆包 快速', 'doubao-fast'],
  ['专家', 'doubao-expert'],
  ['豆包专家', 'doubao-expert'],
  ['豆包 专家', 'doubao-expert'],
  ['工作任务 Pro', 'doubao-2.1-pro'],
  ['deepseek v4.1 flash', 'deepseek-v4.1-flash'],
  ['deepseek-v4.1-flash', 'deepseek-v4.1-flash'],
  ['deepseek v4.1 pro', 'deepseek-v4-pro'],
  ['deepseek-v4.1-pro', 'deepseek-v4-pro'],
  ['deepseek v4 pro', 'deepseek-v4-pro'],
  ['deepseek-v4-pro', 'deepseek-v4-pro'],
  ['kimi k3.1 pro 高速', 'kimi-k3.1-pro-highspeed'],
  ['kimi k3.1 pro高速', 'kimi-k3.1-pro-highspeed'],
  ['kimi-k3.1-pro-highspeed', 'kimi-k3.1-pro-highspeed'],
  ['kimi k3.1 pro', 'kimi-k3.1-pro'],
  ['kimi-k3.1-pro', 'kimi-k3.1-pro'],
  ['kimi k3', 'kimi-k3'],
  ['kimi-k3', 'kimi-k3'],
  ['glm 5.3 flash', 'glm-5.3-flash'],
  ['glm-5.3-flash', 'glm-5.3-flash'],
  ['glm 5.3', 'glm-5.3'],
  ['glm-5.3', 'glm-5.3'],
];

const ALIASES = new Map();
for (const [alias, id] of ALIAS_SOURCE) {
  ALIASES.set(alias, id);
  ALIASES.set(alias.toLowerCase(), id);
  ALIASES.set(alias.replace(/\s+/g, ''), id);
  ALIASES.set(alias.toLowerCase().replace(/\s+/g, ''), id);
}
for (const model of MODELS) {
  ALIASES.set(model.id, model.id);
  ALIASES.set(model.id.toLowerCase(), model.id);
  ALIASES.set(model.key, model.id);
  ALIASES.set(model.name, model.id);
}

const BY_ID = new Map(MODELS.map((model) => [model.id, model]));

/** 把任意写法的模型名归一成标准 id；识别不了就返回 null。 */
export function normalizeModelName(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return null;
  const direct = ALIASES.get(text) ?? ALIASES.get(text.toLowerCase());
  if (direct !== undefined) return direct;
  const squeezed = ALIASES.get(text.replace(/\s+/g, '')) ?? ALIASES.get(text.toLowerCase().replace(/\s+/g, ''));
  if (squeezed !== undefined) return squeezed;
  // 去掉 provider 前缀（doubao/deepseek-v4-pro）
  const slash = text.lastIndexOf('/');
  if (slash >= 0 && slash < text.length - 1) {
    const tail = text.slice(slash + 1);
    const hit = ALIASES.get(tail) ?? ALIASES.get(tail.toLowerCase());
    if (hit !== undefined) return hit;
  }
  return null;
}

/** 取模型条目；未知模型回落到默认模型。 */
export function getModel(raw) {
  const id = normalizeModelName(raw);
  if (id !== null && BY_ID.has(id)) {
    return { model: BY_ID.get(id), requested: String(raw ?? ''), known: true };
  }
  return { model: BY_ID.get(DEFAULT_MODEL), requested: String(raw ?? ''), known: false };
}

/** 把请求里的推理强度（数字 3-7、档位名、DSH 的 effort 名）换成豆包 level。 */
export function resolveEffort(raw, model) {
  const allowed = model?.efforts?.length ? model.efforts : [3, 4, 5];
  if (raw === undefined || raw === null || raw === '') return 3;
  const num = Number(raw);
  if (Number.isInteger(num) && num >= 3 && num <= 7) {
    return allowed.includes(num) ? num : allowed[allowed.length - 1];
  }
  const text = String(raw).toLowerCase().trim();
  const byName = EFFORT_LEVELS.find((item) => item.id === text || item.name === text);
  if (byName !== undefined) return allowed.includes(byName.level) ? byName.level : 3;
  const numeric = Number.parseInt(text, 10);
  if (Number.isInteger(numeric) && allowed.includes(numeric)) return numeric;
  return 3;
}

/** OpenAI /v1/models 响应。 */
export function openAiModelList() {
  return {
    object: 'list',
    data: MODELS.map((model) => ({
      id: model.id,
      object: 'model',
      created: 1_760_000_000,
      owned_by: 'doubao-client',
      name: model.name,
      client_name: model.name,
      model_item_key: model.key,
      context_window: model.window,
      max_output_tokens: 32_768,
      input_modalities: model.vision ? ['text', 'image'] : ['text'],
      reasoning: model.reasoning,
      tag: model.tag,
    })),
  };
}

/** 映射成 llm-pi-ai 的 models 配置数组。 */
export function piAiModels(source = MODELS) {
  return source.map((model) => {
    const entry = {
      id: model.id,
      name: model.tag ? `${model.name}（${model.tag}）` : model.name,
      contextWindow: model.window,
      maxTokens: 32_768,
      input: model.vision ? ['text', 'image'] : ['text'],
    };
    if (model.reasoning) {
      entry.reasoningEfforts = {
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      };
    } else {
      entry.reasoningEfforts = false;
    }
    return entry;
  });
}

/** 便于脚本打印的表格行。 */
export function modelTable() {
  return MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    key: model.key,
    tag: model.tag,
    window: model.window,
    convMode: model.convMode,
  }));
}

/* ────────────────────────── 自动选择 ────────────────────────── */

/** 自动入口的模型 id：DSH 里只显示这一个，具体用哪个模型由反代按请求决定。 */
export const AUTO_ID = 'auto';

/** 自动入口在 DSH 模型下拉里的显示名。 */
export const AUTO_DISPLAY_NAME = '自动选择（豆包智能路由）';

/**
 * 按请求特征挑一个真正干活的豆包模型。
 * - 带 tools：deepseek-v4-pro（实测唯一稳定遵守函数调用标记协议的模型）
 * - 带图片：doubao-2.1-pro（vision）
 * - 超长上下文（>250k）：deepseek-v4-pro（300k 窗口）
 * - 其余：auto（豆包侧自动路由，最省额度）
 */
export function pickAutoModel({ hasTools = false, hasImage = false, approxTokens = 0 } = {}) {
  if (hasTools) return BY_ID.get('deepseek-v4-pro');
  if (hasImage) return BY_ID.get('doubao-2.1-pro');
  if (approxTokens > 250_000) return BY_ID.get('deepseek-v4-pro');
  return BY_ID.get('auto');
}

/**
 * 按 exposeMode 决定往 DSH 注入哪些模型。
 * - `custom`（默认）：只列 exposeList 里点名的那些，顺序跟列表一致
 * - `all`：全部 12 个模型都列出来
 * - `auto`：只列一个自动入口（兼容旧配置）
 */
export function exposeModels(mode = 'custom', list = []) {
  if (mode === 'all') return MODELS.slice();
  if (mode === 'auto') return [BY_ID.get(AUTO_ID)];
  const picked = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const id = normalizeModelName(item);
    if (id === null || seen.has(id) || !BY_ID.has(id)) continue;
    seen.add(id);
    picked.push(BY_ID.get(id));
  }
  return picked.length > 0 ? picked : MODELS.slice();
}

/** 粗略估算 token 数（中文按 1 字 1 token，英文按 4 字符 1 token）。 */
export function estimateTokens(messages) {
  let total = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    const content = message?.content;
    if (typeof content === 'string') {
      total += content.length;
      continue;
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part?.text === 'string') total += part.text.length;
        else if (part?.type === 'image_url' || part?.image_url) total += 1_200;
      }
    }
  }
  return total;
}

/** 请求里是否带图片。 */
export function hasImagePart(messages) {
  for (const message of Array.isArray(messages) ? messages : []) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === 'image_url' || part?.type === 'image' || part?.image_url) return true;
    }
  }
  return false;
}
