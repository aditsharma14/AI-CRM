// Starts src/worker.js as a real child process against this test file's in-memory MongoDB, for the crash and SIGTERM
// tests: a killed process is the only honest way to test a crash.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

const BACKEND = fileURLToPath(new URL('..', import.meta.url))

/**
 * @param {Record<string, string>} env AI_SERVICE_URL, AI_JOB_LEASE_MS, ...
 * @returns {{ child: import('node:child_process').ChildProcess, exited: Promise<number | null>, output: () => string }}
 */
export function spawnWorker(env) {
  const { host, port, name } = mongoose.connection
  const child = spawn(process.execPath, ['src/worker.js'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      MONGO_URI: `mongodb://${host}:${port}/${name}?directConnection=true`,
      AI_ENABLED: 'true',
      AI_INTERNAL_TOKEN: 'test-ai-internal-token-0123',
      AI_WORKER_POLL_MS: '50',
      LOG_LEVEL: 'silent',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (chunk) => (out += chunk))
  child.stderr.on('data', (chunk) => (out += chunk))
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)))
  return { child, exited, output: () => out }
}

/**
 * Polls until `check` returns something truthy (or throws after `ms`).
 * @template T
 * @param {() => Promise<T>} check
 * @param {number} [ms]
 * @returns {Promise<T>}
 */
export async function waitFor(check, ms = 15_000) {
  const until = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > until) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
