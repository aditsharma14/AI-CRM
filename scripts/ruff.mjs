// Runs ruff from AI/.venv, so hooks and scripts use the version pinned in AI/requirements-dev.txt.
// Usage: node scripts/ruff.mjs <ruff args...>
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const venv = fileURLToPath(new URL('../AI/.venv/', import.meta.url))
const ruff = [`${venv}Scripts/ruff.exe`, `${venv}bin/ruff`].find((path) => existsSync(path))

if (!ruff) {
  console.error(
    'ruff not found in AI/.venv. Install it with: AI/.venv python -m pip install -r AI/requirements-dev.txt',
  )
  process.exit(1)
}

const { status } = spawnSync(ruff, process.argv.slice(2), { stdio: 'inherit' })
process.exit(status ?? 1)
