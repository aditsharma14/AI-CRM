#!/usr/bin/env node
// Bundle sizes from a build: every JS chunk (raw and gzip) with what loads first marked, and the biggest packages.
//   ANALYZE=1 npm run build && node scripts/bundle-report.mjs     (per-package sizes need ANALYZE=1's dist/stats.json)
// Output is Markdown, for bench/frontend.md.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const dist = process.argv[2] ?? 'dist'
const kb = (bytes) => (bytes / 1024).toFixed(1)
const html = readFileSync(join(dist, 'index.html'), 'utf8')
// What index.html loads before anything renders: its module script and the modulepreloads.
const initial = new Set([...html.matchAll(/(?:src|href)="[^"]*?(assets\/[^"]+\.js)"/g)].map((m) => m[1]))

const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'))
const chunks = Object.values(manifest)
  .filter((c) => c.file.endsWith('.js'))
  .map((c) => {
    const bytes = readFileSync(join(dist, c.file))
    return {
      file: c.file,
      name: c.name ?? c.src,
      raw: bytes.length,
      gzip: gzipSync(bytes).length,
      initial: initial.has(c.file),
    }
  })
  .sort((a, b) => b.raw - a.raw)
const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0)
const first = chunks.filter((c) => c.initial)

console.log(`Total JS: ${kb(sum(chunks, 'raw'))} kB (${kb(sum(chunks, 'gzip'))} kB gzip) in ${chunks.length} chunks`)
console.log(
  `Initial JS (index.html's script and preloads): ${kb(sum(first, 'raw'))} kB (${kb(sum(first, 'gzip'))} kB gzip)\n`,
)
console.log('| Chunk | kB | gzip kB | Loads first |')
console.log('|---|---|---|---|')
for (const c of chunks.slice(0, 15))
  console.log(`| ${c.name} | ${kb(c.raw)} | ${kb(c.gzip)} | ${c.initial ? 'yes' : ''} |`)

const stats = join(dist, 'stats.json')
if (existsSync(stats)) {
  const { nodeParts, nodeMetas } = JSON.parse(readFileSync(stats, 'utf8'))
  const byPackage = new Map()
  for (const meta of Object.values(nodeMetas)) {
    const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(meta.id)?.[1] ?? 'app code (src/)'
    for (const uid of Object.values(meta.moduleParts)) {
      const part = nodeParts[uid]
      const row = byPackage.get(pkg) ?? { rendered: 0, gzip: 0 }
      row.rendered += part.renderedLength
      row.gzip += part.gzipLength
      byPackage.set(pkg, row)
    }
  }
  console.log('\n| Package | kB (minified) | gzip kB |')
  console.log('|---|---|---|')
  for (const [pkg, r] of [...byPackage].sort((a, b) => b[1].rendered - a[1].rendered).slice(0, 12)) {
    console.log(`| ${pkg} | ${kb(r.rendered)} | ${kb(r.gzip)} |`)
  }
}
