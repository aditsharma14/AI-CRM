#!/usr/bin/env node
// Benchmarks the five most-used read endpoints against the seeded nimbus-bench database (scripts/bench/seed.mjs):
// starts the API on it, signs in as the big org's owner, then for each endpoint
//   1. captures the exact MongoDB commands the request sends (the profiler) and runs explain('executionStats') on each;
//   2. one 5 s autocannon warm-up (discarded), then 3 runs of 10 s with 10 connections; reports the median p50, p95 and
//      req/s, and the spread (min-max) across the 3 runs.
// Writes bench/results/<label>.json and prints the Markdown tables for bench/sde1-baseline.md.
//   node scripts/bench/run.mjs <label>          e.g. before, after
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'

import { assertBenchUri, BENCH_EMAIL, BENCH_PASSWORD, BENCH_URI, syncIndexes } from './seed.mjs'

const require = createRequire(import.meta.url)
const autocannon = require('autocannon')
const hdr = require('hdr-histogram-js')
const mongoose = createRequire(new URL('../../backend/package.json', import.meta.url))('mongoose')

const label = process.argv[2]
if (!/^[\w-]+$/.test(label ?? '')) {
  console.error('usage: node scripts/bench/run.mjs <label>   (after node scripts/bench/seed.mjs)')
  process.exit(2)
}
assertBenchUri(BENCH_URI)

const PORT = 5099
const API = `http://localhost:${PORT}/api/v1`
const WARMUP_S = 5
const RUN_S = 10
const RUNS = 3
const CONNECTIONS = 10

// The five most-used reads: what the Leads page, the Pipeline page and the Dashboard request on load.
const ENDPOINTS = [
  ['lead list (default sort)', '/leads?limit=20'],
  ['lead list, status filter', '/leads?limit=20&status=qualified'],
  ['lead list, search', '/leads?limit=20&q=sharma'],
  ['deal list', '/deals?limit=20&sort=-createdAt'],
  ['dashboard overview', '/dashboard/overview'],
]

// The database's indexes are made to match the models first: a run measures the code as it is.
await mongoose.connect(BENCH_URI, { autoIndex: false })
await syncIndexes()
const db = mongoose.connection.db

const api = spawn(process.execPath, ['src/server.js'], {
  cwd: new URL('../../backend/', import.meta.url),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    MONGO_URI: BENCH_URI,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), // per run; never written anywhere
    ACCESS_TOKEN_TTL: '2h',
    CLIENT_ORIGIN: 'http://localhost:5173',
    RATE_LIMIT_MAX: '1000000000',
    LOG_LEVEL: 'silent',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
})
const stop = () => api.kill()
process.on('exit', stop)

async function waitForApi() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('bench: the API did not start')
}
await waitForApi()

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: BENCH_EMAIL, password: BENCH_PASSWORD }),
})
const token = (await login.json()).data?.accessToken
if (!token) throw new Error(`bench: sign-in failed (${login.status}); run scripts/bench/seed.mjs first`)
const headers = { authorization: `Bearer ${token}` }

/** A plan tree as one line, outermost stage first: "LIMIT > FETCH > IXSCAN {orgId_1_status_1}". */
function stages(plan) {
  const out = []
  for (let node = plan; node;) {
    const index = node.indexName ? ` {${node.indexName}}` : ''
    out.push(`${node.stage}${index}`)
    if (node.inputStages) {
      out.push(`[${node.inputStages.map(stages).join(' | ')}]`)
      break
    }
    node = node.inputStage
  }
  return out.join(' > ')
}

/** The key lines of one explain: winning plan, keys and documents examined, documents returned, in-memory sort. */
function summarize(command, explain) {
  const cursor = explain.stages?.[0]?.$cursor ?? explain
  const planner = cursor.queryPlanner ?? explain.queryPlanner
  const stats = cursor.executionStats ?? explain.executionStats
  const winning = planner?.winningPlan?.queryPlan ?? planner?.winningPlan
  const plan = stages(winning)
  const kind = command.find ? 'find' : command.aggregate ? 'aggregate' : Object.keys(command)[0]
  return {
    collection: command.find ?? command.aggregate ?? command.count,
    kind,
    plan,
    collscan: plan.includes('COLLSCAN'),
    inMemorySort: /\bSORT\b/.test(plan),
    keysExamined: stats?.totalKeysExamined,
    docsExamined: stats?.totalDocsExamined,
    returned: stats?.nReturned,
    millis: stats?.executionTimeMillis,
  }
}

const COMMAND_KEYS = [
  'find',
  'filter',
  'sort',
  'skip',
  'limit',
  'projection',
  'aggregate',
  'pipeline',
  'count',
  'query',
]

/** The MongoDB commands one request sends, from the profiler, each explained with executionStats. */
async function explainEndpoint(path) {
  await db.command({ profile: 0 })
  await db
    .collection('system.profile')
    .drop()
    .catch(() => {})
  await db.command({ profile: 2 })
  const res = await fetch(`${API}${path}`, { headers })
  if (!res.ok) throw new Error(`bench: GET ${path} -> ${res.status}`)
  await db.command({ profile: 0 })
  const entries = await db
    .collection('system.profile')
    .find({ ns: { $not: /\.system\./ }, op: { $in: ['query', 'command'] } })
    .toArray()
  const explained = []
  for (const { command } of entries) {
    if (!command.find && !command.aggregate) continue
    const plain = Object.fromEntries(COMMAND_KEYS.filter((k) => k in command).map((k) => [k, command[k]]))
    if (plain.aggregate) plain.cursor = {}
    const explain = await db.command({ explain: plain, verbosity: 'executionStats' })
    explained.push(summarize(plain, explain))
  }
  return explained
}

/** One autocannon run: p50, p95 (from the raw latency histogram) and req/s. Any non-2xx response fails the run. */
async function load(path, seconds) {
  const raw = await autocannon({
    url: `${API}${path}`,
    headers,
    connections: CONNECTIONS,
    duration: seconds,
    skipAggregateResult: true,
  })
  if (raw.non2xx || raw.errors || raw.timeouts) {
    throw new Error(`bench: ${path}: ${raw.non2xx} non-2xx, ${raw.errors} errors, ${raw.timeouts} timeouts`)
  }
  const latencies = hdr.decodeFromCompressedBase64(raw.latencies)
  const result = {
    p50: latencies.getValueAtPercentile(50),
    p95: latencies.getValueAtPercentile(95),
    reqPerSec: Math.round(raw.totalCompletedRequests / raw.duration),
  }
  latencies.destroy()
  return result
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const spread = (values) => `${Math.min(...values)}-${Math.max(...values)}`

// Every endpoint is explained before any load: requests still in flight when a load run ends would otherwise land in
// the next endpoint's profile.
const explained = new Map()
for (const [, path] of ENDPOINTS) explained.set(path, await explainEndpoint(path))

const results = []
for (const [name, path] of ENDPOINTS) {
  const queries = explained.get(path)
  await load(path, WARMUP_S)
  const runs = []
  for (let i = 0; i < RUNS; i++) runs.push(await load(path, RUN_S))
  const pick = (key) => runs.map((r) => r[key])
  results.push({
    name,
    path,
    runs,
    p50: median(pick('p50')),
    p95: median(pick('p95')),
    reqPerSec: median(pick('reqPerSec')),
    spread: { p50: spread(pick('p50')), p95: spread(pick('p95')), reqPerSec: spread(pick('reqPerSec')) },
    queries,
  })
  console.error(`${name}: p95 ${results.at(-1).p95} ms`)
}

const machine = {
  cpu: os.cpus()[0].model.trim(),
  threads: os.cpus().length,
  ramGb: Math.round(os.totalmem() / 2 ** 30),
  os: `${os.type()} ${os.release()}`,
  node: process.version,
  mongo: (await db.admin().serverInfo()).version,
}
const method = { warmupSeconds: WARMUP_S, runs: RUNS, runSeconds: RUN_S, connections: CONNECTIONS }
mkdirSync(new URL('../../bench/results/', import.meta.url), { recursive: true })
const file = new URL(`../../bench/results/${label}.json`, import.meta.url)
writeFileSync(file, `${JSON.stringify({ label, date: new Date().toISOString(), machine, method, results }, null, 2)}\n`)

console.log(`| Endpoint | p50 ms | p95 ms | req/s | spread p50 / p95 / req/s (3 runs) |`)
console.log(`|---|---|---|---|---|`)
for (const r of results) {
  console.log(
    `| ${r.name} | ${r.p50} | ${r.p95} | ${r.reqPerSec} | ${r.spread.p50} / ${r.spread.p95} / ${r.spread.reqPerSec} |`,
  )
}
console.log()
for (const r of results) {
  console.log(`**${r.name}** \`GET ${r.path}\``)
  for (const q of r.queries) {
    console.log(
      `- ${q.collection} ${q.kind}: \`${q.plan}\`; keys ${q.keysExamined}, docs ${q.docsExamined}, returned ${q.returned}` +
        `${q.inMemorySort ? ', in-memory sort' : ''}${q.collscan ? ', **COLLSCAN**' : ''} (${q.millis} ms)`,
    )
  }
}
console.error(`saved ${file.pathname}`)

await mongoose.disconnect()
stop()
