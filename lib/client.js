/**
 * dsh-llm-doubao 浏览器端：在 DSH 设置里加一个「豆包模型」页面，勾选哪些模型
 * 出现在模型选择列表里。
 *
 * 这个文件是 DSH 客户端模块格式（window.__ModuleLoader__.load），由宿主在
 * 启动时把 factory 注册进浏览器模块表，首次 import 时才执行。它只依赖
 * react / react/jsx-runtime 与 slots 服务，不打包任何第三方库。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-llm-doubao',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const jsxRuntime = require('react/jsx-runtime');
    const jsx = jsxRuntime.jsx;
    const jsxs = jsxRuntime.jsxs;
    const Fragment = jsxRuntime.Fragment;

    /** 反代插件自己的 HTTP 接口（同源，浏览器自动带 GUI 会话凭据）。 */
    const EXPOSE_API = '/api/dsh-llm-doubao/expose';

    const S = {
      section: {
        maxWidth: '760px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        color: 'var(--dsw-alias-label-primary)',
      },
      heading: { margin: 0, fontSize: '18px', fontWeight: 600 },
      intro: {
        margin: 0,
        fontSize: '13px',
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      card: {
        border: '0.5px solid var(--dsw-alias-border-l2)',
        borderRadius: '10px',
        padding: '4px 0',
        display: 'flex',
        flexDirection: 'column',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '9px 14px',
        cursor: 'pointer',
        fontSize: '13px',
        lineHeight: '20px',
      },
      rowName: { flex: '1 1 auto', minWidth: 0 },
      tag: {
        fontSize: '11px',
        padding: '1px 6px',
        borderRadius: '999px',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-tertiary)',
        whiteSpace: 'nowrap',
      },
      id: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      bar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      button: {
        font: 'inherit',
        fontSize: '13px',
        padding: '5px 12px',
        borderRadius: '7px',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
      },
      primary: {
        font: 'inherit',
        fontSize: '13px',
        padding: '5px 14px',
        borderRadius: '7px',
        border: '0.5px solid transparent',
        background: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
        color: '#fff',
        cursor: 'pointer',
      },
      hint: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', margin: 0 },
      error: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #d93025)', margin: 0 },
    };

    /** 一个受控复选框行。 */
    function ModelRow({ model, checked, onToggle }) {
      return jsxs('label', {
        style: S.row,
        children: [
          jsx('input', {
            type: 'checkbox',
            checked,
            onChange: () => onToggle(model.id),
            style: { width: '15px', height: '15px', cursor: 'pointer', flex: '0 0 auto' },
          }),
          jsx('span', { style: S.rowName, children: model.name }),
          model.tag ? jsx('span', { style: S.tag, children: model.tag }) : null,
          jsx('span', { style: S.id, children: model.id }),
        ],
      });
    }

    /**
     * 设置页主体：读 /expose 拿全部模型与当前显示列表，勾选后写回。
     * 写回会立刻触发宿主重新注入 provider，模型下拉即时变化。
     */
    function DoubaoModelsSection() {
      const [status, setStatus] = react.useState('loading');
      const [all, setAll] = react.useState([]);
      const [picked, setPicked] = react.useState(() => new Set());
      const [error, setError] = react.useState('');
      const [notice, setNotice] = react.useState('');
      const [saving, setSaving] = react.useState(false);

      const load = react.useCallback(async () => {
        try {
          const response = await fetch(EXPOSE_API, { headers: { accept: 'application/json' } });
          const data = await response.json();
          if (!data.ok) throw new Error(data.message || '读取失败');
          setAll(Array.isArray(data.all) ? data.all : []);
          setPicked(new Set((data.shown || []).map((model) => model.id)));
          setStatus('ready');
          setError('');
        } catch (cause) {
          setStatus('error');
          setError(String(cause?.message ?? cause));
        }
      }, []);

      react.useEffect(() => {
        void load();
      }, [load]);

      const toggle = react.useCallback((id) => {
        setPicked((previous) => {
          const next = new Set(previous);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        setNotice('');
      }, []);

      const save = react.useCallback(async () => {
        setSaving(true);
        setNotice('');
        try {
          const models = all.filter((model) => picked.has(model.id)).map((model) => model.id);
          const response = await fetch(EXPOSE_API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ models }),
          });
          const data = await response.json();
          if (!data.ok) throw new Error(data.message || '保存失败');
          setNotice(`已保存，模型选择列表现在显示 ${(data.shown || []).length} 个模型`);
          await load();
        } catch (cause) {
          setNotice(`保存失败：${String(cause?.message ?? cause)}`);
        } finally {
          setSaving(false);
        }
      }, [all, picked, load]);

      if (status === 'loading') {
        return jsx('div', { style: S.section, children: jsx('p', { style: S.hint, children: '正在读取豆包模型列表…' }) });
      }
      if (status === 'error') {
        return jsxs('div', {
          style: S.section,
          children: [
            jsx('h2', { style: S.heading, children: '豆包模型' }),
            jsx('p', { style: S.error, children: `读取失败：${error}` }),
            jsx('p', {
              style: S.hint,
              children: '确认 dsh-llm-doubao 插件已启用、反代已启动（默认 127.0.0.1:8790）。',
            }),
            jsx('div', {
              style: S.bar,
              children: jsx('button', { type: 'button', style: S.button, onClick: () => { setStatus('loading'); void load(); }, children: '重试' }),
            }),
          ],
        });
      }

      const count = picked.size;
      return jsxs('div', {
        style: S.section,
        children: [
          jsx('h2', { style: S.heading, children: '豆包模型' }),
          jsx('p', {
            style: S.intro,
            children: '勾选要出现在 DSH 模型选择列表里的豆包模型。没勾的模型不会显示，但仍然可以通过模型 id 直接调用。',
          }),
          jsx('div', {
            style: S.card,
            children: all.map((model) =>
              jsx(ModelRow, { model, checked: picked.has(model.id), onToggle: toggle }, model.id),
            ),
          }),
          jsxs('div', {
            style: S.bar,
            children: [
              jsx('button', {
                type: 'button',
                style: S.primary,
                disabled: saving,
                onClick: () => { void save(); },
                children: saving ? '保存中…' : `保存（已选 ${count} 个）`,
              }),
              jsx('button', {
                type: 'button',
                style: S.button,
                onClick: () => { setPicked(new Set(all.map((model) => model.id))); setNotice(''); },
                children: '全选',
              }),
              jsx('button', {
                type: 'button',
                style: S.button,
                onClick: () => { setPicked(new Set()); setNotice(''); },
                children: '全不选',
              }),
              jsx('button', {
                type: 'button',
                style: S.button,
                onClick: () => {
                  const defaults = ['deepseek-v4-pro', 'deepseek-v4.1-flash', 'kimi-k3.1-pro', 'glm-5.3', 'doubao-2.1-pro'];
                  setPicked(new Set(defaults.filter((id) => all.some((model) => model.id === id))));
                  setNotice('');
                },
                children: '恢复默认',
              }),
            ],
          }),
          notice ? jsx('p', { style: S.hint, children: notice }) : null,
          jsx('p', {
            style: S.hint,
            children: '保存后立即生效：宿主会重新注入 provider，模型下拉马上刷新，不需要重启。',
          }),
        ],
      });
    }

    /** 客户端插件需要的服务：只用到 slot 注册。 */
    const inject = ['slots'];

    /**
     * 把「豆包模型」注册成设置里的一个分区。
     * @param ctx 客户端根 context。
     */
    function apply(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'doubao-models',
            order: 60,
            label: () => '豆包模型',
          },
          DoubaoModelsSection,
        ),
      );
    }

    exports.inject = inject;
    exports.apply = apply;
    exports.DoubaoModelsSection = DoubaoModelsSection;
    return module.exports;
  },
});
