// The demo's cursor pagination behaves like the real API's (backend/tests/cursor-pagination.test.js): every row once,
// in order, and a cursor reused with another filter, search or sort is a 400 INVALID_CURSOR.
import { beforeEach, describe, expect, it } from 'vitest'

import { server } from '../../tests/server.js'
import { api, setAccessToken } from '../api/client.js'
import { createDemoApi } from './handlers.js'
import { DEMO_ACCOUNTS } from './seed.js'

let demo
beforeEach(async () => {
  demo = createDemoApi()
  server.use(...demo.handlers)
  const login = await api.post('/auth/login', { email: DEMO_ACCOUNTS.manager.email, password: 'x' })
  setAccessToken(login.data.data.accessToken)
})

const get = (path, params) => api.get(path, { params }).catch((err) => err.response)

async function walk(path, params) {
  const seen = []
  let cursor
  for (let n = 0; n < 50; n++) {
    const res = await get(path, { ...params, cursor })
    expect(res.status).toBe(200)
    seen.push(...res.data.data.map((r) => r._id))
    cursor = res.data.meta.nextCursor
    if (!cursor) return seen
  }
  throw new Error('no last page')
}

describe('demo cursor pagination', () => {
  it.each([
    ['/leads', {}],
    ['/leads', { sort: '-score' }],
    ['/deals', { sort: 'closedAt' }],
    ['/deals', { sort: '-closedAt' }],
  ])('%s %j: every row once, in the same order as one big page', async (path, params) => {
    const seen = await walk(path, { ...params, limit: 3 })
    const all = (await get(path, { ...params, limit: 100 })).data.data.map((r) => r._id)
    expect(seen).toEqual(all)
  })

  it.each([
    ['another filter', { status: 'qualified' }],
    ['a search', { q: 'priya' }],
    ['another sort', { sort: 'name' }],
  ])('a cursor reused with %s is a 400', async (_, other) => {
    const cursor = (await get('/leads', { limit: 2 })).data.meta.nextCursor
    const res = await get('/leads', { limit: 2, ...other, cursor })
    expect(res.status).toBe(400)
    expect(res.data.error).toEqual({
      code: 'INVALID_CURSOR',
      message: 'cursor: belongs to a different filter, search or sort. Start again from the first page.',
    })
  })

  it('?page= on a cursor list is a 400, as on the real API', async () => {
    const res = await get('/leads', { page: 2 })
    expect(res.status).toBe(400)
    expect(res.data.error.message).toMatch(/page/)
  })
})

describe('demo activities for one record', () => {
  it("?entityType=lead&entityId= lists only that lead's activities, and needs both", async () => {
    const all = (await get('/activities', { limit: 100 })).data.data
    const linked = all.find((a) => a.linkedTo?.entityType === 'lead')
    const res = await get('/activities', { entityType: 'lead', entityId: linked.linkedTo.entityId, limit: 100 })
    expect(res.status).toBe(200)
    expect(res.data.data.length).toBeGreaterThan(0)
    expect(res.data.data.every((a) => a.linkedTo.entityId === linked.linkedTo.entityId)).toBe(true)
    expect((await get('/activities', { entityType: 'lead' })).status).toBe(400)
  })
})
