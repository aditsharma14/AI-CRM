#!/usr/bin/env node
// Queue latency of the AI lead brief: how long a job waits from POST (createdAt) until a worker claims it (startedAt),
// and until it is done (finishedAt). Everything real and local: the API (src/server.js) and WORKERS worker processes
// (src/worker.js, compose's poll interval) on a throwaway in-memory replica set, the AI service on the fake provider
// (scripts/ai-serve.mjs). JOBS briefs are requested at a steady RATE per second, spread over enough orgs to stay
// under the 20-per-org-per-hour limit. Writes bench/results/<label>.json and prints one Markdown table row.
//   WORKERS=1 JOBS=200 RATE=4 node scripts/bench/ai-queue.mjs s2-1-ai-queue-1w
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const backend = createRequire(new URL('../../backend/package.json', import.meta.url))
const { MongoMemoryReplSet } = backend('mongodb-memory-server')
const mongoose = backend('mongoose')

const label = process.argv[2]
if (!/^[\w-]+$/.test(label ?? '')) {
  console.error('usage: WORKERS=1 JOBS=200 RATE=4 node scripts/bench/ai-queue.mjs <label>')
  process.exit(2)
}
const WORKERS = Number(process.env.WORKERS ?? 1)
const JOBS = Number(process.env.JOBS ?? 200)
const RATE = Number(process.env.RATE ?? 4)
const PER_ORG = 20 // the org limit per hour
const API_PORT = 5098
const AI_PORT = 5097
const API = `http://localhost:${API_PORT}/api/v1`
const TOKEN = randomBytes(16).toString('hex')

const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
const uri = mongod.getUri('nimbus-ai-queue')
const env = {
  ...process.env,
  NODE_ENV: 'production',
  MONGO_URI: uri,
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  CLIENT_ORIGIN: 'http://localhost:5173',
  RATE_LIMIT_MAX: '1000000000',
  LOG_LEVEL: 'silent',
  AI_ENABLED: 'true',
  AI_SERVICE_URL: `http://127.0.0.1:${AI_PORT}`,
  AI_INTERNAL_TOKEN: TOKEN,
}
const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url))
const children = [
  spawn(process.execPath, [fileURLToPath(new URL('../ai-serve.mjs', import.meta.url))], {
    env: { ...process.env, AI_PORT: String(AI_PORT), AI_INTERNAL_TOKEN: TOKEN, AI_PROVIDER: 'fake' },
    stdio: ['ignore', 'ignore', 'inherit'],
  }),
  spawn(process.execPath, ['src/server.js'], {
    cwd: backendDir,
    env: { ...env, PORT: String(API_PORT) },
    stdio: 'ignore',
  }),
  ...Array.from({ length: WORKERS }, () =>
    spawn(process.execPath, ['src/worker.js'], { cwd: backendDir, env, stdio: ['ignore', 'ignore', 'inherit'] }),
  ),
]
const stop = async () => {
  for (const child of children) child.kill()
  await mongoose.disconnect()
  await mongod.stop()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(url) {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not listening yet
    }
    await sleep(200)
  }
  throw new Error(`ai-queue: ${url} did not come up`)
}
const call = async (method, path, token, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

try {
  await Promise.all([waitFor(`http://127.0.0.1:${AI_PORT}/health`), waitFor(`http://localhost:${API_PORT}/health`)])

  // Orgs and leads first, so the timed part is only the briefs.
  const leads = []
  for (let o = 0; o < Math.ceil(JOBS / PER_ORG); o++) {
    const reg = await call('POST', '/auth/register-org', null, {
      orgName: `Queue Org ${o}`,
      name: 'Owner',
      email: `owner${o}@queue.bench`,
      password: randomBytes(12).toString('base64url'),
    })
    const token = reg.body.data.accessToken
    for (let l = 0; l < PER_ORG && leads.length < JOBS; l++) {
      const lead = await call('POST', '/leads', token, { name: `Lead ${o}-${l}` })
      leads.push({ id: lead.body.data._id, token })
    }
  }

  // Warm-up: one brief through the whole path (connections, the AI service's first answer), not counted.
  const warm = leads.pop()
  const warmJob = await call('POST', `/ai/leads/${warm.id}/brief`, warm.token, {})
  for (let state = 'queued'; state !== 'done'; await sleep(100)) {
    state = (await call('GET', `/ai/jobs/${warmJob.body.data.jobId}`, warm.token)).body.data.state
    if (state === 'failed') throw new Error('ai-queue: the warm-up job failed')
  }

  const jobIds = []
  const t0 = Date.now()
  for (const [i, lead] of leads.entries()) {
    await sleep(Math.max(0, t0 + (i * 1000) / RATE - Date.now()))
    const res = await call('POST', `/ai/leads/${lead.id}/brief`, lead.token, {})
    if (res.status !== 202) throw new Error(`ai-queue: POST answered ${res.status} ${JSON.stringify(res.body.error)}`)
    jobIds.push(res.body.data.jobId)
  }

  await mongoose.connect(uri)
  const jobs = mongoose.connection.collection('aijobs')
  const ids = jobIds.map((id) => new mongoose.Types.ObjectId(id))
  for (let i = 0; i < 600; i++) {
    if ((await jobs.countDocuments({ _id: { $in: ids }, state: { $in: ['done', 'failed'] } })) === ids.length) break
    await sleep(100)
  }
  const docs = await jobs.find({ _id: { $in: ids } }).toArray()
  const failed = docs.filter((d) => d.state !== 'done').length
  const pct = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
  }
  const queue = docs.map((d) => d.startedAt - d.createdAt)
  const total = docs.filter((d) => d.finishedAt).map((d) => d.finishedAt - d.createdAt)
  const result = {
    label,
    date: new Date().toISOString(),
    machine: {
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      os: `${os.type()} ${os.release()}`,
      node: process.version,
    },
    settings: { workers: WORKERS, jobs: docs.length, ratePerSecond: RATE, pollMs: 500, provider: 'fake' },
    failed,
    queueMs: { p50: pct(queue, 50), p95: pct(queue, 95), max: Math.max(...queue) },
    enqueueToDoneMs: { p50: pct(total, 50), p95: pct(total, 95), max: Math.max(...total) },
  }
  mkdirSync(new URL('../../bench/results/', import.meta.url), { recursive: true })
  writeFileSync(new URL(`../../bench/results/${label}.json`, import.meta.url), `${JSON.stringify(result, null, 2)}\n`)
  console.log('| workers | jobs | rate/s | failed | queue p50 / p95 / max ms | enqueue to done p50 / p95 / max ms |')
  console.log('|---|---|---|---|---|---|')
  console.log(
    `| ${WORKERS} | ${docs.length} | ${RATE} | ${failed} | ${result.queueMs.p50} / ${result.queueMs.p95} / ${result.queueMs.max} | ${result.enqueueToDoneMs.p50} / ${result.enqueueToDoneMs.p95} / ${result.enqueueToDoneMs.max} |`,
  )
} finally {
  await stop()
}
