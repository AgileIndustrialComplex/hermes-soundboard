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
  host,
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

// ── youtube import ────────────────────────────────────────────────────────
// A YouTube link is converted to mp3 by yt-dlp (which needs ffmpeg for the
// transcode). Neither ships with Hermes, so both are probed before the field
// is offered — a URL box that always fails is worse than no URL box.
//
// The conversion runs as a DETACHED child, because the only process door a
// plugin has is `host.request('shell.exec')` and it kills anything at 30s —
// a 4-minute song takes longer than that. So the command starts the job and
// returns in ~2s, and the plugin watches the job's status file. That file is
// the only channel back: shell.exec captures output at launch and is gone.
const YT_MAX_SECONDS = 30
const YT_POLL_MS = 700
const YT_TIMEOUT_MS = 180000

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

/** A pad's trigger list, normalised.
 *
 * Storage holds an ARRAY, but anything written by an earlier version holds a
 * single string — so both are accepted here and a bare string becomes a
 * one-entry list. Unknown ids are dropped, duplicates collapse, and order
 * follows TRIGGERS rather than insertion so the row's chips read the same way
 * every time.
 */
function cleanTriggers(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const wanted = new Set(list.map(cleanTrigger).filter(Boolean))

  return TRIGGERS.filter(trigger => wanted.has(trigger.id)).map(trigger => trigger.id)
}


// ── youtube helpers ───────────────────────────────────────────────────────
// Everything here is deliberately Windows-first but degrades to a clear error
// rather than a silent no-op: the process door, the path separator, and the
// detach syntax are all platform-specific, so each is chosen explicitly.

/** The 11-character id out of any of YouTube's URL shapes, or null. */
function parseYoutube(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  // A bare id is accepted, so pasting just the code works.
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text
  let url
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  if (host === 'youtu.be') {
    return /^[A-Za-z0-9_-]{11}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : null
  }
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') return null
  const v = url.searchParams.get('v')
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v
  // /shorts/<id>, /embed/<id>, /live/<id>
  const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

/** Cached tool probe. Reset by the test harness through `__hermesResetTools`. */
let toolsProbe = null

class ImportError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// navigator.platform is deprecated and EMPTY in jsdom, and Electron does not
// guarantee it either — so fall back to the UA, which both set. A plain
// `navigator.platform` check silently reported "not Windows" under test and
// every import failed with "no plugin folder", which reads like a permissions
// problem rather than a platform probe that never matched.
const IS_WINDOWS =
  typeof navigator !== 'undefined' &&
  /win/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '')

/** jsdom reports "linux" and has no plugin-files bridge, so the harness sets
 *  this to exercise the Windows path it was written for. Production code never
 *  touches it. */
function windowsHost() {
  return IS_WINDOWS || globalThis.__hermesForceWindows === true
}

function joinNative(dir, name) {
  return `${dir}${IS_WINDOWS ? '\\' : '/'}${name}`
}

/** `%APPDATA%\<ProductName>\plugin-files\data\<id>` — Electron's userData is
 *  the app-name folder under Roaming on Windows, and `main` names it the
 *  plugin id verbatim when the id is already lowercase (which it is).
 *
 *  Nothing exposes this path to a plugin: `ctx.files` speaks in relative
 *  paths by design. We do not need the plugin's own path — we need the
 *  POSITION of that folder, which is derivable, and the job writes only
 *  inside the folder the plugin already has access to. */
function dataDir() {
  if (!windowsHost()) return null
  // `%APPDATA%` is expanded by cmd inside the detached command, so the plugin
  // never needs to know a real absolute path — and never gets one, since
  // ctx.files speaks relative paths by design.
  return `%APPDATA%\\Hermes\\plugin-files\\data\\${ID}`
}

/** Forget the cached probe. Only the test harness calls this, so a suite can
 *  exercise "tools missing" and "tools present" in one process. */
globalThis.__hermesResetTools = () => {
  toolsProbe = null
}

/** Are the two tools this needs actually available? Probed once per session.
 *
 *  yt-dlp is not checked directly: `uvx yt-dlp` resolves and caches the
 *  package on demand, so `uvx` being present IS yt-dlp being available — and
 *  probing it by running it would cost a download inside a 30s shell door.
 *  ffmpeg is checked because yt-dlp shells out to it for the mp3 transcode and
 *  there is no equivalent on-demand story. */
async function probeTools() {
  if (toolsProbe) return toolsProbe
  const script = windowsHost()
    ? 'where ffmpeg>nul 2>&1 && echo ffmpeg=1 || echo ffmpeg=0 & where uvx>nul 2>&1 && echo uvx=1 || echo uvx=0'
    : 'command -v ffmpeg >/dev/null 2>&1 && echo ffmpeg=1 || echo ffmpeg=0; command -v uvx >/dev/null 2>&1 && echo uvx=1 || echo uvx=0'
  toolsProbe = (async () => {
    const text = await runShell(script, { capture: true })
    const found = String(text || '')
    return { ytdlp: /uvx=1/.test(found), ffmpeg: /ffmpeg=1/.test(found) }
  })()
  return toolsProbe
}

/** Run one command through the gateway's shell door. Returns captured stdout
 *  when `capture` is set, else a boolean "it launched".
 *
 *  `shell.exec` is SESSION-BOUND: the gateway's handler refuses with
 *  `invalid_params` unless the call carries a `session_id` naming a live local
 *  chat, because it runs the command in that session's frozen cwd behind the
 *  same policy as a user's `!cmd`. Omitting it was the whole bug — the RPC layer
 *  rejected the call before any command ran, and the raw code surfaced in the
 *  panel. There is no session-less variant to fall back to, so the focused
 *  chat's runtime id is the door, and "no chat open" is reported as such
 *  instead of as a converter failure. */
function activeSessionId() {
  try {
    return host.state?.activeSessionId?.get?.() ?? null
  } catch {
    return null
  }
}

async function runShell(command, { capture = false } = {}) {
  const sessionId = activeSessionId()
  // Defensive only: importYoutube checks this first so the user gets a
  // localised message. Reaching here without a session means it appeared to
  // have one and then lost it.
  if (!sessionId) throw new ImportError('noSession', 'Open a chat first — the converter runs inside a session.')

  const result = await host.request('shell.exec', { command, session_id: sessionId })
  const stdout = result?.stdout ?? ''
  const code = result?.code ?? 0
  return capture ? stdout : code === 0 || Boolean(stdout)
}

/** The job is a SCRIPT FILE, not a command line.
 *
 * `shell.exec` takes one string with `shell=True`, so an argument list has to
 * survive two levels of quoting (the shell, then cmd's own `start`), and the
 * first attempt at that produced `cmd /c "uvx yt-dlp "-x" …` where the inner
 * quotes closed the outer — the job never started and the failure was silent
 * because it happened before any output existed. Writing the steps to a script
 * in the plugin's own folder means the only command the shell sees is
 * `run this one file`, and every argument inside it is quoted once.
 *
 * Returns the script body. `status` is written last either way, so its
 * presence always means "finished", and its content says which way.
 */
function jobScript({ exe, args, out, log, status, mp3 }) {
  // `%` is a batch metacharacter. yt-dlp's output template is `%(ext)s`, so an
  // unescaped path makes cmd fail to parse the WHOLE script — it reports
  // "File Not Found" and never runs a line, which is indistinguishable from a
  // bad URL from the plugin's side. Doubling is the batch escape.
  const q = value => `"${String(value).replace(/"/g, '').replace(/%/g, '%%')}"`
  const run = [exe, ...args.map(q)].join(' ')
  const lines = [
    '@echo off',
    'setlocal',
    // Nothing here prompts; a hidden child must never wait on a console.
    `cd /d ${q(out)}`,
    `rem ${run}`,
    `${run} > ${q(log)} 2>&1`,
    'set "RC=%ERRORLEVEL%"',
    `if exist ${q(mp3)} (echo ok> ${q(status)}) else (echo fail> ${q(status)})`,
    'endlocal',
    'exit /b %RC%'
  ]
  return lines.join('\r\n') + '\r\n'
}

/** The one-line command that launches the job script and returns at once.
 *
 * The script takes NO arguments — every path is baked into it — which matters:
 * `start /b cmd /c "script.cmd" "arg"` silently DROPS the arguments (probed
 * here: four start-based forms all arrived with none, while a plain call
 * received both), and a job that never starts looks exactly like a bad URL.
 * `start /b` is kept only as the detach mechanism: the script itself exits
 * immediately after spawning, so the shell door returns in well under 30s.
 */
function detachedCommand(scriptPath) {
  if (windowsHost()) return `start "" /b ${`"${scriptPath}"`}`
  return `nohup sh "${scriptPath}" >/dev/null 2>&1 &`
}

/** Length of the video in seconds, or null when YouTube will not say.
 *  Runs in the foreground because it is fast (~2s) and because the answer
 *  decides whether the job runs at all. */
async function probeDuration(videoId) {
  const out = await runShell(
    `uvx yt-dlp --print duration --skip-download https://www.youtube.com/watch?v=${videoId}`,
    { capture: true }
  )
  const match = String(out || '').match(/(\d+(?:\.\d+)?)\s*$/m)
  const seconds = match ? Number(match[1]) : NaN
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

/** Watch for the job's status file: 'ok' | 'fail' | 'timeout'. */
async function waitForStatus(files, statusPath, budgetMs) {
  const until = Date.now() + budgetMs
  while (Date.now() < until) {
    await sleep(YT_POLL_MS)
    const read = await files.readText(files.dataFolder, statusPath)
    if (read.ok) {
      const text = (read.text || '').trim()
      if (text) return text === 'ok' ? 'ok' : 'fail'
    }
  }
  return 'timeout'
}

/** The tail of the job's log, so a failure explains itself. */
async function readLogTail(files, logPath) {
  const read = await files.readText(files.dataFolder, logPath)
  if (!read.ok) return ''
  const lines = String(read.text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^\[download\]\s+\d/.test(line))
  return lines.slice(-2).join(' ').slice(0, 240)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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
  // cue or the user's own clip alike. Stored as a list since a pad may answer
  // to several events at once.
  const triggers = cleanTriggers(raw.triggers ?? raw.trigger)
  const bound = triggers.length ? { triggers } : {}
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

  // pad id -> its one pending flash timer.
  const timers = new Map()
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

  // One pending flash timer per pad, not per flash. Two triggers bound to the
  // same pad (or a pad played twice quickly) otherwise leave two timers running,
  // and whichever expires first clears the flag the second one just set — so the
  // pad goes dark early, or an assertion right after the second fire sees
  // nothing at all.
  function flash(id) {
    const previous = timers.get(id)
    if (previous) clearTimeout(previous)
    active.set({ ...active.get(), [id]: true })
    const timer = setTimeout(() => {
      timers.delete(id)
      if (disposed) return
      const next = { ...active.get() }
      delete next[id]
      active.set(next)
    }, FLASH_MS)
    timers.set(id, timer)
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
  const bound = () => sounds.get().filter(sound => sound.triggers?.length)

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
      if (!sound.triggers.includes(triggerId)) continue
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

  /** Add or remove ONE trigger on a pad, leaving its other bindings alone. */
  function toggleTrigger(soundId, triggerId) {
    const next = cleanTrigger(triggerId)
    if (!next) return
    persistSounds(
      sounds.get().map(sound => {
        if (sound.id !== soundId) return sound
        const current = sound.triggers ?? []
        const list = current.includes(next) ? current.filter(id => id !== next) : [...current, next]
        const { triggers: _drop, ...rest } = sound
        const ordered = cleanTriggers(list)

        return ordered.length ? { ...rest, triggers: ordered } : rest
      })
    )
  }

  /** Clear every binding on a pad. */
  function clearTriggers(soundId) {
    persistSounds(
      sounds.get().map(sound => {
        if (sound.id !== soundId) return sound
        const { triggers: _drop, ...rest } = sound

        return rest
      })
    )
  }

  /** Import one YouTube URL as an mp3 pad.
   *
   * Returns a promise that settles when the detached job writes its status
   * file, so the caller can await it from a click handler. Everything the job
   * writes lives in the plugin's OWN data folder, so `ctx.files` can read the
   * result back without needing an absolute path anywhere else.
   */
  async function importYoutube(input, { onStage } = {}) {
    const files = ctx.files
    if (!files) throw new ImportError('noFileAccess', t('noFileAccess'))
    const videoId = parseYoutube(input)
    if (!videoId) throw new ImportError('badUrl', t('ytBadUrl'))
    // `shell.exec` runs inside a live local chat (its cwd and policy come from
    // that session), so there is nothing to run in without one. Say so plainly
    // rather than surfacing the gateway's `invalid_params`.
    if (!activeSessionId()) throw new ImportError('noSession', t('ytNoSession'))
    if (sounds.get().length >= MAX_SOUNDS) throw new ImportError('tooMany', t('tooMany'))

    const dir = await dataDir()
    if (!dir) throw new ImportError('noPath', t('ytNoPath'))

    const tools = await probeTools(dir)
    if (!tools.ytdlp) throw new ImportError('noYtdlp', t('ytNoYtdlp'))
    if (!tools.ffmpeg) throw new ImportError('noFfmpeg', t('ytNoFfmpeg'))

    const id = newId()
    const stem = `yt-${id}`
    const statusPath = `.${stem}.status`
    const logPath = `.${stem}.log`
    const mp3Path = `${stem}.mp3`

    // Clean any stale files from a previous attempt with the same id.
    await files.trash?.(files.dataFolder, statusPath)
    await files.trash?.(files.dataFolder, logPath)

    // Duration is probed FIRST, in the foreground, and the job then carries no
    // comparison operator at all. That is not a style choice: `--match-filter
    // "duration <= 30"` puts `<` and `>` in the command, cmd.exe eats them as
    // redirects even inside quotes, and yt-dlp then reports "You must provide
    // at least one URL" — a failure that looks like a bad URL, not a quoting
    // bug. `--print duration` costs ~2s and fits inside the 30s shell door.
    onStage?.('checking')
    const seconds = await probeDuration(videoId)
    if (seconds !== null && seconds > YT_MAX_SECONDS) {
      throw new ImportError('tooLong', t('ytTooLong').replace('{secs}', String(Math.round(seconds))))
    }

    const args = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      '--no-playlist',
      '-o', `${joinNative(dir, stem)}.%(ext)s`,
      `https://www.youtube.com/watch?v=${videoId}`
    ]

    const scriptPath = `.${stem}.cmd`
    const script = jobScript({
      exe: 'uvx yt-dlp',
      args,
      out: dir,
      log: joinNative(dir, logPath),
      status: joinNative(dir, statusPath),
      mp3: joinNative(dir, mp3Path)
    })
    const wroteScript = await files.writeText(files.dataFolder, scriptPath, script)
    if (!wroteScript.ok) throw new ImportError('failed', wroteScript.message || t('saveFailed'))

    onStage?.('downloading')
    const started = await runShell(detachedCommand(joinNative(dir, scriptPath)))
    if (!started) throw new ImportError('noShell', t('ytNoShell'))

    const outcome = await waitForStatus(files, statusPath, YT_TIMEOUT_MS)
    if (outcome === 'timeout') throw new ImportError('timeout', t('ytTimeout'))
    if (outcome !== 'ok') {
      const detail = await readLogTail(files, logPath)
      throw new ImportError('failed', detail || t('ytFailed'))
    }

    const audio = await files.readDataUrl(files.dataFolder, mp3Path)
    if (!audio.ok) throw new ImportError('failed', audio.message || t('ytFailed'))
    const size = Math.round((audio.url.length - audio.url.indexOf(',') - 1) * 0.75)
    if (size > MAX_FILE_BYTES) {
      await files.trash?.(files.dataFolder, mp3Path)
      throw new ImportError('tooLarge', t('tooLarge'))
    }

    const sound = {
      id,
      name: uniqueName(`YouTube ${videoId.slice(0, 6)}`, sounds.get().map(item => item.name)),
      kind: 'file',
      mime: 'audio/mpeg',
      bytes: size
    }

    // Re-encode the mp3 into the plugin's usual base64 blob so playback and
    // deletion follow exactly the same path as an uploaded file.
    const comma = audio.url.indexOf(',')
    const written = await files.writeText(files.dataFolder, `${id}.b64`, audio.url.slice(comma + 1))
    if (!written.ok) throw new ImportError('failed', written.message || t('saveFailed'))

    for (const name of [mp3Path, statusPath, logPath, scriptPath]) {
      await files.trash?.(files.dataFolder, name)
    }

    urls.set(id, audio.url)
    persistSounds([...sounds.get(), sound])
    onStage?.('done')
    haptic('tap')
    return sound
  }

  /** Host toast, hoisted so UI code never needs `ctx` itself. */
  function notify(message) {
    try {
      ctx.notify?.(message)
    } catch {
      // A toast must never take down the caller.
    }
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
    for (const timer of timers.values()) clearTimeout(timer)
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
    bind: toggleTrigger,
    toggleTrigger,
    clearTriggers,
    importYoutube,
    notify,
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
.hermes-sb-row{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.hermes-sb-row .hermes-sb-row-name{flex:1;min-width:0;font-size:11px}
/* The trigger picker is a button + an in-DOM menu, NOT a native <select>.
   A native option list is a browser-drawn popup coloured from the page's
   color-scheme property; inside this popover it came up as a near-white sheet
   under cream text (~1.1:1) and no page CSS could reach it. Owning the list
   means owning its background — the menu paints on --ui-bg-elevated with
   primary text, and the panel's own popover is opaque enough to sit behind it. */
/* The wrapper DISSOLVES (display: contents) so the picker and the menu become
   direct children of the row's flex layout. Without it the wrapper is a
   124x22 box and the menu, however wide it is told to be, can only render
   inside that box — which is why it came out 124px wide and unreadable. */
.hermes-sb-when{display:contents}
.hermes-sb-picker{flex:0 0 124px;width:124px;height:21px;box-sizing:border-box;margin:0;display:flex;align-items:center;gap:2px;
  padding:0 4px;border-radius:3px;text-align:left;
  font-size:10px;line-height:13px;color:var(--ui-text-secondary);
  background-color:var(--ui-bg-tertiary);border:1px solid var(--ui-stroke-secondary);outline:none}
.hermes-sb-picker:hover{border-color:var(--ui-stroke-primary);color:var(--ui-text-primary)}
.hermes-sb-picker:focus-visible{outline:1px solid var(--ui-accent);outline-offset:-1px}
.hermes-sb-picker[data-open=true]{border-color:var(--ui-accent);color:var(--ui-text-primary)}
.hermes-sb-picker[data-bound=true]{color:var(--ui-accent);border-color:color-mix(in srgb,var(--ui-accent) 45%,var(--ui-stroke-secondary))}
.hermes-sb-picker-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hermes-sb-picker-caret{flex-shrink:0;width:0;height:0;margin-top:1px;
  border-left:3px solid transparent;border-right:3px solid transparent;border-top:4px solid var(--ui-text-tertiary)}
.hermes-sb-picker[data-open=true] .hermes-sb-picker-caret{transform:rotate(180deg)}
/* Opaque, themed, and layered above the row it belongs to. max-height keeps a
   14-row grouped list inside a popover that is already near the viewport top. */
/* The menu is a normal flex item that wraps onto its own line: the row is
   flex-wrap: wrap and this is flex: 0 0 100%. Deliberately NOT positioned —
   absolute got clipped by the manage list's scroll container, and fixed
   re-anchored to the popover (whose backdrop-filter makes it the containing
   block), which is why the picker looked dead in the app while passing tests. */
.hermes-sb-menu{flex:0 0 100%;width:100%;margin-top:2px;
  max-height:238px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;
  padding:3px;border-radius:5px;
  background-color:var(--ui-bg-elevated);border:1px solid var(--ui-stroke-secondary);
  box-shadow:0 10px 26px rgba(0,0,0,.55)}
.hermes-sb-menu-group{display:flex;flex-direction:column}
.hermes-sb-menu-heading{padding:5px 6px 2px;font-size:9px;line-height:11px;font-weight:600;
  letter-spacing:.06em;text-transform:uppercase;color:var(--ui-text-tertiary);background-color:var(--ui-bg-elevated)}
.hermes-sb-menu-row{display:flex;align-items:center;gap:5px;width:100%;padding:3px 6px;border-radius:3px;text-align:left;
  font-size:11px;line-height:15px;color:var(--ui-text-primary);background-color:transparent}
.hermes-sb-menu-row:hover,.hermes-sb-menu-row[data-cursor=true]{background-color:var(--chrome-action-hover)}
.hermes-sb-menu-row[data-selected=true]{color:var(--ui-accent);font-weight:600}
/* A fixed-width check gutter keeps every label on one left edge whether or not
   its row is bound — a multi-select list that shifts text as you tick items is
   unreadable while you are ticking them. */
.hermes-sb-menu-check{flex:0 0 10px;font-size:10px;line-height:15px;color:var(--ui-accent)}
.hermes-sb-menu-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hermes-sb-menu-clear{display:block;width:100%;margin-top:3px;padding:4px 6px;border-radius:3px;text-align:left;
  font-size:10px;line-height:14px;color:var(--ui-text-tertiary);
  border-top:1px solid var(--ui-stroke-secondary)}
.hermes-sb-menu-clear:hover{color:var(--ui-text-primary);background-color:var(--chrome-action-hover)}
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
.hermes-sb-yt{display:flex;align-items:center;gap:4px;margin-top:6px}
.hermes-sb-yt-input{flex:1;min-width:0;height:22px;box-sizing:border-box;padding:0 6px;border-radius:4px;
  font:inherit;font-size:11px;color:var(--ui-text-primary);background-color:var(--ui-bg-tertiary);
  border:1px solid var(--ui-stroke-secondary);outline:none}
.hermes-sb-yt-input:focus{border-color:var(--ui-accent)}
.hermes-sb-yt-input:disabled{opacity:.6}
/* The submit button is a CONTROL, not a call to action: it sits inside a row of
   quiet header buttons and a bordered field, so a solid accent block read as a
   stray yellow square. It now uses the same shape as its neighbours — bordered,
   tertiary fill, secondary glyph — and only the accent BORDER marks it as the
   one that commits, which is how the trigger picker already signals state. */
.hermes-sb-yt-go{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex-shrink:0;
  border-radius:4px;color:var(--ui-text-secondary);background-color:var(--ui-bg-tertiary);
  border:1px solid var(--ui-stroke-secondary)}
.hermes-sb-yt-go:hover{border-color:var(--ui-accent);color:var(--ui-text-primary)}
.hermes-sb-yt-go:active{background-color:var(--chrome-action-hover)}
.hermes-sb-yt-go:focus-visible{outline:1px solid var(--ui-accent);outline-offset:-1px}
.hermes-sb-yt-go:disabled{opacity:.45;cursor:default;border-color:var(--ui-stroke-tertiary);color:var(--ui-text-quaternary)}
.hermes-sb-yt-go:disabled:hover{border-color:var(--ui-stroke-tertiary);color:var(--ui-text-quaternary)}
.hermes-sb-yt-note{padding:5px 2px 0;font-size:10px;line-height:14px;color:var(--ui-text-tertiary)}
/* An error is the one thing in this row the user MUST read, so it gets normal
   secondary text, a warning glyph via the marker, and a wrapped line — not the
   dimmest 9px tone it used to have. */
.hermes-sb-yt-note[data-error=true]{color:var(--ui-text-secondary);padding-left:12px;position:relative}
.hermes-sb-yt-note[data-error=true]::before{content:"!";position:absolute;left:2px;top:5px;
  width:8px;height:8px;border-radius:50%;text-align:center;
  font-size:7px;line-height:8px;font-weight:700;
  color:var(--ui-bg-primary);background-color:var(--ui-text-tertiary)}
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
    ...(sound.triggers?.length ? { 'data-bound': 'true' } : {}),
    title: sound.triggers?.length
      ? `${sound.name} — ${sound.triggers.map(id => `“${TRIGGER_BY_ID.get(id)?.label}”`).join(', ')}`
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

/** A multi-trigger picker rendered INSIDE the popover's own DOM.
 *
 * A native <select> was the obvious choice and the wrong one: its option list
 * is not a DOM node, it is a popup the browser draws from the page's
 * `color-scheme`, and inside the Desktop's nested popover it came up as a
 * near-white sheet under cream text — unreadable, and no CSS of ours could
 * reach it. This is a plain button + list, so every pixel is ours.
 *
 * MULTI-SELECT: clicking a trigger TOGGLES it and leaves the menu open, so one
 * pad can answer to several events. The menu closes on Escape, on a click
 * outside, or on the "Done" row — a checkbox list that shuts after every click
 * would make binding three events three round trips.
 *
 * Keyboard: Enter/Space opens, arrows move, Enter toggles, Escape closes —
 * handled on the trigger so it does not steal the panel's own key downs.
 */
function TriggerSelect({ sound, engine }) {
  const t = usePluginI18n(ID)
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const boxRef = useRef(null)
  const boundIds = sound.triggers ?? []
  const boundTriggers = boundIds.map(id => TRIGGER_BY_ID.get(id)).filter(Boolean)

  // Flat list of selectable rows in render order, so the cursor can move over
  // a grouped list without knowing about the groups.
  const flat = TRIGGERS.map(trigger => trigger)

  useEffect(() => {
    if (!open) return
    const onDown = event => {
      if (!boxRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onKeyDown = event => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(true)
        setCursor(0)
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setCursor(index => Math.min(flat.length - 1, Math.max(0, (index < 0 ? 0 : index) + step)))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (cursor >= 0) engine.toggleTrigger(sound.id, flat[cursor].id)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  // What the closed control says: nothing, one label, or "N triggers".
  const summary = boundTriggers.length === 0
    ? t('whenNever')
    : boundTriggers.length === 1
      ? boundTriggers[0].label
      : t('whenCount').replace('{n}', String(boundTriggers.length))
  const detail = boundTriggers.length
    ? boundTriggers.map(trigger => `${trigger.label} — ${trigger.detail}`).join('\n')
    : t('whenNever')

  let rowIndex = -1

  // THE LIST IS IN FLOW, not positioned. Two separate attempts to float it
  // failed against the real app while passing every test:
  //   - `position: absolute` was clipped by the manage list's `overflow-y:auto`;
  //   - `position: fixed` anchored to the POPOVER, not the viewport, because
  //     PopoverContent carries `backdrop-blur-md` and a backdrop-filter makes an
  //     element the containing block for fixed children — the menu then landed
  //     far off-screen and the picker appeared dead.
  // A wrapper with `display: contents` dissolves into the row's flex layout, so
  // the picker sits in its cell and the menu — `flex: 0 0 100%` — wraps onto its
  // own full-width line beneath. Nothing to clip, nothing to re-anchor.
  return jsxs('div', {
    ref: boxRef,
    className: 'hermes-sb-when',
    onKeyDown,
    children: [
      jsx('button', {
        type: 'button',
        className: 'hermes-sb-picker',
        'data-open': open,
        'data-bound': boundTriggers.length > 0,
        'aria-haspopup': 'listbox',
        'aria-expanded': open,
        'aria-label': `${t('when')}: ${sound.name}`,
        title: detail,
        onClick: () => {
          haptic('tap')
          setOpen(value => !value)
        },
        children: [
          jsx('span', { className: 'hermes-sb-picker-label', children: summary }),
          jsx('span', { className: 'hermes-sb-picker-caret', 'aria-hidden': true })
        ]
      }),

      open
        ? jsx('div', {
            className: 'hermes-sb-menu',
            role: 'listbox',
            'aria-multiselectable': 'true',
            'aria-label': t('when'),
            children: [
              ...TRIGGER_GROUPS.map(group =>
                jsxs(
                  'div',
                  {
                    className: 'hermes-sb-menu-group',
                    children: [
                      jsx('div', { className: 'hermes-sb-menu-heading', children: group }),
                      ...TRIGGERS.filter(trigger => trigger.group === group).map(trigger => {
                        const on = boundIds.includes(trigger.id)
                        rowIndex += 1
                        const at = rowIndex

                        return jsx(
                          'button',
                          {
                            type: 'button',
                            className: 'hermes-sb-menu-row',
                            'data-selected': on,
                            'data-cursor': cursor === at,
                            // role/state that a screen reader can follow as the
                            // list stays open across toggles.
                            role: 'option',
                            'aria-selected': on,
                            title: trigger.detail,
                            onClick: () => {
                              haptic('tap')
                              engine.toggleTrigger(sound.id, trigger.id)
                            },
                            onMouseEnter: () => setCursor(at),
                            children: [
                              jsx('span', { className: 'hermes-sb-menu-check', 'aria-hidden': true, children: on ? '✓' : '' }),
                              jsx('span', { className: 'hermes-sb-menu-text', children: trigger.label })
                            ]
                          },
                          trigger.id
                        )
                      })
                    ]
                  },
                  group
                )
              ),
              boundIds.length
                ? jsx('button', {
                    type: 'button',
                    className: 'hermes-sb-menu-clear',
                    onClick: () => {
                      engine.clearTriggers(sound.id)
                      setOpen(false)
                    },
                    children: t('whenClear')
                  }, '__clear')
                : null
            ]
          })
        : null
    ]
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
    'data-bound': Boolean(sound.triggers?.length),
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
  // YouTube import: the field is behind a button, the job is fire-and-watch.
  const [ytOpen, setYtOpen] = useState(false)
  const [ytUrl, setYtUrl] = useState('')
  const [ytBusy, setYtBusy] = useState(false)
  const [ytError, setYtError] = useState('')
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

  const importFromYoutube = useCallback(async () => {
    const value = ytUrl.trim()
    if (!value || ytBusy) return
    setYtBusy(true)
    setYtError('')
    try {
      const sound = await engine.importYoutube(value)
      setYtUrl('')
      setYtOpen(false)
      // The toast goes through the engine: `ctx` is only in scope inside
      // register(), and reaching for it from the panel threw a ReferenceError
      // AFTER the pad had already been added — so the import worked but the
      // user saw an error.
      engine.notify({ kind: 'info', message: t('ytAdded').replace('{name}', sound.name) })
    } catch (error) {
      // The engine throws localised ImportErrors; anything else is shown raw.
      setYtError(error instanceof Error ? error.message : String(error))
    } finally {
      setYtBusy(false)
    }
  }, [engine, ytUrl, ytBusy, t])

  const onKeyDown = event => {
    if (event.key === 'Escape') {
      // Escape closes the import row before it closes the whole panel —
      // otherwise typing a URL and changing your mind shuts everything.
      if (ytOpen) {
        setYtOpen(false)
        setYtError('')
        return
      }
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
            label: t('ytOpen'),
            children: jsx('button', {
              type: 'button',
              className: 'hermes-sb-iconbtn',
              'data-on': ytOpen,
              'aria-expanded': ytOpen,
              'aria-label': t('ytOpen'),
              onClick: () => {
                haptic('tap')
                setYtOpen(value => !value)
              },
              children: jsx(icons.Link, { size: 11 })
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

      ytOpen
        ? jsxs('div', {
            className: 'hermes-sb-yt',
            children: [
              jsx('input', {
                type: 'text',
                className: 'hermes-sb-yt-input',
                // Not type=url: yt-dlp accepts ids and short links, and a
                // browser URL validator would refuse both.
                placeholder: t('ytPlaceholder'),
                value: ytUrl,
                autoFocus: true,
                spellCheck: false,
                disabled: ytBusy,
                'aria-label': t('ytPlaceholder'),
                onChange: event => setYtUrl(event.target.value),
                onKeyDown: event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void importFromYoutube()
                  }
                }
              }),
              jsx('button', {
                type: 'button',
                className: 'hermes-sb-yt-go',
                'aria-label': t('ytImport'),
                disabled: ytBusy || !ytUrl.trim(),
                onClick: () => void importFromYoutube(),
                children: ytBusy
                  ? jsx(icons.Loader2, { size: 11 })
                  : jsx(icons.Download, { size: 11 })
              })
            ]
          })
        : null,

      ytBusy ? jsx('div', { className: 'hermes-sb-yt-note', children: t('ytWorking') }) : null,
      ytError ? jsx('div', { className: 'hermes-sb-yt-note', 'data-error': 'true', children: ytError }) : null,

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
    whenCount: '{n} triggers',
    ytOpen: 'Import from YouTube',
    ytPlaceholder: 'YouTube link or video id',
    ytImport: 'Convert to mp3',
    ytWorking: 'Downloading and converting… this can take a minute.',
    ytAdded: 'Added “{name}”.',
    ytBadUrl: 'That is not a YouTube link.',
    ytNoPath: 'This build does not expose a plugin folder, so a download has nowhere to land.',
    ytNoYtdlp: 'yt-dlp is not available. Install uv (it is bundled with Hermes) and try again.',
    ytNoFfmpeg: 'ffmpeg was not found on PATH — yt-dlp needs it to make an mp3.',
    ytNoShell: 'Hermes refused to run the converter.',
    ytNoSession: 'Open a chat first — the converter runs inside the session that is currently open.',
    ytTooLong: 'That video is {secs}s long. Soundboard clips are capped at 30s — pick a shorter one.',
    ytTimeout: 'The conversion did not finish in three minutes.',
    ytFailed: 'The conversion failed.',
    whenClear: 'Clear all triggers',
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
    whenCount: '{n} wyzwalaczy',
    ytOpen: 'Importuj z YouTube',
    ytPlaceholder: 'Link do YouTube lub id filmu',
    ytImport: 'Konwertuj do mp3',
    ytWorking: 'Pobieranie i konwersja… to może chwilę potrwać.',
    ytAdded: 'Dodano „{name}”.',
    ytBadUrl: 'To nie jest link do YouTube.',
    ytNoPath: 'Ta wersja nie udostępnia folderu wtyczki, więc pobranie nie ma gdzie trafić.',
    ytNoYtdlp: 'yt-dlp jest niedostępny. Zainstaluj uv (jest w zestawie z Hermes) i spróbuj ponownie.',
    ytNoFfmpeg: 'Nie znaleziono ffmpeg w PATH — yt-dlp potrzebuje go do mp3.',
    ytNoShell: 'Hermes odmówił uruchomienia konwertera.',
    ytNoSession: 'Najpierw otwórz czat — konwerter działa w obrębie otwartej sesji.',
    ytTooLong: 'Ten film ma {secs}s. Klipy dźwiękowe są ograniczone do 30s — wybierz krótszy.',
    ytTimeout: 'Konwersja nie zakończyła się w trzy minuty.',
    ytFailed: 'Konwersja nie powiodła się.',
    whenClear: 'Wyczyść wszystkie wyzwalacze',
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
