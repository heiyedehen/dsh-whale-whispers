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

    function useQuotes(convParam, sidParam) {
      const [tick, setTick] = React.useState(0)
      const [state, setState] = React.useState({
        loading: true, title: '鲸语', source: '', items: [], error: null, disabled: [], level: 'normal', rule: '', convRule: '', captureRules: {}, removed: [], convs: [], trashAuto: false, trashDays: 30,
      })

      React.useEffect(() => {
        let alive = true
        const params = []
        if (convParam) params.push('conv=' + encodeURIComponent(convParam))
        if (sidParam) params.push('b64sid=' + encodeURIComponent(b64(String(sidParam))))
        const url = '/dsh-quotes.json' + (params.length ? '?' + params.join('&') : '')
        fetch(url, { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => {
            if (!alive) return
            setState({
              loading: false,
              title: (j && j.title) || '鲸语',
              source: (j && j.source) || '',
              items: (j && j.items) || [],
              disabled: (j && j.disabledConversations) || [],
              captureRules: (j && j.captureRules) || {},
              removed: (j && j.removed) || [],
              trash: (j && j.trash) || [],
              level: (j && (j.level || j.captureLevel)) || 'normal',
          manualAdd: !(j && j.manualAdd === false),
          msgAction: !(j && j.msgAction === false),
          trashAuto: (j && j.trashAuto) === true,
          trashDays: Number((j && j.trashDays) || 30),
              rule: (j && j.captureRule) || '',
              convRule: (j && j.convRule) || '',
              convs: (j && j.convs) || [],
              error: j && j.ok === false ? j.error : null,
            })
          })
          .catch((e) => {
            if (alive) {
              setState({ loading: false, title: '鲸语', source: '', items: [], error: String((e && e.message) || e), disabled: [], level: 'normal' })
            }
          })
        return () => { alive = false }
      }, [tick, convParam])

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

    function Rename({ title, conv, onDone }) {
      const [open, setOpen] = React.useState(false)
      const [value, setValue] = React.useState(conv || title)
      const [busy, setBusy] = React.useState(false)
      const [err, setErr] = React.useState('')

      const save = async () => {
        const next = value.trim()
        if (!next) { setErr('别留空'); return }
        setBusy(true); setErr('')
        try {
          const url = conv
            ? '/dsh-quotes.renameconv?b64from=' + encodeURIComponent(b64(conv)) + '&b64to=' + encodeURIComponent(b64(next))
            : '/dsh-quotes.config?b64title=' + encodeURIComponent(b64(next))
          const r = await fetch(url, { method: 'POST' })
          const j = await r.json()
          if (!j || j.ok !== true) throw new Error((j && j.error) || '保存失败')
          setOpen(false)
          onDone && onDone(next)
        } catch (e) {
          setErr(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      if (!open) {
        return h('button', { type: 'button', style: S.btn, onClick: () => { setValue(conv || title); setOpen(true) } }, '改名')
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

    function ExportBar({ title, items, name }) {
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
          type: 'button', style: S.btn, title: '去掉批注和上文，只留句子',
          onClick: () => { download(fileNameOf(name || title) + '匿名.md', exportText(name || title, items, true)); flash('已下载匿名版') },
        }, '匿名版'),
        msg ? h('span', { style: { ...S.dim, fontSize: 11 } }, msg) : null)
    }

    function fileNameOf(title) {
      const safe = String(title || '鲸语').replace(/[\\/:*?"<>|\s]+/g, '-')
      return safe || '鲸语'
    }

    /* ---------- 单句（带删除） ---------- */

    /* 搜索命中处加底色 */
    function hl(text, needle) {
      const t = String(text || '')
      const n = String(needle || '').trim()
      if (!n) return t
      const low = t.toLowerCase()
      const key = n.toLowerCase()
      const parts = []
      let i = 0
      for (;;) {
        const at = low.indexOf(key, i)
        if (at < 0) { parts.push(t.slice(i)); break }
        if (at > i) parts.push(t.slice(i, at))
        parts.push(h('mark', { key: 'm' + at, style: { background: 'rgba(255,214,0,.55)', padding: 0, borderRadius: 2 } }, t.slice(at, at + key.length)))
        i = at + key.length
      }
      return parts
    }

    function Item({ item, onChanged, showSource, conv, canDelete = true, q = '' }) {
      const [confirming, setConfirming] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [err, setErr] = React.useState('')
      const [copied, setCopied] = React.useState('')

      const remove = async () => {
        setBusy(true); setErr('')
        try {
          const r = await fetch('/dsh-quotes.remove?b64=' + encodeURIComponent(b64(item.text)) + '&conv=' + encodeURIComponent(item.conversation || conv || ''), { method: 'POST' })
          const j = await r.json()
          if (!j || j.ok !== true) throw new Error((j && j.error) || '删不掉')
          setConfirming(false); setBusy(false); setErr('')
          onChanged && onChanged()
        } catch (e) {
          setErr(String((e && e.message) || e))
          setBusy(false)
        }
      }

      return h('div', { style: S.item },
        h('div', { style: S.row },
          h('div', { style: { flex: 1 } }, hl(item.text, q)),
          h('span', {
            style: { cursor: 'pointer', padding: '0 6px', userSelect: 'none', opacity: 0.55 },
            title: '复制这一句',
            onClick: async () => {
              try {
                if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                  await navigator.clipboard.writeText(item.text)
                } else {
                  const ta = document.createElement('textarea')
                  ta.value = item.text
                  document.body.appendChild(ta)
                  ta.select()
                  document.execCommand('copy')
                  ta.remove()
                }
                setCopied(item.text)
                setTimeout(() => setCopied(''), 1200)
              } catch (e) {
                setErr('复制失败：' + String((e && e.message) || e))
              }
            },
          }, copied === item.text ? '✓' : '⧉'),
          h('span', {
            style: { cursor: 'pointer', padding: '0 6px', userSelect: 'none', opacity: item.fav ? 1 : 0.45 },
            title: item.fav ? '取消收藏' : '收藏这句',
            onClick: async () => {
              try {
                const r = await fetch('/dsh-quotes.fav?b64=' + encodeURIComponent(b64(item.text)) + '&on=' + (item.fav ? '0' : '1') + '&conv=' + encodeURIComponent(item.conversation || ''), { method: 'POST' })
                const j = await r.json()
                if (!j || j.ok !== true) throw new Error((j && j.error) || '收藏失败')
                onChanged && onChanged()
              } catch (e) {
                setErr(String((e && e.message) || e))
              }
            },
          }, item.fav ? '★' : '☆'),
          canDelete
            ? (confirming
              ? h('span', { style: { display: 'flex', gap: 4 } },
                  h('button', { type: 'button', style: { ...S.btn, padding: '2px 8px', minWidth: 42 }, disabled: busy, onClick: remove }, busy ? '删…' : '删'),
                  h('button', { type: 'button', style: { ...S.btn, padding: '2px 8px', minWidth: 42 }, onClick: () => setConfirming(false) }, '算了'))
              : h('span', {
                  style: S.del,
                  title: '删掉这一句',
                  onClick: () => setConfirming(true),
                }, '✕'))
            : null),
        item.context ? h('div', { style: S.ctx }, '上文：' + item.context) : null,
        showSource && item.conversation
          ? h('div', { style: { ...S.ctx, opacity: 0.75 } }, '收录自：' + item.conversation)
          : null,
        item.note ? h('div', { style: S.note }, item.note) : null,
        err ? h('div', { style: { color: 'crimson', fontSize: 11 } }, err) : null)
    }

    /* ---------- 面板 ---------- */

    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null } }
      static getDerivedStateFromError(e) { return { err: String((e && e.message) || e) } }
      render() {
        if (this.state.err) {
          return h('div', { style: { padding: 14, color: 'crimson', fontSize: 12 } }, '鲸语渲染出错：' + this.state.err)
        }
        return this.props.children
      }
    }

    function readReplyText(btn) {
      var clean = function (s) {
        var t = String(s || "");
        t = t.replace(/\s*\n+\s*/g, " ");
        t = t.replace(/\s{2,}/g, " ").trim();
        t = t.replace(/^(\u590d\u5236|\u6536\u85cf|\u5220\u9664|\u9cb8\u8bed|\u6717\u8bfb|\u5206\u4eab|\u66f4\u591a)\s*/g, "");
        t = t.replace(/\s*(\u590d\u5236|\u6536\u85cf|\u5220\u9664|\u9cb8\u8bed|\u6717\u8bfb|\u5206\u4eab|\u66f4\u591a)$/g, "").trim();
        return t;
      };
      // 1) sibling strategy: a message block is usually [body, action-bar]
      var node = btn;
      for (var i = 0; i < 10 && node && node.parentElement; i += 1) {
        var parent = node.parentElement;
        var kids = Array.prototype.slice.call(parent.children || []);
        if (kids.length >= 2) {
          var best = "";
          for (var k = 0; k < kids.length; k += 1) {
            var kid = kids[k];
            if (kid === node || kid.contains(btn)) continue;
            try {
              if (kid.querySelectorAll && kid.querySelectorAll("button").length > 2) continue;
            } catch (e) {}
            var t = clean(kid.innerText);
            if (t.length > best.length) best = t;
          }
          if (best.length >= 8 && !/^\u7528\u91cf\s*[\d.]+\s*[kKmM]?\s*tok/i.test(best)) return best.slice(0, 400);
        }
        node = parent;
      }
      // 2) fallback: nearest markdown-ish container with buttons stripped
      var SEL = '[class*="markdown"], [class*="prose"], [class*="message-content"], [class*="MessageBody"], [class*="message-body"], [class*="MessageText"]';
      var up = btn && btn.parentElement ? btn.parentElement : null;
      for (var d = 0; d < 16 && up; d += 1) {
        if (up.matches && up.matches(SEL)) {
          try {
            var clone = up.cloneNode(true);
            var junk = clone.querySelectorAll("button");
            for (var b = 0; b < junk.length; b += 1) { if (junk[b].parentElement) junk[b].parentElement.removeChild(junk[b]); }
            var txt = clean(clone.innerText || clone.textContent || "");
            if (txt.length >= 8) return txt.slice(0, 400);
          } catch (e) {}
        }
        up = up.parentElement;
      }
      return "";
    }

    function MsgAction({ messageId, sessionId }) {
  const [state, setState] = React.useState('idle')
  const [errMsg, setErrMsg] = React.useState('')
  React.useEffect(() => {
    let alive = true
    fetch('/dsh-quotes.json', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (alive && j && j.msgAction === false) setState('off') })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  if (state === 'off') return null
  const b64 = (v) => {
    try { return btoa(unescape(encodeURIComponent(String(v || '')))) } catch { return '' }
  }
  const click = async (ev) => {
    const text = readReplyText(ev.currentTarget)
    // 不靠 DOM 拼文本：把 messageId 一并送给宿主，由事件日志取真正那一条
    if (!text && !messageId) { setState('err'); return }
    try {
      const url = '/dsh-quotes.add?b64text=' + encodeURIComponent(b64(text))
        + '&b64sid=' + encodeURIComponent(b64(sessionId || ''))
        + '&b64conv=' + encodeURIComponent(b64(''))
        + '&b64mid=' + encodeURIComponent(b64(messageId || ''))
      const r = await fetch(url, { method: 'POST' })
      const j = await r.json()
      if (j && j.ok) setState(j.duplicate ? 'dup' : 'done')
      else { setErrMsg((j && j.error) || ''); setState('err') }
    } catch { setState('err') }
    setTimeout(() => setState('idle'), 2000)
  }
  const done = state === 'done' || state === 'dup'
  const svgProps = {
    viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
    style: { display: 'block' },
  }
  const icon = state === 'err'
    ? h('svg', svgProps, h('circle', { cx: 8, cy: 8, r: 5.6 }), h('path', { d: 'M8 5v3.4' }), h('circle', { cx: 8, cy: 11, r: 0.6, fill: 'currentColor', stroke: 'none' }))
    : done
      ? h('svg', svgProps, h('path', { d: 'M3.4 8.4l3.1 3.1 6.1-6.4' }))
      : h('svg', svgProps, h('path', { d: 'M4.2 2.6h7.6v10.8L8 10.9l-3.8 2.5z' }))
  const title = state === 'err' ? (errMsg || '没读到这条回复的文字') : done ? '已收进鲸语' : '把这条回复收进鲸语'
  return h('button', {
    type: 'button',
    title,
    'aria-label': title,
    onClick: click,
    style: { background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, color: state === 'err' ? '#c0392b' : 'inherit', opacity: done ? 1 : 0.7 },
  }, icon)
}

function Settings({ title = '', conv = '', removed = [], trash = [], trashAuto: trashAutoProp = false, trashDays: trashDaysProp = 30, items = [], source = '', disabled = [], level: levelProp, version = '', rule: ruleProp = '', convRule: convRuleProp = '', manualAdd: manualAddProp = true, msgAction: msgActionProp = true, onDone = () => {} }) {
      const LABEL = { conservative: '保守', normal: '正常', eager: '积极' }
      const [level, setLevel] = React.useState(typeof levelProp === 'string' ? levelProp : 'normal')
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [msgScope, setMsgScope] = React.useState('')
      const [removedList, setRemovedList] = React.useState(() => (removed || []).slice())
      const [trashAuto, setTrashAuto] = React.useState(trashAutoProp === true)
      const [trashDays, setTrashDays] = React.useState(String(trashDaysProp || 30))
      const [trashBusy, setTrashBusy] = React.useState(false)
      const [trashOpen, setTrashOpen] = React.useState(false)
      const [trashList, setTrashList] = React.useState(() => (trash || []).slice())
      const [convBusy, setConvBusy] = React.useState(false)
      const [update, setUpdate] = React.useState(null)
      const [checkedAt, setCheckedAt] = React.useState('')
      const [off, setOff] = React.useState(() => (disabled || []).slice())
      const [rule, setRule] = React.useState(ruleProp || '')
      const [ruleScope, setRuleScope] = React.useState('global')
      const [ruleGlobal, setRuleGlobal] = React.useState(ruleProp || '')
      const [ruleConv, setRuleConv] = React.useState(convRuleProp || '')
      const [manualAdd, setManualAdd] = React.useState(manualAddProp !== false)
      const [msgAction, setMsgAction] = React.useState(msgActionProp !== false)
      const [msgBusy, setMsgBusy] = React.useState(false)
      const [manualBusy, setManualBusy] = React.useState(false)
      const convs = React.useMemo(() => {
        const seen = []
        ;(items || []).forEach((it) => {
          const name = (it && it.conversation) || ''
          if (seen.indexOf(name) < 0) seen.push(name)
        })
        return seen.sort((x, y) => (x || '').localeCompare(y || ''))
      }, [items])
      const fileRef = React.useRef(null)
      const say = (text, where) => {
        setMsg(text)
        setMsgScope(typeof where === 'string' ? where : '')
        setTimeout(() => setMsg(''), 4000)
      }
      const S2 = (where, text) => say(text, where)

      const toggleConv = async (name) => {
        const on = off.indexOf(name) >= 0
        setBusy('开关')
        try {
          const r = await fetch('/dsh-quotes.enable?b64conv=' + encodeURIComponent(b64(name)) + '&on=' + (on ? '1' : '0'), { method: 'POST' })
          const j = await r.json()
          if (j && j.ok === true) {
            setOff((prev) => (on ? prev.filter((x) => x !== name) : prev.concat([name])))
            S2('对话', (name || '未标注对话') + (on ? '：已启用' : '：已停用'))
          } else S2('对话', '没改成：' + ((j && j.error) || '未知原因'))
        } finally { setBusy('') }
      }

      const backupThis = () => {
        download(fileNameOf(conv || title) + '.md', exportText(conv || title, items, false))
        S2('备份/下载', '备份已下载')
      }

      const backupAll = async () => {
        setBusy('备份')
        try {
          const r = await fetch('/dsh-quotes.json')
          const j = await r.json()
          const all = (j && j.items) || []
          if (!all.length) { S2('备份/下载', '还没有句子'); return }
          download('鲸语-全部-' + new Date().toISOString().slice(0, 10) + '.md', exportText('鲸语全部', all, false))
          S2('备份/下载', '已导出 ' + all.length + ' 句')
        } catch (e) {
          S2('备份/下载', '导出失败：' + String((e && e.message) || e))
        } finally { setBusy('') }
      }

      const restore = async (file) => {
        if (!file) return
        setBusy('恢复')
        try {
          const text = await file.text()
          const r = await fetch('/dsh-quotes.import?b64=' + encodeURIComponent(b64(text)), { method: 'POST' })
          const j = await r.json()
          if (j && j.ok === true) { S2('恢复', '已恢复 ' + j.items + ' 句'); onDone() }
          else S2('恢复', '没恢复：' + ((j && j.error) || '未知原因'))
        } finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
      }

      const check = async () => {
        setBusy('检查更新')
        try {
          const r = await fetch('/dsh-quotes.update', { cache: 'no-store' })
          const j = await r.json()
          setUpdate(j)
          const d0 = new Date()
          setCheckedAt(String(d0.getHours()).padStart(2, '0') + ':' + String(d0.getMinutes()).padStart(2, '0'))
          S2('更新', j && j.latest ? ('最新版 ' + j.latest) : '查不到最新版（可能没联网）')
        } finally { setBusy('') }
      }

      React.useEffect(() => {
        fetch('/dsh-quotes.update', { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => {
            if (j && j.current) {
              setUpdate(j)
              const d1 = new Date()
              setCheckedAt(String(d1.getHours()).padStart(2, '0') + ':' + String(d1.getMinutes()).padStart(2, '0'))
            }
          })
          .catch(() => { /* 没网就算了 */ })
      }, [])

      const copy = async () => {
        const cmd = (update && update.command) || 'dsh plugin add dsh-whale-whispers@latest'
        try { await navigator.clipboard.writeText(cmd); S2('更新', '更新命令已复制，粘到对话框发给我就行') } catch { S2('更新', cmd) }
      }

      const row = (label, node, hint) =>
        h('div', { style: { padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,.07)' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('span', { style: { minWidth: 96, fontSize: 13 } }, label), node,
            msg && msgScope === String(label)
              ? h('span', { style: { fontSize: 12, color: '#1a7f37' } }, msg)
              : null),
          hint ? h('div', { style: { ...S.dim, fontSize: 11.5, marginTop: 4 } }, hint) : null)

      return h('div', {
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
        onClick: (e) => { if (e.target === e.currentTarget) onDone() },
      },
        h('div', { style: { background: 'var(--dsh-bg, #fff)', borderRadius: 12, padding: '16px 20px', width: 'min(520px, 92vw)', maxHeight: '82vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.25)' } },
          h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 6 } },
            h('div', { style: { fontSize: 14, fontWeight: 600 } }, '鲸语设置'),
            h('span', { style: { flex: 1 } }),
            h('button', { type: 'button', style: S.btn, onClick: onDone }, '关闭')),
          h('div', { style: { ...S.dim, fontSize: 11.5, marginBottom: 8 } }, '文件：' + source),
          row('对话', convs.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 170, overflow: 'auto', minWidth: 250 } },
                convs.map((name) => {
                  const on = off.indexOf(name) < 0
                  return h('div', { key: name || '__none', style: { display: 'flex', alignItems: 'center', gap: 8 } },
                    h('span', { style: { fontSize: 12, flex: 1 } },
                      (name || '未标注对话') + ' · ' + (on ? '已启用' : '未启用')),
                    h('button', {
                      type: 'button',
                      title: on ? '点一下停用' : '点一下启用',
                      style: {
                        width: 38, height: 20, borderRadius: 10, border: 'none', padding: 0, cursor: 'pointer',
                        background: on ? '#1a7f37' : 'rgba(0,0,0,.22)', position: 'relative', opacity: busy ? 0.6 : 1,
                      },
                      onClick: () => toggleConv(name),
                    }, h('span', {
                      style: {
                        position: 'absolute', top: 2, left: on ? 20 : 2, width: 16, height: 16, borderRadius: 8,
                        background: '#fff', transition: 'left .15s',
                      },
                    })))
                }))
            : h('span', { style: S.dim }, '还没有句子，暂无可开关的对话'),
            '每个对话单独开关；停用后这个对话不再记新句子，已有的还在'),
          row('备份/下载', h('span', { style: { display: 'flex', gap: 6 } },
            h('button', { type: 'button', style: S.btn, onClick: backupThis }, '这本（.md）'),
            h('button', { type: 'button', style: S.btn, disabled: busy === '备份', onClick: backupAll }, busy === '备份' ? '导出中…' : '全部（.md）')), '都是下载到本机；这本：只导当前这本；全部：把每本合成一份。都含批注与上文'),
          row('恢复', h('span', null,
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: '.md,.txt',
              style: { fontSize: 12 },
              onChange: (e) => restore(e.target.files && e.target.files[0]),
            })), '选一份之前备份的 .md 覆盖当前文件（旧文件会另存一份 .before-restore-…）'),
          row('更新', h('span', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h('button', { type: 'button', style: { ...S.btn, opacity: busy ? 0.6 : 1 }, onClick: check }, '检测更新'),
            h('button', { type: 'button', style: S.btn, onClick: copy }, '复制更新命令'),
            h('span', { style: { fontSize: 12, color: '#888' } }, 'v' + ((update && update.current) || version || '—'))),
            update
              ? ('当前 ' + (update.current || '?') + ' · npm ' + (update.latest || '?') + (update.ahead ? '（本地这版还没发布）' : update.outdated ? '（可以更新）' : '（已是最新）') + (update.outdated ? '；更新命令粘到对话框发给我即可' : '') + (checkedAt ? ' · 检查于 ' + checkedAt : ''))
              : '更新命令：dsh plugin add dsh-whale-whispers@latest'),
          row('手动加一句', h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('button', {
            type: 'button',
            disabled: manualBusy,
            onClick: async () => {
              const next = !manualAdd
              setManualBusy(true)
              try {
                const r = await fetch('/dsh-quotes.config?b64add=' + encodeURIComponent(b64(next ? 'true' : 'false')), { method: 'POST' })
                const j = await r.json()
                if (!j || j.ok !== true) throw new Error((j && j.error) || '没存上')
                setManualAdd(next)
                S2('手动加一句', next ? '已开启：面板上会显示「加一句」' : '已关闭：面板上不显示「加一句」')
              } catch (e) {
                S2('手动加一句', '失败：' + String((e && e.message) || e))
              } finally { setManualBusy(false) }
            },
            style: { position: 'relative', width: 38, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', padding: 0, background: manualAdd ? '#1a7f37' : 'rgba(0,0,0,.22)' },
          }, h('span', { style: { position: 'absolute', top: 2, left: manualAdd ? 20 : 2, width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'left .15s' } })),
          h('span', { style: { ...S.dim, fontSize: 12 } }, manualAdd ? '已启用' : '已停用')),
          '关掉后，面板工具条上不再显示「加一句」，语录照样自动记'),
          row('回复旁的鲸语按钮',
            h('span', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('button', {
                type: 'button',
                disabled: msgBusy,
                onClick: async () => {
                  const next = !msgAction
                  setMsgBusy(true)
                  try {
                    const r = await fetch('/dsh-quotes.config?b64msgact=' + encodeURIComponent(b64(next ? 'true' : 'false')), { method: 'POST' })
                    const j = await r.json()
                    if (!j || j.ok !== true) throw new Error((j && j.error) || '没存上')
                    setMsgAction(next)
                    S2('回复旁的鲸语按钮', next ? '已开启：每条回复下会多一个「鲸语」按钮' : '已关闭：回复下面不再显示「鲸语」按钮')
                  } catch (e) {
                    S2('回复旁的鲸语按钮', '失败：' + String((e && e.message) || e))
                  } finally { setMsgBusy(false) }
                },
                style: { position: 'relative', width: 38, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', padding: 0, background: msgAction ? '#1a7f37' : 'rgba(0,0,0,.22)' },
              }, h('span', { style: { position: 'absolute', top: 2, left: msgAction ? 20 : 2, width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'left .15s' } })),
              h('span', { style: { ...S.dim, fontSize: 12 } }, msgAction ? '已启用' : '已停用')),
            '开着时，每条回复下面多一个「鲸语」按钮，点一下就能把这段回复收进语录；关掉后按钮不显示。'),

        row('记什么', h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260 } },
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h('button', {
                type: 'button',
                title: '所有对话都用这一条规则',
                style: { ...S.btn, opacity: ruleScope === 'global' ? 1 : 0.6 },
                onClick: () => { setRuleScope('global'); setRule(ruleGlobal) },
              }, '全局'),
              h('button', {
                type: 'button',
                title: conv ? ('只给「' + conv + '」用') : '先在目录里选一个对话',
                style: { ...S.btn, opacity: ruleScope === 'conv' ? 1 : 0.6 },
                onClick: () => {
                  if (!conv) { S2('记什么', '先在目录里选一个对话，再写它自己的规则'); return }
                  setRuleScope('conv'); setRule(ruleConv)
                },
              }, '本对话'),
              h('span', { style: { ...S.dim, fontSize: 11.5 } },
                ruleScope === 'conv' && conv ? ('只作用于「' + conv + '」') : '作用于所有对话')),
            h('textarea', {
              value: rule,
              rows: 3,
              placeholder: '例如：记住我提过的机器配置、答应过的事、正在做的项目进度',
              onChange: (e) => setRule(e.target.value),
              style: { width: '100%', fontSize: 12, lineHeight: 1.5, padding: 6, borderRadius: 6, border: '1px solid rgba(0,0,0,.18)', background: 'transparent', resize: 'vertical' },
            }),
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h('button', {
                type: 'button',
                style: { ...S.btn, opacity: busy ? 0.6 : 1 },
                onClick: async () => {
                  setBusy('rule')
                  try {
                    const res = await fetch('/dsh-quotes.config', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        captureRule: rule,
                        scope: ruleScope,
                        conv: conv || '',
                      }),
                    })
                    const data = await res.json()
                    if (!data || !data.ok) throw new Error((data && data.error) || '保存失败')
                    if (ruleScope === 'conv' && conv) {
                      const map = data.captureRules && typeof data.captureRules === 'object' ? data.captureRules : {}
                      const v = typeof map[conv] === 'string' ? map[conv] : rule
                      setRuleConv(v)
                      setRule(v)
                      S2('记什么', '已保存：只对「' + conv + '」生效')
                    } else {
                      setRuleGlobal(data.captureRule || '')
                      setRule(data.captureRule || '')
                      S2('记什么', '已保存：所有对话生效')
                    }
                  } catch (e) { S2('记什么', '失败：' + (e && e.message ? e.message : e)) } finally { setBusy('') }
                },
              }, '保存'),
              h('button', {
                type: 'button',
                style: S.btn,
                onClick: () => {
                  setRule('')
                  if (ruleScope === 'conv') setRuleConv('')
                  else setRuleGlobal('')
                },
              }, '清空'),
              busy === 'rule'
                ? h('span', { style: { fontSize: 11, color: 'rgba(0,0,0,.45)' } }, '保存中…')
                : null)),
            '想让智能体额外记住某一类内容，写在这里。留空＝用默认规则（它自己判断：判断、比喻、认输、承认才记，寒暄和进度不记）。最多 400 字。'),
          row('频率', h('span', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            ['conservative', 'normal', 'eager'].map((lv) => h('button', {
              key: lv,
              type: 'button',
              style: { ...S.btn, fontWeight: level === lv ? 600 : 400 },
              onClick: async () => {
                setBusy('level')
                try {
                  const res = await fetch('/dsh-quotes.config', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ captureLevel: lv }),
                  })
                  const data = await res.json()
                  if (!data || !data.ok) throw new Error((data && data.error) || '设置失败')
                  setLevel(lv)
                  S2('频率', '已设为「' + LABEL[lv] + '」，新会话生效')
                } catch (e) { S2('频率', '失败：' + (e && e.message ? e.message : e)) } finally { setBusy('') }
              },
            }, LABEL[lv]))), '保守 = 只记明说的；正常 = 一段对话一两句；积极 = 遇到像样就记。对新会话生效。'),
          row('说明', h('div', { style: { fontSize: 12, lineHeight: 1.7, maxWidth: 360 } },
            h('div', null, '这是智能体自己的句子本：它觉得哪句话值得留，就写一笔，你随时能在这儿翻。'),
            h('div', { style: { ...S.dim, marginTop: 4 } }, '灵感是「有些话说出口就沉下去了」，捞回来才不算白说。'),
            h('div', { style: { marginTop: 6 } }, '收句子有三条路：面板上的「加一句」、每条回复旁的鲸语按钮、或它自己判断该记。'),
            h('div', { style: { marginTop: 6 } }, '每个对话一本：文件名跟着会话名走，能在右上角改名；关掉某个对话，它就不再往那本里记。'),
            h('div', { style: { marginTop: 6 } }, '记的规则分两层：全局一份，单个对话还能各写一份，对话自己的优先。'),
            h('div', { style: { ...S.dim, marginTop: 6 } }, '句子只存在这台电脑的 markdown 文件里，不上传、不发到任何服务器。'),
              h('div', { style: { ...S.dim, marginTop: 6 } }, '删单句：把鼠标移到句子上、点右边的 ✕（两下确认）；删错了用上面的「恢复」从备份文件回滚。'),
            h('div', { style: { ...S.dim, marginTop: 2 } }, '不打开这个页面就不会产生额外消耗：它不会为了记句子单独去调模型。'))),
          row('回收站自动清理', h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('button', {
              type: 'button',
              style: { ...S.btn, opacity: trashAuto ? 1 : 0.6 },
              disabled: trashBusy,
              onClick: async () => {
                setTrashBusy(true)
                try {
                  const res = await fetch('/dsh-quotes.config', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ trashAuto: !trashAuto }),
                  })
                  const data = await res.json()
                  if (!data || !data.ok) throw new Error((data && data.error) || '保存失败')
                  setTrashAuto(data.trashAuto === true)
                  S2('回收站自动清理', data.trashAuto === true ? '已打开：超过保留天数的书会自动删掉' : '已关闭：回收站里的书不会自动消失')
                } catch (error) {
                  S2('回收站自动清理', '保存失败：' + String((error && error.message) || error))
                } finally {
                  setTrashBusy(false)
                }
              },
            }, trashAuto ? '已开启' : '已关闭'),
            h('span', { style: S.dim }, '保留'),
            h('input', {
              type: 'number',
              min: 1,
              max: 365,
              value: trashDays,
              onChange: (e) => setTrashDays(e.target.value),
              onBlur: async () => {
                const n = Math.min(365, Math.max(1, Math.round(Number(trashDays) || 30)))
                setTrashDays(String(n))
                setTrashBusy(true)
                try {
                  const res = await fetch('/dsh-quotes.config', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ trashDays: n }),
                  })
                  const data = await res.json()
                  if (!data || !data.ok) throw new Error((data && data.error) || '保存失败')
                  S2('回收站自动清理', '已设为保留 ' + n + ' 天')
                } catch (error) {
                  S2('回收站自动清理', '保存失败：' + String((error && error.message) || error))
                } finally {
                  setTrashBusy(false)
                }
              },
              style: { width: 64, padding: '3px 6px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(0,0,0,.18)', background: 'transparent' },
            }),
            h('span', { style: S.dim }, '天'),
            trashBusy ? h('span', { style: { ...S.dim, color: '#1a7f37' } }, '保存中…') : null)),
          row('移除这本', h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h('button', {
                type: 'button',
                style: { ...S.btn, opacity: convBusy || !conv ? 0.6 : 1 },
                onClick: async () => {
                  if (!conv) { S2('移除这本', '先在上面选一本对话'); return }
                  if (!window.confirm('把「' + conv + '」这本移到回收站？')) return
                  setConvBusy(true)
                  try {
                    const res = await fetch('/dsh-quotes.rmconv', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ conv }),
                    })
                    const data = await res.json()
                    if (!data || !data.ok) throw new Error((data && data.error) || '移除失败')
                    setRemovedList((prev) => (prev.includes(conv) ? prev : prev.concat([conv])))
                    S2('移除这本', '已移除「' + conv + '」，移到 quotes/.trash')
                    onDone()
                  } catch (e) { S2('移除这本', '失败：' + (e && e.message ? e.message : e)) } finally { setConvBusy(false) }
                },
              }, '把这本移走'),
              h('span', { style: { ...S.dim, fontSize: 11 } }, '移到 quotes/.trash，能收回；移出后不会再自动建本')),
            trashList.length
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                  h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                    h('button', {
                      type: 'button',
                      style: { ...S.btn, padding: '2px 8px', minWidth: 0, fontSize: 11 },
                      onClick: () => setTrashOpen((v) => !v),
                    }, (trashOpen ? '收起' : '回收站 ' + trashList.length + ' 本')),
                    trashOpen
                      ? h('button', {
                          type: 'button',
                          style: { ...S.btn, padding: '2px 8px', minWidth: 0, fontSize: 11, color: '#b3261e' },
                          onClick: async () => {
                            if (!window.confirm('清空回收站？这些文件会真的删掉，删了不能恢复，对话也不会自动重建。')) return
                            setConvBusy(true)
                            try {
                              const res = await fetch('/dsh-quotes.purge', { method: 'POST' })
                              const data = await res.json()
                              if (!data || !data.ok) throw new Error((data && data.error) || '清空失败')
                              setTrashList([])
                              S2('移除这本', '清空了 ' + (data.removed || 0) + ' 个文件')
                              onDone()
                            } catch (e) { S2('移除这本', '失败：' + (e && e.message ? e.message : e)) } finally { setConvBusy(false) }
                          },
                        }, '清空')
                      : null,
                    h('span', { style: { ...S.dim, fontSize: 11 } }, trashOpen ? '点一本收回来' : '点开看有哪些')),
                  trashOpen
                    ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                        trashList.map((name) => h('button', {
                          key: name,
                          type: 'button',
                          style: { ...S.btn, padding: '2px 8px', minWidth: 0, fontSize: 11 },
                          onClick: async () => {
                            setConvBusy(true)
                            try {
                              const res = await fetch('/dsh-quotes.rmconv', {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ conv: name, restore: true }),
                              })
                              const data = await res.json()
                              if (!data || !data.ok) throw new Error((data && data.error) || '恢复失败')
                              setRemovedList((prev) => prev.filter((x) => x !== name))
                              setTrashList((prev) => prev.filter((x) => x !== name))
                              S2('移除这本', '已把「' + name + '」收回来')
                              onDone()
                            } catch (e) { S2('移除这本', '失败：' + (e && e.message ? e.message : e)) } finally { setConvBusy(false) }
                          },
                        }, '恢复 ' + name)))
                    : null)
              : null),
          '清空是真删、不可恢复；移出的对话不会自己回来。'),
          conv && removedList.indexOf(conv) >= 0
            ? row('这本已移出', h('button', {
                type: 'button',
                style: { ...S.btn, opacity: convBusy ? 0.6 : 1 },
                onClick: async () => {
                  setConvBusy(true)
                  try {
                    const res = await fetch('/dsh-quotes.rmconv', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ conv, restore: true }),
                    })
                    const data = await res.json()
                    if (!data || !data.ok) throw new Error((data && data.error) || '启用失败')
                    setRemovedList((prev) => prev.filter((x) => x !== conv))
                    S2('这本已移出', '已重新启用「' + conv + '」，新建了一本空的')
                    onDone()
                  } catch (e) { S2('这本已移出', '失败：' + (e && e.message ? e.message : e)) } finally { setConvBusy(false) }
                },
              }, '重新启用这本'), '还在回收站里就把原来那本捞回来；已经清空了就新建一本空的')
            : null,
          row('源码', h('a', {
            href: 'https://github.com/heiyedehen/dsh-whale-whispers',
            target: '_blank',
            rel: 'noreferrer',
            style: { fontSize: 12, color: '#3b6ef6', textDecoration: 'none' },
          }, 'github.com/heiyedehen/dsh-whale-whispers'), '插件本体、说明都在这里；装法 dsh plugin add dsh-whale-whispers'),
          msg ? h('div', { style: { marginTop: 10, fontSize: 12, color: '#1a7f37' } }, msg) : null))
    }

    function Panel(props) {
      const openSettings = !!(props && props.openSettings)
      const sessionId = (props && props.sessionId) || ''
      const [conv, setConv] = React.useState('')
      const { loading, title, source, items, error, disabled, level, rule, convRule, captureRules, removed, trash, manualAdd, msgAction: msgActionCfg, trashAuto: trashAutoCfg, trashDays: trashDaysCfg, convs: convFiles, reload } = useQuotes(conv, sessionId)
      React.useEffect(() => {
        let alive = true
        const url = '/dsh-quotes.session' + (sessionId ? ('?b64sid=' + encodeURIComponent(b64(String(sessionId)))) : '')
        fetch(url, { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => {
            if (!alive) return
            const t = j && typeof j.title === 'string' ? j.title.trim() : ''
            if (!t) return
            setConv(t)
            try { window.localStorage.setItem('dsh-whale-whispers:conv', t) } catch { /* 忽略 */ }
          })
          .catch(() => { /* 读不到就按老样子 */ })
        return () => { alive = false }
      }, [sessionId])

      const [q, setQ] = React.useState('')
      const [span, setSpan] = React.useState('all')
      const [spot, setSpot] = React.useState(null)
      const [onlyFav, setOnlyFav] = React.useState(false)
      const [allConv, setAllConv] = React.useState(false)
      const [asc, setAsc] = React.useState(false)
      const [renaming, setRenaming] = React.useState(false)
      const [addOpen, setAddOpen] = React.useState(false)
      const [addText, setAddText] = React.useState('')
      const [addMsg, setAddMsg] = React.useState('')
      const [settingsOpen, setSettingsOpen] = React.useState(false)
      const [update, setUpdate] = React.useState(null)
      React.useEffect(() => {
        if (!settingsOpen) return
        let alive = true
        fetch('/dsh-quotes.update', { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => { if (alive) setUpdate(j) })
          .catch(() => { /* 取不到就显示省略号 */ })
        return () => { alive = false }
      }, [settingsOpen])
      const [convDraft, setConvDraft] = React.useState('')

      const convs = React.useMemo(() => {
        const set = new Set(convFiles || [])
        for (const it of items) {
          const name = String(it.conversation || '').trim()
          if (name) set.add(name)
        }
        return Array.from(set)
      }, [items, convFiles])
      const rootRef = useRefreshWhenVisible(reload)

      const shown = React.useMemo(() => {
        const needle = q.trim().toLowerCase()
        const cutoff = span === 'week' ? Date.now() - 7 * 864e5 : span === 'month' ? Date.now() - 30 * 864e5 : 0
        return items.filter((it) => {
          if (onlyFav && it.fav !== true) return false
          if (cutoff) {
            const ts = Number(it.ts) || Date.parse(String(it.date || '')) || 0
            if (ts < cutoff) return false
          }
          if (!onlyFav && !allConv && !conv && false) return false
          if (!needle) return true
          return [it.text, it.note, it.context, it.conversation, it.date]
            .filter(Boolean).join(' ').toLowerCase().includes(needle)
        })
      }, [items, q, onlyFav, conv, allConv, span])

      const groups = React.useMemo(() => {
        const map = new Map()
        for (const it of shown) {
          const key = String(it.conversation || '').trim() || '未标注对话'
          if (!map.has(key)) map.set(key, [])
          map.get(key).push(it)
        }
        const g = Array.from(map.entries()).reverse()
        const list = asc ? g.map(([k, v]) => [k, v.slice().reverse()]).reverse() : g
        // 「全部对话」下即使是空书也占一行，不然刚建好的书看起来像不存在
        if (allConv && !conv) {
          for (const n of (convFiles || [])) {
            if (!list.some(([k]) => k === n)) list.push([n, []])
          }
        }
        return list
      }, [shown, asc, allConv, conv, convFiles])

      if (loading) {
        return h('div', { ref: rootRef, style: { padding: '18px 22px', opacity: 0.65, fontSize: 13 } }, '读语录…')
      }

      return h('div', { ref: rootRef, style: S.wrap },
        h('div', { style: { ...S.head, justifyContent: 'space-between' } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10 } },
            h('h2', { style: S.title }, conv ? conv : '全部对话'),
            h('span', { style: S.count }, items.length
              ? items.length + ' 句 · 收藏 ' + items.filter((i) => i.fav === true).length
                + (conv ? '' : ' · ' + (convFiles || []).length + ' 本')
              : '还没有')),
          conv
            ? h(Rename, {
                title,
                conv,
                onDone: (n) => {
                  if (n) {
                    try { window.localStorage.setItem('dsh-whale-whispers:conv', n) } catch { /* 忽略 */ }
                    setConv(n)
                  }
                  reload()
                },
              })
            : null),
        h('p', { style: S.sub }, '随口说过的、被记下来的那几句。'),
        spot
          ? h('div', { style: { margin: '8px 0 2px', padding: '10px 12px', borderRadius: 8, background: 'rgba(255,214,0,.12)', border: '1px solid rgba(255,214,0,.5)', fontSize: 13 } },
              h('div', null, spot.empty ? '这本还没有句子可翻。' : spot.text),
              !spot.empty && spot.note
                ? h('div', { style: { ...S.dim, marginTop: 3, fontSize: 12 } }, '（' + spot.note + '）')
                : null,
              !spot.empty && spot.context
                ? h('div', { style: { ...S.dim, marginTop: 2, fontSize: 12 } }, '↳ 上文：' + spot.context)
                : null,
              spot.empty ? null : h('div', { style: { ...S.dim, marginTop: 4, fontSize: 11 } }, (spot.conversation || '') + (spot.date ? ' · ' + spot.date : '')),
              h('div', { style: { marginTop: 6, display: 'flex', gap: 6 } },
                h('button', { type: 'button', style: S.btn, onClick: () => {
                  const pool = items.filter((it) => it.text && !String(it.text).includes('这一栏还空着'))
                  setSpot(pool.length ? pool[Math.floor(Math.random() * pool.length)] : { empty: true })
                } }, '再翻一句'),
                spot.empty ? null : h('button', { type: 'button', style: S.btn, onClick: async () => {
                  const t = String(spot.text || '')
                  try { await navigator.clipboard.writeText(t) } catch {
                    const ta = document.createElement('textarea')
                    ta.value = t
                    document.body.appendChild(ta)
                    ta.select()
                    try { document.execCommand('copy') } catch { /* 忽略 */ }
                    document.body.removeChild(ta)
                  }
                } }, '复制这句'),
                h('button', { type: 'button', style: S.btn, onClick: () => setSpot(null) }, '收起')))
          : null,
        h('div', { style: S.bar },
          h(ExportBar, { title, items, name: conv || '鲸语' }),
          manualAdd ? h('button', { type: 'button', style: S.btn, onClick: () => { setAddOpen(true); setAddMsg('') } }, '加一句') : null,
          h('select', {
            value: conv,
            title: '按对话筛选',
            onChange: (e) => {
              const v = e.target.value
              setConv(v)
              try { window.localStorage.setItem('dsh-whale-whispers:conv', v) } catch { /* 忽略 */ }
            },
            style: { padding: '3px 6px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(0,0,0,.18)', background: 'transparent', maxWidth: 150 },
          },
            h('option', { value: '' }, '全部对话'),
            convs.map((name) => h('option', { key: name, value: name }, name))),
          h('input', {
            type: 'search',
            value: q,
            placeholder: '搜句子 / 批注 / 上文',
            onChange: (e) => setQ(e.target.value),
            style: { flex: 1, minWidth: 140, padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(0,0,0,.18)', background: 'transparent' },
          }),
          h('button', {
            type: 'button',
            title: allConv ? '现在连全对话一起搜，点一下只搜这本' : '现在只搜这本，点一下连全对话一起搜',
            style: { ...S.btn, opacity: allConv ? 1 : 0.6 },
            onClick: () => setAllConv((v) => !v),
          }, allConv ? '搜全对话' : '搜本对话'),
          h('span', { style: { flex: 1 } }),
          h('button', {
            type: 'button',
            title: '随便翻一句旧的出来看看',
            style: S.btn,
            onClick: () => {
              const pool = items.filter((it) => it.text && !String(it.text).includes('这一栏还空着'))
              setSpot(pool.length ? pool[Math.floor(Math.random() * pool.length)] : { empty: true })
            },
          }, '翻一句'),
          h('button', {
            type: 'button',
            title: onlyFav ? '现在只看星标，点一下看全部' : '点一下只看星标的那几条',
            style: { ...S.btn, opacity: onlyFav ? 1 : 0.6 },
            onClick: () => setOnlyFav((v) => !v),
          }, '只看收藏'),
          h('select', {
            value: span,
            title: '按时间筛',
            onChange: (e) => setSpan(e.target.value),
            style: { padding: '3px 6px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(0,0,0,.18)', background: 'transparent' },
          },
            h('option', { value: 'all' }, '全部时间'),
            h('option', { value: 'week' }, '近一周'),
            h('option', { value: 'month' }, '近一月')),
          h('button', {
            type: 'button',
            style: S.btn,
            title: '切换时间顺序',
            onClick: () => setAsc((v) => !v),
          }, asc ? '旧→新' : '新→旧'),
          h('button', {
            type: 'button',
            style: S.btn,
            title: '设置',
            onClick: () => setSettingsOpen(true),
          }, '设置'),
          h(PathEditor, { source, onDone: reload }),
        null),
        error ? h('div', { style: { color: 'crimson', padding: '8px 0' } }, '读不到：' + error) : null,
        q.trim() ? h('div', { style: { ...S.dim, fontSize: 11.5, margin: '0 0 6px' } }, '筛出 ' + shown.length + ' / ' + items.length + ' 句') : null,
        addOpen
          ? h('div', {
              style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
              onClick: (e) => { if (e.target === e.currentTarget) setAddOpen(false) },
            },
              h('div', { style: { background: 'var(--dsh-bg, #fff)', borderRadius: 12, padding: '16px 18px', width: 'min(460px, 92vw)', boxShadow: '0 12px 40px rgba(0,0,0,.25)' } },
                h('div', { style: { fontSize: 14, fontWeight: 600, marginBottom: 8 } }, '手动加一句'),
                h('textarea', {
                  value: addText,
                  rows: 3,
                  placeholder: '写一句想留下的',
                  onChange: (e) => setAddText(e.target.value),
                  style: { width: '100%', fontSize: 13, lineHeight: 1.6, padding: 8, borderRadius: 8, border: '1px solid rgba(0,0,0,.18)', background: 'transparent', resize: 'vertical' },
                }),
                h('div', { style: { ...S.dim, fontSize: 11.5, marginTop: 6 } },
                  conv ? ('会记到「' + conv + '」下') : '没选对话，会记成「未标注对话」'),
                addMsg ? h('div', { style: { fontSize: 12, color: '#1a7f37', marginTop: 6 } }, addMsg) : null,
                h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 } },
                  h('button', { type: 'button', style: S.btn, onClick: () => setAddOpen(false) }, '取消'),
                  h('button', {
                    type: 'button',
                    style: S.btn,
                    onClick: async () => {
                      const text = addText.trim()
                      if (!text) { setAddMsg('先写一句'); return }
                      try {
                        const res = await fetch('/dsh-quotes.add', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ text, conversation: conv || '' }),
                        })
                        const data = await res.json()
                        if (!data || !data.ok) throw new Error((data && data.error) || '没写进去')
                        setAddText('')
                        setAddOpen(false)
                        reload()
                      } catch (e) { setAddMsg('失败：' + (e && e.message ? e.message : e)) }
                    },
                  }, '写进去'))))
          : null,
        settingsOpen
          ? h(Boundary, null, h(Settings, { level,
              title,
              conv,
              removed,
              trash,
              items,
              source,
              disabled,
              rule,
              convRule,
              manualAdd,
              msgAction: msgActionCfg,
              trashAuto: trashAutoCfg,
              trashDays: trashDaysCfg,
              onDone: () => { setSettingsOpen(false); reload() },
            }))
          : null,
        groups.length === 0 && !error
          ? h('div', { style: S.dim }, '还没有句子。点上面的「加一句」，或等它自己记。')
          : groups.map(([date, list]) =>
              h('div', { key: date },
                date ? h('div', { style: S.date }, date + ((disabled || []).includes(date) ? ' · 未启用' : ((convFiles || []).includes(date) ? ' · 已启用' + (((captureRules || {})[date] || '').trim() ? ' · 单会话规则' : ' · 全局规则') : ''))) : null,
                list.length === 0
                  ? h('div', { style: { ...S.dim, padding: '2px 0 8px', fontSize: 12 } }, '（这本还没有句子，点上面的「加一句」或等它自己记）')
                  : null,
                list.slice().reverse().map((it, i) =>
                  h(Item, { key: (date || '') + ':' + i, item: it, onChanged: reload, showSource: onlyFav, conv, canDelete: !onlyFav, q })))))
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
          inject: (sessionId) => (typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
        }, (props) => h(Boundary, null, h(Panel, props))))

        slots.inject('settings.section', () => slots.register({
          name: 'settings.section',
          id: 'dsh-whale-whispers',
          order: 62,
          label: '鲸语',
        }, () => h(Boundary, null, h(Panel))))

        slots.inject('conversation.chat.assistant-actions', () => slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'dsh-whale-whispers/save',
          order: 95,
          inject: (sessionId) => (typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
        }, MsgAction))

      },
    }
  },
})
