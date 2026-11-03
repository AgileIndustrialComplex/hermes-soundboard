/**
 * Visual preview — renders the plugin's real UI in a real Chromium and writes
 * PNGs, so the panel can be checked at 2x instead of squinting at a status bar
 * that is 20 CSS px tall inside a 1456px screenshot.
 *
 * Usage:  node test/preview.mjs
 *
 * Everything (plugin + React + ReactDOM + the SDK stub) is bundled into ONE
 * ESM file: a single React instance is what makes hooks work, and a browser
 * cannot resolve bare specifiers or CJS without a bundler.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const depsRoot =
  process.env.HERMES_DEPS_ROOT || path.resolve(root, '..', 'AppData/Local/hermes/hermes-agent/node_modules')
const fromDeps = specifier => pathToFileURL(path.join(depsRoot, specifier)).href

const { build } = await import(fromDeps('esbuild/lib/main.js'))
// playwright-core's package entry is CJS; the ESM build is index.mjs.
const playwright = await import(fromDeps('playwright-core/index.mjs'))
const chromium = playwright.chromium ?? playwright.default?.chromium

const outDir = path.join(root, '.build')
const bundlePath = path.join(outDir, 'preview-bundle.mjs')
const entryPath = path.join(outDir, 'entry.js')
const pagePath = path.join(outDir, 'preview.html')

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

// The preview entry: mount the chip into a fake status bar, with a context that
// behaves like the host's (storage, files, i18n, contributions).
fs.writeFileSync(
  entryPath,
  `
import { createRoot } from 'react-dom/client'
import { jsx } from 'react/jsx-runtime'
import plugin from ${JSON.stringify(path.join(root, 'plugin.js').replace(/\\/g, '/'))}
import { registerPluginI18n } from ${JSON.stringify(path.join(here, 'sdk-stub.mjs').replace(/\\/g, '/'))}

const memory = new Map()
const contributions = {}
let settingsPage = null

const ctx = {
  source: 'plugin:hermes-soundboard',
  i18n: {
    // The host resolves usePluginI18n against the bundle registered here.
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
    readText: async () => ({ ok: false, error: 'not-found', message: 'no clip' }),
    writeText: async () => ({ ok: false, error: 'io-error', message: 'preview is read-only' }),
    trash: async () => ({ ok: true }),
    folders: async () => [],
    requestFolder: async () => ({ ok: false, error: 'unavailable', message: 'preview' })
  },
  notify: opts => console.log('[notify]', opts && opts.message),
  // Gateway event stream, exposed so the suite can push a real event through.
  onEvent: (type, listener) => {
    window.__events ??= {}
    window.__events[type] ??= []
    window.__events[type].push(listener)
    return () => {}
  },
  onDispose: () => {},
  register: c => { contributions[c.id] = c },
  registerMany: list => { for (const c of list) contributions[c.id] = c },
  registerSettingsPage: page => { settingsPage = page },
  setTimeout, setInterval, addEventListener: () => () => {},
  os: {}, pet: { visible: false, say: () => () => {}, clear: () => {} }
}

const realRegister = ctx.i18n.register
ctx.i18n.register = bundle => { window.__locales = bundle; realRegister(bundle) }

plugin.register(ctx)
window.__contrib = contributions
window.__settingsPage = settingsPage

const chip = contributions.chip
createRoot(document.getElementById('chip')).render(jsx(chip.render, {}))

// The settings page renders in its own mount, opened on demand.
window.__mountSettings = () => {
  const host = document.getElementById('settings-host')
  host.hidden = false
  createRoot(host).render(settingsPage.render())
}
window.__ready = true
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

// The app's own dark palette (ui-* + the chrome tokens this plugin touches),
// so what renders here is what the window shows.
const THEME = `
  :root{
    --ui-bg-editor:#17130f; --ui-bg-elevated:#231d18; --ui-bg-quaternary:#2b241e;
    --ui-bg-tertiary:#1d1814; --ui-bg-secondary:#25201b;
    --ui-text-primary:#efe6d8; --ui-text-secondary:#c3b6a4; --ui-text-tertiary:#948878;
    --ui-text-quaternary:#6f6558; --ui-accent:#dcae58; --ui-red:#e06a5b;
    --ui-stroke-secondary:#3b322a; --ui-stroke-tertiary:#2e271f;
    --chrome-action-hover:#332b23;
    --font-mono:ui-monospace,SFMono-Regular,Menlo,monospace;
    color-scheme: dark;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--ui-bg-editor);color:var(--ui-text-primary)}
  #stage{position:relative;width:100%;height:100%}
  .fake-editor{position:absolute;inset:0 0 22px 0;display:flex;align-items:center;justify-content:center;
    color:var(--ui-text-quaternary);font-size:12px;letter-spacing:.04em}
  .fake-statusbar{position:absolute;left:0;right:0;bottom:0;height:22px;display:flex;align-items:center;
    justify-content:flex-end;gap:2px;padding:0 8px;background:var(--ui-bg-tertiary);
    border-top:1px solid var(--ui-stroke-tertiary);font-size:11px;color:var(--ui-text-tertiary)}
  .fake-item{display:inline-flex;align-items:center;gap:3px;padding:0 5px;height:100%;color:var(--ui-text-quaternary)}
  #settings-host{position:absolute;left:24px;top:24px;width:400px;padding:18px;border-radius:8px;
    background:var(--ui-bg-elevated);box-shadow:0 8px 30px #0008}
  /* Radix positions the popover in the app (side="top" align="end", portalled,
     collision-aware); the test stub renders it inline, so this reproduces that
     placement — pinned to the window's bottom-right like the real thing. */
  .hermes-sb-panel{position:fixed;right:8px;bottom:28px;width:308px;background:var(--ui-bg-elevated);
    border:1px solid var(--ui-stroke-secondary);border-radius:8px;padding:8px;
    box-shadow:0 10px 32px #0009;z-index:10}
  svg{width:1em;height:1em;display:block}
  button{font:inherit;border:0;background:none;cursor:pointer;padding:0;color:inherit}
  input{font:inherit}
`

fs.writeFileSync(
  pagePath,
  `<!doctype html>
<html><head><meta charset="utf-8"><style>${THEME}</style></head>
<body><div id="stage">
  <div class="fake-editor" style="pointer-events:none">Hermes Desktop — status bar preview</div>
  <div id="settings-host" hidden></div>
  <div class="fake-statusbar">
    <span class="fake-item">VOX FM 128</span>
    <span id="chip"></span>
    <span class="fake-item">42%</span>
    <span class="fake-item">GPU 8% · 2G/12G</span>
    <span class="fake-item">v0.22.6+637</span>
  </div>
</div>
<script type="module">
import './preview-bundle.mjs'
</script>
</body></html>`
)

// The borrowed playwright-core asks for a chromium build that may not be the
// one present on this machine. Pick an installed chrome.exe and pass it
// explicitly; HERMES_CHROME overrides.
function findChrome() {
  if (process.env.HERMES_CHROME) return process.env.HERMES_CHROME
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'),
    path.join(process.env.HOME ?? '', '.cache', 'ms-playwright')
  ].filter(Boolean)
  for (const base of roots) {
    if (!fs.existsSync(base)) continue
    // A full chromium build, never the headless shell: the shell has no
    // window chrome and its font stack differs.
    for (const dir of fs.readdirSync(base).filter(name => /^chromium-\d+$/.test(name))) {
      for (const candidate of [
        path.join(base, dir, 'chrome-win64', 'chrome.exe'),
        path.join(base, dir, 'chrome-linux', 'chrome'),
        path.join(base, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      ]) {
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }
  return undefined
}

const browser = await chromium.launch({ executablePath: findChrome(), args: ['--force-color-profile=srgb'] })
const context = await browser.newContext({
  viewport: { width: 420, height: 560 },
  deviceScaleFactor: 2,
  colorScheme: 'dark'
})
const page = await context.newPage()
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') {
    console.log(`[page:${message.type()}] ${message.text()}`)
  }
})
page.on('pageerror', error => console.log(`[page:error] ${error.message}`))

// file:// pages cannot import ESM modules (CORS), so the preview is served from
// a throwaway loopback HTTP server on the .build folder.
const http = await import('node:http')
const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png' }
const server = http.createServer((request, response) => {
  const name = decodeURIComponent((request.url ?? '/').split('?')[0]).replace(/^\/+/, '') || 'preview.html'
  const file = path.join(outDir, name)
  if (!file.startsWith(outDir) || !fs.existsSync(file)) {
    response.writeHead(404).end('not found')
    return
  }
  response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(response)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

await page.goto(`${origin}/preview.html`)
await page.waitForSelector('#chip button', { timeout: 5000 })
await page.waitForTimeout(250)

const shot = async (name, options) => {
  const file = path.join(outDir, name)
  await page.screenshot({ path: file, ...options })
  console.log(`wrote ${file}`)
  return file
}

await shot('preview-statusbar.png', { clip: { x: 0, y: 480, width: 420, height: 80 } })

// Open the panel the way a user does: click the chip.
await page.click('#chip button')
await page.waitForSelector('.hermes-sb-panel', { timeout: 5000 })
await page.waitForTimeout(350)
await shot('preview-panel.png')

const pads = await page.$$eval('.hermes-sb-pad:has(.hermes-sb-pad-name)', nodes =>
  nodes.map(node => {
    const rect = node.getBoundingClientRect()
    return {
      name: node.querySelector('.hermes-sb-pad-name')?.textContent,
      meta: node.getAttribute('data-custom') ? 'file' : 'tone',
      key: node.querySelector('.hermes-sb-pad-key')?.textContent,
      box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
    }
  })
)

const boxOf = selector =>
  page.$eval(selector, node => {
    const rect = node.getBoundingClientRect()
    return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
  })

const chipBox = await boxOf('#chip button')
const panelBox = await boxOf('.hermes-sb-panel')
const gridBox = await boxOf('.hermes-sb-grid')
const titleBox = await boxOf('.hermes-sb-head-title')
const footBox = await boxOf('.hermes-sb-foot')
const sliderBox = await boxOf('.hermes-sb-foot input[type=range]')

console.log('\nchip  ', JSON.stringify(chipBox))
console.log('panel ', JSON.stringify(panelBox))
console.log('title ', JSON.stringify(titleBox))
console.log('grid  ', JSON.stringify(gridBox))
console.log('foot  ', JSON.stringify(footBox))
console.log('slider', JSON.stringify(sliderBox))

// Anchors: the title, the grid and the volume row must share a left edge. The
// title's RIGHT edge is not the panel's — the head's three icon buttons own
// that column, by design — so only the left edge is compared.
const leftGap = [titleBox, gridBox, footBox].map(box => box.x - panelBox.x)
const rightGap = [gridBox, footBox].map(box => panelBox.x + panelBox.w - (box.x + box.w))
console.log(`left insets  ${leftGap.join(' / ')}`)
console.log(`right insets ${rightGap.join(' / ')}`)
if (Math.max(...leftGap) - Math.min(...leftGap) > 4) console.log('!! left edges disagree by more than 4px')
if (Math.max(...rightGap) - Math.min(...rightGap) > 4) console.log('!! right edges disagree by more than 4px')
console.log(`pads  ${pads.length}`)
for (const pad of pads) {
  console.log(
    `  ${String(pad.key ?? '-').padEnd(2)} ${String(pad.name ?? '?').padEnd(10)} ${String(pad.meta ?? '').padEnd(8)} ${JSON.stringify(pad.box)}`
  )
}

// Layout facts from real geometry, not from reading a screenshot.
const columns = new Set(pads.map(pad => pad.box.x)).size
const rows = new Set(pads.map(pad => pad.box.y)).size
console.log(`grid: ${columns} columns x ${rows} rows`)
if (columns < 2) console.log('!! pads are NOT laid out in a grid')

const overflow = panelBox.x < 0 || panelBox.y < 0 || panelBox.x + panelBox.w > 420 || panelBox.y + panelBox.h > 560
if (overflow) console.log(`!! panel overflows the 420x560 viewport: ${JSON.stringify(panelBox)}`)

// Manage mode.
await page.click('.hermes-sb-panel button[aria-label="Manage sounds"]')
await page.waitForTimeout(250)
await shot('preview-manage.png')
console.log(`manage rows: ${await page.$$eval('.hermes-sb-row', nodes => nodes.length)}`)

// ── triggers, measured in a real browser ────────────────────────────────
// The picker is an in-DOM button + menu, so unlike a native <select> its list
// CAN be measured and screenshotted. That is the whole reason it exists.
const pickers = await page.$$eval('.hermes-sb-picker', nodes =>
  nodes.map(node => ({
    label: node.getAttribute('aria-label'),
    text: node.textContent.trim(),
    expanded: node.getAttribute('aria-expanded'),
    box: (() => {
      const r = node.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) }
    })()
  }))
)
console.log(`trigger pickers: ${pickers.length}`)
if (pickers.length) console.log(`  first: "${pickers[0].text}" ${pickers[0].box.w}x${pickers[0].box.h} @y${pickers[0].box.y}`)

// Open the first picker and measure the LIST itself.
await page.click('.hermes-sb-picker')
await page.waitForSelector('.hermes-sb-menu', { timeout: 3000 })
const menu = await page.evaluate(() => {
  const node = document.querySelector('.hermes-sb-menu')
  const row = node.querySelector('.hermes-sb-menu-row')
  const heading = node.querySelector('.hermes-sb-menu-heading')
  const style = getComputedStyle(node)
  const rowStyle = getComputedStyle(row)
  const headingStyle = getComputedStyle(heading)
  const r = node.getBoundingClientRect()
  return {
    rows: node.querySelectorAll('.hermes-sb-menu-row').length,
    groups: node.querySelectorAll('.hermes-sb-menu-group').length,
    background: style.backgroundColor,
    border: style.borderColor,
    box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    row: { color: rowStyle.color, background: rowStyle.backgroundColor },
    heading: { color: headingStyle.color, background: headingStyle.backgroundColor }
  }
})
const luminance = css => {
  const parts = css.match(/[\d.]+/g)
  if (!parts || parts.length < 3) return null
  const [r, g, b] = parts.slice(0, 3).map(Number).map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrastOn = (fg, bg) => {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return a == null || b == null ? null : (a + 0.05) / (b + 0.05)
}
const menuRatio = contrastOn(menu.row.color, menu.background)
const headingRatio = contrastOn(menu.heading.color, menu.background)
console.log(`  menu bg ${menu.background} (${menu.box.w}x${menu.box.h} @ ${menu.box.x},${menu.box.y})`)
console.log(`  ${menu.rows} rows in ${menu.groups} groups`)
console.log(`  row text ${menu.row.color} → ${menuRatio?.toFixed(2)}:1 on the menu surface`)
console.log(`  group label ${menu.heading.color} → ${headingRatio?.toFixed(2)}:1`)
if (!/^rgb/.test(menu.background) || menu.background.includes('rgba(0, 0, 0, 0)')) console.log('!! the menu has no opaque background')
if (menuRatio !== null && menuRatio < 4.5) console.log(`!! menu row text fails 4.5:1 (${menuRatio.toFixed(2)})`)
if (headingRatio !== null && headingRatio < 3) console.log(`!! group label fails 3:1 (${headingRatio.toFixed(2)})`)
if (menu.rows < 15) console.log(`!! only ${menu.rows} trigger rows`)
if (menu.box.y + menu.box.h > 560) console.log('!! the menu runs off the bottom of the viewport')
await shot('preview-menu.png')

// Pick one from the open menu.
await page.click('.hermes-sb-menu-row:has-text("Approval needed")')
await page.waitForTimeout(200)
await page.click('.hermes-sb-panel button[aria-label="Done"]')
await page.waitForTimeout(200)
const boundPads = await page.$$eval('.hermes-sb-pad[data-bound="true"]', nodes => nodes.length)
console.log(`bound pads after binding one: ${boundPads}`)
if (boundPads !== 1) console.log('!! the binding did not mark a pad')

await page.evaluate(() => {
  for (const listener of (window.__events['approval.request'] ?? [])) {
    listener({ type: 'approval.request', payload: { prompt_id: 'p1' } })
  }
})
await page.waitForTimeout(120)
const flashed = await page.$$eval('.hermes-sb-pad[data-active="true"]', nodes =>
  nodes.map(node => node.querySelector('.hermes-sb-pad-name')?.textContent)
)
console.log(`pads flashed by approval.request: ${JSON.stringify(flashed)}`)
if (flashed.length !== 1) console.log('!! the bound sound did not fire in a real browser')
await shot('preview-triggered.png')

// Settings page.
await page.evaluate(() => window.__mountSettings())
await page.waitForTimeout(300)
await shot('preview-settings.png')

await browser.close()
server.close()
console.log('\npreview done')
