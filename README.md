# hermes-soundboard

A soundboard for the **Hermes Desktop** app, docked in the bottom bar.

Click the chip at the right end of the status bar and a popover of pads opens
above it: seven built-in cues synthesized with WebAudio (no assets, no
network), plus any audio files you add. Names, order, volume and a "manage"
mode all persist per machine.

```
┌───────────────────────────────────────────────┐
│  … status bar …            ▮▮▮▮ Soundboard  ⟩ │  ← chip
└───────────────────────────────────────────────┘
                   ▲
        ┌──────────────────────┐
        │ SOUNDBOARD      ■ + ✎│
        │ ┌────┐┌────┐┌────┐  │
        │ │Pop ││Ding││Beep│  │  ← pads (1–9 = keys)
        │ └────┘└────┘└────┘  │
        │ ┌────┐┌────┐┌────┐  │
        │ │Coin││Lsr ││Whsh│  │
        │ └────┘└────┘└────┘  │
        │ 🔊 ▬▬▬▬▬▬▬▬▬▬  80%  │
        └──────────────────────┘
```

## What it does

- **Bottom-bar controls.** The whole soundboard is a status-bar chip and a
  popover — no pane, no page, no window to manage.
- **Built-in sounds.** Pop, Ding, Beep, Coin, Laser, Whoosh, Boing. Each is a
  handful of oscillator/noise nodes with an exponential envelope, so they are
  instant and cost nothing on disk. Delete them and they can be restored from
  the manage list or the settings page.
- **Custom sounds.** `+` opens a file picker (`audio/*`, multi-select), or drop
  audio files straight onto the panel. Each file is copied into the plugin's
  private data folder as base64 and read back into a `data:` URL on first play,
  so a custom pad survives restarts without the original file staying put.
- **Manage mode.** The pencil button lists every pad with an inline rename
  field (Enter or blur commits, Escape reverts), a preview button and delete.
  Deleting a custom pad also trashes its stored clip.
- **Volume + mute.** One master volume, persisted. `■` stops everything and
  suspends the audio context.
- **Keyboard.** While the panel is focused, `1`–`9` fire the first nine pads and
  `Escape` closes it.
- **⌘K command.** "Open Soundboard" from the command palette.
- **Settings → Plugins → Soundboard.** Volume, whether the status-bar chip
  shows its label, and how many pads fit per row.

## Install

Hermes Desktop loads plugins from `$HERMES_HOME/desktop-plugins/<id>/plugin.js`
and the folder name must equal the plugin `id` (`hermes-soundboard`).

```bash
git clone https://github.com/SztejnMaxer7cm/hermes-soundboard.git
cp -r hermes-soundboard ~/.hermes/desktop-plugins/hermes-soundboard
```

On Windows that is typically:

```powershell
git clone https://github.com/SztejnMaxer7cm/hermes-soundboard.git
xcopy /E /I hermes-soundboard "%LOCALAPPDATA%\hermes\desktop-plugins\hermes-soundboard"
```

Or just copy `plugin.js` into that folder — it is the whole plugin. Then run
**Reload desktop plugins** from ⌘K (the app also hot-reloads every save of the
file). The plugin is enabled by default; it stays off if you toggle it off in
**Capabilities → Plugins**.

## Limits, on purpose

- 40 pads maximum, 3 MB per audio file. `ctx.files` refuses text beyond 4 MiB
  and base64 inflates by 4/3, so 3 MB is the largest clip that reliably fits.
- Soundboard clips are meant to be short. Anything long belongs in a player, not
  a pad.

## How it is built

One plain-ESM file, no build step, no dependencies — the two things the Desktop
loader resolves at runtime are `@hermes/plugin-sdk` and `react/jsx-runtime`:

| Surface | API |
|---|---|
| Bottom bar | `ctx.register({ area: STATUSBAR_AREAS.right })` + `Popover` |
| Command palette | `ctx.register({ area: PALETTE_AREA })` |
| Settings page | `ctx.registerSettingsPage({...})` |
| Persistence | `ctx.storage` (sounds + settings) |
| Clips | `ctx.files.writeText('data', '<id>.b64', base64)` / `readText` / `trash` |
| Sound | WebAudio (`OscillatorNode`, `AudioBufferSourceNode`) and `Audio` |
| Text | `ctx.i18n.register({ en, pl })` + `usePluginI18n` |

Custom clips are stored base64 rather than as binary because `ctx.files` is the
only file door a plugin gets, and it is text (plus `readDataUrl`) oriented. No
`window.hermesDesktop` calls, no DOM reach into the app, no hardcoded colours —
all of it is theme variables, so the pads follow whatever skin is active.

## Test

The harness bundles the real `plugin.js` with esbuild, swaps the SDK for a stub
with the same shapes, mounts every contribution in jsdom and drives them the way
a user would — add a file, drop a file, rename, delete, reload, corrupt the
stored JSON — through 25 assertions.

```bash
npm test
```

It borrows `esbuild`, `jsdom`, `react` and `react-dom` from an installed Hermes
(`HERMES_DEPS_ROOT` points it elsewhere if needed) precisely because the plugin
itself declares no dependencies and this repository has no `node_modules`.

Passing the harness proves the plugin evaluates, registers, renders, persists
and survives a disable/enable cycle. It says nothing about whether it looks
right inside the app — that still needs eyes on the real window.

## License

MIT
