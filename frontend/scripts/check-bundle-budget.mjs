#!/usr/bin/env node
// Fails if a normal production build's JavaScript grew past bundle-budget.json: the entry chunk, and all initial JS (the
// entry plus every chunk it imports statically, i.e. what loads before the first render). Both, because moving code out
// of the entry into an eagerly imported chunk would pass an entry-only budget without loading any less.
// CI runs it after `npm run build`; locally: npm run build && node scripts/check-bundle-budget.mjs [dist]
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const dist = process.argv[2] ?? 'dist'
const manifestFile = join(dist, '.vite', 'manifest.json')
if (!existsSync(manifestFile)) {
  console.error(`check-bundle-budget: no build in ${dist}/ (run npm run build first)`)
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const budget = JSON.parse(readFileSync(new URL('../bundle-budget.json', import.meta.url), 'utf8'))

const [entryKey] = Object.entries(manifest).find(([, chunk]) => chunk.isEntry) ?? []
if (!entryKey) throw new Error('check-bundle-budget: the manifest has no entry chunk')

/** The entry and everything it imports statically (dynamic imports are lazy and don't count). */
const initial = new Set()
const walk = (key) => {
  if (initial.has(key)) return
  initial.add(key)
  for (const imported of manifest[key].imports ?? []) walk(imported)
}
walk(entryKey)

const size = (keys) =>
  [...keys].reduce(
    (total, key) => {
      const bytes = readFileSync(join(dist, manifest[key].file))
      return { raw: total.raw + bytes.length / 1024, gzip: total.gzip + gzipSync(bytes).length / 1024 }
    },
    { raw: 0, gzip: 0 },
  )

const measured = { entryChunk: size([entryKey]), initialJs: size(initial) }
let over = false
for (const [name, actual] of Object.entries(measured)) {
  for (const kind of ['raw', 'gzip']) {
    const limit = budget[name][kind]
    const ok = actual[kind] <= limit
    over ||= !ok
    console.log(`${ok ? 'ok  ' : 'OVER'} ${name} ${kind}: ${actual[kind].toFixed(1)} kB (budget ${limit} kB)`)
  }
}
if (over) {
  console.error(
    'check-bundle-budget: over budget. Lazy-load what the first render does not need, or raise the budget in bundle-budget.json with the reason.',
  )
  process.exit(1)
}
