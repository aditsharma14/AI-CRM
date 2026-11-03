// Cursor pagination on the lead and deal lists: every row exactly once in order (ties on the sort key, nulls, rows
// inserted between pages), a cursor only works for the query it came from, and the page-size cap holds.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import { Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import { bearer, seedOrg } from './helpers.js'

const api = '/api/v1'
const SAME_DAY = new Date('2026-05-01T10:00:00.000Z')
let ctx, other

const get = (path, query, token = ctx.tokens.owner) => request(app).get(`${api}${path}`).query(query).set(bearer(token))

/** Follows nextCursor to the end. `between(n)` runs after page n, before the next request. */
async function walk(path, query, { between = async () => {} } = {}) {
  const pages = []
  let cursor
  for (let n = 1; n < 100; n++) {
    const res = await get(path, { ...query, ...(cursor ? { cursor } : {}) })
    expect(res.status, JSON.stringify(res.body.error)).toBe(200)
    pages.push(res.body)
    cursor = res.body.meta.nextCursor
    if (!cursor) break
    await between(n)
  }
  return { pages, ids: pages.flatMap((p) => p.data.map((r) => r._id)) }
}

const ids = (docs) => docs.map((d) => d._id.toString())

beforeAll(async () => {
  ctx = await seedOrg('Cursor')
  other = await seedOrg('Cursor other')
  const { org, users } = ctx
  // 25 leads, 10 of them created in the same millisecond: ties on the sort key that only _id can order.
  await Lead.insertMany(
    Array.from({ length: 25 }, (_, i) => ({
      orgId: org._id,
      name: `Lead ${i}`,
      status: i % 2 ? 'qualified' : 'new',
      ownerId: users.member._id,
      createdAt: i < 10 ? SAME_DAY : new Date(SAME_DAY.getTime() + i * 60_000),
    })),
  )
  // Scores with ties and nulls: a stored null, a missing field and repeated values.
  await Lead.collection.insertMany(
    [7, 7, 7, null, null, 42, 0, 0, undefined, 99, 42, null].map((score, i) => ({
      orgId: org._id,
      name: `Scored ${i}`,
      status: 'contacted',
      ownerId: users.member._id,
      createdAt: SAME_DAY,
      updatedAt: SAME_DAY,
      ...(score === undefined ? {} : { score }),
    })),
  )
  // Deals: open ones have no closedAt (null), closed ones share some dates.
  await Deal.insertMany(
    Array.from({ length: 14 }, (_, i) => ({
      orgId: org._id,
      title: `Deal ${i}`,
      value: 1000 * (i % 4),
      stageKey: i % 3 ? 'new' : 'won',
      status: i % 3 ? 'open' : 'won',
      ...(i % 3 ? {} : { closedAt: new Date(Date.UTC(2026, 5, 1 + (i % 2))) }),
      ownerId: users.member._id,
      createdAt: i < 6 ? SAME_DAY : new Date(SAME_DAY.getTime() + i * 60_000),
    })),
  )
  await Lead.create({ orgId: other.org._id, name: 'Other org lead', ownerId: other.users.member._id })
})

describe('cursor pagination: every row exactly once, in order', () => {
  it('lead list, default sort: same rows and order as one big query, across ties on createdAt', async () => {
    const { pages, ids: seen } = await walk('/leads', { limit: 4 })
    const expected = await Lead.find({ orgId: ctx.org._id }).sort({ createdAt: -1, _id: -1 })
    expect(seen).toEqual(ids(expected))
    expect(pages.at(-1).meta).toEqual({ limit: 4, hasMore: false, nextCursor: null })
    expect(pages[0].meta).toMatchObject({ limit: 4, hasMore: true, nextCursor: expect.any(String) })
  })

  it('no duplicates or gaps when leads are inserted between pages', async () => {
    const before = ids(await Lead.find({ orgId: ctx.org._id }))
    let added = 0
    const { ids: seen } = await walk(
      '/leads',
      { limit: 5 },
      {
        between: async (n) => {
          // A newer lead (lands on pages already read) and one tied with rows not read yet.
          await Lead.create([
            { orgId: ctx.org._id, name: `Inserted new ${n}`, ownerId: ctx.users.member._id },
            { orgId: ctx.org._id, name: `Inserted tie ${n}`, ownerId: ctx.users.member._id, createdAt: SAME_DAY },
          ])
          added += 2
        },
      },
    )
    expect(added).toBeGreaterThan(0)
    expect(new Set(seen).size).toBe(seen.length) // no duplicates
    for (const id of before) expect(seen).toContain(id) // no gaps
  })

  it.each([
    ['-score', { score: -1, _id: -1 }],
    ['score', { score: 1, _id: 1 }],
  ])('sort=%s with ties and nulls (null first ascending, last descending)', async (sort, order) => {
    const { ids: seen } = await walk('/leads', { limit: 3, sort, status: 'contacted' })
    const expected = await Lead.find({ orgId: ctx.org._id, status: 'contacted' }).sort(order)
    expect(seen).toEqual(ids(expected))
    expect(seen).toHaveLength(12)
  })

  it.each([
    ['-closedAt', { closedAt: -1, _id: -1 }],
    ['closedAt', { closedAt: 1, _id: 1 }],
    ['-createdAt', { createdAt: -1, _id: -1 }],
    ['value', { value: 1, _id: 1 }],
  ])('deal list, sort=%s', async (sort, order) => {
    const { ids: seen } = await walk('/deals', { limit: 4, sort })
    expect(seen).toEqual(ids(await Deal.find({ orgId: ctx.org._id }).sort(order)))
  })

  it('the cursor carries a position, not access: used by another org it returns only that org’s rows', async () => {
    const first = await get('/leads', { limit: 2 })
    const res = await get('/leads', { limit: 2, cursor: first.body.meta.nextCursor }, other.tokens.owner)
    expect(res.status).toBe(200)
    for (const lead of res.body.data) expect(lead.orgId).toBe(other.org._id.toString())
  })
})

describe('a cursor belongs to its query', () => {
  let cursor
  beforeAll(async () => {
    cursor = (await get('/leads', { limit: 2, status: 'new' })).body.meta.nextCursor
  })

  it('works with the same filters, and with another page size', async () => {
    expect((await get('/leads', { limit: 2, status: 'new', cursor })).status).toBe(200)
    expect((await get('/leads', { limit: 7, status: 'new', cursor })).status).toBe(200)
  })

  it.each([
    ['another filter', { status: 'qualified' }],
    ['a filter removed', {}],
    ['a search added', { status: 'new', q: 'lead' }],
    ['another sort', { status: 'new', sort: 'name' }],
  ])('is a 400 with %s', async (_, query) => {
    const res = await get('/leads', { limit: 2, ...query, cursor })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_CURSOR')
    expect(res.body.error.message).toMatch(/different filter, search or sort/)
  })

  it('a leads cursor on the deal list is a 400', async () => {
    const res = await get('/deals', { limit: 2, cursor })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_CURSOR')
  })

  it.each([
    ['garbage', 'not-a-cursor'],
    ['valid base64 of the wrong thing', Buffer.from('{"a":1}').toString('base64url')],
    ['a bad id', Buffer.from(JSON.stringify(['x', 'z', null, 'nope'])).toString('base64url')],
    [
      'an operator as the value',
      Buffer.from(JSON.stringify(['x', 'n', { $gt: 0 }, '0'.repeat(24)])).toString('base64url'),
    ],
  ])('a tampered cursor (%s) is a 400', async (_, bad) => {
    const res = await get('/leads', { limit: 2, cursor: bad })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_CURSOR')
  })
})

describe('page size and the old page parameter', () => {
  it.each(['/leads', '/deals'])('%s: limit is capped at 100', async (path) => {
    expect((await get(path, { limit: 100 })).status).toBe(200)
    const res = await get(path, { limit: 101 })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/limit/)
  })

  it.each(['/leads', '/deals'])('%s: ?page= is a 400 (cursor lists have no page numbers)', async (path) => {
    const res = await get(path, { page: 2 })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/page/)
  })

  it('page-numbered lists keep page numbers and totals', async () => {
    const res = await get('/contacts', { page: 1 })
    expect(res.status).toBe(200)
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: expect.any(Number) })
  })
})
