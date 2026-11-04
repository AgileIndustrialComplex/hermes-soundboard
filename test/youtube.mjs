// Unit-test the YouTube plumbing in isolation: URL parsing and the detached
// command string. These are the parts that fail silently in the app (a bad
// regex makes the button do nothing), so they get real cases.
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = 'C:/Users/user/hermes-soundboard'
const src = fs.readFileSync(path.join(root, 'plugin.js'), 'utf8')

// Pull the pure helpers out of the module source and evaluate them alone —
// the module itself imports the SDK and cannot run under plain Node.
function grab(name, endMarker) {
  const start = src.indexOf(name)
  if (start < 0) throw new Error(`${name} not found`)
  const end = src.indexOf(endMarker, start)
  return src.slice(start, end)
}

const chunk = [
  grab('function parseYoutube', '\nclass ImportError'),
  grab('function jobScript', '\nasync function waitForStatus'),
  // The extracted slice references the platform helper; the unit test is about
  // the Windows shape, so it says so.
  'const IS_WINDOWS = true\nconst windowsHost = () => true\n'
].join('\n')

const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(chunk + '\nexport { parseYoutube, jobScript, detachedCommand }').toString('base64')
)

let pass = 0
let fail = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`PASS  ${name}`)
    pass++
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`)
    fail++
  }
}
const eq = (a, b, label = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label} got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
}

const { parseYoutube, jobScript, detachedCommand } = mod

check('a bare 11-char id is accepted', () => eq(parseYoutube('jNQXAC9IVRw'), 'jNQXAC9IVRw'))
check('a watch URL is parsed', () => eq(parseYoutube('https://www.youtube.com/watch?v=jNQXAC9IVRw'), 'jNQXAC9IVRw'))
check('a watch URL with extra params is parsed', () =>
  eq(parseYoutube('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=42s&list=PLx'), 'jNQXAC9IVRw'))
check('a youtu.be short link is parsed', () => eq(parseYoutube('https://youtu.be/jNQXAC9IVRw'), 'jNQXAC9IVRw'))
check('a youtu.be link with a query is parsed', () => eq(parseYoutube('https://youtu.be/jNQXAC9IVRw?t=10'), 'jNQXAC9IVRw'))
check('a /shorts/ link is parsed', () => eq(parseYoutube('https://youtube.com/shorts/jNQXAC9IVRw'), 'jNQXAC9IVRw'))
check('an /embed/ link is parsed', () => eq(parseYoutube('https://www.youtube.com/embed/jNQXAC9IVRw'), 'jNQXAC9IVRw'))
check('a /live/ link is parsed', () => eq(parseYoutube('https://www.youtube.com/live/jNQXAC9IVRw'), 'jNQXAC9IVRw'))
check('music.youtube.com is parsed', () => eq(parseYoutube('https://music.youtube.com/watch?v=jNQXAC9IVRw'), 'jNQXAC9IVRw'))
check('m.youtube.com is parsed', () => eq(parseYoutube('https://m.youtube.com/watch?v=jNQXAC9IVRw'), 'jNQXAC9IVRw'))
check('a scheme-less URL is parsed', () => eq(parseYoutube('youtube.com/watch?v=jNQXAC9IVRw'), 'jNQXAC9IVRw'))
check('a trimmed URL with whitespace is parsed', () => eq(parseYoutube('  https://youtu.be/jNQXAC9IVRw  '), 'jNQXAC9IVRw'))

check('an unrelated host is refused', () => eq(parseYoutube('https://vimeo.com/12345'), null))
check('a lookalike host is refused', () => eq(parseYoutube('https://notyoutube.com/watch?v=jNQXAC9IVRw'), null))
check('an empty string is refused', () => eq(parseYoutube(''), null))
check('null is refused', () => eq(parseYoutube(null), null))
check('a watch URL without v is refused', () => eq(parseYoutube('https://www.youtube.com/watch'), null))
check('a too-short id is refused', () => eq(parseYoutube('https://youtu.be/abc'), null))
check('an over-long id is refused', () => eq(parseYoutube('https://youtu.be/jNQXAC9IVRwXXXX'), null))
check('a channel URL is refused', () => eq(parseYoutube('https://www.youtube.com/@someone'), null))

// ── the job script ──────────────────────────────────────────────────────
const D = 'C:\\data dir'
const script = jobScript({
  exe: 'uvx yt-dlp',
  args: ['-x', '--audio-format', 'mp3', '-o', `${D}\\yt-1.%(ext)s`, 'https://www.youtube.com/watch?v=jNQXAC9IVRw'],
  out: D,
  log: `${D}\\.yt-1.log`,
  status: `${D}\\.yt-1.status`,
  mp3: `${D}\\yt-1.mp3`
})

check('the script cds into the data folder first', () => {
  const first = script.split('\r\n').find(line => /^cd /.test(line))
  if (first !== `cd /d "${D}"`) throw new Error(first)
})
check('it runs yt-dlp through uvx', () => {
  if (!script.includes('uvx yt-dlp "-x" "--audio-format" "mp3"')) throw new Error(script)
})
check('a path containing a space stays quoted', () => {
  if (!script.includes(`"${D}\\yt-1.%%(ext)s"`)) throw new Error(script)
})
check('a percent in the output template is DOUBLED', () => {
  // Unescaped, cmd fails to parse the whole file and reports "File Not Found"
  // without running a line — the bug that made every import fail silently.
  // Every % in a path must be doubled; a lone one is the bug.
  // Scope to the -o argument: batch variables like %ERRORLEVEL% are fine.
  const template = script.match(/"-o" "([^"]+)"/)
  if (!template) throw new Error('no -o argument in the script')
  if (/(?<!%)%(?!%)/.test(template[1])) throw new Error(`unescaped % in the output template: ${template[1]}`)
  // ...except in %ERRORLEVEL%, which is a real batch variable.
  if (!script.includes('%%(ext)s')) throw new Error(script)
})
check('the log gets both streams', () => {
  const redirect = '> "C:\\data dir\\.yt-1.log" 2>&1'
  if (!script.includes(redirect)) throw new Error(`missing ${redirect} in:\n${script}`)
})
check('success and failure both write the status file', () => {
  if (!/if exist .*yt-1\.mp3.*echo ok>/.test(script)) throw new Error('no ok branch')
  if (!/else \(echo fail>/.test(script)) throw new Error('no fail branch')
})
check('the script has CRLF line endings (cmd needs them)', () => {
  if (/[^\r]\n/.test(script)) throw new Error('bare LF found')
})
check('an argument containing a quote cannot break out', () => {
  const evil = jobScript({ exe: 'uvx yt-dlp', args: ['-o', 'x" & shutdown /s & "'], out: D, log: 'l', status: 's', mp3: 'm' })
  if (evil.includes('"x" & shutdown')) throw new Error('quote survived')
  if (!evil.includes('"x & shutdown /s & "')) throw new Error(evil)
})

// ── the launch command ──────────────────────────────────────────────────
const launch = detachedCommand(`${D}\\.yt-1.cmd`)
check('the launch is a single detached start', () => {
  if (launch !== `start "" /b "${D}\\.yt-1.cmd"`) throw new Error(launch)
})
check('the launch passes NO arguments', () => {
  // `start /b cmd /c "script.cmd" "arg"` drops every argument (verified here:
  // four forms arrived with none), so a script that needed one would silently
  // run with a bad path. The script bakes its paths in for exactly this reason.
  const after = launch.replace(`start "" /b "${D}\\.yt-1.cmd"`, '')
  if (after.trim()) throw new Error(`extra tokens: ${after}`)
})

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail) process.exitCode = 1
