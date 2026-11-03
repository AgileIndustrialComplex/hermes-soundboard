/**
 * The file-picker path, end to end in a real Chromium with a REAL
 * `<input type="file">` and real File objects.
 *
 * The jsdom harness cannot cover this: it assigns `files` as a static property,
 * so it never reproduced the bug this file exists to guard — `input.files` is a
 * live FileList, and resetting `input.value` (so the same file can be picked
 * twice) empties it. The plugin must snapshot before resetting.
 *
 * Usage:  node test/picker.mjs
 */

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const depsRoot =
  process.env.HERMES_DEPS_ROOT || path.resolve(root, '..', 'AppData/Local/hermes/hermes-agent/node_modules')
const fromDeps = specifier => pathToFileURL(path.join(depsRoot, specifier)).href

const { build } = await import(fromDeps('esbuild/lib/main.js'))
const playwright = await import(fromDeps('playwright-core/index.mjs'))
const chromium = playwright.chromium ?? playwright.default?.chromium

const outDir = path.join(root, '.build')
const entryPath = path.join(outDir, 'picker-entry.js')
const bundlePath = path.join(outDir, 'picker-bundle.mjs')
const pagePath = path.join(outDir, 'picker.html')

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

// Fake clips: a real MP3 frame header plus junk, so the mime/extension checks
// run on genuine bytes. Sizes stay tiny; the 3 MB cap is exercised separately.
const clip = (bytes = 4096) => {
  const buffer = Buffer.alloc(bytes)
  Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]).copy(buffer, 0)
  for (let i = 6; i < bytes; i += 1) buffer[i] = i % 251
  return buffer
}

fs.writeFileSync(path.join(outDir, 'clap.mp3'), clip())
fs.writeFileSync(path.join(outDir, 'snare.mp3'), clip(8192))
fs.writeFileSync(path.join(outDir, 'huge.mp3'), clip(4 * 1024 * 1024))
fs.writeFileSync(path.join(outDir, 'notes.txt'), Buffer.from('not audio'))

fs.writeFileSync(
  entryPath,
  `
import { createRoot } from 'react-dom/client'
import { jsx } from 'react/jsx-runtime'
import plugin from ${JSON.stringify(path.join(root, 'plugin.js').replace(/\\/g, '/'))}
import { registerPluginI18n } from ${JSON.stringify(path.join(here, 'sdk-stub.mjs').replace(/\\/g, '/'))}

const memory = new Map()
const written = {}
const trashed = []
const notices = []
const contributions = {}

const ctx = {
  source: 'plugin:hermes-soundboard',
  i18n: {
    register: bundle => registerPluginI18n(plugin.id, bundle),
    t: (key, ...args) => {
      const value = window.__locales && window.__locales.en && window.__locales.en[key]
      return typeof value === 'function' ? value(...args) : (value === undefined ? key : value)
    }
  },
  storage: {
    get: (key, fallback) => (memory.has(key) ? JSON.parse(memory.get(key)) : fallback),
    set: (key, value) => memory.set(key, JSON.stringify(value)),
    remove: key => memory.delete(key)
  },
  files: {
    dataFolder: 'data',
    readText: async (_f, p) => (written[p] ? { ok: true, text: written[p], size: written[p].length, mtimeMs: 0 } : { ok: false, error: 'not-found', message: 'missing' }),
    writeText: async (_f, p, text) => {
      if (BufferByteLength(text) > 4 * 1024 * 1024) return { ok: false, error: 'too-large', message: 'Text is larger than 4 MiB.' }
      written[p] = text
      return { ok: true, path: p, size: text.length, mtimeMs: 0 }
    },
    trash: async (_f, p) => { trashed.push(p); delete written[p]; return { ok: true } },
    folders: async () => [],
    requestFolder: async () => ({ ok: false, error: 'unavailable', message: 'x' })
  },
  notify: opts => notices.push(opts),
  onDispose: () => {},
  register: c => { contributions[c.id] = c },
  registerMany: list => { for (const c of list) contributions[c.id] = c },
  registerSettingsPage: () => {},
  setTimeout, setInterval, addEventListener: () => () => {},
  os: {}, pet: { visible: false, say: () => () => {}, clear: () => {} }
}

const realRegister = ctx.i18n.register
ctx.i18n.register = bundle => { window.__locales = bundle; realRegister(bundle) }

plugin.register(ctx)
window.__contrib = contributions
createRoot(document.getElementById('chip')).render(jsx(contributions.chip.render, {}))

window.__state = () => ({
  sounds: JSON.parse(memory.get('sounds') || 'null'),
  written: Object.keys(written),
  trashed,
  notices
})
window.__ready = true

function BufferByteLength(text) {
  return new TextEncoder().encode(text).length
}
`
)

await build({
  absWorkingDir: root,
  entryPoints: [entryPath],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome110'],
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@hermes/plugin-sdk': path.join(here, 'sdk-stub.mjs') },
  nodePaths: [depsRoot]
})

fs.writeFileSync(
  pagePath,
  `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#17130f;font-family:Inter,system-ui,sans-serif;color:#efe6d8}
  #statusbar{position:fixed;bottom:0;left:0;right:0;height:22px;display:flex;justify-content:flex-end;align-items:center;padding:0 8px;background:#1d1814}
  .hermes-sb-panel{position:fixed;right:8px;bottom:28px;width:308px;background:#231d18;border:1px solid #3b322a;border-radius:8px;padding:8px}
  button{font:inherit;border:0;background:none;cursor:pointer;color:inherit}
  </style></head>
  <body><div id="statusbar"><span id="chip"></span></div>
  <script type="module" src="./picker-bundle.mjs"></script></body></html>`
)

function findChrome() {
  if (process.env.HERMES_CHROME) return process.env.HERMES_CHROME
  const base = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  if (!fs.existsSync(base)) return undefined
  for (const dir of fs.readdirSync(base).filter(name => /^chromium-\d+$/.test(name))) {
    for (const exe of [path.join(base, dir, 'chrome-win64', 'chrome.exe'), path.join(base, dir, 'chrome-linux', 'chrome')]) {
      if (fs.existsSync(exe)) return exe
    }
  }
  return undefined
}

const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.txt': 'text/plain' }
const server = http.createServer((request, response) => {
  const name = decodeURIComponent((request.url ?? '/').split('?')[0]).replace(/^\/+/, '') || 'picker.html'
  const file = path.join(outDir, name)
  if (!file.startsWith(outDir) || !fs.existsSync(file)) return void response.writeHead(404).end('no')
  response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(response)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

const browser = await chromium.launch({ executablePath: findChrome() })
const context = await browser.newContext({ viewport: { width: 500, height: 640 }, deviceScaleFactor: 2 })
const page = await context.newPage()
page.on('pageerror', error => console.log(`[page:error] ${error.message}`))

await page.goto(`http://127.0.0.1:${server.address().port}/picker.html`)
await page.waitForFunction(() => window.__ready === true)
await page.click('#chip button')
await page.waitForSelector('.hermes-sb-panel')

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error: error.message })
  }
}

const state = () => page.evaluate(() => window.__state())
const padNames = () => page.$$eval('.hermes-sb-pad .hermes-sb-pad-name', nodes => nodes.map(n => n.textContent))
const fileInput = () => page.locator('.hermes-sb-panel input[type=file]')

/** Wait for a condition, but report a FAIL instead of throwing: a regression
 *  here must land in the summary as a named failure, not as a crash. */
const settle = async (predicate, label, timeout = 5000) => {
  try {
    await page.waitForFunction(predicate, { timeout })
    return true
  } catch {
    console.log(`FAIL  ${label} (timed out — the pad never appeared)`)
    return false
  }
}

// ── the bug this suite exists for ────────────────────────────────────────
await fileInput().setInputFiles(path.join(outDir, 'clap.mp3'))
const appeared = await settle(
  () => [...document.querySelectorAll('.hermes-sb-pad-name')].some(n => n.textContent === 'clap'),
  'picking one mp3 adds a pad'
)
const names1 = await padNames()
if (appeared) {
  check('the pad is named after the file and the board holds 8 pads', () => {
    if (names1.length !== 8) throw new Error(`expected 8 pads, got ${names1.length}`)
    if (!names1.includes('clap')) throw new Error(`pads: ${names1.join(',')}`)
  })
}
const afterOne = await state()
check('the clip was written to the plugin data folder', () => {
  if (afterOne.written.length !== 1) throw new Error(`written: ${JSON.stringify(afterOne.written)}`)
  if (!afterOne.written[0].endsWith('.b64')) throw new Error(`odd name ${afterOne.written[0]}`)
})
check('the sound was persisted with its mime', () => {
  const saved = afterOne.sounds.find(sound => sound.name === 'clap')
  if (!saved) throw new Error('clap not persisted')
  if (saved.kind !== 'file' || saved.mime !== 'audio/mpeg') throw new Error(JSON.stringify(saved))
})

// ── the same file a second time (why `value` is reset at all) ────────────
// Counts are relative, and every state read tolerates a null store, so one
// failure reports itself instead of cascading into a TypeError.
const soundCount = () => page.evaluate(() => (window.__state().sounds || []).length)
if (appeared) {
  const base = await soundCount()
  await fileInput().setInputFiles(path.join(outDir, 'clap.mp3'))
  const again = await settle(
    `window.__state().sounds.length === ${base + 1}`,
    'picking the same file twice adds a second pad'
  )
  if (again) {
    const names2 = await padNames()
    check('duplicate names get a suffix instead of colliding', () => {
      const claps = names2.filter(name => name.startsWith('clap'))
      if (claps.length !== 2) throw new Error(`clap pads: ${claps.join(',')}`)
    })
  }

  // ── multiple at once ──────────────────────────────────────────────────
  const beforeMulti = await soundCount()
  await fileInput().setInputFiles([path.join(outDir, 'snare.mp3'), path.join(outDir, 'clap.mp3')])
  const multi = await settle(
    `window.__state().sounds.length === ${beforeMulti + 2}`,
    'multi-select adds every file in one pick'
  )
  if (multi) check('multi-select adds both files', () => {})
}

// ── refusals still work with real bytes ─────────────────────────────────
const before = await soundCount()
await fileInput().setInputFiles(path.join(outDir, 'huge.mp3'))
await settle('window.__state().notices.length > 0', 'the oversized file raises a warning')
const afterHuge = await state()
check('an oversized file is refused and adds nothing', () => {
  if ((afterHuge.sounds || []).length !== before) throw new Error('a pad was added anyway')
  const warn = afterHuge.notices.at(-1)
  if (!warn || warn.kind !== 'warning' || !/3 MB/.test(warn.message)) throw new Error(JSON.stringify(warn))
})

const noticesBefore = (await state()).notices.length
await fileInput().setInputFiles(path.join(outDir, 'notes.txt'))
await settle(`window.__state().notices.length > ${noticesBefore}`, 'the .txt file is refused')
const afterTxt = await state()
check('a non-audio file is refused', () => {
  if ((afterTxt.sounds || []).length !== before) throw new Error('a pad was added from a .txt')
})

// ── deleting a custom clip removes its stored file ─────────────────────
await page.click('.hermes-sb-panel button[aria-label="Manage sounds"]')
await page.waitForSelector('.hermes-sb-row')
const rowCount = await page.$$eval('.hermes-sb-row', nodes => nodes.length)
const deleteButtons = await page.$$('.hermes-sb-panel button[aria-label^="Delete"]')
await deleteButtons.at(-1).click()
await page.waitForTimeout(300)
const afterDelete = await state()
check('delete removes the row, the sound and the stored clip', () => {
  const left = (afterDelete.sounds || []).length
  if (left !== rowCount - 1) throw new Error(`sounds ${left} vs rows ${rowCount}`)
  if (afterDelete.trashed.length !== 1) throw new Error(`trashed: ${JSON.stringify(afterDelete.trashed)}`)
})

// ── report ─────────────────────────────────────────────────────────────
const failed = results.filter(row => !row.ok)
for (const row of results) console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.name}${row.ok ? '' : `\n        ${row.error}`}`)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)

await browser.close()
server.close()
if (failed.length) process.exitCode = 1
