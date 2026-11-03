#!/usr/bin/env node
// Lighthouse (mobile preset, the CLI's default) on a URL, 3 runs, the median run by performance score summarized into
// bench/results/lighthouse-<label>.json: score, LCP, TBT, FCP, and the JavaScript transferred.
//   node scripts/bench/lighthouse.mjs <url> <label>     e.g. https://aditsharma14.github.io/AI-CRM/ before
// Needs a Chrome: CHROME_PATH, else Playwright's Chromium (npx playwright install chromium). The script starts that
// Chrome once and Lighthouse connects to it (--port), so Lighthouse never has to kill Chrome (which hangs on Windows);
// Lighthouse still clears the cache and storage before each run.
import { execFileSync, execSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const LIGHTHOUSE = 'lighthouse@12.6.1'
const RUNS = 3
const [url, label] = process.argv.slice(2)
// The url goes into a shell command below: URL characters only.
if (!/^https?:\/\/[\w.:/-]+$/.test(url ?? '') || !/^[\w-]+$/.test(label ?? '')) {
  console.error('usage: node scripts/bench/lighthouse.mjs <url> <label>')
  process.exit(2)
}

function playwrightChromium() {
  const root = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'ms-playwright')
    : join(homedir(), '.cache', 'ms-playwright')
  const builds = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  if (!builds.length) throw new Error('no Chrome: set CHROME_PATH or run npx playwright install chromium')
  const dir = join(root, builds[0])
  const win = join(dir, 'chrome-win64', 'chrome.exe')
  return process.platform === 'win32' ? win : join(dir, 'chrome-linux', 'chrome')
}
const chrome = process.env.CHROME_PATH ?? playwrightChromium()

const out = mkdtempSync(join(tmpdir(), 'lighthouse-'))
const PORT = 9333
const browser = spawn(
  chrome,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(out, 'profile')}`, 'about:blank'],
  { stdio: 'ignore' },
)
const stopBrowser = () => {
  if (process.platform === 'win32')
    // By full path: System32 is not always on PATH (Git Bash).
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), [
      '/pid',
      String(browser.pid),
      '/T',
      '/F',
    ])
  else browser.kill()
}
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break
  } catch {
    if (i > 50) throw new Error('Chrome did not start')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

const runs = []
for (let i = 0; i < RUNS; i++) {
  const file = join(out, `run-${i}.json`)
  // One command string (npx is a .cmd on Windows, which needs a shell); the url was checked above, the path is quoted.
  execSync(`npx -y ${LIGHTHOUSE} ${url} --quiet --output=json "--output-path=${file}" --port=${PORT}`, {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const report = JSON.parse(readFileSync(file, 'utf8'))
  const audit = (id) => report.audits[id]
  const scripts = audit('network-requests').details.items.filter((r) => r.resourceType === 'Script')
  const kb = (bytes) => Math.round(bytes / 102.4) / 10
  runs.push({
    performance: Math.round(report.categories.performance.score * 100),
    lcpMs: Math.round(audit('largest-contentful-paint').numericValue),
    tbtMs: Math.round(audit('total-blocking-time').numericValue),
    fcpMs: Math.round(audit('first-contentful-paint').numericValue),
    jsTransferKb: kb(scripts.reduce((sum, r) => sum + (r.transferSize ?? 0), 0)),
    jsRequests: scripts.length,
    topOpportunities: Object.values(report.audits)
      .filter((a) => a.details?.type === 'opportunity' && (a.numericValue ?? 0) > 0)
      .sort((a, b) => b.numericValue - a.numericValue)
      .slice(0, 4)
      .map((a) => `${a.title} (${a.displayValue ?? ''})`),
    lighthouse: report.lighthouseVersion,
    formFactor: report.configSettings.formFactor,
  })
  console.error(`run ${i + 1}: performance ${runs.at(-1).performance}, LCP ${runs.at(-1).lcpMs} ms`)
}

stopBrowser()

const median = [...runs].sort((a, b) => a.performance - b.performance)[Math.floor(RUNS / 2)]
const summary = { url, label, date: new Date().toISOString(), runs: RUNS, median, all: runs }
mkdirSync(new URL('../../bench/results/', import.meta.url), { recursive: true })
writeFileSync(
  new URL(`../../bench/results/lighthouse-${label}.json`, import.meta.url),
  `${JSON.stringify(summary, null, 2)}\n`,
)
console.log(JSON.stringify(median, null, 2))
