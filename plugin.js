/**
 * hermes-soundboard — a soundboard in the Hermes Desktop bottom bar.
 *
 * Controls live in the status bar (`statusBar.right`): a chip opens a popover
 * of pads. Pads are either synthesized (WebAudio, no files needed) or the
 * user's own audio files, which are copied into the plugin's private data
 * folder through `ctx.files` (base64 text, ≤ 4 MiB each) so they survive a
 * restart without touching the user's disk anywhere else.
 *
 * Disk plugin contract: plain ESM, loaded uncompiled, so UI is `jsx()` calls
 * and the only imports are `@hermes/plugin-sdk`, `react`, `react/jsx-runtime`.
 */

import {
  atom,
  Button,
  haptic,
  icons,
  Input,
  PALETTE_AREA,
  Popover,
  PopoverContent,
  PopoverTrigger,
  STATUSBAR_AREAS,
  Tip,
  usePluginI18n,
  useValue
} from '@hermes/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-soundboard'

/** `ctx.files.writeText` refuses more than 4 MiB; base64 inflates by 4/3. */
const MAX_FILE_BYTES = 3 * 1024 * 1024
const MAX_NAME_LEN = 24
const MAX_SOUNDS = 40
const FLASH_MS = 220

const DEFAULT_SETTINGS = { volume: 80, showLabel: true, padsPerRow: 4 }

// ── synths ────────────────────────────────────────────────────────────────
// Short, distinct, gesture-free cues. Every one is a few oscillator/noise
// nodes with an exponential envelope — no assets, no network, instant.

const SYNTHS = [
  {
    id: 'pop',
    name: 'Pop',
    play(ac, out, gain) {
      const t = ac.currentTime
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(560, t)
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.09)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.75 * gain), t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13)
      osc.connect(g).connect(out)
      osc.start(t)
      osc.stop(t + 0.16)
    }
  },
  {
    id: 'ding',
    name: 'Ding',
    play(ac, out, gain) {
      const t = ac.currentTime
      for (const [freq, level] of [[1046.5, 0.34], [1568, 0.16]]) {
        const osc = ac.createOscillator()
        const g = ac.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, t)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * gain), t + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
        osc.connect(g).connect(out)
        osc.start(t)
        osc.stop(t + 0.95)
      }
    }
  },
  {
    id: 'beep',
    name: 'Beep',
    play(ac, out, gain) {
      const t = ac.currentTime
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(880, t)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.22 * gain), t + 0.006)
      g.gain.setValueAtTime(Math.max(0.0001, 0.22 * gain), t + 0.09)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13)
      osc.connect(g).connect(out)
      osc.start(t)
      osc.stop(t + 0.15)
    }
  },
  {
    id: 'coin',
    name: 'Coin',
    play(ac, out, gain) {
      const t = ac.currentTime
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(987.77, t)
      osc.frequency.setValueAtTime(1318.5, t + 0.06)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.2 * gain), t + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30)
      osc.connect(g).connect(out)
      osc.start(t)
      osc.stop(t + 0.32)
    }
  },
  {
    id: 'laser',
    name: 'Laser',
    play(ac, out, gain) {
      const t = ac.currentTime
      const osc = ac.createOscillator()
      const g = ac.createGain()
      const lp = ac.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(2400, t)
      lp.frequency.exponentialRampToValueAtTime(420, t + 0.3)
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(1600, t)
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.3)
      g.gain.setValueAtTime(Math.max(0.0001, 0.32 * gain), t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
      osc.connect(lp).connect(g).connect(out)
      osc.start(t)
      osc.stop(t + 0.34)
    }
  },
  {
    id: 'whoosh',
    name: 'Whoosh',
    play(ac, out, gain) {
      const t = ac.currentTime
      const frames = Math.max(1, Math.floor(ac.sampleRate * 0.5))
      const buffer = ac.createBuffer(1, frames, ac.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < frames; i += 1) {
        // Decaying white noise: the envelope lives in the buffer so one
        // source node is enough.
        data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
      }
      const src = ac.createBufferSource()
      const bp = ac.createBiquadFilter()
      const g = ac.createGain()
      src.buffer = buffer
      bp.type = 'bandpass'
      bp.Q.value = 1.4
      bp.frequency.setValueAtTime(320, t)
      bp.frequency.exponentialRampToValueAtTime(2600, t + 0.4)
      g.gain.setValueAtTime(Math.max(0.0001, 0.5 * gain), t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      src.connect(bp).connect(g).connect(out)
      src.start(t)
      src.stop(t + 0.5)
    }
  },
  {
    id: 'boing',
    name: 'Boing',
    play(ac, out, gain) {
      const t = ac.currentTime
      const osc = ac.createOscillator()
      const g = ac.createGain()
      const lfo = ac.createOscillator()
      const lfoGain = ac.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(340, t)
      osc.frequency.exponentialRampToValueAtTime(190, t + 0.45)
      lfo.type = 'sine'
      lfo.frequency.setValueAtTime(16, t)
      lfo.frequency.linearRampToValueAtTime(7, t + 0.45)
      lfoGain.gain.value = 22
      lfo.connect(lfoGain).connect(osc.frequency)
      g.gain.setValueAtTime(Math.max(0.0001, 0.5 * gain), t)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      osc.connect(g).connect(out)
      osc.start(t)
      lfo.start(t)
      osc.stop(t + 0.52)
      lfo.stop(t + 0.52)
    }
  }
]

const SYNTH_BY_ID = new Map(SYNTHS.map(synth => [synth.id, synth]))

const DEFAULT_SOUNDS = SYNTHS.map(synth => ({
  id: `builtin-${synth.id}`,
  name: synth.name,
  kind: 'synth',
  synth: synth.id
}))

// ── triggers ──────────────────────────────────────────────────────────────
// Every entry is a real gateway event from the generated contract in
// apps/shared/src/gateway-contract.generated.ts (or a host-state transition).
// `when(payload, event)` narrows a noisy event to the case worth a sound, so a
// binding means "this event, in this situation" rather than "every frame".
//
// `shows` are the filter chips a pad gets while this trigger is selected:
// each one is a further narrowing, so the dropdown stays short.

const TRIGGERS = [
  {
    id: 'turn.complete',
    event: 'message.complete',
    group: 'Turn',
    label: 'Turn finishes',
    detail: 'any outcome',
    when: payload => payload?.status !== 'error' && payload?.status !== 'interrupted'
  },
  {
    id: 'turn.error',
    event: 'message.complete',
    group: 'Turn',
    label: 'Turn fails',
    detail: 'status = error',
    when: payload => payload?.status === 'error' || Boolean(payload?.error)
  },
  {
    id: 'turn.interrupted',
    event: 'message.complete',
    group: 'Turn',
    label: 'Turn interrupted',
    detail: 'status = interrupted',
    when: payload => payload?.status === 'interrupted'
  },
  {
    id: 'turn.start',
    event: 'message.start',
    group: 'Turn',
    label: 'Turn starts',
    detail: 'you hit send',
    when: payload => payload?.display_kind !== 'auto_continue'
  },
  {
    id: 'attention.approval',
    event: 'approval.request',
    group: 'Attention',
    label: 'Approval needed',
    detail: 'agent is blocked',
    when: () => true
  },
  {
    id: 'attention.clarify',
    event: 'clarify.request',
    group: 'Attention',
    label: 'Question asked',
    detail: 'agent is blocked',
    when: () => true
  },
  {
    id: 'attention.warning',
    event: 'notification.show',
    group: 'Attention',
    label: 'Warning notice',
    detail: 'level warn/error',
    when: payload => payload?.level === 'warn' || payload?.level === 'error'
  },
  {
    id: 'attention.risk',
    event: 'tool.output_risk',
    group: 'Attention',
    label: 'Risky tool output',
    detail: 'injection / secrets found',
    when: () => true
  },
  {
    id: 'attention.error',
    event: 'error',
    group: 'Attention',
    label: 'Session error',
    detail: 'outside a turn',
    when: () => true
  },
  {
    id: 'task.subagent',
    event: 'subagent.complete',
    group: 'Work',
    label: 'Subagent finishes',
    detail: 'a delegated child is done',
    when: () => true
  },
  {
    id: 'task.compacted',
    event: 'status.update',
    group: 'Work',
    label: 'Context compacted',
    detail: 'status kind = compacted',
    when: payload => payload?.kind === 'compacted'
  },
  {
    id: 'life.heartbeat',
    event: 'status.update',
    group: 'Ambient',
    label: 'Heartbeat fires',
    detail: 'status kind = heartbeat',
    when: payload => payload?.kind === 'heartbeat'
  },
  {
    id: 'life.wake',
    event: 'wake.detected',
    group: 'Ambient',
    label: 'Wake phrase',
    detail: 'you said the phrase',
    when: () => true
  },
  {
    id: 'life.reaction',
    event: 'reaction',
    group: 'Ambient',
    label: 'Affection detected',
    detail: '"good bot", "ily", a heart',
    when: () => true
  }
]

const TRIGGER_BY_ID = new Map(TRIGGERS.map(trigger => [trigger.id, trigger]))
const TRIGGER_GROUPS = [...new Set(TRIGGERS.map(trigger => trigger.group))]

function cleanTrigger(value) {
  return typeof value === 'string' && TRIGGER_BY_ID.has(value) ? value : null
}

// ── data hygiene ──────────────────────────────────────────────────────────
// Everything read back from storage is user-editable JSON, so each entry is
// rebuilt from scratch; anything unrecognised is dropped rather than trusted.

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const MIME_RE = /^audio\/[a-z0-9.+-]{1,40}$/i

function cleanName(value, fallback) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

  return (text || fallback).slice(0, MAX_NAME_LEN)
}

function cleanSound(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null
  const name = cleanName(raw.name, '')
  if (!name) return null
  // A binding rides on the sound, so any sound can be a trigger — a synthesized
  // cue or the user's own clip alike.
  const trigger = cleanTrigger(raw.trigger)
  const bound = trigger ? { trigger } : {}
  if (raw.kind === 'synth') {
    return SYNTH_BY_ID.has(raw.synth) ? { id: raw.id, name, kind: 'synth', synth: raw.synth, ...bound } : null
  }
  if (raw.kind === 'file' && typeof raw.mime === 'string' && MIME_RE.test(raw.mime)) {
    return {
      id: raw.id,
      name,
      kind: 'file',
      mime: raw.mime,
      bytes: Number.isFinite(raw.bytes) && raw.bytes > 0 ? Math.round(raw.bytes) : 0,
      ...bound
    }
  }

  return null
}

function cleanSounds(raw) {
  if (!Array.isArray(raw)) return DEFAULT_SOUNDS.map(sound => ({ ...sound }))
  const seen = new Set()
  const out = []

  for (const entry of raw.slice(0, MAX_SOUNDS)) {
    const sound = cleanSound(entry)
    if (sound && !seen.has(sound.id)) {
      seen.add(sound.id)
      out.push(sound)
    }
  }

  return out
}

function cleanSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const volume = Number(source.volume)

  return {
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : DEFAULT_SETTINGS.volume,
    showLabel: typeof source.showLabel === 'boolean' ? source.showLabel : DEFAULT_SETTINGS.showLabel,
    padsPerRow: [3, 4, 5].includes(source.padsPerRow) ? source.padsPerRow : DEFAULT_SETTINGS.padsPerRow
  }
}

function newId() {
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)

  return `snd-${uuid.replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}`
}

function uniqueName(desired, taken) {
  const base = cleanName(desired, 'Sound')
  const names = new Set(taken.map(name => name.toLowerCase()))

  if (!names.has(base.toLowerCase())) return base

  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base.slice(0, MAX_NAME_LEN - 4)} ${n}`
    if (!names.has(candidate.toLowerCase())) return candidate
  }

  return base
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that file.'))
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsDataURL(file)
  })
}

const EXT_MIME = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm'
}

function mimeOf(file, header) {
  const declared = String(header || '').split(';')[0].trim().toLowerCase()

  if (MIME_RE.test(declared)) return declared
  const ext = String(file.name || '').split('.').pop()?.toLowerCase() ?? ''

  return EXT_MIME[ext] ?? ''
}

function baseName(fileName) {
  return String(fileName || 'Sound').replace(/\.[^.]+$/, '')
}

// ── engine ────────────────────────────────────────────────────────────────
// All playback, persistence and file I/O lives here; components only read
// atoms and call verbs. Handlers read atoms imperatively (`.get()`), never
// through a render closure.

function createEngine(ctx) {
  const t = ctx.i18n.t
  const sounds = atom(cleanSounds(ctx.storage.get('sounds', null)))
  const settings = atom(cleanSettings(ctx.storage.get('settings', {})))
  const open = atom(false)
  const active = atom({})
  const saving = atom(false)
  /** The most recent trigger that actually fired, for the panel's readout. */
  const lastTrigger = atom(null)

  const timers = new Set()
  const urls = new Map()
  const playing = new Set()
  let audioContext = null
  let disposed = false

  const persistSounds = next => {
    sounds.set(next)
    ctx.storage.set('sounds', next)
  }

  const persistSettings = patch => {
    const next = cleanSettings({ ...settings.get(), ...patch })
    settings.set(next)
    ctx.storage.set('settings', next)
  }

  function flash(id) {
    active.set({ ...active.get(), [id]: true })
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (disposed) return
      const next = { ...active.get() }
      delete next[id]
      active.set(next)
    }, FLASH_MS)
    timers.add(timer)
  }

  function context() {
    if (!audioContext) {
      const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null
      if (!Ctor) return null
      audioContext = new Ctor()
    }
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {})

    return audioContext
  }

  function playSynth(synthId, gain) {
    const synth = SYNTH_BY_ID.get(synthId)
    const ac = context()
    if (!synth || !ac || gain <= 0) return
    const master = ac.createGain()
    master.gain.value = 1
    master.connect(ac.destination)
    try {
      synth.play(ac, master, gain)
    } catch {
      // A closed or suspended context must never surface as a broken pad.
    }
  }

  async function playFile(sound, gain) {
    let url = urls.get(sound.id)
    if (!url) {
      const files = ctx.files
      if (!files) throw new Error(t('noFileAccess'))
      const read = await files.readText(files.dataFolder, `${sound.id}.b64`)
      if (!read.ok) throw new Error(read.message || t('missingAudio'))
      url = `data:${sound.mime};base64,${String(read.text).replace(/\s+/g, '')}`
      urls.set(sound.id, url)
    }
    const audio = new Audio(url)
    audio.volume = Math.max(0, Math.min(1, gain))
    playing.add(audio)
    const release = () => {
      playing.delete(audio)
      audio.src = ''
    }
    audio.addEventListener('ended', release, { once: true })
    audio.addEventListener('error', release, { once: true })
    if (gain <= 0) return
    await audio.play().catch(release)
  }

  function play(sound) {
    if (disposed || !sound) return
    flash(sound.id)
    const gain = settings.get().volume / 100
    if (sound.kind === 'synth') playSynth(sound.synth, gain)
    else void playFile(sound, gain).catch(error => ctx.notify?.({ kind: 'error', message: String(error.message || error) }))
  }

  // Triggered playback is different from a click: the window is usually NOT
  // focused, so the AudioContext may be suspended by the browser's autoplay
  // policy and a resumed context is not guaranteed. Every trigger attempts a
  // resume; if the context refuses, the pad still flashes so the cue is not
  // silently lost, and the panel shows the last trigger.
  const bound = () => sounds.get().filter(sound => sound.trigger)

  function fire(triggerId, event) {
    if (disposed) return
    const trigger = TRIGGER_BY_ID.get(triggerId)
    if (!trigger) return
    let payload = null
    try {
      payload = event?.payload ?? null
      if (!trigger.when(payload, event)) return
    } catch {
      // A malformed payload must never take the event stream down.
      return
    }
    lastTrigger.set({ id: triggerId, at: Date.now() })
    let fired = 0
    for (const sound of bound()) {
      if (sound.trigger !== triggerId) continue
      flash(sound.id)
      fired += 1
      const gain = settings.get().volume / 100
      if (gain <= 0) continue
      if (sound.kind === 'synth') playSynth(sound.synth, gain)
      else void playFile(sound, gain).catch(() => {})
    }
    // A trigger with no pad bound to it is not "the last trigger" — the
    // readout should name something that actually made a sound.
    if (!fired) lastTrigger.set(null)
  }

  // One subscription per distinct event, not per binding: several pads can hang
  // off `message.complete` and the stream only needs to be read once.
  for (const eventName of new Set(TRIGGERS.map(trigger => trigger.event))) {
    ctx.onEvent?.(eventName, event => {
      for (const trigger of TRIGGERS) {
        if (trigger.event === eventName) fire(trigger.id, event)
      }
    })
  }

  function bind(soundId, triggerId) {
    const next = cleanTrigger(triggerId)
    persistSounds(
      sounds.get().map(sound => {
        if (sound.id !== soundId) return sound
        const { trigger: _drop, ...rest } = sound
        return next ? { ...rest, trigger: next } : rest
      })
    )
  }

  function stopAll() {
    for (const audio of playing) {
      audio.pause()
      audio.src = ''
    }
    playing.clear()
    active.set({})
    if (audioContext && audioContext.state === 'running') void audioContext.suspend().catch(() => {})
  }

  async function addFile(file) {
    const files = ctx.files
    if (!files) {
      ctx.notify?.({ kind: 'error', message: t('noFileAccess') })
      return
    }
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      ctx.notify?.({ kind: 'warning', message: t('tooLarge') })
      return
    }
    if (sounds.get().length >= MAX_SOUNDS) {
      ctx.notify?.({ kind: 'warning', message: t('tooMany') })
      return
    }
    saving.set(true)
    try {
      const dataUrl = await readAsDataUrl(file)
      const comma = dataUrl.indexOf(',')
      const mime = mimeOf(file, comma > 0 ? dataUrl.slice(5, comma) : '')
      if (comma < 0 || !mime) {
        ctx.notify?.({ kind: 'warning', message: t('notAudio') })
        return
      }
      const base64 = dataUrl.slice(comma + 1)
      const sound = {
        id: newId(),
        name: uniqueName(baseName(file.name), sounds.get().map(item => item.name)),
        kind: 'file',
        mime,
        bytes: file.size
      }
      const written = await files.writeText(files.dataFolder, `${sound.id}.b64`, base64)
      if (!written.ok) {
        ctx.notify?.({ kind: 'error', message: written.message || t('saveFailed') })
        return
      }
      urls.set(sound.id, dataUrl)
      persistSounds([...sounds.get(), sound])
      haptic('tap')
    } catch (error) {
      ctx.notify?.({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      if (!disposed) saving.set(false)
    }
  }

  function addPreset(synthId) {
    const synth = SYNTH_BY_ID.get(synthId)
    if (!synth || sounds.get().length >= MAX_SOUNDS) return
    const sound = {
      id: `synth-${synth.id}-${Date.now().toString(36)}`,
      name: uniqueName(synth.name, sounds.get().map(item => item.name)),
      kind: 'synth',
      synth: synth.id
    }
    persistSounds([...sounds.get(), sound])
    play(sound)
  }

  function remove(soundId) {
    const target = sounds.get().find(item => item.id === soundId)
    if (!target) return
    const files = ctx.files
    if (target.kind === 'file' && files) void files.trash(files.dataFolder, `${target.id}.b64`).catch(() => {})
    urls.delete(target.id)
    persistSounds(sounds.get().filter(item => item.id !== soundId))
  }

  function rename(soundId, name) {
    const cleaned = cleanName(name, '')
    const current = sounds.get()
    const existing = current.find(item => item.id === soundId)
    if (!existing) return
    if (!cleaned) {
      // An empty field is a cancelled rename, not a nameless pad.
      persistSounds([...current])
      return
    }
    const others = current.filter(item => item.id !== soundId)
    persistSounds(current.map(item => (item.id === soundId ? { ...item, name: uniqueName(cleaned, others.map(other => other.name)) } : item)))
  }

  function restorePresets() {
    const present = new Set(sounds.get().filter(item => item.kind === 'synth').map(item => item.synth))
    const missing = DEFAULT_SOUNDS.filter(sound => !present.has(sound.synth))
    if (!missing.length) return
    persistSounds([...sounds.get(), ...missing.map(sound => ({ ...sound, id: `synth-${sound.synth}-${Date.now().toString(36)}` }))])
  }

  ctx.onDispose(() => {
    disposed = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    for (const audio of playing) {
      audio.pause()
      audio.src = ''
    }
    playing.clear()
    urls.clear()
    if (audioContext) void audioContext.close().catch(() => {})
    audioContext = null
  })

  return {
    sounds,
    settings,
    open,
    active,
    saving,
    lastTrigger,
    play,
    stopAll,
    addFile,
    addPreset,
    remove,
    rename,
    bind,
    restorePresets,
    setVolume: volume => persistSettings({ volume }),
    setShowLabel: showLabel => persistSettings({ showLabel }),
    setPadsPerRow: padsPerRow => persistSettings({ padsPerRow })
  }
}

// ── styles ────────────────────────────────────────────────────────────────
// A disk plugin is not scanned by Tailwind, so layout lives in its own
// stylesheet and every colour comes from a theme variable.

const CSS = `
.hermes-sb-bar{display:flex;align-items:center;height:100%;gap:2px}
.hermes-sb-chip{display:inline-flex;align-items:center;gap:4px;height:100%;padding:0 5px;font-size:11px;color:var(--ui-text-tertiary)}
.hermes-sb-chip:hover{color:var(--ui-text-primary)}
.hermes-sb-chip[data-open=true]{color:var(--ui-accent)}
.hermes-sb-chip-label{max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hermes-sb-panel{width:308px;max-width:calc(100vw - 24px);outline:none}
.hermes-sb-head{display:flex;align-items:center;gap:2px;padding:0 0 6px}
.hermes-sb-head-title{flex:1;min-width:0;padding-left:4px;font-size:10px;line-height:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ui-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hermes-sb-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;color:var(--ui-text-tertiary);background:transparent;flex-shrink:0}
.hermes-sb-iconbtn:hover{background:var(--chrome-action-hover);color:var(--ui-text-primary)}
.hermes-sb-iconbtn[data-on=true]{color:var(--ui-accent)}
.hermes-sb-iconbtn:focus-visible{outline:1px solid var(--ui-accent);outline-offset:-1px}
.hermes-sb-iconbtn:disabled{cursor:default;opacity:.5}
/* No reserved scrollbar gutter: a stable gutter reserves ~15px on the right
   only, which made the grid visibly right-heavy against its 4px left inset.
   The pads shrink slightly once a tenth sound makes the list scroll; that is a
   better trade than a permanent asymmetry. */
.hermes-sb-grid{display:grid;gap:6px;max-height:min(46vh,300px);overflow-y:auto;overscroll-behavior:contain;padding:2px;scrollbar-width:thin}
/* A pad needs a boundary of its own: the fill delta against the popover is
   ~1.1:1 and reads as text on a surface rather than seven press targets. An
   inset hairline (a shadow, not a border — nothing reflows) fixes that. */
.hermes-sb-pad{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;height:42px;min-width:0;padding:0 5px;border-radius:5px;background:var(--ui-bg-quaternary);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ui-stroke-secondary) 70%,transparent);color:var(--ui-text-primary);transition:background-color .1s,box-shadow .1s}
.hermes-sb-pad:hover{background:var(--chrome-action-hover);box-shadow:inset 0 0 0 1px var(--ui-stroke-secondary)}
.hermes-sb-pad:focus-visible{outline:1px solid var(--ui-accent);outline-offset:-1px}
.hermes-sb-pad[data-active=true]{background:color-mix(in srgb,var(--ui-accent) 22%,var(--ui-bg-quaternary));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ui-accent) 70%,transparent)}
/* A custom pad gets a hairline underscore so "my file" and "built-in tone"
   differ without a second line of text in every tile. */
.hermes-sb-pad[data-custom=true]::after{content:"";position:absolute;left:50%;bottom:4px;width:10px;height:1px;transform:translateX(-50%);background:color-mix(in srgb,var(--ui-text-primary) 30%,transparent)}
.hermes-sb-pad[data-active=true][data-custom=true]::after{background:var(--ui-accent)}
/* A bound pad carries a small dot top-right: the binding is invisible in the
   grid otherwise, and a user needs to know which pads will fire on their own. */
.hermes-sb-pad[data-bound=true]::before{content:"";position:absolute;top:4px;right:4px;width:4px;height:4px;
  border-radius:50%;background:var(--ui-accent);opacity:.75}
.hermes-sb-pad[data-bound=true][data-active=true]::before{opacity:1}
.hermes-sb-pad-name{max-width:100%;font-size:11px;line-height:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hermes-sb-pad-key{position:absolute;top:2px;left:4px;font-size:9px;line-height:10px;color:var(--ui-text-tertiary);font-variant-numeric:tabular-nums}
.hermes-sb-pad[data-active=true] .hermes-sb-pad-key{color:var(--ui-accent)}
/* The trailing "+" tile: the same footprint as a pad so the grid stays even,
   dashed and quieter so it never reads as a sound. */
.hermes-sb-add{align-items:center;justify-content:center;background:transparent;box-shadow:inset 0 0 0 1px var(--ui-stroke-tertiary);color:var(--ui-text-tertiary)}
.hermes-sb-add:hover{background:var(--chrome-action-hover);box-shadow:inset 0 0 0 1px var(--ui-stroke-secondary);color:var(--ui-text-primary)}
.hermes-sb-add:disabled{opacity:.5;cursor:default}
.hermes-sb-empty{padding:18px 8px;text-align:center;font-size:11px;line-height:16px;color:var(--ui-text-tertiary)}
.hermes-sb-list{display:flex;flex-direction:column;gap:2px;max-height:min(42vh,268px);overflow-y:auto;overscroll-behavior:contain;padding:2px;scrollbar-gutter:stable}
.hermes-sb-row{display:flex;align-items:center;gap:4px}
.hermes-sb-row .hermes-sb-row-name{flex:1;min-width:0;font-size:11px}
/* The trigger select is the widest content in a manage row (longest label is
   "Risky tool output"), so it gets the larger share and the name field shrinks
   to roughly 12 characters — enough for a pad name, no more.
   Height and box-sizing are pinned to the row's other controls (the 22px
   buttons, the 21px name field) so all four share one baseline; the native
   select's own metrics otherwise leave it 5px shorter and 3px lower. */
.hermes-sb-when{flex:0 0 124px;min-width:0;display:flex;align-items:center;height:22px}
.hermes-sb-select{width:100%;height:21px;box-sizing:border-box;margin:0;font:inherit;font-size:10px;line-height:15px;
  padding:1px 15px 1px 4px;border-radius:3px;
  color:var(--ui-text-secondary);background-color:var(--ui-bg-tertiary);
  border:1px solid var(--ui-stroke-secondary);outline:none;
  appearance:none;-webkit-appearance:none;text-overflow:ellipsis;
  background-image:linear-gradient(45deg,transparent 50%,var(--ui-text-quaternary) 50%),linear-gradient(135deg,var(--ui-text-quaternary) 50%,transparent 50%);
  background-position:calc(100% - 9px) 55%,calc(100% - 5px) 55%;
  background-size:4px 4px,4px 4px;background-repeat:no-repeat}
.hermes-sb-select:hover{border-color:var(--ui-stroke-primary)}
.hermes-sb-select:focus-visible{outline:1px solid var(--ui-accent);outline-offset:-1px}
.hermes-sb-row[data-bound=true] .hermes-sb-select{color:var(--ui-accent);border-color:color-mix(in srgb,var(--ui-accent) 45%,var(--ui-stroke-secondary))}
.hermes-sb-rowbtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex-shrink:0;border-radius:4px;color:var(--ui-text-tertiary)}
.hermes-sb-rowbtn:hover{background:var(--chrome-action-hover);color:var(--ui-text-primary)}
.hermes-sb-rowbtn[data-destructive=true]{color:var(--ui-text-secondary)}
.hermes-sb-rowbtn[data-destructive=true]:hover{background:color-mix(in srgb,var(--ui-red) 18%,transparent);color:var(--ui-red)}
.hermes-sb-section{padding:8px 4px 2px;font-size:9px;line-height:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ui-text-quaternary)}
.hermes-sb-presets{display:flex;flex-wrap:wrap;gap:4px;padding:2px}
.hermes-sb-preset{padding:2px 7px;border-radius:999px;background:var(--ui-bg-quaternary);font-size:11px;line-height:16px;color:var(--ui-text-secondary)}
.hermes-sb-preset:hover{background:var(--chrome-action-hover);color:var(--ui-text-primary)}
/* Volume row: same 4px inner inset and the same right column width as the grid
   above, so the two rows share one left and one right anchor. */
.hermes-sb-foot{display:flex;align-items:center;gap:6px;padding:7px 6px 1px;margin-top:6px;border-top:1px solid var(--ui-stroke-secondary)}
.hermes-sb-foot-icon{display:inline-flex;flex-shrink:0;color:var(--ui-text-quaternary);cursor:pointer;border-radius:3px}
.hermes-sb-foot-icon:hover{color:var(--ui-text-secondary)}
.hermes-sb-foot input[type=range]{flex:1;min-width:0;height:3px;accent-color:var(--ui-accent);cursor:pointer}
.hermes-sb-foot-value{width:30px;flex-shrink:0;text-align:right;font-size:10px;line-height:12px;font-variant-numeric:tabular-nums;color:var(--ui-text-quaternary)}
.hermes-sb-last{padding:4px 6px 0;font-size:9px;line-height:12px;color:var(--ui-text-quaternary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hermes-sb-drop{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:8px;background:color-mix(in srgb,var(--ui-bg-elevated) 90%,transparent);box-shadow:inset 0 0 0 2px var(--ui-accent);font-size:11px;color:var(--ui-accent);z-index:5}
.hermes-sb-body{position:relative}
`

// ── UI ────────────────────────────────────────────────────────────────────

function Pad({ sound, index, engine }) {
  const active = useValue(engine.active)
  return jsxs('button', {
    type: 'button',
    className: 'hermes-sb-pad',
    'data-active': Boolean(active[sound.id]),
    // Present only on a custom pad: React renders boolean `data-*` as the
    // string "false", and an always-present attribute would read as truthy.
    ...(sound.kind === 'file' ? { 'data-custom': 'true' } : {}),
    ...(sound.trigger ? { 'data-bound': 'true' } : {}),
    title: sound.trigger
      ? `${sound.name} — plays on “${TRIGGER_BY_ID.get(sound.trigger)?.label}”`
      : sound.kind === 'file' ? `${sound.name} — your audio file` : `${sound.name} — built-in tone`,
    'aria-label': sound.name,
    onClick: () => {
      haptic('tap')
      engine.play(sound)
    },
    children: [
      index < 9 ? jsx('span', { className: 'hermes-sb-pad-key', 'aria-hidden': true, children: String(index + 1) }) : null,
      jsx('span', { className: 'hermes-sb-pad-name', children: sound.name })
    ]
  }, sound.id)
}

function TriggerSelect({ sound, engine }) {
  const t = usePluginI18n(ID)

  // A native <select> on purpose: 14 grouped options, keyboard-operable, no
  // popover inside a popover (which Radix would fight over focus).
  // Children go in `props.children` — the third argument of jsx() is the key.
  const options = [
    jsx('option', { value: '', children: t('whenNever') }, ''),
    ...TRIGGER_GROUPS.map(group =>
      jsx(
        'optgroup',
        {
          label: group,
          children: TRIGGERS.filter(trigger => trigger.group === group).map(trigger =>
            jsx('option', { value: trigger.id, children: trigger.label }, trigger.id)
          )
        },
        group
      )
    )
  ]

  return jsx('div', {
    className: 'hermes-sb-when',
    children: jsx('select', {
      className: 'hermes-sb-select',
      value: sound.trigger ?? '',
      'aria-label': `${t('when')}: ${sound.name}`,
      title: sound.trigger ? TRIGGER_BY_ID.get(sound.trigger)?.detail : t('whenNever'),
      onChange: event => engine.bind(sound.id, event.target.value),
      children: options
    })
  })
}

function ManageRow({ sound, engine }) {
  const t = usePluginI18n(ID)
  const [draft, setDraft] = useState(sound.name)

  useEffect(() => {
    setDraft(sound.name)
  }, [sound.name])

  const commit = () => {
    if (draft.trim() && draft.trim() !== sound.name) engine.rename(sound.id, draft)
    else setDraft(sound.name)
  }

  return jsxs('div', {
    className: 'hermes-sb-row',
    'data-bound': Boolean(sound.trigger),
    children: [
      jsx(Tip, {
        label: t('preview'),
        children: jsx('button', {
          type: 'button',
          className: 'hermes-sb-rowbtn',
          'aria-label': `${t('preview')}: ${sound.name}`,
          onClick: () => engine.play(sound),
          children: jsx(icons.Play, { size: 11 })
        })
      }),
      jsx(TriggerSelect, { sound, engine }),
      jsx(Input, {
        className: 'hermes-sb-row-name',
        size: 'xs',
        value: draft,
        'aria-label': t('name'),
        spellCheck: false,
        onChange: event => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            setDraft(sound.name)
            event.currentTarget.blur()
          }
        }
      }),
      jsx(Tip, {
        label: `${t('delete')}: ${sound.name}`,
        children: jsx('button', {
          type: 'button',
          className: 'hermes-sb-rowbtn',
          'data-destructive': 'true',
          'aria-label': `${t('delete')}: ${sound.name}`,
          onClick: () => engine.remove(sound.id),
          children: jsx(icons.Trash2, { size: 11 })
        })
      })
    ]
  }, sound.id)
}

function Panel({ engine }) {
  const t = usePluginI18n(ID)
  const sounds = useValue(engine.sounds)
  const settings = useValue(engine.settings)
  const saving = useValue(engine.saving)
  const last = useValue(engine.lastTrigger)
  const [manage, setManage] = useState(false)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const take = useCallback(
    async files => {
      // Snapshot immediately: a FileList handed over from an <input> can be
      // emptied by the caller resetting it, and `await` gives that a chance.
      const list = [...(files || [])]
      for (const file of list.slice(0, 8)) await engine.addFile(file)
    },
    [engine]
  )

  const onKeyDown = event => {
    if (event.key === 'Escape') {
      engine.open.set(false)
      return
    }
    if (manage || event.metaKey || event.ctrlKey || event.altKey) return
    const index = Number(event.key)
    if (!Number.isInteger(index) || index < 1 || index > 9) return
    const sound = sounds[index - 1]
    if (!sound) return
    event.preventDefault()
    engine.play(sound)
  }

  const presentSynths = new Set(sounds.filter(sound => sound.kind === 'synth').map(sound => sound.synth))
  const missing = SYNTHS.filter(synth => !presentSynths.has(synth.id))
  const volume = settings.volume

  return jsxs('div', {
    ref: panelRef,
    tabIndex: -1,
    className: 'hermes-sb-body',
    role: 'group',
    'aria-label': t('title'),
    onKeyDown,
    onDragOver: event => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return
      event.preventDefault()
      setDragging(true)
    },
    onDragLeave: event => {
      if (event.currentTarget.contains(event.relatedTarget)) return
      setDragging(false)
    },
    onDrop: event => {
      event.preventDefault()
      setDragging(false)
      if (event.dataTransfer?.files?.length) void take(event.dataTransfer.files)
    },
    children: [
      jsxs('div', {
        className: 'hermes-sb-head',
        children: [
          jsx('span', { className: 'hermes-sb-head-title', children: t('title') }),
          jsx(Tip, {
            label: t('stopAll'),
            children: jsx('button', {
              type: 'button',
              className: 'hermes-sb-iconbtn',
              'aria-label': t('stopAll'),
              onClick: () => engine.stopAll(),
              children: jsx(icons.StopFilled, { size: 11 })
            })
          }),
          jsx(Tip, {
            label: t('addSound'),
            children: jsx('button', {
              type: 'button',
              className: 'hermes-sb-iconbtn',
              'aria-label': t('addSound'),
              disabled: saving,
              onClick: () => fileRef.current?.click(),
              children: saving ? jsx(icons.Loader2, { size: 11 }) : jsx(icons.Plus, { size: 12 })
            })
          }),
          jsx(Tip, {
            label: manage ? t('done') : t('manage'),
            children: jsx('button', {
              type: 'button',
              className: 'hermes-sb-iconbtn',
              'data-on': manage,
              'aria-pressed': manage,
              'aria-label': manage ? t('done') : t('manage'),
              onClick: () => setManage(value => !value),
              children: jsx(icons.Pencil, { size: 11 })
            })
          })
        ]
      }),

      jsx('input', {
        ref: fileRef,
        type: 'file',
        accept: 'audio/*',
        multiple: true,
        style: { display: 'none' },
        onChange: event => {
          // `input.files` is a LIVE FileList: clearing `value` (which is what
          // makes the same file pickable twice) empties it. Snapshot the files
          // into a real array first, or nothing is ever added.
          const files = [...event.target.files]
          event.target.value = ''
          void take(files)
        }
      }),

      manage
        ? jsxs('div', {
            children: [
              sounds.length
                ? jsx('div', { className: 'hermes-sb-list', children: sounds.map(sound => jsx(ManageRow, { sound, engine }, sound.id)) })
                : jsx('div', { className: 'hermes-sb-empty', children: t('empty') }),
              missing.length
                ? jsxs('div', {
                    children: [
                      jsx('div', { className: 'hermes-sb-section', children: t('builtins') }),
                      jsx('div', {
                        className: 'hermes-sb-presets',
                        children: missing.map(synth =>
                          jsx('button', {
                            type: 'button',
                            className: 'hermes-sb-preset',
                            onClick: () => engine.addPreset(synth.id),
                            children: synth.name
                          }, synth.id)
                        )
                      })
                    ]
                  })
                : null
            ]
          })
        : sounds.length
          ? jsx('div', {
              className: 'hermes-sb-grid',
              style: { gridTemplateColumns: `repeat(${settings.padsPerRow}, minmax(0, 1fr))` },
              children: [
                ...sounds.slice(0, 24).map((sound, index) => jsx(Pad, { sound, index, engine }, sound.id)),
                // The insertion point lives where the list ends, and it fills
                // the short last row a 7-pad board would otherwise leave empty.
                sounds.length < MAX_SOUNDS
                  ? jsx('button', {
                      type: 'button',
                      className: 'hermes-sb-pad hermes-sb-add',
                      title: t('addSound'),
                      'aria-label': t('addSound'),
                      disabled: saving,
                      onClick: () => fileRef.current?.click(),
                      children: jsx(icons.Plus, { size: 13, 'aria-hidden': true })
                    }, 'add')
                  : null
              ]
            })
          : jsxs('div', {
              className: 'hermes-sb-empty',
              children: [
                jsx('div', { children: t('empty') }),
                jsx('button', {
                  type: 'button',
                  className: 'hermes-sb-preset',
                  style: { marginTop: '8px' },
                  onClick: () => engine.restorePresets(),
                  children: t('restore')
                })
              ]
            }),

      jsxs('div', {
        className: 'hermes-sb-foot',
        children: [
          jsx('button', {
            type: 'button',
            className: 'hermes-sb-foot-icon',
            'aria-label': volume ? t('mute') : t('unmute'),
            title: volume ? t('mute') : t('unmute'),
            onClick: () => engine.setVolume(volume ? 0 : 80),
            children: jsx(volume ? icons.Volume2 : icons.VolumeX, { size: 11, 'aria-hidden': true })
          }),
          jsx('input', {
            type: 'range',
            min: 0,
            max: 100,
            step: 1,
            value: volume,
            'aria-label': t('volume'),
            onChange: event => engine.setVolume(Number(event.target.value))
          }),
          jsx('span', { className: 'hermes-sb-foot-value', children: `${volume}%` })
        ]
      }),

      // A binding firing while the panel happens to be open is otherwise
      // invisible: the pads are shut away behind the popover trigger.
      last && TRIGGER_BY_ID.has(last.id)
        ? jsx('div', {
            className: 'hermes-sb-last',
            role: 'status',
            children: t('lastTrigger', TRIGGER_BY_ID.get(last.id).label)
          })
        : null,

      dragging ? jsx('div', { className: 'hermes-sb-drop', children: t('dropHere') }) : null
    ]
  })
}

function Chip({ engine }) {
  const t = usePluginI18n(ID)
  const open = useValue(engine.open)
  const settings = useValue(engine.settings)

  return jsx('div', {
    className: 'hermes-sb-bar',
    children: jsx(Popover, {
      open,
      onOpenChange: value => engine.open.set(value),
      children: [
        jsx(PopoverTrigger, {
          asChild: true,
          children: jsx(Button, {
            variant: 'ghost',
            size: 'micro',
            className: 'hermes-sb-chip',
            'data-open': open,
            'aria-label': t('open'),
            title: t('open'),
            onPointerDown: () => haptic('tap'),
            children: [
              jsx(icons.AudioLines, { size: 12, 'aria-hidden': true }),
              settings.showLabel ? jsx('span', { className: 'hermes-sb-chip-label', children: 'Soundboard' }) : null
            ]
          })
        }),
        jsx(PopoverContent, {
          side: 'top',
          align: 'end',
          className: 'hermes-sb-panel',
          'aria-label': t('title'),
          children: jsx(Panel, { engine })
        })
      ]
    })
  })
}

function SoundboardSettings({ engine }) {
  const t = usePluginI18n(ID)
  const settings = useValue(engine.settings)
  const sounds = useValue(engine.sounds)
  const custom = sounds.filter(sound => sound.kind === 'file').length

  return jsxs('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '18px' },
    children: [
      jsxs('label', {
        style: { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', color: 'var(--ui-text-secondary)' },
        children: [
          jsx('span', { children: t('volume') }),
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '320px' },
            children: [
              jsx('input', {
                type: 'range',
                min: 0,
                max: 100,
                step: 1,
                value: settings.volume,
                style: { flex: 1, height: '3px', accentColor: 'var(--ui-accent)' },
                onChange: event => engine.setVolume(Number(event.target.value))
              }),
              jsx('span', { style: { width: '34px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }, children: `${settings.volume}%` })
            ]
          })
        ]
      }),
      jsxs('label', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--ui-text-secondary)' },
        children: [
          jsx('input', {
            type: 'checkbox',
            checked: settings.showLabel,
            onChange: event => engine.setShowLabel(event.target.checked)
          }),
          jsx('span', { children: t('showLabel') })
        ]
      }),
      jsxs('div', {
        style: { fontSize: '12px', color: 'var(--ui-text-tertiary)' },
        children: [
          jsx('div', { children: t('stats', sounds.length, custom) }),
          jsx('button', {
            type: 'button',
            className: 'hermes-sb-preset',
            style: { marginTop: '8px' },
            onClick: () => engine.restorePresets(),
            children: t('restore')
          })
        ]
      })
    ]
  })
}

// ── plugin ────────────────────────────────────────────────────────────────

const LOCALES = {
  en: {
    title: 'Soundboard',
    open: 'Open the soundboard',
    stopAll: 'Stop all sounds',
    addSound: 'Add a sound file',
    manage: 'Manage sounds',
    done: 'Done',
    preview: 'Preview',
    name: 'Sound name',
    delete: 'Delete',
    volume: 'Volume',
    mute: 'Mute',
    unmute: 'Unmute',
    when: 'Play this sound when',
    whenNever: 'Never',
    lastTrigger: trigger => `Last trigger: ${trigger}`,
    showLabel: 'Show the Soundboard label in the status bar',
    empty: 'No sounds yet. Add an audio file, or drop one here.',
    restore: 'Restore built-in sounds',
    builtins: 'Built-in sounds',
    dropHere: 'Drop audio files to add them',
    noFileAccess: 'This Hermes Desktop build has no plugin file access, so custom sounds cannot be saved.',
    tooLarge: 'That file is larger than 3 MB. Soundboard clips should be short.',
    tooMany: 'The soundboard holds 40 sounds. Delete one to add another.',
    notAudio: 'That file is not an audio file.',
    saveFailed: 'That sound could not be saved.',
    missingAudio: 'That sound file is missing from the plugin folder.',
    stats: (total, custom) => `${total} pads · ${custom} custom file${custom === 1 ? '' : 's'}`
  },
  pl: {
    title: 'Soundboard',
    open: 'Otwórz soundboard',
    stopAll: 'Zatrzymaj wszystkie dźwięki',
    addSound: 'Dodaj plik dźwiękowy',
    manage: 'Zarządzaj dźwiękami',
    done: 'Gotowe',
    preview: 'Odsłuchaj',
    name: 'Nazwa dźwięku',
    delete: 'Usuń',
    volume: 'Głośność',
    mute: 'Wycisz',
    unmute: 'Wyłącz wyciszenie',
    when: 'Odtwórz ten dźwięk gdy',
    whenNever: 'Nigdy',
    lastTrigger: trigger => `Ostatni wyzwalacz: ${trigger}`,
    showLabel: 'Pokazuj podpis Soundboard na pasku stanu',
    empty: 'Brak dźwięków. Dodaj plik audio albo przeciągnij go tutaj.',
    restore: 'Przywróć dźwięki wbudowane',
    builtins: 'Dźwięki wbudowane',
    dropHere: 'Upuść pliki audio, aby je dodać',
    noFileAccess: 'Ta wersja Hermes Desktop nie daje wtyczkom dostępu do plików, więc własnych dźwięków nie da się zapisać.',
    tooLarge: 'Ten plik jest większy niż 3 MB. Klipy do soundboardu powinny być krótkie.',
    tooMany: 'Soundboard mieści 40 dźwięków. Usuń któryś, aby dodać kolejny.',
    notAudio: 'To nie jest plik audio.',
    saveFailed: 'Nie udało się zapisać tego dźwięku.',
    missingAudio: 'Brakuje tego pliku dźwiękowego w folderze wtyczki.',
    stats: (total, custom) => `${total} padów · ${custom} własnych plików`
  }
}

export default {
  id: ID,
  name: 'Soundboard',
  description: 'A soundboard in the bottom bar: synthesized cues plus your own audio files as pads.',
  defaultEnabled: true,
  register(ctx) {
    ctx.i18n.register(LOCALES)

    const style = document.createElement('style')
    style.textContent = CSS
    document.head.append(style)
    ctx.onDispose(() => style.remove())

    const engine = createEngine(ctx)

    ctx.register({ id: 'chip', area: STATUSBAR_AREAS.right, order: 20, render: () => jsx(Chip, { engine }) })

    ctx.register({
      id: 'open',
      area: PALETTE_AREA,
      data: {
        id: 'soundboard.open',
        label: 'Open Soundboard',
        keywords: ['sound', 'soundboard', 'audio', 'pad', 'sfx'],
        run: () => engine.open.set(true)
      }
    })

    ctx.registerSettingsPage?.({
      id: 'settings',
      title: 'Soundboard',
      icon: 'unmute',
      render: () => jsx(SoundboardSettings, { engine })
    })
  }
}
