// Dev-only: boots the API against a throwaway in-memory MongoDB for Playwright (frontend/e2e), and a lead-brief worker
// as its own process on the same database, as compose runs it. Never used in production.
import { spawn } from 'node:child_process'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

import { MongoMemoryReplSet } from 'mongodb-memory-server'

// This script plants auth tokens on request (the control port below); refuse outright where that could ever matter.
if (process.env.NODE_ENV === 'production') {
  console.error('e2e-server.js refuses to start with NODE_ENV=production.')
  process.exit(1)
}

// A one-node replica set: lead conversion uses a transaction, which standalone MongoDB can't run.
const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })

// Set before config/index.js loads; dotenv never overrides a var that's
// already set, so a developer's backend/.env can't point e2e at real data.
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: process.env.E2E_API_PORT ?? '5055',
  MONGO_URI: mongod.getUri('nimbus-e2e'),
  JWT_ACCESS_SECRET: 'e2e-access-secret',
  CLIENT_ORIGIN: process.env.E2E_CLIENT_ORIGIN ?? 'http://localhost:5175',
  RATE_LIMIT_MAX: '1000000',
  // The reset spec walks Forgot password, which the UI offers only with email on. (Email off: frontend unit tests.)
  EMAIL_ENABLED: 'true',
  // The AI lead brief against the AI service Playwright starts (scripts/ai-serve.mjs, fake provider).
  AI_ENABLED: 'true',
  AI_SERVICE_URL: `http://127.0.0.1:${process.env.E2E_AI_PORT ?? '5057'}`,
  AI_INTERNAL_TOKEN: process.env.E2E_AI_TOKEN ?? 'e2e-internal-token-0123456789',
  AI_TIMEOUT_MS: '15000',
  // A queued brief is picked up within 100 ms (compose: 500).
  AI_WORKER_POLL_MS: '100',
})

// The worker: a separate process, like compose's `worker` service. Stopped with this script.
let stopping = false
const worker = spawn(process.execPath, ['src/worker.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: process.env,
  stdio: 'inherit',
})
worker.on('exit', (code, signal) => {
  if (!stopping) console.error(`e2e-server.js: the worker exited (${code ?? signal}).`)
})

// Playwright stops this process when the run ends; take mongod down with it.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    stopping = true
    worker.kill()
    await mongod.stop()
    process.exit(0)
  })
}

await import('../src/server.js')

// The control port: lets a spec plant a reset token the way the backend tests do (hash stored, raw token returned,
// via tests/factories.js), so no test ever reads the dev-only reset-link log. It exists only in this script, is not
// part of the app, and listens on loopback only.
//   POST /reset-token { "email": "…" } → 200 { "token": "<raw>" } | 404
const { issueResetToken } = await import('../tests/factories.js')
const { default: User } = await import('../src/models/User.js')

const CONTROL_PORT = Number(process.env.E2E_CONTROL_PORT ?? 5056)

const control = http.createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  try {
    if (req.method !== 'POST' || req.url !== '/reset-token') return reply(404, { error: 'not found' })
    let raw = ''
    for await (const chunk of req) raw += chunk
    const { email } = JSON.parse(raw || '{}')
    const user = await User.findOne({ email })
    if (!user) return reply(404, { error: 'no such user' })
    reply(200, { token: await issueResetToken(user._id) })
  } catch (err) {
    reply(500, { error: String(err) })
  }
})
control.listen(CONTROL_PORT, '127.0.0.1')
