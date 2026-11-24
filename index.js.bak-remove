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
import { readFile, writeFile, rename, mkdir, readdir, stat, unlink, open } from 'node:fs/promises'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROUTE = '/dsh-quotes.json'
const CONFIG_ROUTE = '/dsh-quotes.config'
const REMOVE_ROUTE = '/dsh-quotes.remove'
const FAV_ROUTE = '/dsh-quotes.fav'
const RENAME_CONV_ROUTE = '/dsh-quotes.rename'
const RENAME_CONV_FILE_ROUTE = '/dsh-quotes.renameconv'
const IMPORT_ROUTE = '/dsh-quotes.import'
const ENABLE_ROUTE = '/dsh-quotes.enable'
const UNDO_ROUTE = '/dsh-quotes.undo'
const RM_ROUTE = '/dsh-quotes.rmconv'
const PURGE_ROUTE = '/dsh-quotes.purge'
const UPDATE_ROUTE = '/dsh-quotes.update'
const SESSION_ROUTE = '/dsh-quotes.session'
const ADD_ROUTE = '/dsh-quotes.add'
const DEFAULT_PATH = join(homedir(), '.dsh', 'whale-whispers', 'quotes.md')
const DEFAULT_TITLE = '鲸语'

export const inject = ['webServer', 'tools', 'systemPrompt', 'agents']

async function readJson(path) {
  try {
    return JSON.parse(stripBom(await readFile(path, 'utf8')))
  } catch {
    return null
  }
}

/** Config candidates, most specific first: the user's home, then an old author-side legacy spot. */
function configCandidates() {
  return [
    join(homedir(), '.dsh', 'quotes.config.json'),
    'D:/dsh work/self/quotes.config.json',
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



const DEFAULT_DIR = join(homedir(), '.dsh', 'whale-whispers', 'quotes')
const PLACEHOLDER = '（这一栏还空着——等我说第一句，或者你手动加一条）'

/** 对话名 → 合法文件名。空名回落到 legacy。 */
export function safeConvName(name) {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return clean
}


/** 按会话 sid 找语录文件（文件头有 sid 标记）。 */
async function findBySid(dir, sid) {
  const key = String(sid || '').trim()
  if (!key) return ''
  const names = await listConvFiles(dir)
  for (const n of names) {
    try {
      const body = await readFile(dir + '/' + n + '.md', 'utf8')
      if (body.indexOf('<!-- sid:' + key + ' -->') >= 0) return dir + '/' + n + '.md'
    } catch { /* skip */ }
  }
  return ''
}

/** 给新文件打 sid 标记，改名后仍认得。 */
async function tagSid(file, sid) {
  const key = String(sid || '').trim()
  if (!file || !key) return
  try {
    const body = await readFile(file, 'utf8')
    if (body.indexOf('<!-- sid:') >= 0) return
    const next = body.replace(/^(# [^\n]*)\n/, '$1\n<!-- sid:' + key + ' -->\n')
    if (next !== body) await writeFile(file, next, 'utf8')
  } catch { /* skip */ }
}

async function quotesDir() {
  let cfg = null
  for (const candidate of configCandidates()) {
    cfg = await readJson(candidate)
    if (cfg && typeof cfg === 'object') break
    cfg = null
  }
  const dir = typeof cfg?.dir === 'string' && cfg.dir.trim() ? cfg.dir.trim() : DEFAULT_DIR
  await mkdir(dir, { recursive: true })
  return dir
}

async function disabledList() {
  try {
    const parsed = JSON.parse(stripBom(await readFile(join(homedir(), '.dsh', 'quotes.config.json'), 'utf8')))
    return Array.isArray(parsed && parsed.disabledConversations) ? parsed.disabledConversations : []
  } catch {
    return []
  }
}

/** 回收站自动清理的开关与天数（设置里可改；默认关）。 */
const TRASH_DEFAULT_DAYS = 30

async function trashCfg() {
  for (const candidate of configCandidates()) {
    const cfg = await readJson(candidate)
    if (cfg && typeof cfg === 'object') {
      const days = Math.min(365, Math.max(1, Math.round(Number(cfg.trashDays) || TRASH_DEFAULT_DAYS)))
      return { auto: cfg.trashAuto === true, days }
    }
  }
  return { auto: false, days: TRASH_DEFAULT_DAYS }
}

/** 回收站里超过 N 天的自动清掉（顺手做，失败了不算错）；开关关着就什么都不做。 */
async function sweepTrash(dir) {
  const { auto, days } = await trashCfg()
  if (!auto) return 0
  const trash = dir + '/.trash'
  let names = []
  try { names = await readdir(trash) } catch { return 0 }
  const cutoff = Date.now() - days * 86400000
  let n = 0
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const fp = trash + '/' + name
    try {
      const st = await stat(fp)
      if (st.mtimeMs < cutoff) { await unlink(fp); n += 1 }
    } catch { /* 忽略 */ }
  }
  return n
}

async function trashList(dir) {
  await sweepTrash(dir)
  try {
    const names = await readdir(dir + '/.trash')
    const set = new Set()
    for (const n of names) {
      if (!n.endsWith('.md')) continue
      const k = n.indexOf('--')
      set.add(k > 0 ? n.slice(0, k) : n.replace(/\.md$/, ''))
    }
    return Array.from(set)
  } catch {
    return []
  }
}

async function removedConvList() {
  for (const candidate of configCandidates()) {
    const cfg = await readJson(candidate)
    if (cfg && typeof cfg === 'object') {
      return Array.isArray(cfg.removedConversations)
        ? cfg.removedConversations.filter((x) => typeof x === 'string')
        : []
    }
  }
  return []
}

async function listConvFiles(dir) {
  const removed = await removedConvList()
  try {
    const names = await readdir(dir)
    return names
      .filter((n) => n.toLowerCase().endsWith('.md'))
      .map((n) => n.slice(0, -3))
      .filter((n) => !removed.includes(n))
      .sort((a, b) => a.localeCompare(b, 'zh'))
  } catch {
    return []
  }
}

/** 对话的语录文件；不存在就建一个带占位句的空本子。 */
async function ensureConvFile(dir, conv, force) {
  const name = safeConvName(conv)
  if (!name) return ''
  if ((await removedConvList()).includes(name)) return ''
  if (!force && (await disabledList()).includes(name)) return ''

  const file = dir + '/' + name + '.md'
  try {
    await readFile(file, 'utf8')
    return file
  } catch { /* 不存在，建一个 */ }
  const seed = '# 语录 · ' + name + '\n\n- 「' + PLACEHOLDER + '」\n'
  await writeFile(file, seed, 'utf8')
  return file
}

/** 去掉没有句子的孤立「↳ 对话：xxx」行。 */
function repairOrphans(content) {
  const lines = String(content).split(/\r?\n/)
  const out = []
  for (const line of lines) {
    const t = line.trim()
    const isMeta = /^(?:\u21b3|->|\u2192)\s*(?:\u4e0a\u6587|\u8bed\u5883|\u5bf9\u8bdd|\u4f1a\u8bdd)\s*[:\uff1a]/.test(t)
    if (isMeta && !(out.length && out[out.length - 1].trim().startsWith('- '))) continue
    out.push(line)
  }
  return out.join('\n')
}

/** 把 legacy quotes.md 里属于这个对话的句子搬进它自己的文件（搬完从 legacy 删掉）。 */
async function migrateLegacy(dir, conv) {
  const convFile = dir + '/' + safeConvName(conv) + '.md'
  let body = ''
  let legacy = ''
  for (const candidate of [dir + '/quotes.md', dirname(dir) + '/quotes.md']) {
    try {
      body = await readFile(candidate, 'utf8')
      legacy = candidate
      break
    } catch { /* 试下一个 */ }
  }
  if (!legacy) return ''
  const lines = body.split(/\r?\n/)
  const moved = []
  const kept = []
  const metaRe = /^(?:\u21b3|->|\u2192)\s*(?:\u4e0a\u6587|\u8bed\u5883|\u5bf9\u8bdd|\u4f1a\u8bdd)\s*[:\uff1a]/
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim().startsWith('- ')) {
      kept.push(line)
      continue
    }
    const block = [line]
    let j = i + 1
    while (j < lines.length && metaRe.test(lines[j].trim())) {
      block.push(lines[j])
      j += 1
    }
    const convLine = block.slice(1).find((b) => /^(?:\u21b3|->|\u2192)\s*(?:\u5bf9\u8bdd|\u4f1a\u8bdd)\s*[:\uff1a]/.test(b.trim()))
    const m = convLine ? convLine.trim().match(/^(?:\u21b3|->|\u2192)\s*(?:\u5bf9\u8bdd|\u4f1a\u8bdd)\s*[:\uff1a]\s*(.*)$/) : null
    if (m && m[1].trim() === conv) moved.push(block.join('\n'))
    else kept.push(...block)
    i = j - 1
  }
  if (!moved.length) return ''
  let current = ''
  try {
    current = await readFile(convFile, 'utf8')
  } catch {
    current = ''
  }
  let head = current.trim() ? current.replace(/\s*$/, '\n') : '# \u8bed\u5f55 \u00b7 ' + conv + '\n'
  if (!/^##\s/m.test(head)) head += '\n## ' + todayKey() + '\n\n'
  const next = dropPlaceholder(head + moved.join('\n') + '\n')
  await writeAtomic(convFile, next)
  await writeAtomic(legacy, kept.join('\n').replace(/\n{3,}/g, '\n\n'))
  return next
}

/** 第一条真语录写进来时，把占位句删掉。 */
function dropPlaceholder(content) {
  const lines = String(content).split(/\r?\n/)
  const kept = lines.filter((l) => !(l.trim().startsWith('- ') && l.indexOf(PLACEHOLDER) >= 0))
  return kept.join('\n')
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
    let conversation = ''
    for (let k = 0; k < 2; k += 1) {
      const peek = String(lines[i + 1] || '').trim()
      const meta = peek.match(/^(?:↳|->|→)\s*(上文|语境|对话|会话)\s*[:：]\s*(.*)$/)
      if (!meta) break
      if (meta[1] === '对话' || meta[1] === '会话') conversation = meta[2].trim()
      else context = meta[2].trim()
      i += 1
    }
    const body = line.slice(2).trim()
    if (!body) continue
    let main = body
    let note = ''
    const m = body.match(/^(.*?)\s*[（(]([^（()）]*)[)）]\s*$/)
    if (m) {
      main = m[1].trim()
      note = m[2].trim()
    }
    out.push({ date, text: main.replace(/^「|」$/g, '').trim(), note, context, conversation })
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
function formatLine(text, note, context, conversation) {
  const quoted = /^「.*」$/.test(text) ? text : `「${text}」`
  const head = note ? `- ${quoted}（${note}）` : `- ${quoted}`
  const extra = []
  const conv = String(conversation || '').trim()
  const ctx = String(context || '').trim()
  if (conv) extra.push(`  ↳ 对话：${conv}`)
  if (ctx) extra.push(`  ↳ 上文：${ctx}`)
  return extra.length ? head + '\n' + extra.join('\n') : head
}

/**
 * Insert one line under `## <today>`; append the section if it does not exist yet.
 * Returns the new file content plus whether the line was actually added.
 */
export function insertQuote(source, text, note, context, conversation) {
  // 多行正文会把 md 的一行拆成几行、也会让查重认不出来，先压成一行
  const oneLine = (v) => String(v == null ? '' : v).replace(/\s*\n+\s*/g, ' ').trim()
  const cleanText = oneLine(text)
  const cleanNote = oneLine(note)
  const cleanCtx = oneLine(context)
  const line = formatLine(cleanText, cleanNote, cleanCtx, conversation)
  const wanted = normalise(cleanText)
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
  let insertAt = lastItem >= 0 ? lastItem + 1 : end + 1
  while (insertAt < lines.length && /^\s*↳/.test(lines[insertAt])) insertAt += 1
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

/** Windows 记事本爱在开头塞一个 BOM；JSON.parse 见到它必炸，先切掉。 */
export function stripBom(text) {
  const s = typeof text === 'string' ? text : String(text == null ? '' : text)
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 同一个句子本可能被两只鱼同时写（宿主里一个进程、另开的 DSH 里一个进程）。
 * 读-改-写之间不加锁，后写的那次会把先写的那句覆盖掉。
 * 用 `<本子>.lock` 排他创建当锁：抢不到就等，锁太旧（进程崩了没删）就当没主。
 */
export async function withQuoteLock(path, fn, { timeoutMs = 5000, staleMs = 15000 } = {}) {
  const lock = `${path}.lock`
  const started = Date.now()
  let handle = null
  for (;;) {
    try {
      handle = await open(lock, 'wx')
      break
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error
      try {
        const info = await stat(lock)
        if (Date.now() - info.mtimeMs > staleMs) {
          await unlink(lock).catch(() => {})
          continue
        }
      } catch {
        continue // 锁刚被别人放掉，重试
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error('本子正被另一个进程写着，等了 5 秒还没放开：' + lock)
      }
      await sleep(20 + Math.floor(Math.random() * 30))
    }
  }
  try {
    return await fn()
  } finally {
    try { await handle.close() } catch { /* 已经关了 */ }
    await unlink(lock).catch(() => {})
  }
}

async function readSource(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // 第一次用：在用户目录里开一份自己的句子本，别让人先改配置才能写
    try {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, '# ' + DEFAULT_TITLE + '\n', 'utf8')
      return '# ' + DEFAULT_TITLE + '\n'
    } catch {
      return ''
    }
  }
}

/** 星标是全局的：一本一句都要能看见，所以不跟着单本的 sidecar 走。 */
/** 解析缓存：同一文件（mtime+size 未变）不重复读盘、不重复 parse。 */
const __parsedCache = new Map()
const __PARSED_CACHE_MAX = 500

async function readParsedCached(path) {
  let st = null
  try { st = await stat(path) } catch { return { text: '', parsed: [] } }
  const hit = __parsedCache.get(path)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value
  const text = await readFile(path, 'utf8')
  const value = { text, parsed: parseQuotes(text) }
  if (__parsedCache.size >= __PARSED_CACHE_MAX) __parsedCache.clear()
  __parsedCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, value })
  return value
}

async function favFile(source) {
  const dir = await quotesDir()
  return join(dir, '.favs.json')
}

/** 读全局星标；顺手把旧的 `<某本>.md.fav.json` merge 进来（1.16.0 之前是分本存的）。 */
async function readFavs(source) {
  const global = await favFile(source)
  const out = []
  const push = (x) => {
    const t = String(x || '').trim()
    if (t && !out.includes(t)) out.push(t)
  }
  try {
    const list = JSON.parse(await readFile(global, 'utf8'))
    if (Array.isArray(list)) list.forEach(push)
  } catch { /* 还没建过 */ }
  // legacy：旧版把星标写在「当前这本」旁边
  const legacy = [source + '.fav.json']
  const legacyDirty = []
  try {
    const dir = await quotesDir()
    const names = await listConvFiles(dir).catch(() => [])
    for (const n of names) legacy.push(join(dir, n + '.md.fav.json'))
    legacy.push(join(dirname(dir), 'quotes.md.fav.json'))
  } catch { /* 忽略 */ }
  for (const f of legacy) {
    try {
      const list = JSON.parse(await readFile(f, 'utf8'))
      if (Array.isArray(list)) { list.forEach(push); legacyDirty.push(f) }
    } catch { /* 没有这个文件 */ }
  }
  // 搬完就只留全局一份：不然取消收藏后旧的 sidecar 又把它 merge 回来
  if (legacyDirty.length > 0) {
    try {
      await mkdir(await quotesDir(), { recursive: true })
      await writeAtomic(global, JSON.stringify(out, null, 2) + '\n')
      for (const f of legacyDirty) { try { await unlink(f) } catch { /* 忽略 */ } }
    } catch { /* 写不动就算了 */ }
  }
  return out
}

async function writeFavs(source, list) {
  const global = await favFile(source)
  await mkdir(await quotesDir(), { recursive: true })
  await writeAtomic(global, JSON.stringify(list, null, 2) + '\n')
}

const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
}

export function apply(ctx) {
  /* ---------- the shared operation ---------- */

  /** conv 为空 → 老的单文件（“全部对话”）；否则用该对话自己的文件。 */
  const targetFor = async (conv, force) => {
    const base = await resolveTarget()
    const name = safeConvName(conv)
    if (!name) return { path: base.path, title: base.title, dir: await quotesDir(), conv: '' }
    const dir = await quotesDir()
    return { path: await ensureConvFile(dir, name, force), title: base.title, dir, conv: name }
  }

/** 目录名改过之后，按别名映射回用户选的名字。 */
async function aliasOf(conv) {
  try {
    const cfg = (await readJson(configCandidates()[0])) || {}
    const alias = cfg && cfg.convAlias
    const key = safeConvName(conv)
    if (!alias || !key) return key
    const hit = alias[key]
    return hit ? safeConvName(hit) : key
  } catch {
    return safeConvName(conv)
  }
}

async function sessionTitleOf(sessionId) {
  try {
    const home = process.env.USERPROFILE || process.env.HOME || ''
    const dir = home + '/.dsh/storages/session_projcache/sessions'
    const names = await readdir(dir)
    const want = String(sessionId) + '.json'
    const hit = names.indexOf(want) >= 0 ? want : names.find((n) => n.startsWith(String(sessionId)))
    if (!hit) return ''
    const raw = await readFile(dir + '/' + hit, 'utf8')
    const parsed = JSON.parse(stripBom(raw))
    const rows = (parsed && parsed.record && parsed.record.rows) || parsed || {}
    const t = rows && rows.title && (rows.title.val !== undefined ? rows.title.val : rows.title)
    return typeof t === 'string' ? t.trim() : ''
  } catch {
    return ''
  }
}

  /** Text of one finalized assistant message, straight from the session event log. */
  const messageTextOf = (sid, mid) => {
    try {
      const svc = ctx.agents || null
      const key = String(sid)
      let agent = svc && typeof svc.get === 'function' ? svc.get(key) : null
      if (!agent && svc && typeof svc.list === 'function') {
        agent = svc.list().find((a) => a && String(a.id) === key) || null
      }
      const events = agent && agent.session && agent.session.snapshotEvents ? agent.session.snapshotEvents() : []
      const textOf = (m) => (Array.isArray(m && m.content) ? m.content : [])
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => String(b.text))
        .join('\n\n')
        .trim()
      let anchor = -1
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const ev = events[i]
        const m = ev && ev.type === 'assistant/message' && ev.data ? ev.data.message : null
        if (m && m.id === mid) { anchor = i; break }
      }
      if (anchor < 0) anchor = events.length - 1
      // 一条回复常被拆成「正文 + 若干工具调用」多条消息，且顺序不保证正文在前；
      // 所以取这一轮（两条用户消息之间）所有助手消息的正文，取最后非空的那段。
      let start = Math.max(0, anchor - 400)
      for (let i = anchor; i >= start; i -= 1) {
        if (events[i] && events[i].type === 'user/message') { start = i + 1; break }
      }
      let tail = ''
      for (let i = start; i < events.length; i += 1) {
        const ev = events[i]
        if (!ev) continue
        if (ev.type === 'user/message') break
        if (ev.type !== 'assistant/message') continue
        const t = textOf(ev.data && ev.data.message)
        if (t) tail = t
      }
      if (tail) return tail
    } catch { /* 拿不到就让调用方回退 */ }
    return ''
  }

  const SELF_ROUTE = '/dsh-quotes.selftest'
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: SELF_ROUTE,
      handler: async (req, res) => {
        try {
          const svc = ctx.agents || null
          const list = svc && typeof svc.list === 'function' ? svc.list() : []
          const rows = []
          for (const a of list.slice(0, 12)) {
            const sid = String(a && a.id ? a.id : '')
            let msgs = []
            try {
              const ev = a && a.session && a.session.snapshotEvents ? a.session.snapshotEvents() : []
              msgs = ev.filter((e) => e && e.type === 'assistant/message' && e.data && e.data.message).map((e) => e.data.message)
            } catch { /* ignore */ }
            const textCount = msgs.filter((m) => (Array.isArray(m.content) ? m.content : []).some((b) => b && b.type === 'text' && String(b.text || '').trim())).length
            const last = msgs[msgs.length - 1]
            const got = last ? messageTextOf(sid, last.id) : ''
            rows.push({ sid: sid.slice(0, 18), n: msgs.length, textCount, got: got.slice(0, 40), gotLen: got.length })
          }
          jsonSend(res, 200, { ok: true, agents: list.length, rows })
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  const bookNameOf = (dir, file) => file
    ? String(file).slice(String(dir).length + 1).replace(/\.md$/i, '')
    : ''

  /**
   * 给一个会话找它那本书：先认文件里的 `<!-- sid:... -->`，
   * 找不到才按会话标题（或给定名字）建一本并打上标记。
   * 以后会话改名、书改名都不会再凭名字去认书。
   */
  const sessionBook = async (dir, sidKey, fallbackName) => {
    const key = String(sidKey || '').trim()
    const found = key ? await findBySid(dir, key) : ''
    if (found) return { path: found, conv: bookNameOf(dir, found), blocked: false }
    let name = ''
    if (key) {
      try { name = safeConvName(await sessionTitleOf(key)) } catch { name = '' }
    }
    if (!name && fallbackName) name = safeConvName(fallbackName)
    if (!name) name = '未命名'
    const removedNow = await removedConvList()
    if (removedNow.includes(name)) return { path: '', conv: name, blocked: true }
    const exist = dir + '/' + name + '.md'
    let has = false
    try { await stat(exist); has = true } catch { has = false }
    const file = has ? exist : await ensureConvFile(dir, name, true)
    if (!file) return { path: '', conv: name, blocked: true }
    if (key) await tagSid(file, key)
    return { path: file, conv: name, blocked: false }
  }

  const listQuotes = async (conv, sid, mode) => {
    const cfgNow = (await readJson(configCandidates()[0])) || {}
    const dir = await quotesDir()
    const convs = await listConvFiles(dir)
    const sidKey = String(sid || '').trim()
    const wantAll = mode === 'all' || (!mode && !conv && !sidKey)
    let active = ''
    let path = ''
    let items = []

    const readBookSource = async (file, label) => {
      let source = await readSource(file)
      const repaired = repairOrphans(source)
      if (repaired !== source) {
        await writeAtomic(file, repaired)
        source = repaired
      }
      const real = parseQuotes(source).filter((it) => it.text && it.text.trim() && it.text.trim() !== PLACEHOLDER)
      if (!real.length) {
        const migrated = await migrateLegacy(dir, label)
        if (migrated) source = migrated
      }
      return source
    }

    if (wantAll) {
      // 「全部对话」：把所有对话文件聚起来（跳过占位句），按时间倒序
      const seen = new Set()
      const favsAll = new Set((await readFavs(join(dir, '_'))).map((x) => normalise(String(x))))
      for (const n of convs) {
        const fp = dir + '/' + n + '.md'
        const cached = await readParsedCached(fp)
        if (!cached.parsed.length) continue
        for (const it of cached.parsed) {
          const t = (it.text || '').trim()
          if (!t || t === PLACEHOLDER) continue
          const k = normalise(t)
          if (seen.has(k)) continue
          seen.add(k)
          items.push({
            ...it,
            conv: n,
            conversation: String(it.conversation || '').trim() || n,
            fav: favsAll.has(k),
          })
        }
      }
      items.sort((a, b) => (b.ts || 0) - (a.ts || 0))
      path = dir
    } else if (mode === 'name' && conv) {
      active = await aliasOf(safeConvName(conv))
      const file = await ensureConvFile(dir, active)
      if (file) {
        path = file
        const source = await readBookSource(file, active)
        const favs = new Set((await readFavs(file)).map((x) => normalise(String(x))))
        items = parseQuotes(source).map((it) => ({
          ...it,
          conversation: String(it.conversation || '').trim() || active,
          fav: favs.has(normalise(it.text)),
        }))
      }
    } else {
      // 会话视图：sid 才是身份，书名只是标签
      const book = await sessionBook(dir, sidKey, conv)
      active = book.conv
      if (book.path) {
        path = book.path
        const source = await readBookSource(book.path, active)
        const favs = new Set((await readFavs(book.path)).map((x) => normalise(String(x))))
        items = parseQuotes(source).map((it) => ({
          ...it,
          conversation: String(it.conversation || '').trim() || active,
          fav: favs.has(normalise(it.text)),
        }))
      }
    }

    const title = typeof cfgNow.title === 'string' && cfgNow.title.trim() ? cfgNow.title.trim() : '鲸语'
    // 下拉只列「真写过句子」的书；空壳（只有占位句）不占位置，当前这本例外。
    const listed = []
    for (const n of convs) {
      if (active && n === active) { listed.push(n); continue }
      const f = join(dir, n + '.md')
      const cached = await readParsedCached(f).catch(() => null)
      const rows = (cached && Array.isArray(cached.parsed)) ? cached.parsed : []
      const real = rows.some((it) => {
        const t = String((it && it.text) || '').trim()
        return t && t !== PLACEHOLDER
      })
      if (real) listed.push(n)
    }
    return {
      ok: true,
      title,
      source: path,
      dir,
      conv: active,
      convs: listed,
      items,
      captureLevel: CAPTURE_RULES[cfgNow.captureLevel] ? cfgNow.captureLevel : 'normal',
      captureRule: typeof cfgNow.captureRule === 'string' ? cfgNow.captureRule : '',
      convRule: active && cfgNow.captureRules && typeof cfgNow.captureRules[active] === 'string'
        ? cfgNow.captureRules[active] : '',
      manualAdd: cfgNow.manualAdd !== false,
      msgAction: cfgNow.msgAction !== false,
      disabledConversations: Array.isArray(cfgNow.disabledConversations) ? cfgNow.disabledConversations : [],
      captureRules: cfgNow.captureRules && typeof cfgNow.captureRules === 'object' ? cfgNow.captureRules : {},
      removed: await removedConvList(),
      trash: await trashList(await quotesDir()),
      trashAuto: (await trashCfg()).auto,
      trashDays: (await trashCfg()).days,
    }
  }

  const appendQuote = async (text, note, context, conversation) => {
    const body = String(text || '').replace(/\s*\n+\s*/g, ' ').trim()
    if (!body) return { ok: false, error: 'text 不能为空' }
    const convName = safeConvName(conversation)
    if (convName) {
      const removedNow = await removedConvList()
      if (removedNow.includes(convName)) {
        return { ok: false, error: '这本在回收站里，先从设置里收回来再记' }
      }
    }
    const target = await targetFor(convName, true)
    const path = target.path
    const title = target.title
    const label = convName || title
    // 读-改-写整段上锁：两只鱼同时记，后写的不会把前一句吞掉
    const written = await withQuoteLock(path, async () => {
      const source = await readSource(path)
      const inserted = insertQuote(source, body, note ? String(note).trim() : '', context ? String(context).trim() : '', label)
      const content = inserted.added ? dropPlaceholder(inserted.content) : inserted.content
      if (inserted.added) await writeAtomic(path, content)
      return { inserted, content }
    })
    const inserted = written.inserted
    const added = inserted.added
    const reason = inserted.reason
    const content = written.content
    return {
      ok: true,
      added,
      ...(added ? {} : { reason: reason || 'skipped' }),
      title,
      source: path,
      line: formatLine(body, note ? String(note).trim() : '', context ? String(context).trim() : '', conversation ? String(conversation).trim() : ''),
      total: parseQuotes(content).length,
    }
  }

  const removeQuote = async (text, conv) => {
    const wanted = normalise(text)
    if (!wanted) return { ok: false, error: 'text 不能为空' }
    // 删除不能因为「这本还没建」就顺手建出一个空文件来（之前删未标注对话时就发生过）
    let path = ''
    let source = ''
    if (conv) {
      path = (await targetFor(conv)).path
      try { source = await readFile(path, 'utf8') } catch { source = '' }
    }
    const eol = source.includes('\r\n') ? '\r\n' : '\n'
    const lines = source ? source.split(/\r?\n/) : []
    let at = path ? lines.findIndex((l) => l.trim().startsWith('- ') && normalise(splitLine(l)) === wanted) : -1
    if (at === -1) {
      // 句子可能写在别的对话文件里（例如早期按 sid 落盘但没带对话名），再扫一遍所有文件
      let altNames = []
      try { altNames = (await readdir(DEFAULT_DIR)).filter((n) => n.endsWith('.md')) } catch { altNames = [] }
      for (const name of altNames) {
        const alt = DEFAULT_DIR + '/' + name
        if (alt === path) continue
        let altSource = ''
        try { altSource = await readFile(alt, 'utf8') } catch { continue }
        const altLines = altSource.split(/\r?\n/)
        const hit = altLines.findIndex((l) => l.trim().startsWith('- ') && normalise(splitLine(l)) === wanted)
        if (hit === -1) continue
        const removedLine = altLines[hit].trim()
        altLines.splice(hit, 1)
        await writeAtomic(alt, joinLike(altLines, altSource))
        return { ok: true, removed: splitLine(removedLine), line: removedLine, source: alt, total: parseQuotes(joinLike(altLines, altSource)).length }
      }
      return { ok: false, error: '没有这一句（按整句匹配，不含批注）' }
    }
    const removed = lines[at].trim()
    let extra = 0
    while (at + 1 + extra < lines.length) {
      const nxt = lines[at + 1 + extra]
      if (!nxt || !/^\s{2,}\S/.test(nxt)) break
      extra += 1
    }
    const block = lines.slice(at, at + 1 + extra)
    lines.splice(at, 1 + extra)
    await writeAtomic(path, joinLike(lines, source))
    return { ok: true, removed: splitLine(removed), line: removed, block, source: path, total: parseQuotes(joinLike(lines, source)).length }
  }

  const mergeQuotes = async (conv) => {
    const { path } = await targetFor(conv)
    const source = await readSource(path)
    const lines = source.split(/\r?\n/)
    const seen = new Set()
    const kept = []
    let dropped = 0
    for (const line of lines) {
      if (line.trim().startsWith('- ')) {
        const key = normalise(splitLine(line))
        if (key && seen.has(key)) {
          dropped += 1
          continue
        }
        if (key) seen.add(key)
      }
      kept.push(line)
    }
    if (dropped) await writeAtomic(path, joinLike(kept, source))
    return { ok: true, dropped, total: parseQuotes(joinLike(kept, source)).length, source: path }
  }

  /** Rewrite every `↳ 对话：<from>` line to <to>. Returns how many lines changed. */
  const renameConversation = async (from, to) => {
    const src = String(from || '').trim()
    const dst = String(to || '').trim()
    if (!src || !dst) return { ok: false, error: '新旧名字都要填' }
    if (src === dst) return { ok: true, changed: 0 }
    const { path } = await resolveTarget()
    const source = await readSource(path)
    const lines = source.split(/\r?\n/)
    let changed = 0
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(/^(\s*↳\s*(?:对话|会话)\s*[:：]\s*)(.*)$/)
      if (m && m[2].trim() === src) {
        lines[i] = m[1] + dst
        changed += 1
      }
    }
    if (changed) await writeAtomic(path, joinLike(lines, source))
    return { ok: true, changed, from: src, to: dst, source: path }
  }

  /** Rename one conversation's own file (per-conversation mode). */
  const renameConvFile = async (from, to, sid) => {
    const dstName = safeConvName(to)
    if (!dstName) return { ok: false, error: '新名字要填' }
    const dir = await quotesDir()
    let srcName = safeConvName(from)
    let srcFile = srcName ? dir + '/' + srcName + '.md' : ''
    let body = ''
    try { body = await readFile(srcFile, 'utf8') } catch {
      // 名字对不上（会话改过名、语录早先也改过名）→ 按 sid 找真正的那本
      const bySid = sid ? await findBySid(dir, sid) : ''
      if (!bySid) return { ok: false, error: '没有这个对话的语录文件' }
      srcFile = bySid
      srcName = srcFile.slice(dir.length + 1).replace(/\.md$/i, '')
      body = await readFile(srcFile, 'utf8')
    }
    if (srcName === dstName) return { ok: true, changed: 0 }
    const dstFile = dir + '/' + dstName + '.md'
    try {
      await stat(dstFile)
      return { ok: false, error: '已经有同名目录了' }
    } catch { /* 目标不存在，可以改名 */ }
    // 真·改名：同一个文件挪个名字，不复制、不新建
    await rename(srcFile, dstFile)
    const replaced = body
      .replace(/^([ \t]*↳[ \t]*(?:对话|会话)[ \t]*[:：][ \t]*).*$/gm, (m, p1) => p1 + dstName)
      .replace(/^# 语录 · .*$/m, '# 语录 · ' + dstName)
    if (replaced !== body) await writeFile(dstFile, replaced, 'utf8')
    try {
      const cfgPath = configCandidates()[0]
      const cfg = (await readJson(cfgPath)) || {}
      const alias = (cfg && cfg.convAlias && typeof cfg.convAlias === 'object') ? cfg.convAlias : {}
      // 旧名字、真实文件名、当前会话标题，统统指向新名字，免得下次又建一本空的
      let titleKey = ''
      if (sid) { try { titleKey = safeConvName(await sessionTitleOf(sid)) } catch { titleKey = '' } }
      for (const k of [srcName, safeConvName(from), titleKey]) {
        if (k && k !== dstName) alias[k] = dstName
      }
      cfg.convAlias = alias
      await writeJson(cfgPath, cfg)
    } catch { /* 记不住别名也不影响改名本身 */ }
    return { ok: true, changed: 1, from: srcName, to: dstName, source: dstFile }
  }

  /** Replace the whole file with an uploaded backup, keeping the old one aside. */
  const importQuotes = async (markdown) => {
    const body = String(markdown || '')
    if (!body.trim()) return { ok: false, error: '备份内容是空的' }
    if (!/(^|\n)\s*-\s+/.test(body)) return { ok: false, error: '看着不像语录文件（没有 `- 句子` 行）' }
    const { path } = await resolveTarget()
    const previous = await readSource(path).catch(() => '')
    if (previous.trim()) {
      const stamp = new Date().toISOString().replace(/[:T]/g, '').slice(0, 15)
      await writeFile(path + '.before-restore-' + stamp, previous, 'utf8').catch(() => {})
    }
    await writeAtomic(path, body)
    const items = parseQuotes(body)
    return { ok: true, items: items.length, source: path }
  }

  /** Per-conversation on/off switch, stored in the config file. */
  const setConversationEnabled = async (conversation, enabled) => {
    const name = String(conversation || '').trim()
    if (!name) return { ok: false, error: '没有指定对话' }
    const file = configCandidates()[0]
    const current = (await readJson(file)) || {}
    const list = new Set(Array.isArray(current.disabledConversations) ? current.disabledConversations : [])
    if (enabled) list.delete(name)
    else list.add(name)
    await saveConfig({ disabledConversations: Array.from(list) })
    return { ok: true, conversation: name, enabled, disabled: Array.from(list) }
  }

  /** Ask npm for the newest published version. */
  const checkUpdate = async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    let current = ''
    try {
      current = JSON.parse(await readFile(join(here, 'package.json'), 'utf8')).version || ''
    } catch { /* 拿不到就只说最新版 */ }
    let latest = ''
    try {
      const res = await fetch('https://registry.npmjs.org/dsh-whale-whispers/latest', {
        headers: { accept: 'application/json' },
      })
      if (res.ok) latest = String((await res.json()).version || '')
    } catch { /* 离线 */ }
    const cmp = (a, b) => {
      const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
      const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
      for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const d = (pa[i] || 0) - (pb[i] || 0)
        if (d) return d > 0 ? 1 : -1
      }
      return 0
    }
    const order = current && latest ? cmp(current, latest) : 0
    return {
      ok: true,
      current,
      latest,
      ahead: order > 0,
      outdated: order < 0,
      command: 'dsh plugin add dsh-whale-whispers@latest',
    }
  }

  /**
   * The conversation the user is looking at right now.
   * The host does not hand the current session id to a slot component, so ask the projection cache:
   * the session whose cache file was written last is, in practice, the one on screen.
   */
  async function readActiveSession() {
    const dir = join(homedir(), '.dsh', 'storages', 'session_projcache', 'sessions')
    let names = []
    try {
      names = await readdir(dir)
    } catch {
      return { ok: false, title: '', id: '' }
    }
    const rows = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const info = await stat(join(dir, name))
        rows.push([info.mtimeMs, name])
      } catch {
        /* 单个文件读不到就算了 */
      }
    }
    rows.sort((a, b) => b[0] - a[0])
    for (const [mtime, name] of rows.slice(0, 3)) {
      try {
        const data = JSON.parse(await readFile(join(dir, name), 'utf8'))
        const title = data && data.record && data.record.rows && data.record.rows.title
        const value = title && typeof title.val === 'string' ? title.val.trim() : ''
        if (value) {
          return { ok: true, id: name.replace(/\.json$/, ''), title: value, updatedAt: new Date(mtime).toISOString() }
        }
      } catch {
        /* 结构对不上就看下一个 */
      }
    }
    return { ok: false, title: '', id: '' }
  }

  /* ---------- the panel's data route ---------- */

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (req, res) => {
        let payload
        let cq = new URLSearchParams('')
        try { cq = new URL(req.url || '/', 'http://127.0.0.1').searchParams } catch { /* 忽略 */ }
        const conv = fixMojibake(cq.get('conv') || '')
        let sid = ''
        try {
          const rawSid = cq.get('b64sid')
          sid = rawSid ? Buffer.from(rawSid, 'base64').toString('utf8') : (cq.get('sid') || '')
        } catch { sid = '' }
        const mode = cq.get('mode') || ''
        try {
          payload = await listQuotes(conv, sid, mode)
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
        const levelRaw = pick('level') || (typeof body.captureLevel === 'string' ? String(body.captureLevel).trim() : '')
        const captureLevel = ['conservative', 'normal', 'eager'].includes(levelRaw) ? levelRaw : ''
        let addRaw = dec(q.get('b64add'))
        if (!addRaw && body && (body.manualAdd === true || body.manualAdd === false || body.manualAdd === 'true' || body.manualAdd === 'false')) addRaw = String(body.manualAdd)
        const manualAdd = addRaw === 'true' || addRaw === '1' ? true : addRaw === 'false' || addRaw === '0' ? false : null
        let msgRaw = dec(q.get('b64msgact'))
        if (!msgRaw && body && (body.msgAction === true || body.msgAction === false)) msgRaw = String(body.msgAction)
        const msgAction = msgRaw === 'true' || msgRaw === '1' ? true : msgRaw === 'false' || msgRaw === '0' ? false : null
        let trautoRaw = dec(q.get('b64trauto'))
        if (!trautoRaw && body && (body.trashAuto === true || body.trashAuto === false)) trautoRaw = String(body.trashAuto)
        const trashAuto = trautoRaw === 'true' || trautoRaw === '1' ? true : trautoRaw === 'false' || trautoRaw === '0' ? false : null
        const trdaysNum = Number(dec(q.get('b64trdays')) || (body && body.trashDays != null ? body.trashDays : NaN))
        const trashDays = Number.isFinite(trdaysNum) && trdaysNum > 0 ? Math.min(365, Math.max(1, Math.round(trdaysNum))) : null
        const hasRule = dec(q.get('b64rule')) !== '' || typeof body.captureRule === 'string'
        const captureRule = (dec(q.get('b64rule')) || (typeof body.captureRule === 'string' ? fixMojibake(body.captureRule) : '')).trim().slice(0, 400)
        const scopeRaw = (dec(q.get('b64scope')) || (typeof body.scope === 'string' ? body.scope : '')).trim()
        const scopeConv = (dec(q.get('b64conv')) || (typeof body.conv === 'string' ? fixMojibake(body.conv) : '')).trim().slice(0, 60)

        if (!title && !pathValue && !captureLevel && !hasRule && manualAdd === null && msgAction === null && trashAuto === null && trashDays === null) return jsonSend(res, 400, { ok: false, error: '没有要改的字段' })
        if (title && title.length > 40) return jsonSend(res, 400, { ok: false, error: '标题太长（最多 40 字）' })
        if (pathValue && !/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(pathValue)) {
          return jsonSend(res, 400, { ok: false, error: '请填绝对路径，例如 C:/Users/me/.dsh/whale-whispers/quotes.md' })
        }

        try {
          const patch = {}
          if (title) patch.title = title
          if (pathValue) patch.path = pathValue.replace(/\\/g, '/')
          if (captureLevel) patch.captureLevel = captureLevel
          if (hasRule) {
            if (scopeRaw === 'conv' && scopeConv) {
              const curCfg = (await readJson(configCandidates()[0])) || {}
              const map = Object.assign({}, curCfg.captureRules || {})
              map[scopeConv] = captureRule
              patch.captureRules = map
            } else {
              patch.captureRule = captureRule
              if (scopeConv) {
                const curCfg = (await readJson(configCandidates()[0])) || {}
                const map = Object.assign({}, curCfg.captureRules || {})
                if (map[scopeConv] !== undefined) {
                  delete map[scopeConv]
                  patch.captureRules = map
                }
              }
            }
          }
        if (manualAdd !== null) patch.manualAdd = manualAdd
          if (msgAction !== null) patch.msgAction = msgAction
          if (trashAuto !== null) patch.trashAuto = trashAuto
          if (trashDays !== null) patch.trashDays = trashDays
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
            captureLevel: CAPTURE_RULES[saved.captureLevel] ? saved.captureLevel : 'normal',
            captureRule: typeof saved.captureRule === 'string' ? saved.captureRule : '',
            captureRules: saved.captureRules && typeof saved.captureRules === 'object' ? saved.captureRules : {},
        manualAdd: saved.manualAdd !== false,
        msgAction: saved.msgAction !== false,
        trashAuto: saved.trashAuto === true,
        trashDays: Math.min(365, Math.max(1, Math.round(Number(saved.trashDays) || TRASH_DEFAULT_DAYS))),
            ...(warning ? { warning } : {}),
          })
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  /* ---------- 让新会话的智能体知道这个本子怎么用 ---------- */

  const CAPTURE_RULES = {
    conservative: '只在主人明说“记住这句/收进鲸语”，或者那句明显站得住时才记；一段对话常常一句都不记，也正常。',
    normal: '一段对话里最多记一两条；有明显好句子才记，普通对话不记也正常。',
    eager: '遇到像样的句子就记，一段对话可以记两三条；但依然不硬凑，凑数的别写。',
  }

  function currentConvSync() {
    try {
      const dir = join(homedir(), '.dsh', 'storages', 'session_projcache', 'sessions')
      const names = readdirSync(dir).filter((n) => n.endsWith('.json'))
      let best = ''
      let bestM = -1
      for (const n of names) {
        try {
          const st = statSync(join(dir, n))
          if (st.mtimeMs > bestM) { bestM = st.mtimeMs; best = n }
        } catch { /* 单个文件读不到就算了 */ }
      }
      if (!best) return ''
      const data = JSON.parse(stripBom(readFileSync(join(dir, best), 'utf8')))
      const t = data && data.record && data.record.rows && data.record.rows.title
      return t && typeof t.val === 'string' ? t.val.trim() : ''
    } catch {
      return ''
    }
  }

  function buildGuide() {
    let level = 'normal'
    let rule = ''
    try {
      const cfgPath = join(homedir(), '.dsh', 'quotes.config.json')
      const parsed = JSON.parse(stripBom(readFileSync(cfgPath, 'utf8')))
      if (parsed && CAPTURE_RULES[parsed.captureLevel]) level = parsed.captureLevel
      if (parsed && typeof parsed.captureRule === 'string') rule = parsed.captureRule.trim()
      if (parsed && parsed.captureRules && typeof parsed.captureRules === 'object') {
        const cur = currentConvSync()
        if (cur && typeof parsed.captureRules[cur] === 'string' && parsed.captureRules[cur].trim()) rule = parsed.captureRules[cur].trim()
      }
    } catch {
      /* 没配置按 normal */
    }
    try {
      const cfgPath = join(homedir(), '.dsh', 'quotes.config.json')
      const parsed2 = JSON.parse(stripBom(readFileSync(cfgPath, 'utf8')))
      const cur2 = currentConvSync()
      if (cur2 && parsed2 && Array.isArray(parsed2.disabledConversations) && parsed2.disabledConversations.includes(cur2)) return ''
    } catch {
      /* ignore */
    }
    return [
      '【鲸语】你有一个自己的句子本：whale_whisper_append({ text, note?, context?, conversation? }) 记一句，whale_whisper_list 查重/回看，whale_whisper_remove 删一句。',
      '只记站得住、想过之后还想再看的话（判断、比喻、认输、承认）；寒暄、进度、汇报不记。',
      '值得说的时候（不是每次）顺带一句「这句我收进鲸语了」。',
      '频率：' + CAPTURE_RULES[level],
      ...(rule ? ['另外，主人指定要记这类内容：' + rule + '（只在这类内容真出现时记，别硬凑）'] : []),
    ].join('\n')
  }

  ctx.effect(() =>
    (() => { const t = buildGuide(); if (t) ctx.systemPrompt.section({ name: 'dsh-whale-whispers', order: 620, text: t }) })(),
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

        let convArg = fixMojibake(q.get('conv') || '')
        if (!convArg) {
          try {
            const body = JSON.parse(raw || '{}') || {}
            convArg = fixMojibake(typeof body.conv === 'string' ? body.conv : '')
          } catch { convArg = '' }
        }
        try {
          const out = await removeQuote(text, convArg)
          try {
            if (out && out.ok && Array.isArray(out.block) && out.block.length) {
              await writeAtomic(DEFAULT_DIR + '/.undo.json', JSON.stringify({ file: out.source, block: out.block }))
            } else if (out && out.ok) {
              /* 没抓到整块（例如跨文件删到的旧格式行），就不要留着上一次的快照误导人 */
              await writeAtomic(DEFAULT_DIR + '/.undo.json', '')
            }
          } catch { /* 快照失败不影响删除 */ }
          jsonSend(res, 200, out)
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  /* ---------- 撤销上一次删除 ---------- */

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: UNDO_ROUTE,
      handler: async (req, res) => {
        if (req.method === 'GET') {
          let peek = null
          try { peek = await readJson(DEFAULT_DIR + '/.undo.json') } catch (e) { peek = null }
          const hasPeek = !!(peek && Array.isArray(peek.block) && peek.block.length)
          return jsonSend(res, 200, { ok: true, has: hasPeek, text: hasPeek ? splitLine(peek.block[0] || '') : '' })
        }
        if (req.method !== 'POST') return jsonSend(res, 405, { ok: false, error: 'POST only' })
        try {
          const snap = await readJson(DEFAULT_DIR + '/.undo.json')
          if (!snap || !snap.file || !Array.isArray(snap.block) || !snap.block.length) {
            return jsonSend(res, 400, { ok: false, error: '没有可撤销的删除' })
          }
          const src = await readSource(snap.file)
          const lines = src.split(/\r?\n/)
          let cut = lines.length
          while (cut > 0 && lines[cut - 1].trim() === '') cut -= 1
          lines.splice(cut, 0, ...snap.block)
          await writeAtomic(snap.file, joinLike(lines, src))
          try { await writeAtomic(DEFAULT_DIR + '/.undo.json', '') } catch { /* 忽略 */ }
          return jsonSend(res, 200, { ok: true, restored: splitLine(snap.block[0] || '') })
        } catch (error) {
          return jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  /* ---------- 面板里手动加一句 ---------- */

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ADD_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'POST') return jsonSend(res, 405, { ok: false, error: 'POST only' })

        let raw = ''
        try { raw = await readBody(req) } catch (error) {
          return jsonSend(res, 400, { ok: false, error: String((error && error.message) || error) })
        }
        let q = new URLSearchParams('')
        try { q = new URL(req.url || '/', 'http://127.0.0.1').searchParams } catch { /* 忽略 */ }

        const dec = (value) => {
          try { return Buffer.from(String(value || ''), 'base64').toString('utf8').trim() } catch { return '' }
        }
        let text = dec(q.get('b64text'))
        let conversation = dec(q.get('b64conv'))
        let sidArg = dec(q.get('b64sid'))
        if (!text || !conversation || !sidArg) {
          try {
            const body = JSON.parse(raw || '{}') || {}
            if (!text) text = fixMojibake(typeof body.text === 'string' ? body.text : '').trim()
            if (!conversation) conversation = fixMojibake(typeof body.conversation === 'string' ? body.conversation : conversation).trim()
            if (!sidArg) {
              const bs = body.sid || body.sessionId
              if (typeof bs === 'string' && bs.trim()) sidArg = bs.trim()
            }
          } catch { /* 忽略 */ }
        }
        if (!text) return jsonSend(res, 400, { ok: false, error: 'text 不能为空' })
        const convGiven = conversation
        if (!conversation && sidArg) conversation = await sessionTitleOf(sidArg)
        // 目录改过名之后，用别名回到真实目录，免得又写出一个同名目录
        if (conversation) conversation = await aliasOf(conversation)
        // 按 messageId 回源到会话事件，拿真正那一条回复的文本
        {
          const sid2 = sidArg
          const mid = dec(q.get('b64mid'))
          if (sid2 && mid) {
            const exact = messageTextOf(sid2, mid)
            if (exact) text = exact
          }
        }
        if (text.length > 500) return jsonSend(res, 400, { ok: false, error: '太长了（最多 500 字）' })

        try {
          let target
          if (sidArg && !convGiven) {
            // 没指定书名 = 「本对话」：严格按 sessionId 找那本
            const dirNow = await quotesDir()
            const book = await sessionBook(dirNow, sidArg, conversation)
            if (book.blocked || !book.path) {
              return jsonSend(res, 400, { ok: false, error: '这本在回收站里，先在设置里点「恢复」收回来再记' })
            }
            target = { path: book.path, conv: book.conv, title: conversation }
          } else {
            // 明确指定了某一本：按书名写，别被当前会话的 sid 抢走
            target = await targetFor(conversation, true)
          }
          const path = target.path
          if (!path) {
            return jsonSend(res, 400, { ok: false, error: '这本在回收站里，先在设置里点「恢复」收回来再记' })
          }
          const done = await withQuoteLock(path, async () => {
            const source = await readSource(path)
            const result = insertQuote(source, text, '', '', safeConvName(conversation))
            if (!result || !result.added) return { added: false }
            await writeAtomic(path, dropPlaceholder(result.content))
            return { added: true }
          })
          if (!done.added) return jsonSend(res, 200, { ok: true, duplicate: true, conv: target.conv })
          jsonSend(res, 200, { ok: true, conv: target.conv })
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  /* ---------- 面板里收藏 / 取消收藏 ---------- */

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: FAV_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'POST') return jsonSend(res, 405, { ok: false, error: 'POST only' })
        let q = new URLSearchParams('')
        try { q = new URL(req.url || '/', 'http://127.0.0.1').searchParams } catch { /* 忽略 */ }
        let text = ''
        try { text = Buffer.from(String(q.get('b64') || ''), 'base64').toString('utf8').trim() } catch { text = '' }
        if (!text) return jsonSend(res, 400, { ok: false, error: 'text 不能为空' })
        const on = String(q.get('on') || '1') !== '0'
        try {
          const { path } = await resolveTarget()
          const key = normalise(text)
          const list = await readFavs(path)
          const kept = list.filter((x) => normalise(String(x)) !== key)
          if (on) kept.push(text)
          await writeFavs(path, kept)
          jsonSend(res, 200, { ok: true, fav: on, total: kept.length })
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: RENAME_CONV_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'POST') return jsonSend(res, 405, { ok: false, error: 'POST only' })
        let q = new URLSearchParams('')
        try { q = new URL(req.url || '/', 'http://127.0.0.1').searchParams } catch { /* 忽略 */ }
        const dec = (v) => {
          try { return Buffer.from(String(v || ''), 'base64').toString('utf8').trim() } catch { return '' }
        }
        const from = dec(q.get('b64from'))
        const to = dec(q.get('b64to'))
        try {
          jsonSend(res, 200, await renameConversation(from, to))
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: RENAME_CONV_FILE_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'POST') return jsonSend(res, 405, { ok: false, error: 'POST only' })
        let q = new URLSearchParams('')
        try { q = new URL(req.url || '/', 'http://127.0.0.1').searchParams } catch { /* 忽略 */ }
        const dec = (v) => {
          try { return Buffer.from(String(v || ''), 'base64').toString('utf8').trim() } catch { return '' }
        }
        const from = dec(q.get('b64from'))
        const to = dec(q.get('b64to'))
        const rsid = dec(q.get('b64sid'))
        try {
          jsonSend(res, 200, await renameConvFile(from, to, rsid))
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: IMPORT_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'POST') return jsonSend(res, 405, { ok: false, error: 'POST only' })
        let q = new URLSearchParams('')
        try { q = new URL(req.url || '/', 'http://127.0.0.1').searchParams } catch { /* 忽略 */ }
        const raw = q.get('b64') || ''
        let text = ''
        try { text = Buffer.from(raw, 'base64').toString('utf8') } catch { text = '' }
        try {
          jsonSend(res, 200, await importQuotes(text))
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  const moveConvFile = async (conv, restore) => {
    const name = safeConvName(conv)
    if (!name) return { ok: false, error: '对话名不能为空' }
    const dir = await quotesDir()
    const removed = await removedConvList()
    const src = dir + '/' + name + '.md'
    const trashDir = dir + '/.trash'
    if (restore) {
      let found = ''
      try {
        const names = await readdir(trashDir)
        const hit = names.filter((n) => n.startsWith(name + '--') && n.endsWith('.md')).sort().pop()
        if (hit) found = trashDir + '/' + hit
      } catch { /* 没有回收站 */ }
      if (!found) {
        await mkdir(dir, { recursive: true })
        // 先解除隐藏，再建本——顺序反了 ensureConvFile 会因为还在隐藏列表里直接返回空
        await saveConfig({ removedConversations: removed.filter((x) => x !== name) })
        const made = await ensureConvFile(dir, name, true)
        return { ok: true, restored: name, fresh: true, file: made }
      }
      await mkdir(dir, { recursive: true })
      await rename(found, src)
      await saveConfig({ removedConversations: removed.filter((x) => x !== name) })
      return { ok: true, restored: name }
    }
    let body = ''
    try { body = await readFile(src, 'utf8') } catch { return { ok: false, error: '这一本不存在' } }
    const count = parseQuotes(body).length
    await mkdir(trashDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await rename(src, trashDir + '/' + name + '--' + stamp + '.md')
    const list = removed.includes(name) ? removed : removed.concat([name])
    await saveConfig({ removedConversations: list })
    return { ok: true, removed: name, moved: count }
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ENABLE_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'POST') return jsonSend(res, 405, { ok: false, error: 'POST only' })
        let q = new URLSearchParams('')
        try { q = new URL(req.url || '/', 'http://127.0.0.1').searchParams } catch { /* 忽略 */ }
        const dec = (v) => { try { return Buffer.from(String(v || ''), 'base64').toString('utf8').trim() } catch { return '' } }
        const conv = dec(q.get('b64conv'))
        const on = String(q.get('on') || '1') === '1'
        try {
          jsonSend(res, 200, await setConversationEnabled(conv, on))
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: RM_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'POST') return jsonSend(res, 405, { ok: false, error: 'POST only' })
        let body = {}
        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        } catch { body = {} }
        try {
          jsonSend(res, 200, await moveConvFile(body.conv, body.restore === true))
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: PURGE_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'POST') return jsonSend(res, 405, { ok: false, error: 'POST only' })
        try {
          const dir = await quotesDir()
          const trash = dir + '/.trash'
          let names = []
          try { names = await readdir(trash) } catch { names = [] }
          let n = 0
          for (const name of names) {
            if (!name.endsWith('.md')) continue
            try { await unlink(trash + '/' + name); n += 1 } catch { /* 忽略 */ }
          }
          jsonSend(res, 200, { ok: true, removed: n })
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: UPDATE_ROUTE,
      handler: async (req, res) => {
        try {
          jsonSend(res, 200, await checkUpdate())
        } catch (error) {
          jsonSend(res, 500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: SESSION_ROUTE,
      handler: async (req, res) => {
        try {
          const q = new URL(req.url || SESSION_ROUTE, 'http://127.0.0.1').searchParams
          const sidArg = q.get('b64sid') || q.get('sid') || ''
          let sid = sidArg
          if (q.get('b64sid')) {
            try { sid = Buffer.from(String(sidArg || ''), 'base64').toString('utf8').trim() } catch { sid = '' }
          }
          if (sid) {
            const title = await sessionTitleOf(sid)
            jsonSend(res, 200, { ok: true, title: title ? await aliasOf(title) : '', sessionId: sid })
            return
          }
          const active = await readActiveSession()
          if (active && active.title) active.title = await aliasOf(active.title)
          jsonSend(res, 200, active)
        } catch (error) {
          jsonSend(res, 500, { ok: false, title: '', error: String((error && error.message) || error) })
        }
      },
    }),
  )

  /* ---------- the agent tools ---------- */

  ctx.effect(() =>
    ctx.tools.register({
      name: 'whale_whisper_list',
      description:
        '读回「鲸语」里的句子（最新在前）。动手记之前先看一眼，免得收重复的话；也可以用它确认自己以前记过什么。'
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
        '把你的某一句话收进「鲸语」——这是你留给自己的句子本。'
        + '什么时候用：当你说出一句自己觉得站得住、想过之后还想再看一遍的话（一句判断、一个比喻、一次认输、一句承认），'
        + '就在同一层回答里顺手调它，把原句抄进去，能带上文就带上；不收套话、不收解释、不收寒暄。'
        + '已经有一样的句子会跳过（不会重复），写完不用另存，面板立刻能读到。'
        + '今天一句都没有也没什么；硬凑出来的那句是凑，不是留。',
      parameters: {
        text: { type: 'string', description: '要收的句子（必填，不含两端的「」也行）' },
        note: { type: 'string', description: '可选批注：为什么会记它，会显示成灰色小字' },
        context: { type: 'string', description: '可选上文：这句话是在什么情况下说的（他会想看到语境）' },
        conversation: { type: 'string', description: '可选对话名：这句话出自哪段对话，面板按它分组（不填就归到未标注）' },
      },
      output: textOutput,
      async execute(args) {
        return appendQuote(args?.text, args?.note, args?.context, args?.conversation)
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

  ctx.effect(() =>
    ctx.tools.register({
      name: 'whale_whisper_merge',
      description:
        '把「鲸语」里重复的句子合并掉：同样的句子只留最早那条，多余的删掉，返回删了几条。'
        + '句子攒久了、同一个意思写了两遍的时候用；不会动不同意思的句子。',
      parameters: {},
      output: textOutput,
      async execute() {
        return mergeQuotes()
      },
    }),
  )
}
