// Idempotency-Key on the writes a client may retry (S2.2): one key per mutation, reused by its network and 409 retries
// and by the refresh-on-401 replay; never retried on an answer the server gave; every retryable write sends one.
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'

import { API, fail, ok, server } from '../../tests/server.js'
import { api, createRecord, idempotent, setAccessToken } from './client.js'
import { convertLead, moveStage, requestBrief } from './mutations.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const fast = { delayMs: 1 }

/** Answers `method path` with each of `replies` in turn (the last repeats), recording every Idempotency-Key. */
function endpoint(method, path, ...replies) {
  const keys = []
  server.use(
    http[method](`${API}${path}`, ({ request }) => {
      keys.push(request.headers.get('idempotency-key'))
      return replies[Math.min(keys.length, replies.length) - 1]()
    }),
  )
  return keys
}
const created = () => ok({ _id: 'd1' }, null, 201)
const dropped = () => HttpResponse.error()

afterEach(() => setAccessToken(null))

describe('idempotent()', () => {
  it('sends a fresh UUID per mutation', async () => {
    const keys = endpoint('post', '/leads', created)
    const send = (config) => api.post('/leads', { name: 'x' }, config)
    await idempotent(send)
    await idempotent(send)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(UUID)
    expect(keys[1]).toMatch(UUID)
    expect(keys[1]).not.toBe(keys[0])
  })

  it('a dropped connection is retried with the same key', async () => {
    const keys = endpoint('post', '/leads', dropped, dropped, created)
    const res = await idempotent((config) => api.post('/leads', { name: 'x' }, config), fast)
    expect(res.status).toBe(201)
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(1)
  })

  it('a 409 IDEMPOTENCY_IN_PROGRESS is retried with the same key until the replay', async () => {
    const keys = endpoint('post', '/leads', () => fail(409, 'IDEMPOTENCY_IN_PROGRESS', 'Still running.'), created)
    const res = await idempotent((config) => api.post('/leads', { name: 'x' }, config), fast)
    expect(res.status).toBe(201)
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it('gives up after its retries and rethrows the network error', async () => {
    const keys = endpoint('post', '/leads', dropped)
    await expect(idempotent((config) => api.post('/leads', {}, config), { ...fast, retries: 2 })).rejects.toThrow()
    expect(keys).toHaveLength(3)
  })

  it.each([
    [400, 'VALIDATION_ERROR'],
    [422, 'IDEMPOTENCY_KEY_REUSED'],
    [409, 'DUPLICATE_KEY'],
    [500, 'INTERNAL_ERROR'],
  ])('an answer the server gave (%i %s) is not retried', async (status, code) => {
    const keys = endpoint('post', '/leads', () => fail(status, code, 'No.'))
    await expect(idempotent((config) => api.post('/leads', {}, config), fast)).rejects.toMatchObject({
      response: { status },
    })
    expect(keys).toHaveLength(1)
  })

  it('the refresh-on-401 replay resends the same key', async () => {
    setAccessToken('stale')
    server.use(http.post(`${API}/auth/refresh`, () => ok({ accessToken: 'fresh' })))
    const keys = []
    server.use(
      http.post(`${API}/leads`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key'))
        return request.headers.get('authorization') === 'Bearer fresh'
          ? created()
          : fail(401, 'UNAUTHORIZED', 'Expired.')
      }),
    )
    await idempotent((config) => api.post('/leads', {}, config), fast)
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })
})

describe('every retryable write sends a key', () => {
  it.each([
    ['POST /leads', 'post', '/leads', () => createRecord('leads', { name: 'x' })],
    ['POST /deals', 'post', '/deals', () => createRecord('deals', { title: 'x' })],
    ['POST /leads/:id/convert', 'post', '/leads/l1/convert', () => convertLead('l1')],
    ['PATCH /deals/:id/move-stage', 'patch', '/deals/d1/move-stage', () => moveStage({ id: 'd1', stageKey: 'won' })],
    ['POST /ai/leads/:id/brief', 'post', '/ai/leads/l1/brief', () => requestBrief('l1', false)],
  ])('%s', async (_, method, path, call) => {
    const keys = endpoint(method, path, dropped, created)
    await call()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(UUID)
    expect(keys[1]).toBe(keys[0])
  })

  it('a create on a resource without server-side keys sends none and is never retried', async () => {
    const keys = endpoint('post', '/contacts', dropped)
    await expect(createRecord('contacts', { name: 'x' })).rejects.toThrow()
    expect(keys).toEqual([null])
  })
})
