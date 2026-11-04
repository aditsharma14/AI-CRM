// Starts the AI service (AI/, uvicorn) for e2e: the fake provider unless AI_PROVIDER says otherwise. Uses AI/.venv's
// Python when it exists (local), else `python` on PATH (CI installs AI/requirements.txt into it).
//   AI_PORT=5057 AI_INTERNAL_TOKEN=... node scripts/ai-serve.mjs
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ai = fileURLToPath(new URL('../AI/', import.meta.url))
const venv = [`${ai}.venv/Scripts/python.exe`, `${ai}.venv/bin/python`].find((path) => existsSync(path))
const python = venv ?? 'python'
const port = process.env.AI_PORT ?? '8000'

const child = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', port], {
  cwd: ai,
  stdio: 'inherit',
  env: { ...process.env, AI_PROVIDER: process.env.AI_PROVIDER ?? 'fake' },
})
// Playwright stops this script at the end of a run; take uvicorn down with it.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => process.exit(code ?? 0))
