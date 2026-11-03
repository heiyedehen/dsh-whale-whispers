/**
 * Host half of 鲸语 / dsh-whale-whispers.
 *
 * Two jobs:
 *   1. GET /dsh-quotes.json  — the panel reads this (no cache, reads the file every time).
 *   2. three agent tools     — so any agent can keep its own quotes without a human typing:
 *        whale_whisper_append  add one line under today's section (dedupes, keeps formatting)
 *        whale_whisper_list    read back the most recent lines (for dedupe / inspection)
 *        whale_whisper_remove  drop one line (fixing a mistake)
 *
 * Settings (optional file, no framework Config needed):
 *   quotes.config.json somewhere on the plugin's own search path:
 *     { "path": "<absolute quotes.md>", "title": "<panel title>" }
 *   Missing file or fields fall back to the author's defaults.
 *
 * The tools and the panel resolve the same config through the same function, so one
 * operation has one implementation (see the plugin-development skill on user actions).
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const ROUTE = '/dsh-quotes.json'
const CONFIG_ROUTE = '/dsh-quotes.config'
const REMOVE_ROUTE = '/dsh-quotes.remove'
const DEFAULT_PATH = 'D:/dsh work/self/quotes.md'
const DEFAULT_TITLE = '鲸语'

export const inject = ['webServer', 'tools']

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/** Config candidates, most specific first: the author's spot, then the user's home. */
function configCandidates() {
  return [
    'D:/dsh work/self/quotes.config.json',
    join(homedir(), '.dsh', 'quotes.config.json'),
  ]
}

/** Resolve { path, title } — config wins, defaults otherwise. One resolver for the route and the tools. */
async function resolveTarget() {
  // Explicit override wins: handy for other machines and for tests
  // (DSH_WHALE_WHISPERS_PATH=C:/some/quotes.md).
  const fromEnv = String(process.env.DSH_WHALE_WHISPERS_PATH || '').trim()
  if (fromEnv) {
    return { path: fromEnv, title: String(process.env.DSH_WHALE_WHISPERS_TITLE || '').trim() || DEFAULT_TITLE }
  }
  let cfg = null
  for (const candidate of configCandidates()) {
    cfg = await readJson(candidate)
    if (cfg && typeof cfg === 'object') break
    cfg = null
  }
  const path = typeof cfg?.path === 'string' && cfg.path.trim() ? cfg.path.trim() : DEFAULT_PATH
  const title = typeof cfg?.title === 'string' && cfg.title.trim() ? cfg.title.trim() : DEFAULT_TITLE
  return { path, title }
}



/** 有些 Web 服务器把 URL/body 当 latin1 交上来，中文会变成乱码；能救回来就救。 */
function fixMojibake(value) {
  const str = String(value || '')
  if (!/[^\x00-\x7F]/.test(str)) return str
  try {
    const repaired = Buffer.from(str, 'latin1').toString('utf8')
    if (repaired && !repaired.includes('\uFFFD') && /[^\x00-\x7F]/.test(repaired)) return repaired
  } catch { /* 救不回来就用原样 */ }
  return str
}

/** 写回配置（只有改名这一个字段在用；已有的 path 保留）。 */
async function saveConfig(patch) {
  const file = configCandidates()[0]
  let current = (await readJson(file)) || {}
  if (!current || typeof current !== 'object') current = {}
  const next = { ...current, ...patch }
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
  return next
}

/** Parse the quotes markdown into [{ date, text, note }]. */
export function parseQuotes(text) {
  const out = []
  let date = ''
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (line.startsWith('## ')) {
      date = line.slice(3).trim()
      continue
    }
    if (!line.startsWith('- ')) continue
    let context = ''
    const peek = String(lines[i + 1] || '').trim()
    const ctxMatch = peek.match(/^(?:↳|->|→)\s*(?:上文|语境)\s*[:：]\s*(.*)$/)
    if (ctxMatch) { context = ctxMatch[1].trim(); i += 1 }
    const body = line.slice(2).trim()
    if (!body) continue
    let main = body
    let note = ''
    const m = body.match(/^(.*?)\s*[（(]([^（()）]*)[)）]\s*$/)
    if (m) {
      main = m[1].trim()
      note = m[2].trim()
    }
    out.push({ date, text: main.replace(/^「|」$/g, '').trim(), note, context })
  }
  return out
}

function todayKey() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Split one `- ...` line into its sentence and trailing note, the same way
 * parseQuotes does. Used so append/remove match on the sentence, not the whole
 * line (a line with a note must still be removable by its bare text).
 */
function splitLine(line) {
  const body = String(line || '').trim().replace(/^-\s*/, '').trim()
  let main = body
  const m = body.match(/^(.*?)\s*[（(]([^（()）]*)[)）]\s*$/)
  if (m) main = m[1].trim()
  return main.replace(/^「|」$/g, '').trim()
}

/** Canonical form used for duplicate detection. */
function normalise(text) {
  return String(text)
    .replace(/^「|」$/g, '')
    .replace(/[\s]+/g, '')
    .trim()
}

/** Format one line the way the file already looks. */
function formatLine(text, note, context) {
  const quoted = /^「.*」$/.test(text) ? text : `「${text}」`
  const head = note ? `- ${quoted}（${note}）` : `- ${quoted}`
  const ctx = String(context || '').trim()
  return ctx ? `${head}\n  ↳ 上文：${ctx}` : head
}

/**
 * Insert one line under `## <today>`; append the section if it does not exist yet.
 * Returns the new file content plus whether the line was actually added.
 */
export function insertQuote(source, text, note, context) {
  const line = formatLine(text, note, context)
  const wanted = normalise(text)
  const existing = parseQuotes(source)
  if (existing.some((q) => normalise(q.text) === wanted)) {
    return { content: source, added: false, reason: 'duplicate' }
  }

  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/)
  const day = todayKey()
  const header = `## ${day}`
  const at = lines.findIndex((l) => l.trim() === header)

  if (at === -1) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push('', header, '', line, '')
    return { content: joinLike(lines, source), added: true }
  }

  // Walk to the end of that day's block: last non-empty line before the next "## ".
  let end = at + 1
  let lastItem = -1
  for (let i = at + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('## ')) break
    if (trimmed.startsWith('- ')) lastItem = i
    if (trimmed !== '') end = i
  }
  const insertAt = lastItem >= 0 ? lastItem + 1 : end + 1
  lines.splice(insertAt, 0, line)
  return { content: joinLike(lines, source), added: true }
}

/**
 * Re-join lines using the file's own conventions: the dominant line ending for
 * the lines in between, and whatever the file already used at its very end
 * (a file may end with a bare "\n" even when its lines are CRLF).
 */
function joinLike(lines, source) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  let out = lines.join(eol)
  const tail = (source.match(/(\r?\n)$/) || [])[1] || ''
  if (!tail) return out.replace(/(?:\r?\n)+$/, '')
  if (out.endsWith(eol) && tail !== eol) out = out.slice(0, -eol.length) + tail
  return out
}

/** Atomic write: temp file in the same directory, then rename. */
async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}

async function readSource(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
}

export function apply(ctx) {
  /* ---------- the shared operation ---------- */

  const listQuotes = async () => {
    const { path, title } = await resolveTarget()
    const source = await readSource(path)
    return { ok: true, title, source: path, items: parseQuotes(source) }
  }

  const appendQuote = async (text, note, context) => {
    const body = String(text || '').trim()
    if (!body) return { ok: false, error: 'text 不能为空' }
    const { path, title } = await resolveTarget()
    const source = await readSource(path)
    const { content, added, reason } = insertQuote(source, body, note ? String(note).trim() : '', context ? String(context).trim() : '')
    if (added) await writeAtomic(path, content)
    return {
      ok: true,
      added,
      ...(added ? {} : { reason: reason || 'skipped' }),
      title,
      source: path,
      line: formatLine(body, note ? String(note).trim() : '', context ? String(context).trim() : ''),
      total: parseQuotes(content).length,
    }
  }

  const removeQuote = async (text) => {
    const wanted = normalise(text)
    if (!wanted) return { ok: false, error: 'text 不能为空' }
    const { path } = await resolveTarget()
    const source = await readSource(path)
    const eol = source.includes('\r\n') ? '\r\n' : '\n'
    const lines = source.split(/\r?\n/)
    const at = lines.findIndex((l) => l.trim().startsWith('- ') && normalise(splitLine(l)) === wanted)
    if (at === -1) return { ok: false, error: '没有这一句（按整句匹配，不含批注）' }
    const removed = lines[at].trim()
    lines.splice(at, 1)
    await writeAtomic(path, joinLike(lines, source))
    return { ok: true, removed: splitLine(removed), line: removed, source: path, total: parseQuotes(joinLike(lines, source)).length }
  }

  /* ---------- the panel's data route ---------- */

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (req, res) => {
        let payload
        try {
          payload = await listQuotes()
        } catch (error) {
          payload = { ok: false, items: [], error: String((error && error.message) || error) }
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify(payload))
      },
    }),
  )


  /* ---------- 设置：改名 / 换语录文件 ---------- */

  const readBody = async (req, limit = 8192) => {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > limit) throw new Error('too large')
      chunks.push(buf)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  const jsonSend = (res, code, body) => {
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: CONFIG_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'POST') return jsonSend(res, 405, { ok: false, error: 'POST only' })

        let raw = ''
        try { raw = await readBody(req) } catch (error) {
          return jsonSend(res, 400, { ok: false, error: String((error && error.message) || error) })
        }
        let body = {}
        if (String(raw).trim()) {
          try { body = JSON.parse(raw) || {} } catch { return jsonSend(res, 400, { ok: false, error: 'bad json' }) }
        }

        let q = new URLSearchParams('')
        try { q = new URL(req.url || '/', 'http://127.0.0.1').searchParams } catch { /* 参数坏了就当没传 */ }
        const dec = (value) => {
          try { return Buffer.from(String(value || ''), 'base64').toString('utf8').trim() } catch { return '' }
        }
        // b64title / b64path 是当前客户端用的；裸 b64 留给旧客户端（只当标题）
        const pick = (key) => dec(q.get('b64' + key)) || dec(key === 'title' ? q.get('b64') : '') || fixMojibake(q.get(key) || '').trim()

        const title = pick('title') || (typeof body.title === 'string' ? fixMojibake(body.title).trim() : '')
        const pathValue = pick('path') || (typeof body.path === 'string' ? fixMojibake(body.path).trim() : '')
        if (!title && !pathValue) return jsonSend(res, 400, { ok: false, error: '没有要改的字段' })
        if (title && title.length > 40) return jsonSend(res, 400, { ok: false, error: '标题太长（最多 40 字）' })
        if (pathValue && !/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(pathValue)) {
          return jsonSend(res, 400, { ok: false, error: '请填绝对路径，例如 D:/dsh work/self/quotes.md' })
        }

        try {
          const patch = {}
          if (title) patch.title = title
          if (pathValue) patch.path = pathValue.replace(/\\/g, '/')
          const saved = await saveConfig(patch)
          let warning = ''
          if (patch.path) {
            try { await readSource(patch.path) } catch (error) {
              warning = '已保存，但这个文件现在读不到：' + String((error && error.message) || error)
            }
          }
          jsonSend(res, 200, {
            ok: true,
            title: saved.title || DEFAULT_TITLE,
            path: saved.path || DEFAULT_PATH,
            ...(warning ? { warning } : {}),
          })
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  /* ---------- 面板里删一句（面板上的 ✕ 走这里） ---------- */

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: REMOVE_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'POST') return jsonSend(res, 405, { ok: false, error: 'POST only' })

        let raw = ''
        try { raw = await readBody(req) } catch (error) {
          return jsonSend(res, 400, { ok: false, error: String((error && error.message) || error) })
        }
        let q = new URLSearchParams('')
        try { q = new URL(req.url || '/', 'http://127.0.0.1').searchParams } catch { /* 忽略 */ }

        let text = ''
        try { text = Buffer.from(String(q.get('b64') || ''), 'base64').toString('utf8').trim() } catch { text = '' }
        if (!text) {
          try {
            const body = JSON.parse(raw || '{}') || {}
            text = fixMojibake(typeof body.text === 'string' ? body.text : '').trim()
          } catch { text = '' }
        }
        if (!text) return jsonSend(res, 400, { ok: false, error: 'text 不能为空' })

        try {
          jsonSend(res, 200, await removeQuote(text))
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  /* ---------- the agent tools ---------- */

  ctx.effect(() =>
    ctx.tools.register({
      name: 'whale_whisper_list',
      description:
        '读回「鲸语」里的句子（最新在前）。用来查重、看自己之前收过什么。'
        + '语录文件由鲸语插件决定（quotes.config.json 里的 path，缺省是作者那份）。',
      parameters: {
        limit: { type: 'number', description: '返回几条（默认 20，最大 200）' },
      },
      output: textOutput,
      async execute(args) {
        const data = await listQuotes()
        const limit = Math.max(1, Math.min(Number(args?.limit) || 20, 200))
        const items = data.items.slice().reverse().slice(0, limit)
        return { ...data, items, returned: items.length, total: data.items.length }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'whale_whisper_append',
      description:
        '把一句值得留下的话收进「鲸语」：写在今天那一段下面；已经有一模一样的句子就跳过（不会重复）。'
        + '只收自己说过的、站得住的句子；不收套话、不收解释。写完不用另存，面板会立刻读到。',
      parameters: {
        text: { type: 'string', description: '要收的句子（必填，不含两端的「」也行）' },
        note: { type: 'string', description: '可选批注：为什么会记它，会显示成灰色小字' },
        context: { type: 'string', description: '可选上文：这句话是在什么情况下说的（他会想看到语境）' },
      },
      output: textOutput,
      async execute(args) {
        return appendQuote(args?.text, args?.note, args?.context)
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'whale_whisper_remove',
      description: '从「鲸语」里删掉一句（按整句精确匹配，不会误删旁边那句）。收错了、或者不想留了再用。',
      parameters: {
        text: { type: 'string', description: '要删掉的句子，跟写进去时一致（不含「」和批注）' },
      },
      output: textOutput,
      async execute(args) {
        return removeQuote(args?.text)
      },
    }),
  )
}
