#!/usr/bin/env node
// Deterministic benchmark data for S1.9: one big org (100,000 leads, 10,000 deals, 50,000 activities, 20 users) and 50
// small ones, in a local database that is only ever used for benchmarks. Same input, same documents, same ids.
//   node scripts/bench/seed.mjs [mongodb://localhost:27017/nimbus-bench]
// Then: node scripts/bench/run.mjs. Sign in as bench-owner@bench.example / bench-password (local bench data only).
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../backend/package.json', import.meta.url))
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

export const BENCH_DB = 'nimbus-bench'
export const BENCH_URI = process.argv[2] ?? process.env.BENCH_MONGO_URI ?? `mongodb://localhost:27017/${BENCH_DB}`
export const BENCH_EMAIL = 'bench-owner@bench.example'
export const BENCH_PASSWORD = 'bench-password'

/** Refuses anything but a local database named nimbus-bench: never CI's, never a real one, never the demo. */
export function assertBenchUri(uri) {
  const url = new URL(uri)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'mongodb:' || !local || url.pathname !== `/${BENCH_DB}`) {
    throw new Error(
      `bench: refusing ${url.protocol}//${url.hostname}${url.pathname}; only a local /${BENCH_DB} database`,
    )
  }
}

// The models register on the backend's mongoose; importing them also brings their index definitions.
const models = async () => {
  const { Company, Contact, Lead } = await import('../../backend/src/models/CRM.js')
  const { default: Deal } = await import('../../backend/src/models/Deal.js')
  const { default: Activity } = await import('../../backend/src/models/Activity.js')
  const { ActivityLog, Log } = await import('../../backend/src/models/Logs.js')
  const { default: Organization } = await import('../../backend/src/models/Organization.js')
  const { default: User } = await import('../../backend/src/models/User.js')
  return { Activity, ActivityLog, Company, Contact, Deal, Lead, Log, Organization, User }
}

/** Every collection's indexes made to match the models exactly (extra ones dropped), so a run measures the code. */
export async function syncIndexes() {
  const m = await models()
  for (const model of [m.Organization, m.User, m.Company, m.Contact, m.Lead, m.Deal, m.Activity, m.Log]) {
    await model.syncIndexes()
  }
}

// mulberry32: small, fast, and the same sequence for the same seed on every machine.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = rng(19)
const int = (n) => Math.floor(random() * n)
const pick = (list) => list[int(list.length)]
const weighted = (pairs) => {
  let r = random() * pairs.reduce((sum, [, w]) => sum + w, 0)
  for (const [value, w] of pairs) if ((r -= w) < 0) return value
  return pairs[pairs.length - 1][0]
}

const NOW = Date.UTC(2026, 10, 1) // fixed, so "60 days ago" is the same on every run
const DAY = 86_400_000
const at = (daysAgo) => new Date(NOW - daysAgo * DAY - int(DAY))

// ObjectIds from a counter, timestamped by createdAt like real ones: deterministic, and _id order follows time.
let counter = 0
const oid = (date = new Date(NOW)) =>
  new mongoose.Types.ObjectId(
    Math.floor(date.getTime() / 1000)
      .toString(16)
      .padStart(8, '0') + (++counter).toString(16).padStart(16, '0'),
  )

const FIRST = [
  'Aarav',
  'Priya',
  'Rohan',
  'Ananya',
  'Vikram',
  'Isha',
  'Karan',
  'Meera',
  'Arjun',
  'Diya',
  'Kabir',
  'Nisha',
  'Siddharth',
  'Kavya',
  'Aditya',
  'Pooja',
  'Rahul',
  'Sneha',
  'Varun',
  'Tara',
  'Neha',
  'Manish',
  'Ritu',
  'Amit',
]
const LAST = [
  'Sharma',
  'Patel',
  'Iyer',
  'Nair',
  'Reddy',
  'Gupta',
  'Mehta',
  'Joshi',
  'Rao',
  'Kapoor',
  'Desai',
  'Menon',
  'Chopra',
  'Bose',
  'Kulkarni',
  'Pillai',
  'Verma',
  'Singh',
  'Das',
  'Agarwal',
  'Bhat',
  'Shetty',
  'Malhotra',
  'Saxena',
]
const CO = ['Kaveri', 'Tapti', 'Godavari', 'Narmada', 'Vindhya', 'Sahyadri', 'Nilgiri', 'Aravalli', 'Ganga', 'Krishna']
const CO_KIND = ['Logistics', 'Textiles', 'Pharma', 'Foods', 'Infra', 'Motors', 'Retail', 'Systems', 'Agro', 'Steel']
const SOURCES = ['website', 'referral', 'trade show', 'cold call', 'linkedin', 'partner']
const LEAD_STATUS = [
  ['new', 30],
  ['contacted', 25],
  ['qualified', 20],
  ['unqualified', 15],
  ['converted', 10],
]
const STAGES = [
  ['new', 20],
  ['qualified', 20],
  ['proposal', 15],
  ['negotiation', 10],
  ['won', 20],
  ['lost', 15],
]
const ROLES = ['owner', 'admin', 'admin', 'manager', 'manager', 'manager', 'manager']

const stamp = (date) => ({ createdAt: date, updatedAt: date })

function org(name, n, size) {
  const created = at(800)
  const orgId = oid(created)
  const users = Array.from({ length: size.users }, (_, i) => {
    const first = FIRST[(i + n) % FIRST.length]
    const last = LAST[(i * 7 + n) % LAST.length]
    return {
      _id: oid(created),
      orgId,
      name: `${first} ${last}`,
      email: n === 0 && i === 0 ? BENCH_EMAIL : `user${i}.org${n}@bench.example`,
      role: ROLES[i] ?? 'member',
      isEmailVerified: true,
      refreshTokens: [],
      ...stamp(created),
    }
  })
  const owners = users.map((u) => u._id)
  const companies = Array.from({ length: size.companies }, (_, i) => {
    const date = at(700 - int(100))
    const name = `${pick(CO)} ${pick(CO_KIND)} ${i + 1}`
    return { _id: oid(date), orgId, name, domain: `co${i + 1}.org${n}.example`, ownerId: pick(owners), ...stamp(date) }
  })
  const leads = Array.from({ length: size.leads }, (_, i) => {
    const date = at(int(730))
    const first = pick(FIRST)
    const last = pick(LAST)
    return {
      _id: oid(date),
      orgId,
      name: `${first} ${last}`,
      email: `${first}.${last}.${i}@lead.example`.toLowerCase(),
      phone: `+91 98${String(int(1e8)).padStart(8, '0')}`,
      source: pick(SOURCES),
      status: weighted(LEAD_STATUS),
      score: int(101), // 0..100: plenty of ties, which cursor pagination must handle
      ...(random() < 0.7 && companies.length ? { companyId: pick(companies)._id } : {}),
      ownerId: pick(owners),
      ...stamp(date),
    }
  })
  const deals = Array.from({ length: size.deals }, (_, i) => {
    const date = at(int(365))
    const stageKey = weighted(STAGES)
    const closed = stageKey === 'won' || stageKey === 'lost'
    return {
      _id: oid(date),
      orgId,
      title: `${pick(CO)} ${pick(CO_KIND)}: order ${i + 1}`,
      value: (1 + int(200)) * 5000,
      currency: 'INR',
      stageKey,
      probability: closed ? (stageKey === 'won' ? 100 : 0) : 10 + int(80),
      ...(companies.length ? { companyId: pick(companies)._id } : {}),
      contactIds: [],
      ownerId: pick(owners),
      status: closed ? stageKey : 'open',
      ...(closed ? { closedAt: new Date(date.getTime() + int(60) * DAY) } : {}),
      ...stamp(date),
    }
  })
  const activities = Array.from({ length: size.activities }, (_, i) => {
    const date = at(int(365))
    const type = pick(['task', 'task', 'call', 'meeting', 'event'])
    const timed = type === 'meeting' || type === 'event'
    return {
      _id: oid(date),
      orgId,
      type,
      title: `${type} ${i + 1}`,
      assigneeId: pick(owners),
      linkedTo: { entityType: 'lead', entityId: pick(leads)._id },
      ...(timed ? { startAt: date, endAt: new Date(date.getTime() + 3_600_000), allDay: false } : {}),
      ...(type === 'task'
        ? { dueDate: new Date(date.getTime() + 7 * DAY), priority: pick(['low', 'medium', 'high']) }
        : {}),
      status: random() < 0.6 ? 'done' : 'open',
      ...stamp(date),
    }
  })
  const logs = Array.from({ length: size.logs }, () => {
    const date = at(int(365))
    const lead = pick(leads)
    return {
      _id: oid(date),
      kind: 'activity_log',
      orgId,
      userId: pick(owners),
      action: 'update',
      entityType: 'lead',
      entityId: lead._id,
      message: `Updated lead "${lead.name}"`,
      ...stamp(date),
    }
  })
  return {
    org: { _id: orgId, name, plan: 'pro', currency: 'INR', ...stamp(created) },
    users,
    companies,
    leads,
    deals,
    activities,
    logs,
  }
}

async function insert(model, docs) {
  for (let i = 0; i < docs.length; i += 5000) {
    await model.collection.insertMany(docs.slice(i, i + 5000), { ordered: false })
  }
}

async function main() {
  assertBenchUri(BENCH_URI)
  const started = performance.now()
  await mongoose.connect(BENCH_URI, { autoIndex: false })
  const m = await models()
  await mongoose.connection.dropDatabase()

  const big = { users: 20, companies: 2000, leads: 100_000, deals: 10_000, activities: 50_000, logs: 20_000 }
  const small = { users: 2, companies: 20, leads: 200, deals: 20, activities: 100, logs: 50 }
  const orgs = [
    org('Bench Big Org', 0, big),
    ...Array.from({ length: 50 }, (_, i) => org(`Bench Org ${i + 1}`, i + 1, small)),
  ]

  // One bcrypt hash for every user, with a fixed salt so the users collection is identical on every run too.
  const password = await bcrypt.hash(BENCH_PASSWORD, '$2b$10$benchbenchbenchbenchbe')
  const all = (key) => orgs.flatMap((o) => o[key])
  const timings = []
  const step = async (label, model, docs) => {
    const t = performance.now()
    await insert(model, docs)
    timings.push([label, docs.length, Math.round(performance.now() - t)])
  }
  // The schema's defaults (pipeline stages and the empty arrays), as a real signup would store them.
  const defaults = new m.Organization({ name: 'defaults' }).toObject()
  const { teams, emailTemplates } = defaults
  const pipelineStages = defaults.pipelineStages.map(({ key, label, order }) => ({ key, label, order })) // no random _id
  await step(
    'organizations',
    m.Organization,
    orgs.map((o) => ({ ...o.org, pipelineStages, teams, emailTemplates })),
  )
  await step(
    'users',
    m.User,
    all('users').map((u) => ({ ...u, password })),
  )
  await step('companies', m.Company, all('companies'))
  await step('leads', m.Lead, all('leads'))
  await step('deals', m.Deal, all('deals'))
  await step('activities', m.Activity, all('activities'))
  await step('audit logs', m.Log, all('logs'))

  const t = performance.now()
  await syncIndexes()
  timings.push(['indexes (from the models)', null, Math.round(performance.now() - t)])

  for (const [label, n, ms] of timings)
    console.log(`${label.padEnd(28)} ${n === null ? '' : String(n).padStart(7)}  ${ms} ms`)
  console.log(`seeded ${BENCH_URI} in ${((performance.now() - started) / 1000).toFixed(1)} s`)
  await mongoose.disconnect()
}

// Run directly (not when run.mjs imports the helpers above).
if (process.argv[1]?.endsWith('seed.mjs')) {
  await main()
}
