// Dashboards and search against a fixture with known numbers, plus a second org that must never leak in.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import { Company, Contact, Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import { ActivityLog } from '../src/models/Logs.js'
import { bearer, seedOrg } from './helpers.js'

let a
let b

/**
 * Org A's numbers, worked out by hand:
 *   leads:  new ×2, contacted ×1, converted ×1
 *   deals:  open  new 100 + new 50 + proposal 300            -> open pipeline 450
 *           won   1000 (Jan 2026) + 500 (Feb 2026), lost 200 (Feb 2026) -> win rate 2/3
 */
const lead = (org, owner, name, status) => Lead.create({ orgId: org._id, ownerId: owner._id, name, status })
const deal = (org, owner, title, value, stageKey, status = 'open', closedAt) =>
  Deal.create({ orgId: org._id, ownerId: owner._id, title, value, stageKey, status, closedAt })

beforeAll(async () => {
  // Search uses $text, which needs the text indexes to actually exist.
  await Promise.all([Lead.init(), Contact.init(), Company.init()])

  a = await seedOrg('Insights A')
  b = await seedOrg('Insights B')
  const ownerA = a.users.owner

  await Promise.all([
    lead(a.org, ownerA, 'Zephyr Lead', 'new'),
    lead(a.org, ownerA, 'Plain Lead', 'new'),
    lead(a.org, ownerA, 'Called Lead', 'contacted'),
    lead(a.org, ownerA, 'Done Lead', 'converted'),
    deal(a.org, ownerA, 'Zephyr Deal', 100, 'new'),
    deal(a.org, ownerA, 'Small', 50, 'new'),
    deal(a.org, ownerA, 'Pitch', 300, 'proposal'),
    deal(a.org, ownerA, 'Jan win', 1000, 'won', 'won', new Date(Date.UTC(2026, 0, 15))),
    deal(a.org, ownerA, 'Feb win', 500, 'won', 'won', new Date(Date.UTC(2026, 1, 10))),
    deal(a.org, ownerA, 'Feb loss', 200, 'lost', 'lost', new Date(Date.UTC(2026, 1, 20))),
    Contact.create({ orgId: a.org._id, ownerId: ownerA._id, name: 'Zephyr Contact' }),
    Company.create({ orgId: a.org._id, ownerId: ownerA._id, name: 'Zephyr Co' }),
  ])

  // Twelve audit entries, oldest first, so "latest 10, newest first" is checkable.
  for (let i = 0; i < 12; i++) {
    await ActivityLog.create({
      orgId: a.org._id,
      userId: ownerA._id,
      action: 'create',
      entityType: 'lead',
      message: `entry ${i}`,
      createdAt: new Date(Date.UTC(2026, 2, 1, 0, i)),
    })
  }

  // Org B: big numbers and a matching search term that must never reach org A.
  const ownerB = b.users.owner
  await Promise.all([
    lead(b.org, ownerB, 'Zephyr B Lead', 'new'),
    deal(b.org, ownerB, 'Zephyr B Deal', 9999, 'new'),
    deal(b.org, ownerB, 'B win', 7777, 'won', 'won', new Date(Date.UTC(2026, 0, 5))),
  ])
})

describe('GET /dashboard/overview', () => {
  it('counts leads by status, deals by stage, and the open pipeline value', async () => {
    const res = await request(app).get('/api/v1/dashboard/overview').set(bearer(a.tokens.owner))
    expect(res.status).toBe(200)
    const { leadsByStatus, dealsByStage, openPipelineValue } = res.body.data

    expect(leadsByStatus).toEqual({ new: 2, contacted: 1, converted: 1 })
    expect(openPipelineValue).toBe(450)
    expect(dealsByStage).toHaveLength(4)
    expect(dealsByStage).toEqual(
      expect.arrayContaining([
        { stageKey: 'new', count: 2, value: 150 },
        { stageKey: 'proposal', count: 1, value: 300 },
        { stageKey: 'won', count: 2, value: 1500 },
        { stageKey: 'lost', count: 1, value: 200 },
      ]),
    )
  })

  it('returns the 10 most recent audit entries, newest first, with the actor populated', async () => {
    const res = await request(app).get('/api/v1/dashboard/overview').set(bearer(a.tokens.member))
    const { recentActivity } = res.body.data
    expect(recentActivity).toHaveLength(10)
    expect(recentActivity.map((e) => e.message)).toEqual(Array.from({ length: 10 }, (_, i) => `entry ${11 - i}`))
    expect(recentActivity[0].userId.name).toBe(a.users.owner.name)
  })
})

describe('GET /dashboard/reports', () => {
  it('reports won/lost totals, win rate and a per-month breakdown', async () => {
    const res = await request(app).get('/api/v1/dashboard/reports').set(bearer(a.tokens.owner))
    expect(res.status).toBe(200)
    const { won, lost, winRate, wonLostByMonth } = res.body.data

    expect({ won, lost }).toEqual({ won: 2, lost: 1 })
    expect(winRate).toBeCloseTo(2 / 3)
    expect(wonLostByMonth).toHaveLength(3)
    expect(wonLostByMonth).toEqual(
      expect.arrayContaining([
        { _id: { year: 2026, month: 1, status: 'won' }, count: 1, value: 1000 },
        { _id: { year: 2026, month: 2, status: 'won' }, count: 1, value: 500 },
        { _id: { year: 2026, month: 2, status: 'lost' }, count: 1, value: 200 },
      ]),
    )
    // Sorted chronologically: January first.
    expect(wonLostByMonth[0]._id.month).toBe(1)
  })

  it('reports a null win rate when nothing has closed yet', async () => {
    const empty = await seedOrg('Insights empty')
    const res = await request(app).get('/api/v1/dashboard/reports').set(bearer(empty.tokens.owner))
    expect(res.body.data).toEqual({ wonLostByMonth: [], winRate: null, won: 0, lost: 0 })
  })
})

describe('GET /search', () => {
  it('finds matches across leads, contacts, companies and deals', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'Zephyr' }).set(bearer(a.tokens.member))
    expect(res.status).toBe(200)
    const { leads, contacts, companies, deals } = res.body.data
    expect(leads.map((r) => r.name)).toEqual(['Zephyr Lead'])
    expect(contacts.map((r) => r.name)).toEqual(['Zephyr Contact'])
    expect(companies.map((r) => r.name)).toEqual(['Zephyr Co'])
    expect(deals.map((r) => r.title)).toEqual(['Zephyr Deal'])
  })

  it('rejects an empty query', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: '   ' }).set(bearer(a.tokens.member))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('isolation and access', () => {
  it("never counts or returns another org's data", async () => {
    const overview = (await request(app).get('/api/v1/dashboard/overview').set(bearer(b.tokens.owner))).body.data
    expect(overview.leadsByStatus).toEqual({ new: 1 })
    expect(overview.openPipelineValue).toBe(9999)

    const reports = (await request(app).get('/api/v1/dashboard/reports').set(bearer(b.tokens.owner))).body.data
    expect({ won: reports.won, lost: reports.lost }).toEqual({ won: 1, lost: 0 })

    const search = (await request(app).get('/api/v1/search').query({ q: 'Zephyr' }).set(bearer(b.tokens.owner))).body
      .data
    expect(search.leads.map((r) => r.name)).toEqual(['Zephyr B Lead'])
    expect(search.contacts).toEqual([])
  })

  it('serves dashboards and search to every role', async () => {
    for (const role of ['owner', 'admin', 'manager', 'member']) {
      for (const path of ['/api/v1/dashboard/overview', '/api/v1/dashboard/reports', '/api/v1/search?q=Zephyr']) {
        expect((await request(app).get(path).set(bearer(a.tokens[role]))).status).toBe(200)
      }
    }
  })
})
