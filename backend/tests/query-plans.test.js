// Query plans of the five most-used reads (bench/sde1-baseline.md): every MongoDB command each endpoint sends is captured
// with the profiler, explained, and checked on its winning plan's stages, never on timing. A few hundred documents per
// collection, in two orgs, so the planner's choice is the one it makes on real data.
import mongoose from 'mongoose'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import Activity from '../src/models/Activity.js'
import { Company, Contact, Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import { ActivityLog, Log } from '../src/models/Logs.js'
import Organization from '../src/models/Organization.js'
import User from '../src/models/User.js'
import { bearer, seedOrg } from './helpers.js'

const api = '/api/v1'
const STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted']
const STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost']
const NAMES = ['Sharma', 'Patel', 'Iyer', 'Nair', 'Reddy', 'Gupta', 'Mehta', 'Joshi']
let ctx

async function seedRecords({ org, users }, leads, deals) {
  const orgId = org._id
  const owners = Object.values(users).map((u) => u._id)
  const day = 86_400_000
  const companies = await Company.insertMany(
    Array.from({ length: 30 }, (_, i) => ({ orgId, name: `Co ${i}`, ownerId: owners[i % owners.length] })),
  )
  await Lead.insertMany(
    Array.from({ length: leads }, (_, i) => ({
      orgId,
      name: `Lead ${NAMES[i % NAMES.length]} ${i}`,
      email: `lead${i}@plans.example`,
      status: STATUSES[i % STATUSES.length],
      score: i % 101,
      ownerId: owners[i % owners.length],
      companyId: companies[i % companies.length]._id,
      createdAt: new Date(Date.UTC(2026, 0, 1) + (i % 97) * day),
    })),
  )
  await Deal.insertMany(
    Array.from({ length: deals }, (_, i) => {
      const stageKey = STAGES[i % STAGES.length]
      const closed = stageKey === 'won' || stageKey === 'lost'
      return {
        orgId,
        title: `Deal ${i}`,
        value: 1000 * (1 + (i % 50)),
        stageKey,
        status: closed ? stageKey : 'open',
        ...(closed ? { closedAt: new Date(Date.UTC(2026, 3, 1) + (i % 60) * day) } : {}),
        ownerId: owners[i % owners.length],
        companyId: companies[i % companies.length]._id,
        createdAt: new Date(Date.UTC(2026, 0, 1) + (i % 89) * day),
      }
    }),
  )
  await ActivityLog.insertMany(
    Array.from({ length: 200 }, (_, i) => ({
      orgId,
      userId: owners[i % owners.length],
      action: 'update',
      entityType: 'lead',
      message: `Updated lead ${i}`,
    })),
  )
}

beforeAll(async () => {
  ctx = await seedOrg('Plans')
  await seedRecords(ctx, 600, 300)
  await seedRecords(await seedOrg('Neighbour'), 300, 150)
  // The planner can only choose indexes that exist: build every model's now, not in the background.
  for (const model of [Organization, User, Company, Contact, Lead, Deal, Activity, Log]) await model.syncIndexes()
})

/** A plan tree as one line, outermost stage first: "LIMIT > FETCH > IXSCAN {orgId_1_status_1}". */
function stages(plan) {
  const out = []
  for (let node = plan; node; node = node.inputStage) {
    out.push(`${node.stage}${node.indexName ? ` {${node.indexName}}` : ''}`)
    if (node.inputStages) out.push(`[${node.inputStages.map(stages).join(' | ')}]`)
  }
  return out.join(' > ')
}

const KEYS = ['find', 'filter', 'sort', 'skip', 'limit', 'projection', 'aggregate', 'pipeline']

/** Every find and aggregate one GET sends, explained: [{ collection, kind, plan, docsExamined, returned }]. */
async function plansFor(path) {
  const db = mongoose.connection.db
  await db.command({ profile: 0 })
  await db
    .collection('system.profile')
    .drop()
    .catch(() => {})
  await db.command({ profile: 2 })
  const res = await request(app).get(`${api}${path}`).set(bearer(ctx.tokens.owner))
  await db.command({ profile: 0 })
  expect(res.status, JSON.stringify(res.body.error)).toBe(200)

  const entries = await db
    .collection('system.profile')
    .find({ op: { $in: ['query', 'command'] }, ns: { $not: /\.system\./ } })
    .toArray()
  const plans = []
  for (const { command } of entries) {
    if (!command.find && !command.aggregate) continue
    const plain = Object.fromEntries(KEYS.filter((k) => k in command).map((k) => [k, command[k]]))
    if (plain.aggregate) plain.cursor = {}
    const explain = await db.command({ explain: plain, verbosity: 'executionStats' })
    const cursor = explain.stages?.[0]?.$cursor ?? explain
    const winning = cursor.queryPlanner.winningPlan
    plans.push({
      collection: plain.find ?? plain.aggregate,
      kind: plain.find ? 'find' : 'aggregate',
      plan: stages(winning.queryPlan ?? winning),
      docsExamined: cursor.executionStats.totalDocsExamined,
      returned: cursor.executionStats.nReturned,
    })
  }
  return plans
}

const onlyOn = (plans, collection) => plans.filter((p) => p.collection === collection)
// A blocking SORT stage means every match is read and sorted in memory. SORT_MERGE (a merge of sorted scans) is fine.
const sortsInMemory = (plan) => /(^|> )SORT( |$)/.test(plan)

const LISTS = [
  ['lead list, default sort', '/leads?limit=20', 'leads'],
  ['lead list, status filter', '/leads?limit=20&status=qualified', 'leads'],
  ['deal list', '/deals?limit=20&sort=-createdAt', 'deals'],
]

describe('query plans of the five most-used reads', () => {
  it.each(LISTS)(
    '%s: an index scan in sort order that reads only the page, no in-memory sort',
    async (_, path, coll) => {
      const plans = await plansFor(path)
      for (const { plan } of plans) expect(plan).not.toContain('COLLSCAN')
      const [list, ...others] = onlyOn(plans, coll)
      expect(others, 'one query on the list collection: no count of every match').toEqual([])
      expect(list.plan).toContain('IXSCAN')
      expect(sortsInMemory(list.plan), list.plan).toBe(false)
      expect(list.docsExamined, list.plan).toBeLessThanOrEqual(21) // the page, plus one to know there is more
    },
  )

  it.each(LISTS)(
    '%s, page 2 (after a cursor): starts at the cursor, reads the page plus its ties',
    async (_, path, coll) => {
      const first = await request(app).get(`${api}${path}`).set(bearer(ctx.tokens.owner))
      const plans = await plansFor(`${path}&cursor=${first.body.meta.nextCursor}`)
      const [list, ...others] = onlyOn(plans, coll)
      expect(others).toEqual([])
      expect(list.plan).not.toContain('COLLSCAN')
      expect(sortsInMemory(list.plan), list.plan).toBe(false)
      // The scan starts at the cursor's sort value, so page 1's rows tied with it are read again and dropped by the _id
      // tie-break; nothing before them is. (Skip/limit would read all of page 1, and page n would read n pages.)
      const model = coll === 'leads' ? Lead : Deal
      const last = first.body.data.at(-1)
      const ties = await model.countDocuments({
        orgId: ctx.org._id,
        createdAt: last.createdAt,
        _id: { $gte: last._id },
      })
      expect(list.docsExamined, list.plan).toBeLessThanOrEqual(21 + ties)
    },
  )

  it('lead search: the org-prefixed text index (only this org’s leads are examined), no collection scan', async () => {
    const plans = await plansFor('/leads?limit=20&q=sharma')
    for (const { plan } of plans) expect(plan).not.toContain('COLLSCAN')
    const [search, ...others] = onlyOn(plans, 'leads')
    expect(others).toEqual([])
    expect(search.plan).toContain('TEXT_MATCH {orgId_1_name_text_email_text}')
  })

  it('the search palette: contacts and companies use their org-prefixed text indexes too', async () => {
    const plans = await plansFor('/search?q=sharma')
    for (const { plan } of plans) expect(plan).not.toContain('COLLSCAN')
    expect(onlyOn(plans, 'leads')[0].plan).toContain('{orgId_1_name_text_email_text}')
    expect(onlyOn(plans, 'contacts')[0].plan).toContain('{orgId_1_name_text_email_text}')
    expect(onlyOn(plans, 'companies')[0].plan).toContain('{orgId_1_name_text}')
  })

  it('dashboard overview: no collection scans; the deal sums and lead counts read only the index', async () => {
    const plans = await plansFor('/dashboard/overview')
    for (const { plan } of plans) expect(plan).not.toContain('COLLSCAN')
    const aggregates = [...onlyOn(plans, 'deals'), ...onlyOn(plans, 'leads')]
    expect(aggregates.length).toBeGreaterThan(0)
    for (const { plan, docsExamined } of aggregates) {
      expect(docsExamined, plan).toBe(0) // covered: answered from the index alone
    }
  })

  it('dashboard overview: lead counts are one bounded COUNT_SCAN per status, not a walk over every lead', async () => {
    const plans = onlyOn(await plansFor('/dashboard/overview'), 'leads')
    expect(plans.length).toBeGreaterThan(0)
    for (const { plan } of plans) expect(plan).toMatch(/COUNT_SCAN \{orgId_1_status_1/)
  })
})
