# hermes-soundboard

A soundboard for the **Hermes Desktop** app, docked in the bottom bar.

Click the chip at the right end of the status bar and a popover of pads opens
above it: seven built-in cues synthesized with WebAudio (no assets, no
network), plus any audio files you add. Names, order, volume and a "manage"
mode all persist per machine.

```
┌──────────────────────────────────────────────────┐
│  … status bar …              ≋ Soundboard  42%  │  ← chip
└──────────────────────────────────────────────────┘
                       ▲
        ┌──────────────────────────────┐
        │ SOUNDBOARD           ■  +  ✎ │
        │ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
        │ │1Pop│ │2Dng│ │3Bep│ │4Con│  │  ← 1–9 = keys
        │ └────┘ └────┘ └────┘ └────┘  │
        │ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
        │ │5Lsr│ │6Whs│ │7Bng│ │ +  │  │  ← + adds a file
        │ └────┘ └────┘ └────┘ └────┘  │
        │ ──────────────────────────── │
        │ 🔊 ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬   80% │
        └──────────────────────────────┘
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

## Screenshots

![The soundboard popover](shots/preview-panel.png)

| | |
|---|---|
| ![Manage mode](shots/preview-manage.png) | ![Settings page](shots/preview-settings.png) |
| Manage mode — rename, preview, delete | Settings → Plugins → Soundboard |

All three are produced by `npm run test:ui`, not by hand.

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

- 40 sounds maximum, 3 MB per audio file. `ctx.files` refuses text beyond 4 MiB
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

Everything read back out of storage is rebuilt field by field before use, so a
hand-edited or half-written JSON blob degrades to the built-ins instead of
throwing inside a render.

## Test

Three suites, all runnable with `npm test`:

```bash
npm test            # all three
npm run test:unit   # jsdom harness, 25 assertions
npm run test:picker # real file picker in Chromium, 8 assertions
npm run test:ui     # render + geometry in Chromium, writes PNGs to .build/
```

**`test/harness.mjs`** bundles the real `plugin.js` with esbuild, swaps the SDK
for a stub with the same shapes, mounts every contribution in jsdom and drives
them the way a user would — click a pad, press a number key, add a file, drop a
file, refuse an oversized one, rename, delete, stop-all, Escape, then reload the
plugin and corrupt the stored JSON. 25 assertions.

**`test/picker.mjs`** drives a **real** `<input type="file">` with real `File`
objects in Chromium: one mp3, the same mp3 twice, two at once, a 4 MB file, a
`.txt`, then delete. 8 assertions.

It exists because the jsdom harness could not have caught the bug it now guards.
`input.files` is a **live `FileList`**: the plugin resets `input.value` after a
pick (otherwise the same file cannot be chosen twice), and that reset empties
`input.files`. Reading `event.target.files` straight into a variable therefore
handed `addFile` an empty list, every time — the picker appeared to do nothing at
all. jsdom let the harness assign `files` as a plain static property, so the
suite passed while the shipped plugin was broken. The suite was confirmed to
fail (5 checks, 4 failures) against the unfixed code before the fix was restored.

**`test/preview.mjs`** renders the same plugin in a real Chromium against the
app's theme variables and measures the result: pad count, grid columns, and
whether the header, grid and volume row share one left and one right edge. It
writes `preview-statusbar.png`, `preview-panel.png`, `preview-manage.png` and
`preview-settings.png` to `.build/`. That is what catches a layout that reads
fine in code and wrong on screen — the padding asymmetry and the orphaned grid
cell in this plugin were both found that way, not by reading the CSS.

All three borrow `esbuild`, `jsdom`, `react`, `react-dom` and `playwright-core`
from an installed Hermes (`HERMES_DEPS_ROOT` points elsewhere if needed),
precisely because the plugin itself declares no dependencies and this repository
has no `node_modules`.

Passing these proves the plugin evaluates, registers, renders, persists, lays
out, and handles a real file pick. They do not replace looking at it: a status
bar chip is 15 CSS px tall, and the final judgement of a popover is still the
eye.

## License

MIT
