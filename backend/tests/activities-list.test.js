// GET /activities: every filter, the type-dependent date range and sort, pagination, isolation.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/app.js'
import Activity from '../src/models/Activity.js'
import { bearer, seedOrg } from './helpers.js'

const day = (d) => new Date(Date.UTC(2026, 2, d)) // March 2026, midnight UTC
const iso = (d) => day(d).toISOString()

let a
let b

/**
 * Org A:
 *   tasks (dated by dueDate)   T1 Mar 1 open member · T2 Mar 5 done owner · T4 Mar 5 open owner (created after T2) · T3 Mar 10 open member
 *   events/calls (by startAt)  E1 Mar 2 · C1 Mar 3 (call) · E2 Mar 20
 * Org B: one task due Mar 2 that must never show up for org A.
 */
beforeAll(async () => {
  a = await seedOrg('Activities A')
  b = await seedOrg('Activities B')
  const { owner, member } = a.users
  const task = (title, dueDate, status, assignee, createdAt) =>
    Activity.create({ orgId: a.org._id, type: 'task', title, dueDate, status, assigneeId: assignee._id, createdAt })

  await task('T1', day(1), 'open', member, day(1))
  await task('T2', day(5), 'done', owner, new Date(Date.UTC(2026, 1, 1)))
  await task('T4', day(5), 'open', owner, new Date(Date.UTC(2026, 1, 2))) // same due date as T2, created later
  await task('T3', day(10), 'open', member, day(1))
  await Activity.create([
    { orgId: a.org._id, type: 'event', title: 'E1', startAt: day(2), assigneeId: owner._id },
    { orgId: a.org._id, type: 'call', title: 'C1', startAt: day(3), assigneeId: member._id },
    { orgId: a.org._id, type: 'event', title: 'E2', startAt: day(20), assigneeId: owner._id },
    { orgId: b.org._id, type: 'task', title: 'B task', dueDate: day(2), assigneeId: b.users.owner._id },
  ])
})

/** GET /activities as org A's owner unless told otherwise; returns titles plus the raw body. */
async function list(query, token = a.tokens.owner) {
  const res = await request(app).get('/api/v1/activities').query(query).set(bearer(token))
  return { res, titles: (res.body.data ?? []).map((x) => x.title) }
}

describe('filters', () => {
  it('filters by type', async () => {
    expect((await list({ type: 'event' })).titles).toEqual(['E1', 'E2'])
    expect((await list({ type: 'call' })).titles).toEqual(['C1'])
  })

  it('filters by status', async () => {
    expect((await list({ type: 'task', status: 'done' })).titles).toEqual(['T2'])
    expect((await list({ type: 'task', status: 'open' })).titles).toEqual(['T1', 'T4', 'T3'])
  })

  it('filters by assignee', async () => {
    expect((await list({ type: 'task', assigneeId: a.users.member._id.toString() })).titles).toEqual(['T1', 'T3'])
  })

  it('combines filters', async () => {
    expect((await list({ type: 'task', status: 'open', assigneeId: a.users.owner._id.toString() })).titles).toEqual(['T4'])
  })

  it('returns every type when none is given', async () => {
    const { res } = await list({})
    expect(res.status).toBe(200)
    expect(res.body.meta.total).toBe(7)
  })
})

describe('date range', () => {
  it("ranges over a task's dueDate, both bounds inclusive", async () => {
    expect((await list({ type: 'task', dateFrom: iso(5), dateTo: iso(10) })).titles).toEqual(['T4', 'T2', 'T3'])
  })

  it('supports an open-ended range on either side', async () => {
    expect((await list({ type: 'task', dateFrom: iso(6) })).titles).toEqual(['T3'])
    expect((await list({ type: 'task', dateTo: iso(1) })).titles).toEqual(['T1'])
  })

  it('ranges over startAt for every non-task type', async () => {
    expect((await list({ type: 'event', dateFrom: iso(10) })).titles).toEqual(['E2'])
    expect((await list({ type: 'call', dateTo: iso(3) })).titles).toEqual(['C1'])
    // Tasks have no startAt, so a range without type=task matches no task.
    expect((await list({ dateFrom: iso(1), dateTo: iso(31) })).titles).toEqual(['E1', 'C1', 'E2'])
  })
})

describe('sort and pagination', () => {
  it('sorts by the date field ascending, newest-created first on ties', async () => {
    expect((await list({ type: 'task' })).titles).toEqual(['T1', 'T4', 'T2', 'T3'])
  })

  it('pages with accurate meta', async () => {
    const first = await list({ type: 'task', limit: 3, page: 1 })
    expect(first.titles).toEqual(['T1', 'T4', 'T2'])
    expect(first.res.body.meta).toEqual({ page: 1, limit: 3, total: 4, hasMore: true })

    const second = await list({ type: 'task', limit: 3, page: 2 })
    expect(second.titles).toEqual(['T3'])
    expect(second.res.body.meta).toEqual({ page: 2, limit: 3, total: 4, hasMore: false })
  })

  it('populates the assignee name', async () => {
    const { res } = await list({ type: 'task', limit: 1 })
    expect(res.body.data[0].assigneeId).toMatchObject({ _id: a.users.member._id.toString(), name: a.users.member.name })
  })
})

describe('isolation and validation', () => {
  it("never returns another org's activities", async () => {
    expect((await list({ type: 'task' }, b.tokens.owner)).titles).toEqual(['B task'])
    expect((await list({})).titles).not.toContain('B task')
  })

  it('rejects an unknown type or a malformed assignee id', async () => {
    for (const query of [{ type: 'party' }, { assigneeId: 'not-an-id' }, { limit: 101 }]) {
      const { res } = await list(query)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
  })
})
