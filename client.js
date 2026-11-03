/**
 * dsh-whale-whispers — 鲸语（Client 半边）
 *
 * 挂在会话头部 tab 里（对话 / 轨迹 / 刷过的视频 / 上下文 / 鲸语），设置页也留一份。
 * 1.3.0 起：
 *   - 点进来才读文件（不轮询、后台不花一分钱）；
 *   - 每句右边有 ✕，两下确认后直接从文件里删；
 *   - 顶部能「改名」「换语录文件」，还有导出（复制 / 下载 .md / 匿名版）。
 * 注册 id 必须等于 loader entry 名（dsh-whale-whispers）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-whale-whispers',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /* ---------- 数据 ---------- */

    function useQuotes() {
      const [tick, setTick] = React.useState(0)
      const [state, setState] = React.useState({
        loading: true, title: '鲸语', source: '', items: [], error: null,
      })

      React.useEffect(() => {
        let alive = true
        fetch('/dsh-quotes.json', { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => {
            if (!alive) return
            setState({
              loading: false,
              title: (j && j.title) || '鲸语',
              source: (j && j.source) || '',
              items: (j && j.items) || [],
              error: j && j.ok === false ? j.error : null,
            })
          })
          .catch((e) => {
            if (alive) {
              setState({ loading: false, title: '鲸语', source: '', items: [], error: String((e && e.message) || e) })
            }
          })
        return () => { alive = false }
      }, [tick])

      const reload = React.useCallback(() => setTick((n) => n + 1), [])
      return { ...state, reload }
    }

    /** 面板重新可见（切到鲸语 tab）时重读一次；后台不轮询。 */
    function useRefreshWhenVisible(reload) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        const node = ref.current
        if (!node || typeof IntersectionObserver !== 'function') return undefined
        let seen = false
        const io = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            if (!seen) { seen = true; continue }
            reload()
          }
        }, { threshold: 0.01 })
        io.observe(node)
        return () => io.disconnect()
      }, [reload])
      return ref
    }

    const b64 = (value) => {
      const bytes = new TextEncoder().encode(String(value))
      let bin = ''
      for (const byte of bytes) bin += String.fromCharCode(byte)
      return btoa(bin)
    }

    /* ---------- 样式 ---------- */

    const S = {
      wrap: { padding: '18px 22px 40px', maxWidth: 820, fontSize: 13, lineHeight: 1.7 },
      head: { display: 'flex', alignItems: 'baseline', gap: 10, margin: '0 0 4px' },
      title: { fontSize: 16, fontWeight: 600, margin: 0 },
      count: { opacity: 0.55, fontSize: 12 },
      sub: { opacity: 0.6, fontSize: 12, margin: '0 0 6px' },
      dim: { opacity: 0.65 },
      bar: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '2px 0 16px' },
      btn: {
        padding: '4px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
        border: '1px solid var(--dsh-border, rgba(128,128,128,.35))',
        background: 'transparent', color: 'inherit',
      },
      input: {
        padding: '4px 10px', borderRadius: 8, fontSize: 12, width: 200,
        border: '1px solid var(--dsh-border, rgba(128,128,128,.45))',
        background: 'transparent', color: 'inherit', outline: 'none',
      },
      inputWide: {
        padding: '4px 10px', borderRadius: 8, fontSize: 12, width: 380,
        border: '1px solid var(--dsh-border, rgba(128,128,128,.45))',
        background: 'transparent', color: 'inherit', outline: 'none',
      },
      date: { opacity: 0.5, fontSize: 11, letterSpacing: '.08em', margin: '18px 0 6px' },
      item: { margin: '0 0 10px', paddingLeft: 14, borderLeft: '2px solid var(--dsh-border, rgba(128,128,128,.28))' },
      note: { opacity: 0.55, fontSize: 11, marginTop: 3 },
      ctx: { opacity: 0.6, fontSize: 11.5, marginTop: 4, paddingLeft: 2, borderLeft: '2px dotted var(--dsh-border, rgba(128,128,128,.25))' },
      del: { opacity: 0.32, fontSize: 11, cursor: 'pointer', marginLeft: 8, userSelect: 'none' },
      row: { display: 'flex', alignItems: 'flex-start', gap: 4 },
    }

    /* ---------- 改名 ---------- */

    function Rename({ title, onDone }) {
      const [open, setOpen] = React.useState(false)
      const [value, setValue] = React.useState(title)
      const [busy, setBusy] = React.useState(false)
      const [err, setErr] = React.useState('')

      const save = async () => {
        const next = value.trim()
        if (!next) { setErr('别留空'); return }
        setBusy(true); setErr('')
        try {
          const r = await fetch('/dsh-quotes.config?b64title=' + encodeURIComponent(b64(next)), { method: 'POST' })
          const j = await r.json()
          if (!j || j.ok !== true) throw new Error((j && j.error) || '保存失败')
          setOpen(false)
          onDone && onDone()
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      if (!open) {
        return h('button', { type: 'button', style: S.btn, onClick: () => { setValue(title); setOpen(true) } }, '改名')
      }
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h('input', {
          style: S.input,
          value,
          maxLength: 40,
          autoFocus: true,
          onChange: (e) => setValue(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setOpen(false)
          },
        }),
        h('button', { type: 'button', style: S.btn, disabled: busy, onClick: save }, busy ? '保存中' : '保存'),
        h('button', { type: 'button', style: S.btn, onClick: () => setOpen(false) }, '取消'),
        err ? h('span', { style: { color: 'crimson', fontSize: 11 } }, err) : null)
    }

    /* ---------- 换文件 ---------- */

    function PathEditor({ source, onDone }) {
      const [open, setOpen] = React.useState(false)
      const [value, setValue] = React.useState(source)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState('')

      const save = async () => {
        const next = value.trim()
        if (!next) { setMsg('别留空'); return }
        setBusy(true); setMsg('')
        try {
          const r = await fetch('/dsh-quotes.config?b64path=' + encodeURIComponent(b64(next)), { method: 'POST' })
          const j = await r.json()
          if (!j || j.ok !== true) throw new Error((j && j.error) || '保存失败')
          setOpen(false)
          if (j.warning) setMsg(j.warning)
          onDone && onDone()
        } catch (e) {
          setMsg(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
        h('span', { style: { ...S.dim, fontSize: 11.5 } }, '语录文件：' + (source || '（读不到，用默认路径）')),
        open
          ? h('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('input', {
                style: S.inputWide,
                value,
                autoFocus: true,
                placeholder: 'D:/dsh work/self/quotes.md',
                onChange: (e) => setValue(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') save()
                  if (e.key === 'Escape') setOpen(false)
                },
              }),
              h('button', { type: 'button', style: S.btn, disabled: busy, onClick: save }, busy ? '保存中' : '保存'),
              h('button', { type: 'button', style: S.btn, onClick: () => setOpen(false) }, '取消'))
          : h('button', { type: 'button', style: S.btn, onClick: () => { setValue(source); setOpen(true) } }, '换文件'),
        msg ? h('span', { style: { color: 'crimson', fontSize: 11 } }, msg) : null)
    }

    /* ---------- 导出 ---------- */

    function exportText(title, items, anonymous) {
      const lines = []
      if (anonymous) {
        lines.push('# ' + title + '（匿名版）', '')
        for (const it of items) lines.push('- ' + it.text)
        return lines.join('\n') + '\n'
      }
      lines.push('# ' + title, '')
      let lastDate = ''
      for (const it of items) {
        if (it.date && it.date !== lastDate) {
          lastDate = it.date
          lines.push('', '## ' + lastDate, '')
        }
        lines.push('- 「' + it.text + '」' + (it.note ? '（' + it.note + '）' : ''))
        if (it.context) lines.push('  ↳ 上文：' + it.context)
      }
      return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
    }

    function download(name, text) {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }

    function ExportBar({ title, items }) {
      const [msg, setMsg] = React.useState('')
      const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 1600) }

      const copyAll = async () => {
        const text = exportText(title, items, false)
        try {
          await navigator.clipboard.writeText(text)
          flash('已复制 ' + items.length + ' 句')
        } catch {
          download(fileNameOf(title) + '.md', text)
          flash('剪贴板不可用，改成下载')
        }
      }

      return h('span', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('button', { type: 'button', style: S.btn, onClick: copyAll }, '复制全部'),
        h('button', {
          type: 'button', style: S.btn,
          onClick: () => { download(fileNameOf(title) + '.md', exportText(title, items, false)); flash('已下载') },
        }, '下载 .md'),
        h('button', {
          type: 'button', style: S.btn, title: '去掉批注和上文，只留句子',
          onClick: () => { download(fileNameOf(title) + '-匿名.md', exportText(title, items, true)); flash('已下载匿名版') },
        }, '匿名版'),
        msg ? h('span', { style: { ...S.dim, fontSize: 11 } }, msg) : null)
    }

    function fileNameOf(title) {
      const safe = String(title || '鲸语').replace(/[\\/:*?"<>|\s]+/g, '-')
      return safe || '鲸语'
    }

    /* ---------- 单句（带删除） ---------- */

    function Item({ item, onChanged }) {
      const [confirming, setConfirming] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [err, setErr] = React.useState('')

      const remove = async () => {
        setBusy(true); setErr('')
        try {
          const r = await fetch('/dsh-quotes.remove?b64=' + encodeURIComponent(b64(item.text)), { method: 'POST' })
          const j = await r.json()
          if (!j || j.ok !== true) throw new Error((j && j.error) || '删不掉')
          onChanged && onChanged()
        } catch (e) {
          setErr(String((e && e.message) || e))
          setBusy(false)
        }
      }

      return h('div', { style: S.item },
        h('div', { style: S.row },
          h('div', { style: { flex: 1 } }, item.text),
          confirming
            ? h('span', { style: { display: 'flex', gap: 4 } },
                h('button', { type: 'button', style: { ...S.btn, padding: '2px 8px' }, disabled: busy, onClick: remove }, busy ? '删…' : '删'),
                h('button', { type: 'button', style: { ...S.btn, padding: '2px 8px' }, onClick: () => setConfirming(false) }, '算了'))
            : h('span', {
                style: S.del,
                title: '删掉这一句',
                onClick: () => setConfirming(true),
              }, '✕')),
        item.context ? h('div', { style: S.ctx }, '上文：' + item.context) : null,
        item.note ? h('div', { style: S.note }, item.note) : null,
        err ? h('div', { style: { color: 'crimson', fontSize: 11 } }, err) : null)
    }

    /* ---------- 面板 ---------- */

    function Panel() {
      const { loading, title, source, items, error, reload } = useQuotes()
      const rootRef = useRefreshWhenVisible(reload)

      const groups = React.useMemo(() => {
        const map = new Map()
        for (const it of items) {
          const key = it.date || ''
          if (!map.has(key)) map.set(key, [])
          map.get(key).push(it)
        }
        return Array.from(map.entries()).reverse()
      }, [items])

      if (loading) {
        return h('div', { ref: rootRef, style: { padding: '18px 22px', opacity: 0.65, fontSize: 13 } }, '读语录…')
      }

      return h('div', { ref: rootRef, style: S.wrap },
        h('div', { style: { ...S.head, justifyContent: 'space-between' } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10 } },
            h('h2', { style: S.title }, title),
            h('span', { style: S.count }, items.length ? items.length + ' 句' : '还没有')),
          h(Rename, { title, onDone: reload })),
        h('p', { style: S.sub }, '随口说的、被记下来的、他读过的那几句。'),
        h('div', { style: S.bar },
          h(ExportBar, { title, items }),
          h('span', { style: { flex: 1 } }),
          h(PathEditor, { source, onDone: reload })),
        error ? h('div', { style: { color: 'crimson', padding: '8px 0' } }, '读不到：' + error) : null,
        groups.length === 0 && !error
          ? h('div', { style: S.dim }, '还没有句子。写进 quotes.md 就会出现在这里。')
          : groups.map(([date, list]) =>
              h('div', { key: date },
                date ? h('div', { style: S.date }, date) : null,
                list.slice().reverse().map((it, i) =>
                  h(Item, { key: (date || '') + ':' + i, item: it, onChanged: reload })))))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return

        slots.inject('conversation.view', () => slots.register({
          name: 'conversation.view',
          id: 'whale-whispers',
          order: 31,
          label: '鲸语',
        }, () => h(Panel)))

        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'dsh-whale-whispers', order: 30, label: '鲸语' },
          () => h(Panel),
        ))
      },
    }
  },
})
