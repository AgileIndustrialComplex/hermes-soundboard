/**
 * Headless render harness for hermes-soundboard.
 *
 * Bundles the real `plugin.js` with esbuild, swapping the three specifiers the
 * Desktop loader resolves at runtime (`@hermes/plugin-sdk`, `react`,
 * `react/jsx-runtime`) for the local stub / the installed React 19, then mounts
 * its contributions in jsdom and drives them like a user would.
 *
 * This proves the plugin evaluates, registers, renders and persists — it does
 * not prove it looks right inside the app. That needs the app.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
// React 19 / ReactDOM 19 / esbuild / jsdom come from the Hermes install: this
// repo ships no dependencies (a desktop plugin has none), so the harness only
// borrows the toolchain that is already on the machine. Override with
// HERMES_DEPS_ROOT when running against a different install.
const depsRoot =
  process.env.HERMES_DEPS_ROOT || path.resolve(root, '..', 'AppData/Local/hermes/hermes-agent/node_modules')
const fromDeps = specifier => pathToFileURL(path.join(depsRoot, specifier)).href

const { build } = await import(fromDeps('esbuild/lib/main.js'))
const { JSDOM } = await import(fromDeps('jsdom/lib/api.js'))

/* ── 1. bundle ─────────────────────────────────────────────────────────── */

// `react` / `react-dom` stay EXTERNAL so the plugin and the renderer share one
// React instance — bundling React into the plugin blob would give the mounted
// tree a second copy and every hook call would throw "Invalid hook call".
// Bare specifiers only resolve from a real file, so the bundle is written into
// `.build/`, next to a junction to the borrowed node_modules.
const buildDir = path.join(root, '.build')
const nodeModulesLink = path.join(buildDir, 'node_modules')
const bundlePath = path.join(buildDir, 'plugin.mjs')

fs.rmSync(buildDir, { recursive: true, force: true })
fs.mkdirSync(buildDir, { recursive: true })
fs.symlinkSync(depsRoot, nodeModulesLink, process.platform === 'win32' ? 'junction' : 'dir')

await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'plugin.js')],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  alias: {
    '@hermes/plugin-sdk': path.join(here, 'sdk-stub.mjs')
  }
})

/* ── 2. jsdom ──────────────────────────────────────────────────────────── */

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
  url: 'https://hermes.invalid/',
  pretendToBeVisual: true
})

const { window } = dom
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true })
globalThis.HTMLElement = window.HTMLElement
globalThis.Event = window.Event
globalThis.KeyboardEvent = window.KeyboardEvent
globalThis.MouseEvent = window.MouseEvent
globalThis.File = window.File
globalThis.FileReader = window.FileReader
if (!window.crypto?.randomUUID) {
  window.crypto.randomUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* ── 3. stubbed host surfaces ──────────────────────────────────────────── */

// WebAudio: every node the plugin builds is a no-op recorder, so a play call
// is observable without sound.
const audioLog = { contexts: 0, oscillators: 0, bufferSources: 0, started: 0 }

class FakeParam {
  constructor() {
    this.value = 0
  }
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
}

class FakeNode {
  connect(target) {
    return target
  }
  disconnect() {}
}

class FakeAudioContext {
  constructor() {
    audioLog.contexts += 1
    this.currentTime = 0
    this.sampleRate = 48000
    this.state = 'running'
    this.destination = new FakeNode()
  }
  createOscillator() {
    audioLog.oscillators += 1
    return Object.assign(new FakeNode(), {
      type: 'sine',
      frequency: new FakeParam(),
      start: () => {
        audioLog.started += 1
      },
      stop: () => {}
    })
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() })
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam(), Q: new FakeParam() })
  }
  createBuffer(channels, frames) {
    audioLog.bufferSources += 1
    const data = new Float32Array(frames)
    return { getChannelData: () => data, length: frames }
  }
  createBufferSource() {
    return Object.assign(new FakeNode(), { buffer: null, start: () => {}, stop: () => {} })
  }
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
  suspend() {
    this.state = 'suspended'
    return Promise.resolve()
  }
  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
}

window.AudioContext = FakeAudioContext
globalThis.AudioContext = FakeAudioContext

// <audio> playback: records the URL a pad asked for.
const audioElements = []
window.Audio = class FakeAudio {
  constructor(src) {
    this.src = src
    this.volume = 1
    this.paused = true
    this.listeners = new Map()
    audioElements.push(this)
  }
  addEventListener(type, fn) {
    this.listeners.set(type, fn)
  }
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
}
globalThis.Audio = window.Audio

/* ── 4. plugin context ─────────────────────────────────────────────────── */

const storage = new Map()
const notifications = []
const files = new Map()
/** event type → the listeners currently subscribed to it. */
const events = new Map()

/** Emit a gateway event the way the host does, then let React flush. Waits for
 *  any previous flash to expire first, so each assertion sees only its own. */
const emit = async (type, payload) => {
  await new Promise(resolve => setTimeout(resolve, 260))
  for (const listener of events.get(type) ?? []) listener({ type, payload })
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

const makeCtx = () => {
  const contributions = []
  const settingsPages = []
  const disposers = []
  const locales = {}
  let disposeAll = null

  const ctx = {
    source: 'plugin:hermes-soundboard',
    register: c => {
      contributions.push(c)
      return () => {}
    },
    registerMany: list => {
      contributions.push(...list)
      return () => {}
    },
    registerSettingsPage: page => {
      settingsPages.push(page)
      return () => {}
    },
    storage: {
      get: (key, fallback) => (storage.has(key) ? JSON.parse(storage.get(key)) : fallback),
      set: (key, value) => storage.set(key, JSON.stringify(value)),
      remove: key => storage.delete(key)
    },
    files: {
      dataFolder: 'data',
      folders: async () => [],
      requestFolder: async () => ({ ok: false, error: 'unavailable', message: 'test' }),
      release: async () => false,
      list: async () => ({ ok: true, entries: [], truncated: false }),
      stat: async () => ({ ok: true, exists: false }),
      readText: async (_folder, p) => (files.has(p) ? { ok: true, text: files.get(p), size: files.get(p).length, mtimeMs: 0 } : { ok: false, error: 'not-found', message: `no ${p}` }),
      readDataUrl: async () => ({ ok: false, error: 'not-found', message: 'none' }),
      writeText: async (_folder, p, text) => {
        files.set(p, text)
        return { ok: true, path: p, size: text.length, mtimeMs: 0 }
      },
      rename: async () => ({ ok: false, error: 'io-error', message: 'unused' }),
      trash: async (_folder, p) => {
        files.delete(p)
        return { ok: true }
      }
    },
    notify: opts => notifications.push(opts),
    notifyError: message => notifications.push({ kind: 'error', message }),
    // Gateway event stream: the plugin subscribes by event type. Emitting here
    // is how the harness plays "the app said a turn finished".
    onEvent: (type, listener) => {
      const set = events.get(type) ?? new Set()
      set.add(listener)
      events.set(type, set)
      return () => set.delete(listener)
    },
    i18n: {
      register: bundle => Object.assign(locales, bundle),
      t: (key, ...args) => {
        const value = (locales.en ?? {})[key]
        return typeof value === 'function' ? value(...args) : (value ?? key)
      }
    },
    onDispose: fn => {
      disposers.push(fn)
    },
    setTimeout: (fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
    setInterval: (fn, ms) => {
      const id = setInterval(fn, ms)
      return () => clearInterval(id)
    },
    addEventListener: () => () => {},
    os: {},
    pet: { visible: false, say: () => () => {}, clear: () => {} }
  }

  disposeAll = () => {
    for (const fn of disposers.reverse()) fn()
  }

  return { ctx, contributions, settingsPages, locales, dispose: disposeAll }
}

/* ── 5. load the plugin ────────────────────────────────────────────────── */

// Imported from disk (not a data: URL) so its `react` specifier resolves
// through `.build/node_modules` to the very same React the renderer below uses.
const mod = await import(pathToFileURL(bundlePath).href)
const plugin = mod.default

if (!plugin || plugin.id !== 'hermes-soundboard' || typeof plugin.register !== 'function') {
  throw new Error('plugin.js did not default-export a HermesPlugin')
}

const boot = makeCtx()
plugin.register(boot.ctx)

// The real host resolves `usePluginI18n(id)` from the bundle the plugin
// registered through `ctx.i18n.register`; the stub reads that table from a
// global, so the harness hands it over here.
globalThis.__hermesPluginLocales.set(plugin.id, boot.locales)

/* ── 6. render ─────────────────────────────────────────────────────────── */

// React is imported through the real path (not the .build junction) so it is
// the exact module instance the bundle's `react` specifier resolves to.
const React = await import(fromDeps('react/index.js'))
const { createRoot } = await import(fromDeps('react-dom/client.js'))
const { act } = React

const mount = node => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(node))
  return { host, root, unmount: () => act(() => root.unmount()) }
}

const click = element => {
  act(() => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
}

const typeInto = (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

const waitFor = async (predicate, label, timeout = 3000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
    await act(async () => {})
  }
  throw new Error(`timed out waiting for ${label}`)
}

/* ── 7. assertions ─────────────────────────────────────────────────────── */

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error: error.message })
  }
}

const chipContribution = boot.contributions.find(item => item.area === 'statusBar.right')
const paletteContribution = boot.contributions.find(item => item.area === 'palette')

check('registers a status-bar chip', () => {
  if (!chipContribution) throw new Error('no statusBar.right contribution')
  if (chipContribution.id !== 'chip') throw new Error(`unexpected id ${chipContribution.id}`)
})
check('registers a palette command', () => {
  if (!paletteContribution) throw new Error('no palette contribution')
})
check('registers a settings page', () => {
  if (!boot.settingsPages.length) throw new Error('no settings page')
  if (boot.settingsPages[0].title !== 'Soundboard') throw new Error('wrong settings title')
})

const chip = mount(chipContribution.render())
const chipButton = chip.host.querySelector('button')
check('chip renders a button with the icon', () => {
  if (!chipButton) throw new Error('no button')
  if (!chipButton.querySelector('[data-icon="AudioLines"]')) throw new Error('no AudioLines icon')
  if (!/soundboard/i.test(chipButton.textContent + (chipButton.getAttribute('aria-label') ?? ''))) throw new Error('no label')
})

click(chipButton)

const panel = () => chip.host.querySelector('[data-popover-content]')
check('clicking the chip opens the panel', () => {
  if (!panel()) throw new Error('popover content did not mount')
})

const pads = () => [...(panel()?.querySelectorAll('.hermes-sb-pad') ?? [])].filter(pad => pad.querySelector('.hermes-sb-pad-name'))
check('ships the seven built-in pads', () => {
  if (pads().length !== 7) throw new Error(`expected 7 pads, got ${pads().length}`)
  const names = pads().map(pad => pad.textContent)
  for (const expected of ['Pop', 'Ding', 'Beep', 'Coin', 'Laser', 'Whoosh', 'Boing']) {
    if (!names.some(text => text.includes(expected))) throw new Error(`missing pad ${expected}`)
  }
})

const padByName = name => pads().find(pad => pad.textContent.includes(name))

click(padByName('Pop'))
check('a synthesized pad plays through WebAudio', () => {
  if (audioLog.contexts === 0) throw new Error('no AudioContext created')
  if (audioLog.oscillators === 0) throw new Error('no oscillator started')
})

click(padByName('Whoosh'))
check('a noise pad allocates a buffer source', () => {
  if (audioLog.bufferSources === 0) throw new Error('no buffer source')
})

// The 1..9 shortcuts: pads flash and play without a click. Handlers live on
// the panel body, so keys are dispatched there.
act(() => {
  panel().querySelector('.hermes-sb-body').dispatchEvent(new window.KeyboardEvent('keydown', { key: '2', bubbles: true }))
})
check('number keys trigger pads', () => {
  const flashed = pads().filter(pad => pad.getAttribute('data-active') === 'true')
  if (!flashed.length) throw new Error('no pad flashed')
})

// Volume: the slider writes through to settings and to the audio graph gate.
const volumeSlider = () => panel().querySelector('input[type=range]')
act(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(volumeSlider(), '0')
  volumeSlider().dispatchEvent(new window.Event('input', { bubbles: true }))
})
check('volume persists', () => {
  const saved = JSON.parse(storage.get('settings'))
  if (saved.volume !== 0) throw new Error(`volume ${saved.volume}`)
})
act(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(volumeSlider(), '80')
  volumeSlider().dispatchEvent(new window.Event('input', { bubbles: true }))
})

// Custom sounds: the file input and the drop target both route to addFile.
const fileInput = () => panel().querySelector('input[type=file]')
check('the panel exposes a hidden file input for audio', () => {
  const input = fileInput()
  if (!input) throw new Error('no file input')
  if (input.accept !== 'audio/*') throw new Error(`accept=${input.accept}`)
  if (!input.multiple) throw new Error('file input is single-select')
})

const clap = new window.File([new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0])], 'Clap Trap.mp3', { type: 'audio/mpeg' })
act(() => {
  Object.defineProperty(fileInput(), 'files', { value: [clap], configurable: true })
  fileInput().dispatchEvent(new window.Event('input', { bubbles: true }))
  fileInput().dispatchEvent(new window.Event('change', { bubbles: true }))
})

await waitFor(() => padByName('Clap Trap'), 'the custom pad')

check('a dropped/added file becomes a pad', () => {
  const pad = padByName('Clap Trap')
  if (!pad) throw new Error('no pad')
  if (!pad.getAttribute('data-custom')) throw new Error('custom pad not marked')
})
check('custom audio is written into the plugin data folder as base64', () => {
  const names = [...files.keys()]
  if (names.length !== 1) throw new Error(`files=${JSON.stringify(names)}`)
  if (!names[0].endsWith('.b64')) throw new Error(`unexpected name ${names[0]}`)
  const text = files.get(names[0])
  if (!/^[A-Za-z0-9+/=]+$/.test(text)) throw new Error('payload is not base64')
})
check('custom sounds are persisted to storage', () => {
  const saved = JSON.parse(storage.get('sounds'))
  if (saved.length !== 8) throw new Error(`expected 8 saved sounds, got ${saved.length}`)
  const clapSound = saved.find(sound => sound.name === 'Clap Trap')
  if (!clapSound || clapSound.kind !== 'file' || clapSound.mime !== 'audio/mpeg') throw new Error('custom sound not saved right')
})

click(padByName('Clap Trap'))
await waitFor(() => audioElements.length > 0, 'an <audio> element')
check('a custom pad plays from the data-URL payload', () => {
  const element = audioElements.at(-1)
  if (!/^data:audio\/mpeg;base64,/.test(element.src)) throw new Error(`src=${element.src?.slice(0, 40)}`)
  if (element.volume !== 0.8) throw new Error(`volume=${element.volume}`)
})

// Drop path. The handler lives on the panel body (the popover content is a
// sibling wrapper), so the event is dispatched there, as a drop lands on it.
const panelBody = () => panel()?.querySelector('.hermes-sb-body')
const boop = new window.File([new Uint8Array([79, 103, 103, 83])], 'boop.ogg', { type: 'audio/ogg' })
act(() => {
  const event = new window.Event('drop', { bubbles: true, cancelable: true })
  event.dataTransfer = { types: ['Files'], files: [boop] }
  panelBody().dispatchEvent(event)
})
await waitFor(() => padByName('boop'), 'the dropped pad')
check('dropping a file on the panel adds a pad', () => {
  if (!padByName('boop')) throw new Error('no pad')
})

// Too-large files are refused with a warning, not a crash.
const huge = new window.File([new Uint8Array(1)], 'huge.wav', { type: 'audio/wav' })
Object.defineProperty(huge, 'size', { value: 9 * 1024 * 1024 })
const before = notifications.length
act(() => {
  const event = new window.Event('drop', { bubbles: true, cancelable: true })
  event.dataTransfer = { types: ['Files'], files: [huge] }
  panelBody().dispatchEvent(event)
})
await waitFor(() => notifications.length > before, 'the size warning')
check('oversized files are refused with a warning', () => {
  const last = notifications.at(-1)
  if (last.kind !== 'warning') throw new Error(`kind=${last.kind}`)
  if (!/3 MB/.test(last.message)) throw new Error(`message=${last.message}`)
})

// Manage mode: rename + delete.
const iconButton = label => [...panel().querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label)
click(iconButton('Manage sounds'))
const rows = () => [...(panel()?.querySelectorAll('.hermes-sb-row') ?? [])]
check('manage mode lists every sound', () => {
  if (rows().length !== 9) throw new Error(`expected 9 rows, got ${rows().length}`)
})

const clapRow = rows().find(row => row.querySelector('input')?.value === 'Clap Trap')
const clapInput = clapRow.querySelector('input')
typeInto(clapInput, 'Snare')
act(() => {
  // React 19 delegates focus loss through `focusout`, not `blur`.
  clapInput.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
})
check('renaming a pad persists', () => {
  const saved = JSON.parse(storage.get('sounds'))
  if (!saved.some(sound => sound.name === 'Snare')) throw new Error('rename not saved')
})

const snareRow = () => rows().find(row => row.querySelector('input')?.value === 'Snare')
click([...snareRow().querySelectorAll('button')].find(button => /Delete/.test(button.getAttribute('aria-label') ?? '')))
check('deleting a pad removes its row and its file', () => {
  if (rows().length !== 8) throw new Error(`expected 8 rows, got ${rows().length}`)
  if (files.size !== 1) throw new Error(`files left: ${files.size}`)
})

click(iconButton('Done'))
check('leaving manage mode shows the pad grid again', () => {
  if (!pads().length) throw new Error('no pads')
})

// ── triggers ────────────────────────────────────────────────────────────
// Every pad carries a "play when" select; a bound pad fires on its gateway
// event and stays silent for every other one.
const pickerFor = name => [...(panel()?.querySelectorAll('.hermes-sb-picker') ?? [])].find(picker =>
  (picker.getAttribute('aria-label') ?? '').endsWith(name)
)
const rowFor = name => rows().find(row => row.querySelector('.hermes-sb-row-name')?.value === name)
/** Open a row's trigger menu, click one or more triggers, then close it.
 *  The menu STAYS OPEN across clicks (multi-select), so closing is explicit. */
const bindVia = (name, ...triggerLabels) => {
  click(pickerFor(name))
  if (!panel().querySelector('.hermes-sb-menu')) throw new Error('the trigger menu did not open')
  for (const label of triggerLabels) {
    // Re-query each time: React replaces the menu node on every toggle.
    const row = [...panel().querySelectorAll('.hermes-sb-menu-row')].find(
      item => item.querySelector('.hermes-sb-menu-text')?.textContent.trim() === label
    )
    if (!row) throw new Error(`no "${label}" row in the menu`)
    click(row)
  }
  // Close by toggling the picker itself. Escape is not usable here: the
  // popover's own handler closes the WHOLE panel on it, not just this menu.
  click(pickerFor(name))
}

click(iconButton('Manage sounds'))
check('every manage row offers a trigger picker', () => {
  const pickers = panel().querySelectorAll('.hermes-sb-picker')
  if (pickers.length !== rows().length) throw new Error(`${pickers.length} pickers for ${rows().length} rows`)
})
check('the picker renders its list in the DOM, not as a native select', () => {
  if (panel().querySelector('select')) throw new Error('a native <select> is still rendered')
  click(pickerFor('Pop'))
  const menu = panel().querySelector('.hermes-sb-menu')
  if (!menu) throw new Error('no in-DOM menu')
  const rowsInMenu = menu.querySelectorAll('.hermes-sb-menu-row')
  if (rowsInMenu.length !== 14) throw new Error(`expected 14 trigger rows, got ${rowsInMenu.length}`)
  const groups = menu.querySelectorAll('.hermes-sb-menu-group')
  if (groups.length < 4) throw new Error(`only ${groups.length} groups`)
  click(pickerFor('Pop'))
})
check('the menu is opaque — it carries its own background, not the page behind it', () => {
  // The previous check may have left Pop's menu open; the picker is a toggle,
  // so close it first and open deliberately.
  if (panel().querySelector('.hermes-sb-menu')) click(pickerFor('Pop'))
  click(pickerFor('Pop'))
  const menu = panel().querySelector('.hermes-sb-menu')
  const style = window.getComputedStyle(menu)
  if (!style.backgroundColor || style.backgroundColor === 'rgba(0, 0, 0, 0)') {
    throw new Error(`menu background is ${style.backgroundColor}`)
  }
  const rowStyle = window.getComputedStyle(menu.querySelector('.hermes-sb-menu-row'))
  if (!rowStyle.color) throw new Error('menu rows have no colour')
  click(pickerFor('Pop'))
})

bindVia('Pop', 'Approval needed')
check('binding a trigger persists on the sound', () => {
  const saved = JSON.parse(storage.get('sounds'))
  const pop = saved.find(sound => sound.name === 'Pop')
  if (JSON.stringify(pop.triggers) !== JSON.stringify(['attention.approval'])) {
    throw new Error(`triggers=${JSON.stringify(pop.triggers)}`)
  }
})

// ── multiple triggers on one sound ──────────────────────────────────────
bindVia('Ding', 'Turn finishes', 'Turn fails', 'Question asked')
check('one sound can hold several triggers', () => {
  const saved = JSON.parse(storage.get('sounds'))
  const ding = saved.find(sound => sound.name === 'Ding')
  const expected = ['turn.complete', 'turn.error', 'attention.clarify']
  if (JSON.stringify(ding.triggers) !== JSON.stringify(expected)) {
    throw new Error(`triggers=${JSON.stringify(ding.triggers)}`)
  }
})
check('a multi-bound picker summarises as a count', () => {
  const picker = pickerFor('Ding')
  const label = picker.querySelector('.hermes-sb-picker-label')?.textContent.trim()
  if (label !== '3 triggers') throw new Error(`label is "${label}"`)

})
check('the menu marks every bound trigger as selected', () => {
  click(pickerFor('Ding'))
  const menu = panel().querySelector('.hermes-sb-menu')
  const selected = [...menu.querySelectorAll('.hermes-sb-menu-row[data-selected=true]')].map(
    row => row.querySelector('.hermes-sb-menu-text')?.textContent.trim()
  )
  if (JSON.stringify(selected) !== JSON.stringify(['Turn finishes', 'Turn fails', 'Question asked'])) {
    throw new Error(`selected=${JSON.stringify(selected)}`)
  }
})
check('clicking a bound trigger again removes just that one', () => {
  const menu = panel().querySelector('.hermes-sb-menu')
  const row = [...menu.querySelectorAll('.hermes-sb-menu-row')].find(
    item => item.querySelector('.hermes-sb-menu-text')?.textContent.trim() === 'Turn fails'
  )
  click(row)
  const saved = JSON.parse(storage.get('sounds'))
  const ding = saved.find(sound => sound.name === 'Ding')
  if (JSON.stringify(ding.triggers) !== JSON.stringify(['turn.complete', 'attention.clarify'])) {
    throw new Error(`triggers=${JSON.stringify(ding.triggers)}`)
  }
  const still = panel().querySelector('.hermes-sb-menu')
  if (!still) throw new Error('the menu closed on a toggle; multi-select needs it open')
})
check('the menu offers a clear-all row once anything is bound', () => {
  const clear = panel().querySelector('.hermes-sb-menu-clear')
  if (!clear) throw new Error('no clear row')
  click(clear)
  const saved = JSON.parse(storage.get('sounds'))
  const ding = saved.find(sound => sound.name === 'Ding')
  if (ding.triggers !== undefined) throw new Error(`triggers=${JSON.stringify(ding.triggers)}`)
})
check('with everything cleared the picker reads Never again', () => {
  const label = pickerFor('Ding').querySelector('.hermes-sb-picker-label')?.textContent.trim()
  if (label !== 'Never') throw new Error(`label is "${label}"`)
})

// restore a two-trigger binding for the firing tests below
bindVia('Ding', 'Turn finishes', 'Question asked')
check('a bound row is marked', () => {
  const picker = pickerFor('Pop')
  if (picker?.getAttribute('data-bound') !== 'true') throw new Error('picker not marked bound')
  if (picker.textContent.trim() !== 'Approval needed') throw new Error(`label is "${picker.textContent.trim()}"`)
})

click(iconButton('Done'))
check('a bound pad shows a dot in the grid', () => {
  const bound = [...panel().querySelectorAll('.hermes-sb-pad')].filter(pad => pad.getAttribute('data-bound') === 'true')
  if (bound.length !== 2) throw new Error(`${bound.length} pads marked bound`)
})

const oscillatorsBefore = audioLog.oscillators
await emit('approval.request', { prompt_id: 'p1', command: 'rm -rf /' })
check('an approval request plays its bound sound only', () => {
  // One flash, one cue: the Ding pad is bound to a different event.
  const activePads = [...panel().querySelectorAll('.hermes-sb-pad')].filter(pad => pad.getAttribute('data-active') === 'true')
  if (activePads.length !== 1) throw new Error(`${activePads.length} pads flashed`)
  if (!activePads[0].textContent.includes('Pop')) throw new Error(`wrong pad: ${activePads[0].textContent}`)
  if (audioLog.oscillators <= oscillatorsBefore) throw new Error('no sound scheduled')
})

await emit('message.complete', { status: 'complete', text: 'done' })
check('a turn-complete event plays the other binding', () => {
  const activePads = [...panel().querySelectorAll('.hermes-sb-pad')].filter(pad => pad.getAttribute('data-active') === 'true')
  if (activePads.length !== 1) throw new Error(`${activePads.length} pads flashed`)
  if (!activePads[0].textContent.includes('Ding')) throw new Error(`wrong pad: ${activePads[0].textContent}`)
})
check('the last-trigger readout reports what fired', () => {
  const readout = panel().querySelector('.hermes-sb-last')
  if (!readout) throw new Error('no readout')
  if (!/Turn finishes/.test(readout.textContent)) throw new Error(readout.textContent)
})

const beforeSilent = audioLog.oscillators
await emit('message.complete', { status: 'error', error: 'boom' })
check('an unbound outcome of a bound event stays silent', () => {
  // `turn.complete` filters status != error, so a failed turn plays nothing.
  if ([...panel().querySelectorAll('.hermes-sb-pad[data-active="true"]')].length) throw new Error('a pad flashed on a failed turn')
})

await emit('error', { message: 'session blew up' })
check('an event with no binding anywhere plays nothing', () => {
  const active = [...panel().querySelectorAll('.hermes-sb-pad[data-active="true"]')]
  if (active.length) throw new Error(`${active.length} pads flashed for an unbound event`)
})
check('the readout clears when a trigger fired nothing', () => {
  if (panel().querySelector('.hermes-sb-last')) throw new Error('stale readout survived')
})

// Unbinding returns the pad to click-only. With multi-select there is no
// "Never" row to pick — clearing is its own action in the menu.
click(iconButton('Manage sounds'))
click(pickerFor('Ding'))
click(panel().querySelector('.hermes-sb-menu-clear'))
check('clearing bindings removes them from the sound', () => {
  const saved = JSON.parse(storage.get('sounds'))
  const ding = saved.find(sound => sound.name === 'Ding')
  if (ding.triggers !== undefined) throw new Error(`triggers still ${JSON.stringify(ding.triggers)}`)
})
const afterUnbind = audioLog.oscillators
await emit('message.complete', { status: 'complete' })
check('an unbound sound no longer fires', () => {
  if ([...panel().querySelectorAll('.hermes-sb-pad[data-active="true"]')].length) throw new Error('a pad flashed')
})
click(iconButton('Done'))

// Stop all + close.
click(iconButton('Stop all sounds'))
check('stop-all clears the active flashes', () => {
  if (pads().some(pad => pad.getAttribute('data-active') === 'true')) throw new Error('a pad is still flashing')
})
act(() => {
  panel().querySelector('.hermes-sb-body').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
})
check('Escape closes the panel', () => {
  if (panel()) throw new Error('panel still mounted')
})

/* ── 7b. YouTube import ─────────────────────────────────────────────────── */

// jsdom reports a Linux UA; the plugin's job pipeline is written for Windows
// (cmd, start /b, doubled %). Force that branch for these tests.
globalThis.__hermesForceWindows = true
globalThis.__hermesTestSessionId = 'test-session'
const storageBeforeYt = new Map(storage)
const filesBeforeYt = new Map(files)
// Each scenario below needs a fresh tool probe.
const resetTools = () => globalThis.__hermesResetTools?.()

// The import is a detached job watched through files, so the harness fakes the
// job by having `shell.exec` write what the real one would: a script, then an
// mp3, then the status file — at whichever moment the test chooses.
// The stub is bundled into the plugin, so `host` is not reachable from here.
// It delegates to this global, which is what the tests swap.
const stubShell = handler => {
  globalThis.__hermesHostRequest = handler
}
const ytFiles = () => [...files.keys()]

chip.unmount()
boot.dispose()

const ytCtx = makeCtx()
plugin.register(ytCtx.ctx)
const ytMount = mount(ytCtx.contributions.find(item => item.area === 'statusBar.right').render())
click(ytMount.host.querySelector('button'))

const linkButton = () => ytMount.host.querySelector('.hermes-sb-panel button[aria-label="Import from YouTube"]')
check('the import control lives in the panel header', () => {
  if (!linkButton()) throw new Error('no YouTube button')
})
click(linkButton())
const urlInput = () => ytMount.host.querySelector('.hermes-sb-yt-input')
check('opening it reveals a single URL field', () => {
  if (!urlInput()) throw new Error('no input')
  if (urlInput().type !== 'text') throw new Error(`type=${urlInput().type}`)
})

// --- a refused URL never reaches the shell ---
let shellCalls = 0
stubShell(async () => {
  shellCalls += 1
  return { blocked: false, code: 0, stdout: '' }
})
typeInto(urlInput(), 'https://vimeo.com/12345')
const goButton = () => ytMount.host.querySelector('.hermes-sb-yt-go')
click(goButton())
await new Promise(resolve => setTimeout(resolve, 120))
check('a non-YouTube link is refused before any process runs', () => {
  const note = ytMount.host.querySelector('.hermes-sb-yt-note[data-error="true"]')
  if (!note) throw new Error('no error shown')
  if (shellCalls !== 0) throw new Error(`the shell ran ${shellCalls} times`)
})

// --- no open chat: refused before any process runs, and said plainly ---
resetTools()
globalThis.__hermesTestSessionId = null
shellCalls = 0
typeInto(urlInput(), 'https://youtu.be/jNQXAC9IVRw')
click(goButton())
await new Promise(resolve => setTimeout(resolve, 120))
check('an import with no open chat explains itself', () => {
  const note = ytMount.host.querySelector('.hermes-sb-yt-note[data-error="true"]')
  if (!note) throw new Error('no error shown')
  if (!/open a chat/i.test(note.textContent)) throw new Error(`note=${note.textContent}`)
  if (/invalid_params/.test(note.textContent)) throw new Error('a raw gateway code leaked to the UI')
  if (shellCalls !== 0) throw new Error(`the shell ran ${shellCalls} times`)
})
globalThis.__hermesTestSessionId = 'test-session'

// --- a missing tool explains itself ---
resetTools()
stubShell(async (method, params) => {
  const command = params?.command ?? ''
  if (/where ffmpeg/.test(command)) return { blocked: false, code: 0, stdout: 'ffmpeg=0\nuvx=1\n' }
  return { blocked: false, code: 0, stdout: '' }
})
typeInto(urlInput(), 'https://youtu.be/jNQXAC9IVRw')
click(goButton())
await new Promise(resolve => setTimeout(resolve, 200))
check('a missing ffmpeg is reported, not silently ignored', () => {
  const note = ytMount.host.querySelector('.hermes-sb-yt-note[data-error="true"]')
  if (!note) throw new Error('no error shown')
  if (!/ffmpeg/i.test(note.textContent)) throw new Error(`note=${note.textContent}`)
})

// --- the happy path: tools present, duration short, job completes ---
resetTools()
const scriptWrites = []
stubShell(async (method, params) => {
  const command = params?.command ?? ''
  if (/where ffmpeg/.test(command)) return { blocked: false, code: 0, stdout: 'ffmpeg=1\nuvx=1\n' }
  if (/--print duration/.test(command)) return { blocked: false, code: 0, stdout: '19\n' }
  return { blocked: false, code: 0, stdout: '' }
})
// Pretend the detached job finished: the script the plugin wrote is in `files`,
// so the harness can supply the mp3 and the status file it would have produced.
const realWrite = ytCtx.ctx.files.writeText
ytCtx.ctx.files.writeText = async (folder, path, text, opts) => {
  const out = await realWrite(folder, path, text, opts)
  if (path.endsWith('.cmd')) {
    scriptWrites.push({ path, text })
    // yt-dlp would now run; stand in for it.
    const stem = path.replace(/^\./, '').replace(/\.cmd$/, '')
    files.set(`${stem}.mp3`, 'FAKE-MP3')
    files.set(`${path.replace(/^\./, '.').replace(/\.cmd$/, '.status')}`, 'ok')
  }
  return out
}
ytCtx.ctx.files.readDataUrl = async (_folder, path) => {
  if (path.endsWith('.mp3')) return { ok: true, url: 'data:audio/mpeg;base64,' + Buffer.from('FAKE-MP3'.repeat(40)).toString('base64') }
  return { ok: false, error: 'not-found', message: path }
}

const ytPadsBefore = ytMount.host.querySelectorAll('.hermes-sb-pad').length
typeInto(urlInput(), 'https://www.youtube.com/watch?v=jNQXAC9IVRw')
click(goButton())
// The poll interval is 700ms, so give the stub job a couple of ticks.
await new Promise(resolve => setTimeout(resolve, 2600))

check('a valid link writes a job script, runs it, and lands a pad', () => {
  if (!scriptWrites.length) throw new Error('no job script was written')
  if (!/uvx yt-dlp/.test(scriptWrites[0].text)) throw new Error('the script does not call uvx yt-dlp')
  if (!/%%\(ext\)s/.test(scriptWrites[0].text)) throw new Error('the output template is not batch-escaped')

  const after = ytMount.host.querySelectorAll('.hermes-sb-pad').length
  if (after !== ytPadsBefore + 1) throw new Error(`${after - ytPadsBefore} pads added`)
  const saved = JSON.parse(storage.get('sounds'))
  const yt = saved.find(sound => /^YouTube/.test(sound.name))
  if (!yt) throw new Error(`no YouTube pad in ${saved.map(s => s.name).join(', ')}`)
  if (yt.mime !== 'audio/mpeg') throw new Error(`mime=${yt.mime}`)
})

check('the progress bar is gone once the import finishes', () => {
  // A bar stuck at 100% would be as confusing as no bar at all.
  if (ytMount.host.querySelector('.hermes-sb-yt-progress')) throw new Error('the progress bar survived')
})

check('a failure raises a host toast as well as the inline note', () => {
  // The panel can be shut when a job ends, so the toast is the only signal left.
  if (!notifications.length) throw new Error('no toast was raised')
  const last = notifications[notifications.length - 1]
  if (last.kind !== 'info') throw new Error(`kind=${last.kind}`)
})

check('the job leftovers are cleaned up after a success', () => {
  const leftovers = ytFiles().filter(name => /\.(cmd|log|status)$/.test(name))
  if (leftovers.length) throw new Error(`left behind: ${leftovers.join(', ')}`)
})

ytMount.unmount()
ytCtx.dispose()
// The import added a pad to the shared storage; later checks count pads, so
// restore the exact pre-test state instead of leaking a change forward.
for (const [key, value] of storageBeforeYt) storage.set(key, value)
for (const [key, value] of filesBeforeYt) files.set(key, value)
for (const key of [...files.keys()]) if (!filesBeforeYt.has(key)) files.delete(key)

/* ── 8. persistence across a reload ────────────────────────────────────── */

chip.unmount()
boot.dispose()

const reboot = makeCtx()
plugin.register(reboot.ctx)
const rebootChip = reboot.contributions.find(item => item.area === 'statusBar.right')
const second = mount(rebootChip.render())
click(second.host.querySelector('button'))
const rebootPads = [...second.host.querySelectorAll('.hermes-sb-pad')]
  .filter(pad => pad.querySelector('.hermes-sb-pad-name'))
  .map(pad => pad.textContent)
check('state survives a disable/enable cycle', () => {
  if (rebootPads.length !== 8) throw new Error(`expected 8 pads after reload, got ${rebootPads.length}`)
  if (!rebootPads.some(text => text.includes('boop'))) throw new Error('custom pad lost')
  if (rebootPads.some(text => text.includes('Clap Trap'))) throw new Error('deleted pad came back')
})

// Corrupt storage must not break the plugin.
storage.set('sounds', '{"nope":true}')
storage.set('settings', '"garbage"')
second.unmount()
reboot.dispose()
const third = makeCtx()
plugin.register(third.ctx)
const thirdChip = third.contributions.find(item => item.area === 'statusBar.right')
const thirdMount = mount(thirdChip.render())
// Migration: everything the previous version wrote stored `trigger: "id"`.
// Drive it through a real load rather than reaching into the sanitizer, so the
// test covers the path the app actually takes.
storage.set('sounds', JSON.stringify([
  { id: 'oldpop', name: 'Old Pop', kind: 'synth', synth: 'pop', trigger: 'turn.complete' },
  { id: 'oldding', name: 'Old Ding', kind: 'synth', synth: 'ding' }
]))
storage.set('settings', JSON.stringify({ volume: 55 }))
thirdMount.unmount()
third.dispose()
const fourth = makeCtx()
plugin.register(fourth.ctx)
const fourthMount = mount(fourth.contributions.find(item => item.area === 'statusBar.right').render())
click(fourthMount.host.querySelector('button'))
check('a legacy single-trigger save is migrated to a list', () => {
  const pads = [...fourthMount.host.querySelectorAll('.hermes-sb-pad')].filter(pad => pad.getAttribute('data-bound') === 'true')
  if (pads.length !== 1) throw new Error(`${pads.length} pads read as bound; expected the legacy one only`)
  if (!pads[0].textContent.includes('Old Pop')) throw new Error(`wrong pad bound: ${pads[0].textContent}`)
})
await emit('message.complete', { status: 'complete' })
check('a migrated binding still fires', () => {
  const active = [...fourthMount.host.querySelectorAll('.hermes-sb-pad[data-active="true"]')]
  if (active.length !== 1) throw new Error(`${active.length} pads flashed after migrating`)
  if (!active[0].textContent.includes('Old Pop')) throw new Error('wrong pad fired')
})
check('a corrupt trigger list is filtered down to known ids', () => {
  storage.set('sounds', JSON.stringify([
    { id: 'x', name: 'X', kind: 'synth', synth: 'pop', triggers: ['turn.complete', 'nonsense', 'turn.complete', 42] }
  ]))
  fourthMount.unmount()
  fourth.dispose()
  const fifth = makeCtx()
  plugin.register(fifth.ctx)
  const fifthMount = mount(fifth.contributions.find(item => item.area === 'statusBar.right').render())
  click(fifthMount.host.querySelector('button'))
  const pad = fifthMount.host.querySelector('.hermes-sb-pad')
  if (pad.getAttribute('data-bound') !== 'true') throw new Error('known id was dropped')
  if (!/Turn finishes/.test(pad.getAttribute('title') ?? '')) throw new Error(`title=${pad.getAttribute('title')}`)
  if (/nonsense|42/.test(pad.getAttribute('title') ?? '')) throw new Error('unknown id survived cleaning')
  fifthMount.unmount()
  fifth.dispose()
})

// Corrupt storage must not break the plugin: after the garbage above, the
// built-in set comes back.
storage.set('sounds', '{"nope":true}')
storage.set('settings', '"garbage"')
const sixth = makeCtx()
plugin.register(sixth.ctx)
const sixthMount = mount(sixth.contributions.find(item => item.area === 'statusBar.right').render())
click(sixthMount.host.querySelector('button'))
check('corrupt storage falls back to the built-ins', () => {
  const count = sixthMount.host.querySelectorAll('.hermes-sb-pad .hermes-sb-pad-name').length
  if (count !== 7) throw new Error(`expected 7 fallback pads, got ${count}`)
})
sixthMount.unmount()
sixth.dispose()

/* ── 9. report ─────────────────────────────────────────────────────────── */

const failed = results.filter(row => !row.ok)
for (const row of results) {
  console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.name}${row.ok ? '' : `\n        ${row.error}`}`)
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)

if (failed.length) process.exitCode = 1
