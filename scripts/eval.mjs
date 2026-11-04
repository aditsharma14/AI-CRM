// Runs the lead-brief eval (AI/evals/run.py) with the AI/.venv Python, from the repo root.
// Usage: npm run eval -- --provider ollama [--model qwen3:4b] [--case <id>] [--no-write]
//        npm run eval --provider ollama     (npm keeps --provider for itself; it arrives as npm_config_provider)
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ai = fileURLToPath(new URL('../AI/', import.meta.url))
const python = [`${ai}.venv/Scripts/python.exe`, `${ai}.venv/bin/python`].find((path) => existsSync(path))
if (!python) {
  console.error(
    'No AI/.venv. Create it: cd AI && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt',
  )
  process.exit(1)
}

const args = process.argv.slice(2)
const fromNpm = process.env.npm_config_provider
if (!args.includes('--provider') && fromNpm && fromNpm !== 'true') args.unshift('--provider', fromNpm)
// `npm run eval --provider ollama` leaves "ollama" as a bare argument.
if (!args.includes('--provider') && ['fake', 'ollama'].includes(args[0])) args.unshift('--provider')

const { status } = spawnSync(python, ['-m', 'evals.run', ...args], { cwd: ai, stdio: 'inherit' })
process.exit(status ?? 1)
