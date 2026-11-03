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

const pads = () => [...(panel()?.querySelectorAll('.hermes-sb-pad') ?? [])]
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
  if (!/audio|kB/.test(pad.textContent)) throw new Error('no meta on the pad')
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

/* ── 8. persistence across a reload ────────────────────────────────────── */

chip.unmount()
boot.dispose()

const reboot = makeCtx()
plugin.register(reboot.ctx)
const rebootChip = reboot.contributions.find(item => item.area === 'statusBar.right')
const second = mount(rebootChip.render())
click(second.host.querySelector('button'))
const rebootPads = [...second.host.querySelectorAll('.hermes-sb-pad')].map(pad => pad.textContent)
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
check('corrupt storage falls back to the built-ins', () => {
  click(thirdMount.host.querySelector('button'))
  const count = thirdMount.host.querySelectorAll('.hermes-sb-pad').length
  if (count !== 7) throw new Error(`expected 7 fallback pads, got ${count}`)
})
third.dispose()

/* ── 9. report ─────────────────────────────────────────────────────────── */

const failed = results.filter(row => !row.ok)
for (const row of results) {
  console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.name}${row.ok ? '' : `\n        ${row.error}`}`)
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)

if (failed.length) process.exitCode = 1
