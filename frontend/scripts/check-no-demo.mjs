#!/usr/bin/env node
// Fails if a normal build (frontend/dist) contains any part of the GitHub Pages demo: MSW, its worker, the 404.html
// fallback and per-route copies, the seed data or the demo handlers. CI runs it after `npm run build`; locally:
//   npm run build && node scripts/check-no-demo.mjs        (or point it at another folder: ... dist-other)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { STATIC_ROUTES } from './pages-routes.mjs'

const dir = process.argv[2] ?? 'dist'
if (!existsSync(join(dir, 'index.html'))) {
  console.error(`check-no-demo: no build in ${dir}/ (run npm run build first)`)
  process.exit(2)
}

// Files only the demo build emits, and strings only the demo's code contains.
const FILES = ['mockServiceWorker.js', '404.html', ...STATIC_ROUTES.map((route) => `${route}.html`)]
const MARKERS = [
  'mockServiceWorker', // the worker's URL in start.js
  'NOT_AVAILABLE_IN_DEMO', // handlers.js
  'Kaveri Office Solutions', // seed.js
  'Demo mode: data stays in your browser', // DemoUi.jsx
  'MSW_INTERCEPTORS_REGISTRY', // msw's interceptor registry key
]

const files = (root) =>
  readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })

const problems = []
for (const name of FILES) if (existsSync(join(dir, name))) problems.push(`${name} is in the build`)
for (const path of files(dir)) {
  if (!/\.(js|html|css)$/.test(path)) continue
  const text = readFileSync(path, 'utf8')
  for (const marker of MARKERS) if (text.includes(marker)) problems.push(`${relative(dir, path)} contains "${marker}"`)
}

if (problems.length) {
  console.error(`check-no-demo: the demo leaked into ${dir}/:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-no-demo: ${dir}/ has no demo code (${FILES.length} files, ${MARKERS.length} markers checked)`)
