// Fails if any JS file in a type-checked folder is missing its `// @ts-check` first line.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHECKED_FOLDERS } from './checked-folders.js'

const root = fileURLToPath(new URL('..', import.meta.url))

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* jsFiles(path)
    else if (name.endsWith('.js')) yield path
  }
}

const missing = CHECKED_FOLDERS.flatMap((folder) =>
  [...jsFiles(join(root, folder))].filter((file) => !readFileSync(file, 'utf8').startsWith('// @ts-check')),
)

if (missing.length) {
  console.error('These files are in a type-checked folder but lack a `// @ts-check` first line:')
  for (const file of missing) console.error(`  ${relative(root, file)}`)
  process.exit(1)
}
console.log(`@ts-check present in every file of: ${CHECKED_FOLDERS.join(', ')}`)
