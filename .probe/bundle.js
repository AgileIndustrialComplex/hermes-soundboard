(() => {
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

  // ../../../../../hermes-soundboard/test/sdk-stub.mjs
  var import_react = __require("react");
  var atom = (initial) => {
    const listeners = /* @__PURE__ */ new Set();
    let value = initial;
    return {
      get: () => value,
      set(next) {
        if (Object.is(next, value)) return;
        value = next;
        for (const listener of [...listeners]) listener(value);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      }
    };
  };
  var useValue = (store2) => (0, import_react.useSyncExternalStore)(store2.subscribe, store2.get, store2.get);
  var bundles = globalThis.__hermesPluginLocales ??= /* @__PURE__ */ new Map();
  var usePluginI18n = (pluginId) => {
    const bundle = bundles.get(pluginId) ?? {};
    const locale = bundle.en ?? {};
    return (key, ...args) => {
      const value = locale[key];
      if (value === void 0) return key;
      return typeof value === "function" ? value(...args) : value;
    };
  };
  var haptic = () => {
  };
  var host = {
    state: {
      gateway: atom("open"),
      busy: atom(false),
      profile: atom("default"),
      // `shell.exec` is session-bound (the gateway runs the command in that
      // chat's cwd/policy). The harness sets this to stand in for an open chat;
      // read through the global so it can change per scenario.
      activeSessionId: { get: () => globalThis.__hermesTestSessionId ?? null }
    },
    notify: () => {
    },
    navigate: () => {
    },
    // The gateway RPC door. esbuild INLINES this stub into the bundle, so the
    // harness cannot swap `host.request` on a separately-imported copy — it hands
    // a handler through this global instead, which every bundled caller sees.
    request: async (method, params, timeoutMs) => {
      const handler = globalThis.__hermesHostRequest;
      if (typeof handler !== "function") {
        throw new Error(`host.request(${method}) is not stubbed for this call`);
      }
      return handler(method, params, timeoutMs);
    }
  };
  var STATUSBAR_AREAS = { left: "statusBar.left", right: "statusBar.right" };
  var PALETTE_AREA = "palette";
  var Button = ({ children, asChild, ...props }) => (0, import_react.createElement)("button", { type: "button", ...props }, children);
  var Input = (props) => (0, import_react.createElement)("input", props);
  var Tip = ({ children }) => children;
  var PopoverContext = (0, import_react.createContext)({ open: false, setOpen: () => {
  } });
  var Popover = ({ children, open = false, onOpenChange }) => (0, import_react.createElement)(PopoverContext.Provider, { value: { open, setOpen: (next) => onOpenChange?.(next) } }, children);
  var PopoverTrigger = ({ children, asChild }) => {
    const { open, setOpen } = (0, import_react.useContext)(PopoverContext);
    const toggle = (event) => {
      children.props?.onClick?.(event);
      setOpen(!open);
    };
    return asChild ? (0, import_react.cloneElement)(children, { onClick: toggle }) : (0, import_react.createElement)("button", { type: "button", onClick: toggle }, children);
  };
  var PopoverContent = ({ children, ...props }) => {
    const { open } = (0, import_react.useContext)(PopoverContext);
    return open ? (0, import_react.createElement)("div", { "data-popover-content": "true", ...props }, children) : null;
  };
  var GLYPH = {
    Plus: "+",
    StopFilled: "\u25A0",
    Pencil: "\u270E",
    Play: "\u25B6",
    Trash2: "\u2715",
    Loader2: "\u25CC",
    Volume2: "\u{1F50A}",
    VolumeX: "\u{1F507}",
    AudioLines: "\u224B",
    Pause: "\u2759\u2759",
    X: "\u2715"
  };
  var icon = (name) => {
    const Component = (props) => {
      const size = props.size ?? 12;
      return (0, import_react.createElement)(
        "span",
        {
          "data-icon": name,
          "aria-hidden": "true",
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: size,
            height: size,
            fontSize: Math.max(8, size - 1),
            lineHeight: 1,
            flexShrink: 0
          }
        },
        GLYPH[name] ?? "\u25C6"
      );
    };
    Component.displayName = `icon:${name}`;
    return Component;
  };
  var icons = new Proxy({}, { get: (_target, key) => typeof key === "string" ? icon(key) : void 0 });

  // ../../../../../hermes-soundboard/plugin.js
  var import_react2 = __require("react");
  var import_jsx_runtime = __require("react/jsx-runtime");
  var ID = "hermes-soundboard";
  var MAX_FILE_BYTES = 3 * 1024 * 1024;
  var MAX_NAME_LEN = 24;
  var MAX_SOUNDS = 40;
  var FLASH_MS = 220;
  var YT_MAX_SECONDS = 30;
  var YT_POLL_MS = 700;
  var YT_TIMEOUT_MS = 18e4;
  var DEFAULT_SETTINGS = { volume: 80, showLabel: true, padsPerRow: 4 };
  var SYNTHS = [
    {
      id: "pop",
      name: "Pop",
      play(ac, out, gain) {
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(560, t);
        osc.frequency.exponentialRampToValueAtTime(180, t + 0.09);
        g.gain.setValueAtTime(1e-4, t);
        g.gain.exponentialRampToValueAtTime(Math.max(1e-4, 0.75 * gain), t + 8e-3);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.13);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 0.16);
      }
    },
    {
      id: "ding",
      name: "Ding",
      play(ac, out, gain) {
        const t = ac.currentTime;
        for (const [freq, level] of [[1046.5, 0.34], [1568, 0.16]]) {
          const osc = ac.createOscillator();
          const g = ac.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(1e-4, t);
          g.gain.exponentialRampToValueAtTime(Math.max(1e-4, level * gain), t + 0.01);
          g.gain.exponentialRampToValueAtTime(1e-4, t + 0.9);
          osc.connect(g).connect(out);
          osc.start(t);
          osc.stop(t + 0.95);
        }
      }
    },
    {
      id: "beep",
      name: "Beep",
      play(ac, out, gain) {
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(880, t);
        g.gain.setValueAtTime(1e-4, t);
        g.gain.exponentialRampToValueAtTime(Math.max(1e-4, 0.22 * gain), t + 6e-3);
        g.gain.setValueAtTime(Math.max(1e-4, 0.22 * gain), t + 0.09);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.13);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 0.15);
      }
    },
    {
      id: "coin",
      name: "Coin",
      play(ac, out, gain) {
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(987.77, t);
        osc.frequency.setValueAtTime(1318.5, t + 0.06);
        g.gain.setValueAtTime(1e-4, t);
        g.gain.exponentialRampToValueAtTime(Math.max(1e-4, 0.2 * gain), t + 6e-3);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.3);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 0.32);
      }
    },
    {
      id: "laser",
      name: "Laser",
      play(ac, out, gain) {
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        const lp = ac.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(2400, t);
        lp.frequency.exponentialRampToValueAtTime(420, t + 0.3);
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(1600, t);
        osc.frequency.exponentialRampToValueAtTime(140, t + 0.3);
        g.gain.setValueAtTime(Math.max(1e-4, 0.32 * gain), t);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.32);
        osc.connect(lp).connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 0.34);
      }
    },
    {
      id: "whoosh",
      name: "Whoosh",
      play(ac, out, gain) {
        const t = ac.currentTime;
        const frames = Math.max(1, Math.floor(ac.sampleRate * 0.5));
        const buffer = ac.createBuffer(1, frames, ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i += 1) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
        }
        const src = ac.createBufferSource();
        const bp = ac.createBiquadFilter();
        const g = ac.createGain();
        src.buffer = buffer;
        bp.type = "bandpass";
        bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(320, t);
        bp.frequency.exponentialRampToValueAtTime(2600, t + 0.4);
        g.gain.setValueAtTime(Math.max(1e-4, 0.5 * gain), t);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.5);
        src.connect(bp).connect(g).connect(out);
        src.start(t);
        src.stop(t + 0.5);
      }
    },
    {
      id: "boing",
      name: "Boing",
      play(ac, out, gain) {
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        const lfo = ac.createOscillator();
        const lfoGain = ac.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(340, t);
        osc.frequency.exponentialRampToValueAtTime(190, t + 0.45);
        lfo.type = "sine";
        lfo.frequency.setValueAtTime(16, t);
        lfo.frequency.linearRampToValueAtTime(7, t + 0.45);
        lfoGain.gain.value = 22;
        lfo.connect(lfoGain).connect(osc.frequency);
        g.gain.setValueAtTime(Math.max(1e-4, 0.5 * gain), t);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.5);
        osc.connect(g).connect(out);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + 0.52);
        lfo.stop(t + 0.52);
      }
    }
  ];
  var SYNTH_BY_ID = new Map(SYNTHS.map((synth) => [synth.id, synth]));
  var DEFAULT_SOUNDS = SYNTHS.map((synth) => ({
    id: `builtin-${synth.id}`,
    name: synth.name,
    kind: "synth",
    synth: synth.id
  }));
  var TRIGGERS = [
    {
      id: "turn.complete",
      event: "message.complete",
      group: "Turn",
      label: "Turn finishes",
      detail: "any outcome",
      when: (payload) => payload?.status !== "error" && payload?.status !== "interrupted"
    },
    {
      id: "turn.error",
      event: "message.complete",
      group: "Turn",
      label: "Turn fails",
      detail: "status = error",
      when: (payload) => payload?.status === "error" || Boolean(payload?.error)
    },
    {
      id: "turn.interrupted",
      event: "message.complete",
      group: "Turn",
      label: "Turn interrupted",
      detail: "status = interrupted",
      when: (payload) => payload?.status === "interrupted"
    },
    {
      id: "turn.start",
      event: "message.start",
      group: "Turn",
      label: "Turn starts",
      detail: "you hit send",
      when: (payload) => payload?.display_kind !== "auto_continue"
    },
    {
      id: "attention.approval",
      event: "approval.request",
      group: "Attention",
      label: "Approval needed",
      detail: "agent is blocked",
      when: () => true
    },
    {
      id: "attention.clarify",
      event: "clarify.request",
      group: "Attention",
      label: "Question asked",
      detail: "agent is blocked",
      when: () => true
    },
    {
      id: "attention.warning",
      event: "notification.show",
      group: "Attention",
      label: "Warning notice",
      detail: "level warn/error",
      when: (payload) => payload?.level === "warn" || payload?.level === "error"
    },
    {
      id: "attention.risk",
      event: "tool.output_risk",
      group: "Attention",
      label: "Risky tool output",
      detail: "injection / secrets found",
      when: () => true
    },
    {
      id: "attention.error",
      event: "error",
      group: "Attention",
      label: "Session error",
      detail: "outside a turn",
      when: () => true
    },
    {
      id: "task.subagent",
      event: "subagent.complete",
      group: "Work",
      label: "Subagent finishes",
      detail: "a delegated child is done",
      when: () => true
    },
    {
      id: "task.compacted",
      event: "status.update",
      group: "Work",
      label: "Context compacted",
      detail: "status kind = compacted",
      when: (payload) => payload?.kind === "compacted"
    },
    {
      id: "life.heartbeat",
      event: "status.update",
      group: "Ambient",
      label: "Heartbeat fires",
      detail: "status kind = heartbeat",
      when: (payload) => payload?.kind === "heartbeat"
    },
    {
      id: "life.wake",
      event: "wake.detected",
      group: "Ambient",
      label: "Wake phrase",
      detail: "you said the phrase",
      when: () => true
    },
    {
      id: "life.reaction",
      event: "reaction",
      group: "Ambient",
      label: "Affection detected",
      detail: '"good bot", "ily", a heart',
      when: () => true
    }
  ];
  var TRIGGER_BY_ID = new Map(TRIGGERS.map((trigger) => [trigger.id, trigger]));
  var TRIGGER_GROUPS = [...new Set(TRIGGERS.map((trigger) => trigger.group))];
  function cleanTrigger(value) {
    return typeof value === "string" && TRIGGER_BY_ID.has(value) ? value : null;
  }
  function cleanTriggers(value) {
    const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    const wanted = new Set(list.map(cleanTrigger).filter(Boolean));
    return TRIGGERS.filter((trigger) => wanted.has(trigger.id)).map((trigger) => trigger.id);
  }
  function parseYoutube(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      return null;
    }
    const host2 = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host2 === "youtu.be") {
      return /^[A-Za-z0-9_-]{11}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : null;
    }
    if (host2 !== "youtube.com" && host2 !== "m.youtube.com" && host2 !== "music.youtube.com") return null;
    const v = url.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  var toolsProbe = null;
  var ImportError = class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  };
  var IS_WINDOWS = typeof navigator !== "undefined" && /win/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "");
  function windowsHost() {
    return IS_WINDOWS || globalThis.__hermesForceWindows === true;
  }
  function joinNative(dir, name) {
    return `${dir}${IS_WINDOWS ? "\\" : "/"}${name}`;
  }
  function dataDir() {
    if (!windowsHost()) return null;
    return `%APPDATA%\\Hermes\\plugin-files\\data\\${ID}`;
  }
  globalThis.__hermesResetTools = () => {
    toolsProbe = null;
  };
  async function probeTools() {
    if (toolsProbe) return toolsProbe;
    const script = windowsHost() ? "where ffmpeg>nul 2>&1 && echo ffmpeg=1 || echo ffmpeg=0 & where uvx>nul 2>&1 && echo uvx=1 || echo uvx=0" : "command -v ffmpeg >/dev/null 2>&1 && echo ffmpeg=1 || echo ffmpeg=0; command -v uvx >/dev/null 2>&1 && echo uvx=1 || echo uvx=0";
    toolsProbe = (async () => {
      const text = await runShell(script, { capture: true });
      const found = String(text || "");
      return { ytdlp: /uvx=1/.test(found), ffmpeg: /ffmpeg=1/.test(found) };
    })();
    return toolsProbe;
  }
  function activeSessionId() {
    try {
      return host.state?.activeSessionId?.get?.() ?? null;
    } catch {
      return null;
    }
  }
  async function runShell(command, { capture = false } = {}) {
    const sessionId = activeSessionId();
    if (!sessionId) throw new ImportError("noSession", "Open a chat first \u2014 the converter runs inside a session.");
    const result = await host.request("shell.exec", { command, session_id: sessionId });
    const stdout = result?.stdout ?? "";
    const code = result?.code ?? 0;
    return capture ? stdout : code === 0 || Boolean(stdout);
  }
  function jobScript({ exe, args, out, log, status, mp3 }) {
    const q = (value) => `"${String(value).replace(/"/g, "").replace(/%(?![%~])/g, "%%")}"`;
    const run = [exe, ...args.map(q)].join(" ");
    const lines = [
      "@echo off",
      "setlocal",
      // %~dp0 is this script's own folder, with a trailing backslash.
      `cd /d ${q(out ?? "%~dp0")}`,
      `rem ${run}`,
      `${run} > ${q(log)} 2>&1`,
      'set "RC=%ERRORLEVEL%"',
      // Written in EVERY case, including a failed cd: a status file is the only
      // way the plugin learns the job ended at all.
      `if exist ${q(mp3)} (echo ok> ${q(status)}) else (echo fail> ${q(status)})`,
      "endlocal",
      "exit /b %RC%"
    ];
    return lines.join("\r\n") + "\r\n";
  }
  function detachedCommand(scriptPath) {
    if (windowsHost()) return `start "" /b ${`"${scriptPath}"`}`;
    return `nohup sh "${scriptPath}" >/dev/null 2>&1 &`;
  }
  async function probeDuration(videoId) {
    const out = await runShell(
      `uvx yt-dlp --print duration --skip-download https://www.youtube.com/watch?v=${videoId}`,
      { capture: true }
    );
    const match = String(out || "").match(/(\d+(?:\.\d+)?)\s*$/m);
    const seconds = match ? Number(match[1]) : NaN;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }
  async function waitForStatus(files2, statusPath, budgetMs, { logPath, onProgress } = {}) {
    const until = Date.now() + budgetMs;
    while (Date.now() < until) {
      await sleep(YT_POLL_MS);
      const read = await files2.readText(files2.dataFolder, statusPath);
      if (read.ok) {
        const text = (read.text || "").trim();
        if (text) return text === "ok" ? "ok" : "fail";
      }
      if (logPath && onProgress) {
        const log = await files2.readText(files2.dataFolder, logPath);
        if (log.ok) {
          const matches = String(log.text || "").match(/(\d{1,3}(?:\.\d+)?)%/g);
          if (matches?.length) {
            const percent = Number(matches[matches.length - 1].replace("%", ""));
            if (Number.isFinite(percent)) onProgress(Math.max(0, Math.min(100, Math.round(percent))));
          }
        }
      }
    }
    return "timeout";
  }
  async function readLogTail(files2, logPath) {
    const read = await files2.readText(files2.dataFolder, logPath);
    if (!read.ok) return "";
    const lines = String(read.text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).filter((line) => !/^\[download\]\s+\d/.test(line));
    return lines.slice(-2).join(" ").slice(0, 240);
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var MIME_RE = /^audio\/[a-z0-9.+-]{1,40}$/i;
  function cleanName(value, fallback) {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    return (text || fallback).slice(0, MAX_NAME_LEN);
  }
  function cleanSound(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
    const name = cleanName(raw.name, "");
    if (!name) return null;
    const triggers = cleanTriggers(raw.triggers ?? raw.trigger);
    const bound = triggers.length ? { triggers } : {};
    if (raw.kind === "synth") {
      return SYNTH_BY_ID.has(raw.synth) ? { id: raw.id, name, kind: "synth", synth: raw.synth, ...bound } : null;
    }
    if (raw.kind === "file" && typeof raw.mime === "string" && MIME_RE.test(raw.mime)) {
      return {
        id: raw.id,
        name,
        kind: "file",
        mime: raw.mime,
        bytes: Number.isFinite(raw.bytes) && raw.bytes > 0 ? Math.round(raw.bytes) : 0,
        ...bound
      };
    }
    return null;
  }
  function cleanSounds(raw) {
    if (!Array.isArray(raw)) return DEFAULT_SOUNDS.map((sound) => ({ ...sound }));
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const entry of raw.slice(0, MAX_SOUNDS)) {
      const sound = cleanSound(entry);
      if (sound && !seen.has(sound.id)) {
        seen.add(sound.id);
        out.push(sound);
      }
    }
    return out;
  }
  function cleanSettings(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const volume = Number(source.volume);
    return {
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : DEFAULT_SETTINGS.volume,
      showLabel: typeof source.showLabel === "boolean" ? source.showLabel : DEFAULT_SETTINGS.showLabel,
      padsPerRow: [3, 4, 5].includes(source.padsPerRow) ? source.padsPerRow : DEFAULT_SETTINGS.padsPerRow
    };
  }
  function newId() {
    const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    return `snd-${uuid.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}`;
  }
  function uniqueName(desired, taken) {
    const base = cleanName(desired, "Sound");
    const names = new Set(taken.map((name) => name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    for (let n = 2; n < 100; n += 1) {
      const candidate = `${base.slice(0, MAX_NAME_LEN - 4)} ${n}`;
      if (!names.has(candidate.toLowerCase())) return candidate;
    }
    return base;
  }
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("Could not read that file."));
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.readAsDataURL(file);
    });
  }
  var EXT_MIME = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    flac: "audio/flac",
    webm: "audio/webm"
  };
  function mimeOf(file, header) {
    const declared = String(header || "").split(";")[0].trim().toLowerCase();
    if (MIME_RE.test(declared)) return declared;
    const ext = String(file.name || "").split(".").pop()?.toLowerCase() ?? "";
    return EXT_MIME[ext] ?? "";
  }
  function baseName(fileName) {
    return String(fileName || "Sound").replace(/\.[^.]+$/, "");
  }
  function createEngine(ctx2) {
    const t = ctx2.i18n.t;
    const sounds = atom(cleanSounds(ctx2.storage.get("sounds", null)));
    const settings = atom(cleanSettings(ctx2.storage.get("settings", {})));
    const open = atom(false);
    const active = atom({});
    const saving = atom(false);
    const lastTrigger = atom(null);
    const ytJob = atom(null);
    const timers = /* @__PURE__ */ new Map();
    const urls = /* @__PURE__ */ new Map();
    const playing = /* @__PURE__ */ new Set();
    let audioContext = null;
    let disposed = false;
    const persistSounds = (next) => {
      sounds.set(next);
      ctx2.storage.set("sounds", next);
    };
    const persistSettings = (patch) => {
      const next = cleanSettings({ ...settings.get(), ...patch });
      settings.set(next);
      ctx2.storage.set("settings", next);
    };
    function flash(id) {
      const previous = timers.get(id);
      if (previous) clearTimeout(previous);
      active.set({ ...active.get(), [id]: true });
      const timer = setTimeout(() => {
        timers.delete(id);
        if (disposed) return;
        const next = { ...active.get() };
        delete next[id];
        active.set(next);
      }, FLASH_MS);
      timers.set(id, timer);
    }
    function context() {
      if (!audioContext) {
        const Ctor = typeof AudioContext !== "undefined" ? AudioContext : typeof webkitAudioContext !== "undefined" ? webkitAudioContext : null;
        if (!Ctor) return null;
        audioContext = new Ctor();
      }
      if (audioContext.state === "suspended") void audioContext.resume().catch(() => {
      });
      return audioContext;
    }
    function playSynth(synthId, gain) {
      const synth = SYNTH_BY_ID.get(synthId);
      const ac = context();
      if (!synth || !ac || gain <= 0) return;
      const master = ac.createGain();
      master.gain.value = 1;
      master.connect(ac.destination);
      try {
        synth.play(ac, master, gain);
      } catch {
      }
    }
    async function playFile(sound, gain) {
      let url = urls.get(sound.id);
      if (!url) {
        const files2 = ctx2.files;
        if (!files2) throw new Error(t("noFileAccess"));
        const read = await files2.readText(files2.dataFolder, `${sound.id}.b64`);
        if (!read.ok) throw new Error(read.message || t("missingAudio"));
        url = `data:${sound.mime};base64,${String(read.text).replace(/\s+/g, "")}`;
        urls.set(sound.id, url);
      }
      const audio = new Audio(url);
      audio.volume = Math.max(0, Math.min(1, gain));
      playing.add(audio);
      const release = () => {
        playing.delete(audio);
        audio.src = "";
      };
      audio.addEventListener("ended", release, { once: true });
      audio.addEventListener("error", release, { once: true });
      if (gain <= 0) return;
      await audio.play().catch(release);
    }
    function play(sound) {
      if (disposed || !sound) return;
      flash(sound.id);
      const gain = settings.get().volume / 100;
      if (sound.kind === "synth") playSynth(sound.synth, gain);
      else void playFile(sound, gain).catch((error) => ctx2.notify?.({ kind: "error", message: String(error.message || error) }));
    }
    const bound = () => sounds.get().filter((sound) => sound.triggers?.length);
    function fire(triggerId, event) {
      if (disposed) return;
      const trigger = TRIGGER_BY_ID.get(triggerId);
      if (!trigger) return;
      let payload = null;
      try {
        payload = event?.payload ?? null;
        if (!trigger.when(payload, event)) return;
      } catch {
        return;
      }
      lastTrigger.set({ id: triggerId, at: Date.now() });
      let fired = 0;
      for (const sound of bound()) {
        if (!sound.triggers.includes(triggerId)) continue;
        flash(sound.id);
        fired += 1;
        const gain = settings.get().volume / 100;
        if (gain <= 0) continue;
        if (sound.kind === "synth") playSynth(sound.synth, gain);
        else void playFile(sound, gain).catch(() => {
        });
      }
      if (!fired) lastTrigger.set(null);
    }
    for (const eventName of new Set(TRIGGERS.map((trigger) => trigger.event))) {
      ctx2.onEvent?.(eventName, (event) => {
        for (const trigger of TRIGGERS) {
          if (trigger.event === eventName) fire(trigger.id, event);
        }
      });
    }
    function toggleTrigger(soundId, triggerId) {
      const next = cleanTrigger(triggerId);
      if (!next) return;
      persistSounds(
        sounds.get().map((sound) => {
          if (sound.id !== soundId) return sound;
          const current = sound.triggers ?? [];
          const list = current.includes(next) ? current.filter((id) => id !== next) : [...current, next];
          const { triggers: _drop, ...rest } = sound;
          const ordered = cleanTriggers(list);
          return ordered.length ? { ...rest, triggers: ordered } : rest;
        })
      );
    }
    function clearTriggers(soundId) {
      persistSounds(
        sounds.get().map((sound) => {
          if (sound.id !== soundId) return sound;
          const { triggers: _drop, ...rest } = sound;
          return rest;
        })
      );
    }
    async function importYoutube(input, { onStage } = {}) {
      const files2 = ctx2.files;
      if (!files2) throw new ImportError("noFileAccess", t("noFileAccess"));
      const videoId = parseYoutube(input);
      if (!videoId) throw new ImportError("badUrl", t("ytBadUrl"));
      if (!activeSessionId()) throw new ImportError("noSession", t("ytNoSession"));
      if (sounds.get().length >= MAX_SOUNDS) throw new ImportError("tooMany", t("tooMany"));
      const dir = await dataDir();
      if (!dir) throw new ImportError("noPath", t("ytNoPath"));
      const tools = await probeTools(dir);
      if (!tools.ytdlp) throw new ImportError("noYtdlp", t("ytNoYtdlp"));
      if (!tools.ffmpeg) throw new ImportError("noFfmpeg", t("ytNoFfmpeg"));
      const id = newId();
      const stem = `yt-${id}`;
      const statusPath = `.${stem}.status`;
      const logPath = `.${stem}.log`;
      const mp3Path = `${stem}.mp3`;
      await files2.trash?.(files2.dataFolder, statusPath);
      await files2.trash?.(files2.dataFolder, logPath);
      onStage?.("checking");
      const seconds = await probeDuration(videoId);
      if (seconds !== null && seconds > YT_MAX_SECONDS) {
        throw new ImportError("tooLong", t("ytTooLong").replace("{secs}", String(Math.round(seconds))));
      }
      const args = [
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "5",
        "--no-playlist",
        "-o",
        `${stem}.%(ext)s`,
        `https://www.youtube.com/watch?v=${videoId}`
      ];
      const scriptPath = `.${stem}.cmd`;
      const script = jobScript({
        exe: "uvx yt-dlp",
        args,
        out: "%~dp0",
        log: `.${stem}.log`,
        status: `.${stem}.status`,
        mp3: `${stem}.mp3`
      });
      const wroteScript = await files2.writeText(files2.dataFolder, scriptPath, script);
      if (!wroteScript.ok) throw new ImportError("failed", wroteScript.message || t("saveFailed"));
      onStage?.("downloading");
      const started = await runShell(detachedCommand(joinNative(dir, scriptPath)));
      if (!started) throw new ImportError("noShell", t("ytNoShell"));
      ytJob.set({ stage: "downloading", id, percent: 0, at: Date.now() });
      const outcome = await waitForStatus(files2, statusPath, YT_TIMEOUT_MS, {
        files: files2,
        logPath,
        onProgress: (percent) => ytJob.set({ stage: "downloading", id, percent, at: Date.now() })
      });
      if (outcome === "timeout") {
        const detail = await readLogTail(files2, logPath);
        ytJob.set(null);
        throw new ImportError("timeout", detail || t("ytTimeout"));
      }
      if (outcome !== "ok") {
        const detail = await readLogTail(files2, logPath);
        throw new ImportError("failed", detail || t("ytFailed"));
      }
      const audio = await files2.readDataUrl(files2.dataFolder, mp3Path);
      if (!audio.ok) throw new ImportError("failed", audio.message || t("ytFailed"));
      const size = Math.round((audio.url.length - audio.url.indexOf(",") - 1) * 0.75);
      if (size > MAX_FILE_BYTES) {
        await files2.trash?.(files2.dataFolder, mp3Path);
        throw new ImportError("tooLarge", t("tooLarge"));
      }
      const sound = {
        id,
        name: uniqueName(`YouTube ${videoId.slice(0, 6)}`, sounds.get().map((item) => item.name)),
        kind: "file",
        mime: "audio/mpeg",
        bytes: size
      };
      const comma = audio.url.indexOf(",");
      const written = await files2.writeText(files2.dataFolder, `${id}.b64`, audio.url.slice(comma + 1));
      if (!written.ok) throw new ImportError("failed", written.message || t("saveFailed"));
      for (const name of [mp3Path, statusPath, logPath, scriptPath]) {
        await files2.trash?.(files2.dataFolder, name);
      }
      urls.set(id, audio.url);
      persistSounds([...sounds.get(), sound]);
      onStage?.("done");
      ytJob.set(null);
      haptic("tap");
      return sound;
    }
    function notify(message) {
      try {
        ctx2.notify?.(message);
      } catch {
      }
    }
    function stopAll() {
      for (const audio of playing) {
        audio.pause();
        audio.src = "";
      }
      playing.clear();
      active.set({});
      if (audioContext && audioContext.state === "running") void audioContext.suspend().catch(() => {
      });
    }
    async function addFile(file) {
      const files2 = ctx2.files;
      if (!files2) {
        ctx2.notify?.({ kind: "error", message: t("noFileAccess") });
        return;
      }
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        ctx2.notify?.({ kind: "warning", message: t("tooLarge") });
        return;
      }
      if (sounds.get().length >= MAX_SOUNDS) {
        ctx2.notify?.({ kind: "warning", message: t("tooMany") });
        return;
      }
      saving.set(true);
      try {
        const dataUrl = await readAsDataUrl(file);
        const comma = dataUrl.indexOf(",");
        const mime = mimeOf(file, comma > 0 ? dataUrl.slice(5, comma) : "");
        if (comma < 0 || !mime) {
          ctx2.notify?.({ kind: "warning", message: t("notAudio") });
          return;
        }
        const base64 = dataUrl.slice(comma + 1);
        const sound = {
          id: newId(),
          name: uniqueName(baseName(file.name), sounds.get().map((item) => item.name)),
          kind: "file",
          mime,
          bytes: file.size
        };
        const written = await files2.writeText(files2.dataFolder, `${sound.id}.b64`, base64);
        if (!written.ok) {
          ctx2.notify?.({ kind: "error", message: written.message || t("saveFailed") });
          return;
        }
        urls.set(sound.id, dataUrl);
        persistSounds([...sounds.get(), sound]);
        haptic("tap");
      } catch (error) {
        ctx2.notify?.({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        if (!disposed) saving.set(false);
      }
    }
    function addPreset(synthId) {
      const synth = SYNTH_BY_ID.get(synthId);
      if (!synth || sounds.get().length >= MAX_SOUNDS) return;
      const sound = {
        id: `synth-${synth.id}-${Date.now().toString(36)}`,
        name: uniqueName(synth.name, sounds.get().map((item) => item.name)),
        kind: "synth",
        synth: synth.id
      };
      persistSounds([...sounds.get(), sound]);
      play(sound);
    }
    function remove(soundId) {
      const target = sounds.get().find((item) => item.id === soundId);
      if (!target) return;
      const files2 = ctx2.files;
      if (target.kind === "file" && files2) void files2.trash(files2.dataFolder, `${target.id}.b64`).catch(() => {
      });
      urls.delete(target.id);
      persistSounds(sounds.get().filter((item) => item.id !== soundId));
    }
    function rename(soundId, name) {
      const cleaned = cleanName(name, "");
      const current = sounds.get();
      const existing = current.find((item) => item.id === soundId);
      if (!existing) return;
      if (!cleaned) {
        persistSounds([...current]);
        return;
      }
      const others = current.filter((item) => item.id !== soundId);
      persistSounds(current.map((item) => item.id === soundId ? { ...item, name: uniqueName(cleaned, others.map((other) => other.name)) } : item));
    }
    function restorePresets() {
      const present = new Set(sounds.get().filter((item) => item.kind === "synth").map((item) => item.synth));
      const missing = DEFAULT_SOUNDS.filter((sound) => !present.has(sound.synth));
      if (!missing.length) return;
      persistSounds([...sounds.get(), ...missing.map((sound) => ({ ...sound, id: `synth-${sound.synth}-${Date.now().toString(36)}` }))]);
    }
    ctx2.onDispose(() => {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const audio of playing) {
        audio.pause();
        audio.src = "";
      }
      playing.clear();
      urls.clear();
      if (audioContext) void audioContext.close().catch(() => {
      });
      audioContext = null;
    });
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
      ytJob,
      notify,
      restorePresets,
      setVolume: (volume) => persistSettings({ volume }),
      setShowLabel: (showLabel) => persistSettings({ showLabel }),
      setPadsPerRow: (padsPerRow) => persistSettings({ padsPerRow })
    };
  }
  var CSS = `
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
   inset hairline (a shadow, not a border \u2014 nothing reflows) fixes that. */
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
   means owning its background \u2014 the menu paints on --ui-bg-elevated with
   primary text, and the panel's own popover is opaque enough to sit behind it. */
/* The wrapper DISSOLVES (display: contents) so the picker and the menu become
   direct children of the row's flex layout. Without it the wrapper is a
   124x22 box and the menu, however wide it is told to be, can only render
   inside that box \u2014 which is why it came out 124px wide and unreadable. */
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
   flex-wrap: wrap and this is flex: 0 0 100%. Deliberately NOT positioned \u2014
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
   its row is bound \u2014 a multi-select list that shifts text as you tick items is
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
   stray yellow square. It now uses the same shape as its neighbours \u2014 bordered,
   tertiary fill, secondary glyph \u2014 and only the accent BORDER marks it as the
   one that commits, which is how the trigger picker already signals state. */
.hermes-sb-yt-go{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex-shrink:0;
  border-radius:4px;color:var(--ui-text-secondary);background-color:var(--ui-bg-tertiary);
  border:1px solid var(--ui-stroke-secondary)}
.hermes-sb-yt-go:hover{border-color:var(--ui-accent);color:var(--ui-text-primary)}
.hermes-sb-yt-go:active{background-color:var(--chrome-action-hover)}
.hermes-sb-yt-go:focus-visible{outline:1px solid var(--ui-accent);outline-offset:-1px}
.hermes-sb-yt-go:disabled{opacity:.45;cursor:default;border-color:var(--ui-stroke-tertiary);color:var(--ui-text-quaternary)}
.hermes-sb-yt-go:disabled:hover{border-color:var(--ui-stroke-tertiary);color:var(--ui-text-quaternary)}
.hermes-sb-yt-progress{display:flex;align-items:center;gap:6px;margin-top:6px}
.hermes-sb-yt-bar{flex:1;min-width:0;height:4px;border-radius:2px;overflow:hidden;background-color:var(--ui-bg-tertiary)}
.hermes-sb-yt-bar-fill{height:100%;border-radius:2px;background-color:var(--ui-accent);
  transition:width .25s ease-out}
.hermes-sb-yt-pct{flex:0 0 auto;font-size:9px;line-height:11px;font-variant-numeric:tabular-nums;
  color:var(--ui-text-tertiary);white-space:nowrap}
.hermes-sb-yt-note{padding:5px 2px 0;font-size:10px;line-height:14px;color:var(--ui-text-tertiary)}
/* An error is the one thing in this row the user MUST read, so it gets normal
   secondary text, a warning glyph via the marker, and a wrapped line \u2014 not the
   dimmest 9px tone it used to have. */
.hermes-sb-yt-note[data-error=true]{color:var(--ui-text-secondary);padding-left:12px;position:relative}
.hermes-sb-yt-note[data-error=true]::before{content:"!";position:absolute;left:2px;top:5px;
  width:8px;height:8px;border-radius:50%;text-align:center;
  font-size:7px;line-height:8px;font-weight:700;
  color:var(--ui-bg-primary);background-color:var(--ui-text-tertiary)}
.hermes-sb-body{position:relative}
`;
  function Pad({ sound, index, engine }) {
    const active = useValue(engine.active);
    return (0, import_jsx_runtime.jsxs)("button", {
      type: "button",
      className: "hermes-sb-pad",
      "data-active": Boolean(active[sound.id]),
      // Present only on a custom pad: React renders boolean `data-*` as the
      // string "false", and an always-present attribute would read as truthy.
      ...sound.kind === "file" ? { "data-custom": "true" } : {},
      ...sound.triggers?.length ? { "data-bound": "true" } : {},
      title: sound.triggers?.length ? `${sound.name} \u2014 ${sound.triggers.map((id) => `\u201C${TRIGGER_BY_ID.get(id)?.label}\u201D`).join(", ")}` : sound.kind === "file" ? `${sound.name} \u2014 your audio file` : `${sound.name} \u2014 built-in tone`,
      "aria-label": sound.name,
      onClick: () => {
        haptic("tap");
        engine.play(sound);
      },
      children: [
        index < 9 ? (0, import_jsx_runtime.jsx)("span", { className: "hermes-sb-pad-key", "aria-hidden": true, children: String(index + 1) }) : null,
        (0, import_jsx_runtime.jsx)("span", { className: "hermes-sb-pad-name", children: sound.name })
      ]
    }, sound.id);
  }
  function TriggerSelect({ sound, engine }) {
    const t = usePluginI18n(ID);
    const [open, setOpen] = (0, import_react2.useState)(false);
    const [cursor, setCursor] = (0, import_react2.useState)(-1);
    const boxRef = (0, import_react2.useRef)(null);
    const boundIds = sound.triggers ?? [];
    const boundTriggers = boundIds.map((id) => TRIGGER_BY_ID.get(id)).filter(Boolean);
    const flat = TRIGGERS.map((trigger) => trigger);
    (0, import_react2.useEffect)(() => {
      if (!open) return;
      const onDown = (event) => {
        if (!boxRef.current?.contains(event.target)) setOpen(false);
      };
      document.addEventListener("mousedown", onDown);
      return () => document.removeEventListener("mousedown", onDown);
    }, [open]);
    const onKeyDown = (event) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (!open) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
          setCursor(0);
        }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setCursor((index) => Math.min(flat.length - 1, Math.max(0, (index < 0 ? 0 : index) + step)));
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (cursor >= 0) engine.toggleTrigger(sound.id, flat[cursor].id);
      } else if (event.key === "Tab") {
        setOpen(false);
      }
    };
    const summary = boundTriggers.length === 0 ? t("whenNever") : boundTriggers.length === 1 ? boundTriggers[0].label : t("whenCount").replace("{n}", String(boundTriggers.length));
    const detail = boundTriggers.length ? boundTriggers.map((trigger) => `${trigger.label} \u2014 ${trigger.detail}`).join("\n") : t("whenNever");
    let rowIndex = -1;
    return (0, import_jsx_runtime.jsxs)("div", {
      ref: boxRef,
      className: "hermes-sb-when",
      onKeyDown,
      children: [
        (0, import_jsx_runtime.jsx)("button", {
          type: "button",
          className: "hermes-sb-picker",
          "data-open": open,
          "data-bound": boundTriggers.length > 0,
          "aria-haspopup": "listbox",
          "aria-expanded": open,
          "aria-label": `${t("when")}: ${sound.name}`,
          title: detail,
          onClick: () => {
            haptic("tap");
            setOpen((value) => !value);
          },
          children: [
            (0, import_jsx_runtime.jsx)("span", { className: "hermes-sb-picker-label", children: summary }),
            (0, import_jsx_runtime.jsx)("span", { className: "hermes-sb-picker-caret", "aria-hidden": true })
          ]
        }),
        open ? (0, import_jsx_runtime.jsx)("div", {
          className: "hermes-sb-menu",
          role: "listbox",
          "aria-multiselectable": "true",
          "aria-label": t("when"),
          children: [
            ...TRIGGER_GROUPS.map(
              (group) => (0, import_jsx_runtime.jsxs)(
                "div",
                {
                  className: "hermes-sb-menu-group",
                  children: [
                    (0, import_jsx_runtime.jsx)("div", { className: "hermes-sb-menu-heading", children: group }),
                    ...TRIGGERS.filter((trigger) => trigger.group === group).map((trigger) => {
                      const on = boundIds.includes(trigger.id);
                      rowIndex += 1;
                      const at = rowIndex;
                      return (0, import_jsx_runtime.jsx)(
                        "button",
                        {
                          type: "button",
                          className: "hermes-sb-menu-row",
                          "data-selected": on,
                          "data-cursor": cursor === at,
                          // role/state that a screen reader can follow as the
                          // list stays open across toggles.
                          role: "option",
                          "aria-selected": on,
                          title: trigger.detail,
                          onClick: () => {
                            haptic("tap");
                            engine.toggleTrigger(sound.id, trigger.id);
                          },
                          onMouseEnter: () => setCursor(at),
                          children: [
                            (0, import_jsx_runtime.jsx)("span", { className: "hermes-sb-menu-check", "aria-hidden": true, children: on ? "\u2713" : "" }),
                            (0, import_jsx_runtime.jsx)("span", { className: "hermes-sb-menu-text", children: trigger.label })
                          ]
                        },
                        trigger.id
                      );
                    })
                  ]
                },
                group
              )
            ),
            boundIds.length ? (0, import_jsx_runtime.jsx)("button", {
              type: "button",
              className: "hermes-sb-menu-clear",
              onClick: () => {
                engine.clearTriggers(sound.id);
                setOpen(false);
              },
              children: t("whenClear")
            }, "__clear") : null
          ]
        }) : null
      ]
    });
  }
  function ManageRow({ sound, engine }) {
    const t = usePluginI18n(ID);
    const [draft, setDraft] = (0, import_react2.useState)(sound.name);
    (0, import_react2.useEffect)(() => {
      setDraft(sound.name);
    }, [sound.name]);
    const commit = () => {
      if (draft.trim() && draft.trim() !== sound.name) engine.rename(sound.id, draft);
      else setDraft(sound.name);
    };
    return (0, import_jsx_runtime.jsxs)("div", {
      className: "hermes-sb-row",
      "data-bound": Boolean(sound.triggers?.length),
      children: [
        (0, import_jsx_runtime.jsx)(Tip, {
          label: t("preview"),
          children: (0, import_jsx_runtime.jsx)("button", {
            type: "button",
            className: "hermes-sb-rowbtn",
            "aria-label": `${t("preview")}: ${sound.name}`,
            onClick: () => engine.play(sound),
            children: (0, import_jsx_runtime.jsx)(icons.Play, { size: 11 })
          })
        }),
        (0, import_jsx_runtime.jsx)(TriggerSelect, { sound, engine }),
        (0, import_jsx_runtime.jsx)(Input, {
          className: "hermes-sb-row-name",
          size: "xs",
          value: draft,
          "aria-label": t("name"),
          spellCheck: false,
          onChange: (event) => setDraft(event.target.value),
          onBlur: commit,
          onKeyDown: (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(sound.name);
              event.currentTarget.blur();
            }
          }
        }),
        (0, import_jsx_runtime.jsx)(Tip, {
          label: `${t("delete")}: ${sound.name}`,
          children: (0, import_jsx_runtime.jsx)("button", {
            type: "button",
            className: "hermes-sb-rowbtn",
            "data-destructive": "true",
            "aria-label": `${t("delete")}: ${sound.name}`,
            onClick: () => engine.remove(sound.id),
            children: (0, import_jsx_runtime.jsx)(icons.Trash2, { size: 11 })
          })
        })
      ]
    }, sound.id);
  }
  function Panel({ engine }) {
    const t = usePluginI18n(ID);
    const sounds = useValue(engine.sounds);
    const settings = useValue(engine.settings);
    const saving = useValue(engine.saving);
    const last = useValue(engine.lastTrigger);
    const ytJob = useValue(engine.ytJob);
    const [manage, setManage] = (0, import_react2.useState)(false);
    const [dragging, setDragging] = (0, import_react2.useState)(false);
    const [ytOpen, setYtOpen] = (0, import_react2.useState)(false);
    const [ytUrl, setYtUrl] = (0, import_react2.useState)("");
    const [ytBusy, setYtBusy] = (0, import_react2.useState)(false);
    const [ytError, setYtError] = (0, import_react2.useState)("");
    const panelRef = (0, import_react2.useRef)(null);
    const fileRef = (0, import_react2.useRef)(null);
    (0, import_react2.useEffect)(() => {
      panelRef.current?.focus();
    }, []);
    const take = (0, import_react2.useCallback)(
      async (files2) => {
        const list = [...files2 || []];
        for (const file of list.slice(0, 8)) await engine.addFile(file);
      },
      [engine]
    );
    const importFromYoutube = (0, import_react2.useCallback)(async () => {
      const value = ytUrl.trim();
      if (!value || ytBusy) return;
      setYtBusy(true);
      setYtError("");
      try {
        const sound = await engine.importYoutube(value);
        setYtUrl("");
        setYtOpen(false);
        engine.notify({ kind: "info", message: t("ytAdded").replace("{name}", sound.name) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setYtError(message);
        engine.notify({ kind: "error", message: `${t("ytFailed")} ${message}` });
      } finally {
        setYtBusy(false);
      }
    }, [engine, ytUrl, ytBusy, t]);
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (ytOpen) {
          setYtOpen(false);
          setYtError("");
          return;
        }
        engine.open.set(false);
        return;
      }
      if (manage || event.metaKey || event.ctrlKey || event.altKey) return;
      const index = Number(event.key);
      if (!Number.isInteger(index) || index < 1 || index > 9) return;
      const sound = sounds[index - 1];
      if (!sound) return;
      event.preventDefault();
      engine.play(sound);
    };
    const presentSynths = new Set(sounds.filter((sound) => sound.kind === "synth").map((sound) => sound.synth));
    const missing = SYNTHS.filter((synth) => !presentSynths.has(synth.id));
    const volume = settings.volume;
    return (0, import_jsx_runtime.jsxs)("div", {
      ref: panelRef,
      tabIndex: -1,
      className: "hermes-sb-body",
      role: "group",
      "aria-label": t("title"),
      onKeyDown,
      onDragOver: (event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      },
      onDragLeave: (event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setDragging(false);
      },
      onDrop: (event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer?.files?.length) void take(event.dataTransfer.files);
      },
      children: [
        (0, import_jsx_runtime.jsxs)("div", {
          className: "hermes-sb-head",
          children: [
            (0, import_jsx_runtime.jsx)("span", { className: "hermes-sb-head-title", children: t("title") }),
            (0, import_jsx_runtime.jsx)(Tip, {
              label: t("stopAll"),
              children: (0, import_jsx_runtime.jsx)("button", {
                type: "button",
                className: "hermes-sb-iconbtn",
                "aria-label": t("stopAll"),
                onClick: () => engine.stopAll(),
                children: (0, import_jsx_runtime.jsx)(icons.StopFilled, { size: 11 })
              })
            }),
            (0, import_jsx_runtime.jsx)(Tip, {
              label: t("addSound"),
              children: (0, import_jsx_runtime.jsx)("button", {
                type: "button",
                className: "hermes-sb-iconbtn",
                "aria-label": t("addSound"),
                disabled: saving,
                onClick: () => fileRef.current?.click(),
                children: saving ? (0, import_jsx_runtime.jsx)(icons.Loader2, { size: 11 }) : (0, import_jsx_runtime.jsx)(icons.Plus, { size: 12 })
              })
            }),
            (0, import_jsx_runtime.jsx)(Tip, {
              label: t("ytOpen"),
              children: (0, import_jsx_runtime.jsx)("button", {
                type: "button",
                className: "hermes-sb-iconbtn",
                "data-on": ytOpen,
                "aria-expanded": ytOpen,
                "aria-label": t("ytOpen"),
                onClick: () => {
                  haptic("tap");
                  setYtOpen((value) => !value);
                },
                children: (0, import_jsx_runtime.jsx)(icons.Link, { size: 11 })
              })
            }),
            (0, import_jsx_runtime.jsx)(Tip, {
              label: manage ? t("done") : t("manage"),
              children: (0, import_jsx_runtime.jsx)("button", {
                type: "button",
                className: "hermes-sb-iconbtn",
                "data-on": manage,
                "aria-pressed": manage,
                "aria-label": manage ? t("done") : t("manage"),
                onClick: () => setManage((value) => !value),
                children: (0, import_jsx_runtime.jsx)(icons.Pencil, { size: 11 })
              })
            })
          ]
        }),
        (0, import_jsx_runtime.jsx)("input", {
          ref: fileRef,
          type: "file",
          accept: "audio/*",
          multiple: true,
          style: { display: "none" },
          onChange: (event) => {
            const files2 = [...event.target.files];
            event.target.value = "";
            void take(files2);
          }
        }),
        ytOpen ? (0, import_jsx_runtime.jsxs)("div", {
          className: "hermes-sb-yt",
          children: [
            (0, import_jsx_runtime.jsx)("input", {
              type: "text",
              className: "hermes-sb-yt-input",
              // Not type=url: yt-dlp accepts ids and short links, and a
              // browser URL validator would refuse both.
              placeholder: t("ytPlaceholder"),
              value: ytUrl,
              autoFocus: true,
              spellCheck: false,
              disabled: ytBusy,
              "aria-label": t("ytPlaceholder"),
              onChange: (event) => setYtUrl(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void importFromYoutube();
                }
              }
            }),
            (0, import_jsx_runtime.jsx)("button", {
              type: "button",
              className: "hermes-sb-yt-go",
              "aria-label": t("ytImport"),
              disabled: ytBusy || !ytUrl.trim(),
              onClick: () => void importFromYoutube(),
              children: ytBusy ? (0, import_jsx_runtime.jsx)(icons.Loader2, { size: 11 }) : (0, import_jsx_runtime.jsx)(icons.Download, { size: 11 })
            })
          ]
        }) : null,
        ytBusy ? (0, import_jsx_runtime.jsxs)("div", {
          className: "hermes-sb-yt-progress",
          role: "progressbar",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": ytJob?.percent ?? 0,
          "aria-label": t("ytWorking"),
          children: [
            (0, import_jsx_runtime.jsx)("div", { className: "hermes-sb-yt-bar", children: (0, import_jsx_runtime.jsx)("div", {
              className: "hermes-sb-yt-bar-fill",
              style: { width: `${Math.max(4, ytJob?.percent ?? 0)}%` }
            }) }),
            (0, import_jsx_runtime.jsx)("span", {
              className: "hermes-sb-yt-pct",
              children: ytJob?.percent ? `${ytJob.percent}%` : t("ytWorking")
            })
          ]
        }) : null,
        ytError ? (0, import_jsx_runtime.jsx)("div", { className: "hermes-sb-yt-note", "data-error": "true", children: ytError }) : null,
        manage ? (0, import_jsx_runtime.jsxs)("div", {
          children: [
            sounds.length ? (0, import_jsx_runtime.jsx)("div", { className: "hermes-sb-list", children: sounds.map((sound) => (0, import_jsx_runtime.jsx)(ManageRow, { sound, engine }, sound.id)) }) : (0, import_jsx_runtime.jsx)("div", { className: "hermes-sb-empty", children: t("empty") }),
            missing.length ? (0, import_jsx_runtime.jsxs)("div", {
              children: [
                (0, import_jsx_runtime.jsx)("div", { className: "hermes-sb-section", children: t("builtins") }),
                (0, import_jsx_runtime.jsx)("div", {
                  className: "hermes-sb-presets",
                  children: missing.map(
                    (synth) => (0, import_jsx_runtime.jsx)("button", {
                      type: "button",
                      className: "hermes-sb-preset",
                      onClick: () => engine.addPreset(synth.id),
                      children: synth.name
                    }, synth.id)
                  )
                })
              ]
            }) : null
          ]
        }) : sounds.length ? (0, import_jsx_runtime.jsx)("div", {
          className: "hermes-sb-grid",
          style: { gridTemplateColumns: `repeat(${settings.padsPerRow}, minmax(0, 1fr))` },
          children: [
            ...sounds.slice(0, 24).map((sound, index) => (0, import_jsx_runtime.jsx)(Pad, { sound, index, engine }, sound.id)),
            // The insertion point lives where the list ends, and it fills
            // the short last row a 7-pad board would otherwise leave empty.
            sounds.length < MAX_SOUNDS ? (0, import_jsx_runtime.jsx)("button", {
              type: "button",
              className: "hermes-sb-pad hermes-sb-add",
              title: t("addSound"),
              "aria-label": t("addSound"),
              disabled: saving,
              onClick: () => fileRef.current?.click(),
              children: (0, import_jsx_runtime.jsx)(icons.Plus, { size: 13, "aria-hidden": true })
            }, "add") : null
          ]
        }) : (0, import_jsx_runtime.jsxs)("div", {
          className: "hermes-sb-empty",
          children: [
            (0, import_jsx_runtime.jsx)("div", { children: t("empty") }),
            (0, import_jsx_runtime.jsx)("button", {
              type: "button",
              className: "hermes-sb-preset",
              style: { marginTop: "8px" },
              onClick: () => engine.restorePresets(),
              children: t("restore")
            })
          ]
        }),
        (0, import_jsx_runtime.jsxs)("div", {
          className: "hermes-sb-foot",
          children: [
            (0, import_jsx_runtime.jsx)("button", {
              type: "button",
              className: "hermes-sb-foot-icon",
              "aria-label": volume ? t("mute") : t("unmute"),
              title: volume ? t("mute") : t("unmute"),
              onClick: () => engine.setVolume(volume ? 0 : 80),
              children: (0, import_jsx_runtime.jsx)(volume ? icons.Volume2 : icons.VolumeX, { size: 11, "aria-hidden": true })
            }),
            (0, import_jsx_runtime.jsx)("input", {
              type: "range",
              min: 0,
              max: 100,
              step: 1,
              value: volume,
              "aria-label": t("volume"),
              onChange: (event) => engine.setVolume(Number(event.target.value))
            }),
            (0, import_jsx_runtime.jsx)("span", { className: "hermes-sb-foot-value", children: `${volume}%` })
          ]
        }),
        // A binding firing while the panel happens to be open is otherwise
        // invisible: the pads are shut away behind the popover trigger.
        last && TRIGGER_BY_ID.has(last.id) ? (0, import_jsx_runtime.jsx)("div", {
          className: "hermes-sb-last",
          role: "status",
          children: t("lastTrigger", TRIGGER_BY_ID.get(last.id).label)
        }) : null,
        dragging ? (0, import_jsx_runtime.jsx)("div", { className: "hermes-sb-drop", children: t("dropHere") }) : null
      ]
    });
  }
  function Chip({ engine }) {
    const t = usePluginI18n(ID);
    const open = useValue(engine.open);
    const settings = useValue(engine.settings);
    return (0, import_jsx_runtime.jsx)("div", {
      className: "hermes-sb-bar",
      children: (0, import_jsx_runtime.jsx)(Popover, {
        open,
        onOpenChange: (value) => engine.open.set(value),
        children: [
          (0, import_jsx_runtime.jsx)(PopoverTrigger, {
            asChild: true,
            children: (0, import_jsx_runtime.jsx)(Button, {
              variant: "ghost",
              size: "micro",
              className: "hermes-sb-chip",
              "data-open": open,
              "aria-label": t("open"),
              title: t("open"),
              onPointerDown: () => haptic("tap"),
              children: [
                (0, import_jsx_runtime.jsx)(icons.AudioLines, { size: 12, "aria-hidden": true }),
                settings.showLabel ? (0, import_jsx_runtime.jsx)("span", { className: "hermes-sb-chip-label", children: "Soundboard" }) : null
              ]
            })
          }),
          (0, import_jsx_runtime.jsx)(PopoverContent, {
            side: "top",
            align: "end",
            className: "hermes-sb-panel",
            "aria-label": t("title"),
            children: (0, import_jsx_runtime.jsx)(Panel, { engine })
          })
        ]
      })
    });
  }
  function SoundboardSettings({ engine }) {
    const t = usePluginI18n(ID);
    const settings = useValue(engine.settings);
    const sounds = useValue(engine.sounds);
    const custom = sounds.filter((sound) => sound.kind === "file").length;
    return (0, import_jsx_runtime.jsxs)("div", {
      style: { display: "flex", flexDirection: "column", gap: "18px" },
      children: [
        (0, import_jsx_runtime.jsxs)("label", {
          style: { display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--ui-text-secondary)" },
          children: [
            (0, import_jsx_runtime.jsx)("span", { children: t("volume") }),
            (0, import_jsx_runtime.jsxs)("div", {
              style: { display: "flex", alignItems: "center", gap: "8px", maxWidth: "320px" },
              children: [
                (0, import_jsx_runtime.jsx)("input", {
                  type: "range",
                  min: 0,
                  max: 100,
                  step: 1,
                  value: settings.volume,
                  style: { flex: 1, height: "3px", accentColor: "var(--ui-accent)" },
                  onChange: (event) => engine.setVolume(Number(event.target.value))
                }),
                (0, import_jsx_runtime.jsx)("span", { style: { width: "34px", textAlign: "right", fontVariantNumeric: "tabular-nums" }, children: `${settings.volume}%` })
              ]
            })
          ]
        }),
        (0, import_jsx_runtime.jsxs)("label", {
          style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--ui-text-secondary)" },
          children: [
            (0, import_jsx_runtime.jsx)("input", {
              type: "checkbox",
              checked: settings.showLabel,
              onChange: (event) => engine.setShowLabel(event.target.checked)
            }),
            (0, import_jsx_runtime.jsx)("span", { children: t("showLabel") })
          ]
        }),
        (0, import_jsx_runtime.jsxs)("div", {
          style: { fontSize: "12px", color: "var(--ui-text-tertiary)" },
          children: [
            (0, import_jsx_runtime.jsx)("div", { children: t("stats", sounds.length, custom) }),
            (0, import_jsx_runtime.jsx)("button", {
              type: "button",
              className: "hermes-sb-preset",
              style: { marginTop: "8px" },
              onClick: () => engine.restorePresets(),
              children: t("restore")
            })
          ]
        })
      ]
    });
  }
  var LOCALES = {
    en: {
      title: "Soundboard",
      open: "Open the soundboard",
      stopAll: "Stop all sounds",
      addSound: "Add a sound file",
      manage: "Manage sounds",
      done: "Done",
      preview: "Preview",
      name: "Sound name",
      delete: "Delete",
      volume: "Volume",
      mute: "Mute",
      unmute: "Unmute",
      when: "Play this sound when",
      whenNever: "Never",
      whenCount: "{n} triggers",
      ytOpen: "Import from YouTube",
      ytPlaceholder: "YouTube link or video id",
      ytImport: "Convert to mp3",
      ytWorking: "Converting\u2026",
      ytAdded: "Added \u201C{name}\u201D.",
      ytBadUrl: "That is not a YouTube link.",
      ytNoPath: "This build does not expose a plugin folder, so a download has nowhere to land.",
      ytNoYtdlp: "yt-dlp is not available. Install uv (it is bundled with Hermes) and try again.",
      ytNoFfmpeg: "ffmpeg was not found on PATH \u2014 yt-dlp needs it to make an mp3.",
      ytNoShell: "Hermes refused to run the converter.",
      ytNoSession: "Open a chat first \u2014 the converter runs inside the session that is currently open.",
      ytTooLong: "That video is {secs}s long. Soundboard clips are capped at 30s \u2014 pick a shorter one.",
      ytTimeout: "The converter stopped without reporting back. Check that ffmpeg is on PATH, then try again.",
      ytFailed: "The conversion failed.",
      whenClear: "Clear all triggers",
      lastTrigger: (trigger) => `Last trigger: ${trigger}`,
      showLabel: "Show the Soundboard label in the status bar",
      empty: "No sounds yet. Add an audio file, or drop one here.",
      restore: "Restore built-in sounds",
      builtins: "Built-in sounds",
      dropHere: "Drop audio files to add them",
      noFileAccess: "This Hermes Desktop build has no plugin file access, so custom sounds cannot be saved.",
      tooLarge: "That file is larger than 3 MB. Soundboard clips should be short.",
      tooMany: "The soundboard holds 40 sounds. Delete one to add another.",
      notAudio: "That file is not an audio file.",
      saveFailed: "That sound could not be saved.",
      missingAudio: "That sound file is missing from the plugin folder.",
      stats: (total, custom) => `${total} pads \xB7 ${custom} custom file${custom === 1 ? "" : "s"}`
    },
    pl: {
      title: "Soundboard",
      open: "Otw\xF3rz soundboard",
      stopAll: "Zatrzymaj wszystkie d\u017Awi\u0119ki",
      addSound: "Dodaj plik d\u017Awi\u0119kowy",
      manage: "Zarz\u0105dzaj d\u017Awi\u0119kami",
      done: "Gotowe",
      preview: "Ods\u0142uchaj",
      name: "Nazwa d\u017Awi\u0119ku",
      delete: "Usu\u0144",
      volume: "G\u0142o\u015Bno\u015B\u0107",
      mute: "Wycisz",
      unmute: "Wy\u0142\u0105cz wyciszenie",
      when: "Odtw\xF3rz ten d\u017Awi\u0119k gdy",
      whenNever: "Nigdy",
      whenCount: "{n} wyzwalaczy",
      ytOpen: "Importuj z YouTube",
      ytPlaceholder: "Link do YouTube lub id filmu",
      ytImport: "Konwertuj do mp3",
      ytWorking: "Pobieranie i konwersja\u2026 to mo\u017Ce chwil\u0119 potrwa\u0107.",
      ytAdded: "Dodano \u201E{name}\u201D.",
      ytBadUrl: "To nie jest link do YouTube.",
      ytNoPath: "Ta wersja nie udost\u0119pnia folderu wtyczki, wi\u0119c pobranie nie ma gdzie trafi\u0107.",
      ytNoYtdlp: "yt-dlp jest niedost\u0119pny. Zainstaluj uv (jest w zestawie z Hermes) i spr\xF3buj ponownie.",
      ytNoFfmpeg: "Nie znaleziono ffmpeg w PATH \u2014 yt-dlp potrzebuje go do mp3.",
      ytNoShell: "Hermes odm\xF3wi\u0142 uruchomienia konwertera.",
      ytNoSession: "Najpierw otw\xF3rz czat \u2014 konwerter dzia\u0142a w obr\u0119bie otwartej sesji.",
      ytTooLong: "Ten film ma {secs}s. Klipy d\u017Awi\u0119kowe s\u0105 ograniczone do 30s \u2014 wybierz kr\xF3tszy.",
      ytTimeout: "Konwerter zatrzyma\u0142 si\u0119 bez odpowiedzi. Sprawd\u017A, czy ffmpeg jest w PATH, i spr\xF3buj ponownie.",
      ytFailed: "Konwersja nie powiod\u0142a si\u0119.",
      whenClear: "Wyczy\u015B\u0107 wszystkie wyzwalacze",
      lastTrigger: (trigger) => `Ostatni wyzwalacz: ${trigger}`,
      showLabel: "Pokazuj podpis Soundboard na pasku stanu",
      empty: "Brak d\u017Awi\u0119k\xF3w. Dodaj plik audio albo przeci\u0105gnij go tutaj.",
      restore: "Przywr\xF3\u0107 d\u017Awi\u0119ki wbudowane",
      builtins: "D\u017Awi\u0119ki wbudowane",
      dropHere: "Upu\u015B\u0107 pliki audio, aby je doda\u0107",
      noFileAccess: "Ta wersja Hermes Desktop nie daje wtyczkom dost\u0119pu do plik\xF3w, wi\u0119c w\u0142asnych d\u017Awi\u0119k\xF3w nie da si\u0119 zapisa\u0107.",
      tooLarge: "Ten plik jest wi\u0119kszy ni\u017C 3 MB. Klipy do soundboardu powinny by\u0107 kr\xF3tkie.",
      tooMany: "Soundboard mie\u015Bci 40 d\u017Awi\u0119k\xF3w. Usu\u0144 kt\xF3ry\u015B, aby doda\u0107 kolejny.",
      notAudio: "To nie jest plik audio.",
      saveFailed: "Nie uda\u0142o si\u0119 zapisa\u0107 tego d\u017Awi\u0119ku.",
      missingAudio: "Brakuje tego pliku d\u017Awi\u0119kowego w folderze wtyczki.",
      stats: (total, custom) => `${total} pad\xF3w \xB7 ${custom} w\u0142asnych plik\xF3w`
    }
  };
  var plugin_default = {
    id: ID,
    name: "Soundboard",
    description: "A soundboard in the bottom bar: synthesized cues plus your own audio files as pads.",
    defaultEnabled: true,
    register(ctx2) {
      ctx2.i18n.register(LOCALES);
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.append(style);
      ctx2.onDispose(() => style.remove());
      const engine = createEngine(ctx2);
      ctx2.register({ id: "chip", area: STATUSBAR_AREAS.right, order: 20, render: () => (0, import_jsx_runtime.jsx)(Chip, { engine }) });
      ctx2.register({
        id: "open",
        area: PALETTE_AREA,
        data: {
          id: "soundboard.open",
          label: "Open Soundboard",
          keywords: ["sound", "soundboard", "audio", "pad", "sfx"],
          run: () => engine.open.set(true)
        }
      });
      ctx2.registerSettingsPage?.({
        id: "settings",
        title: "Soundboard",
        icon: "unmute",
        render: () => (0, import_jsx_runtime.jsx)(SoundboardSettings, { engine })
      });
    }
  };

  // ../../../../../hermes-soundboard/.probe/entry.js
  var files = /* @__PURE__ */ new Map([["snd-87ce81f27a9544eebb53.b64", "SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYzLjEuMTAxAAAAAAAAAAAAAAD/+1QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYaW5nAAAADwAAAGAAACuYAAYICw0PERMWGBocHiEjJScpLC4wMjQ3OTs7PT9CREZLUFRZXWBlaW5xdnp+goaKjpKXl5qcn6GjpaeqrK6wsrW3ubu9wMLExsjLzc3P0dPW2Nrc3uHj5efp7O7w8vT3+fv9/wAAAABMYXZjNjMuMS4AAAAAAAAAAAAAAAAkAxUAAAAAAAArmMkGp0H/+xRkAA/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARMQU1FNC4xIChhbHBoYSAwKVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRkHg/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRkPA/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRkWg/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRkeA/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRklg/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRktA/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRk0g/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjEgKGFscGhhIDApVVVVVVVVVVVVVVVVVVX/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAA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IAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUU0LjEgKGFscGhhIDApqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+xRk4Y/wAABpAAAACAAADSAAAAEAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo="]]);
  var store = /* @__PURE__ */ new Map([
    ["sounds", JSON.stringify([{ id: "snd-87ce81f27a9544eebb53", name: "YT", kind: "file", mime: "audio/mpeg", bytes: 11205 }])],
    ["settings", JSON.stringify({ volume: 73 })]
  ]);
  window.__audios = [];
  var RealAudio = window.Audio;
  window.Audio = class extends RealAudio {
    constructor(src) {
      super(src);
      window.__audios.push(this);
      this.addEventListener("error", () => {
        window.__audioError = this.error ? "code " + this.error.code : "unknown";
      });
    }
  };
  var ctx = {
    source: "plugin:hermes-soundboard",
    register: (c) => {
      window.__chip = c;
    },
    registerMany: () => () => {
    },
    registerSettingsPage: () => () => {
    },
    storage: { get: (k, f) => store.has(k) ? JSON.parse(store.get(k)) : f, set: (k, v) => store.set(k, JSON.stringify(v)), remove: (k) => store.delete(k) },
    files: {
      dataFolder: "data",
      readText: async (_f, p) => files.has(p) ? { ok: true, text: files.get(p), size: files.get(p).length, mtimeMs: 0 } : { ok: false, error: "not-found", message: "no " + p },
      writeText: async (_f, p, t) => {
        files.set(p, t);
        return { ok: true, path: p, size: t.length, mtimeMs: 0 };
      },
      trash: async (_f, p) => {
        files.delete(p);
        return { ok: true };
      },
      readDataUrl: async () => ({ ok: false, error: "x", message: "x" }),
      folders: async () => [],
      requestFolder: async () => ({ ok: false }),
      list: async () => ({ ok: true, entries: [], truncated: false }),
      stat: async () => ({ ok: true, exists: true }),
      rename: async () => ({ ok: true })
    },
    i18n: { register: (b) => {
      window.__loc = b;
    }, t: (k) => k },
    onEvent: () => () => {
    },
    onDispose: () => {
    },
    setTimeout: (f, ms) => {
      const id = setTimeout(f, ms);
      return () => clearTimeout(id);
    },
    setInterval: () => () => {
    },
    addEventListener: () => () => {
    },
    os: {},
    pet: { say: () => () => {
    } },
    notify: (o) => {
      window.__note = o?.message;
    }
  };
  plugin_default.register(ctx);
  window.__mount = (host2) => {
    const React = window.React;
    const { createRoot } = window.ReactDOMClient;
    createRoot(host2).render(React.createElement(window.__chip.render));
  };
})();
