/**
 * @hermes/plugin-sdk test stub.
 *
 * Only the surface hermes-soundboard imports is implemented, with the same
 * shapes (nanostores-style atoms, `useValue` via `useSyncExternalStore`), so
 * the plugin runs unchanged outside the Electron renderer. Imported by the
 * esbuild bundle in harness.mjs through an alias — never shipped, never
 * imported directly (esbuild inlines it into the same bundle as the plugin).
 */

import { cloneElement, createContext, createElement, useContext, useSyncExternalStore } from 'react'

export const atom = initial => {
  const listeners = new Set()
  let value = initial

  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const listener of [...listeners]) listener(value)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}

export const computed = (deps, derive) => {
  const store = atom(derive(...deps.map(dep => dep.get())))
  for (const dep of deps) dep.subscribe(() => store.set(derive(...deps.map(item => item.get()))))
  return store
}

export const useValue = store => useSyncExternalStore(store.subscribe, store.get, store.get)

// `usePluginI18n` resolves against the bundles this plugin registered. The
// real host keeps the registry; here it lives on a global so the harness's
// `ctx.i18n.register` (a different module instance) feeds the same table.
const bundles = (globalThis.__hermesPluginLocales ??= new Map())

export const registerPluginI18n = (pluginId, locales) => {
  bundles.set(pluginId, locales)
}

export const usePluginI18n = pluginId => {
  const bundle = bundles.get(pluginId) ?? {}
  const locale = bundle.en ?? {}

  return (key, ...args) => {
    const value = locale[key]
    if (value === undefined) return key
    return typeof value === 'function' ? value(...args) : value
  }
}

export const cn = (...values) => values.flat().filter(Boolean).join(' ')

export const haptic = () => {}

export const host = {
  state: {
    gateway: atom('open'),
    busy: atom(false),
    profile: atom('default'),
    // `shell.exec` is session-bound (the gateway runs the command in that
    // chat's cwd/policy). The harness sets this to stand in for an open chat;
    // read through the global so it can change per scenario.
    activeSessionId: { get: () => globalThis.__hermesTestSessionId ?? null }
  },
  notify: () => {},
  navigate: () => {},
  // The gateway RPC door. esbuild INLINES this stub into the bundle, so the
  // harness cannot swap `host.request` on a separately-imported copy — it hands
  // a handler through this global instead, which every bundled caller sees.
  request: async (method, params, timeoutMs) => {
    const handler = globalThis.__hermesHostRequest
    if (typeof handler !== 'function') {
      throw new Error(`host.request(${method}) is not stubbed for this call`)
    }
    return handler(method, params, timeoutMs)
  }
}

export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' }
export const PALETTE_AREA = 'palette'
export const KEYBINDS_AREA = 'keybinds'
export const PANES_AREA = 'panes'
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebarNav'

export const Button = ({ children, asChild, ...props }) => createElement('button', { type: 'button', ...props }, children)

export const Input = props => createElement('input', props)

export const Tip = ({ children }) => children

// Controlled popover: Radix semantics reduced to "the trigger toggles, the
// content mounts only while open". Without this the panel would always be
// mounted and every open/close assertion would pass vacuously.
const PopoverContext = createContext({ open: false, setOpen: () => {} })

export const Popover = ({ children, open = false, onOpenChange }) =>
  createElement(PopoverContext.Provider, { value: { open, setOpen: next => onOpenChange?.(next) } }, children)

export const PopoverTrigger = ({ children, asChild }) => {
  const { open, setOpen } = useContext(PopoverContext)
  const toggle = event => {
    children.props?.onClick?.(event)
    setOpen(!open)
  }

  return asChild ? cloneElement(children, { onClick: toggle }) : createElement('button', { type: 'button', onClick: toggle }, children)
}

// Radix's POSITIONING props must not reach the DOM. The real `PopoverContent`
// is a portalled element that consumes `side`/`align` and never renders them;
// this stub spread them through, and `<div align="end">` is an inherited
// legacy HTML attribute that maps to `text-align` — so every descendant
// inherited `text-align: end` and the preview screenshots showed a layout the
// app never produces. Swallow them, keep everything else.
export const PopoverContent = ({ children, side: _side, align: _align, sideOffset: _offset, ...props }) => {
  const { open } = useContext(PopoverContext)

  return open ? createElement('div', { 'data-popover-content': 'true', tabIndex: -1, ...props }, children) : null
}

// A visible stand-in for each icon the plugin uses, so the preview shows what
// the real SVG would occupy. The real host renders actual SVGs.
const GLYPH = {
  Plus: '+',
  StopFilled: '■',
  Pencil: '✎',
  Play: '▶',
  Trash2: '✕',
  Loader2: '◌',
  Volume2: '🔊',
  VolumeX: '🔇',
  AudioLines: '≋',
  Pause: '❙❙',
  X: '✕'
}

const icon = name => {
  const Component = props => {
    const size = props.size ?? 12
    return createElement(
      'span',
      {
        'data-icon': name,
        'aria-hidden': 'true',
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          fontSize: Math.max(8, size - 1),
          lineHeight: 1,
          flexShrink: 0
        }
      },
      GLYPH[name] ?? '◆'
    )
  }
  Component.displayName = `icon:${name}`
  return Component
}

export const icons = new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? icon(key) : undefined) })
