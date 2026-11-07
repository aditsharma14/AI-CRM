// Idempotency-Key (S2.2): replay after commit, 409 while in progress, 422 on reuse, per user and org, 8 parallel
// requests, 5xx and 429 free the key, a stuck lease expires, a failed done-write per endpoint kind, replay fidelity,
// the 64 kB cap, and the TTL index.
import { randomUUID } from 'node:crypto'

import express from 'express'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app.js'
import { env } from '../src/config/index.js'
import { errorHandler } from '../src/middleware/errorHandler.js'
import { idempotent } from '../src/middleware/idempotency.js'
import AiCall from '../src/models/AiCall.js'
import AiJob from '../src/models/AiJob.js'
import { Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import IdempotencyRecord from '../src/models/IdempotencyRecord.js'
import { ActivityLog } from '../src/models/Logs.js'
import { ORG_CALLS_PER_HOUR, resetAiBriefState } from '../src/services/aiBriefService.js'
import { apiResponse, asyncHandler } from '../src/utils/http.js'
import { startAiStub } from './aiStub.js'
import { bearer, makeRecord, seedOrg } from './helpers.js'

const api = '/api/v1'
const REPLAYED = 'idempotent-replayed'
let ctx, other, saved, stub

/** A request with an Idempotency-Key, as `role` in `org` (default: the owner of ctx). */
const send = (method, path, body, key, { org = ctx, role = 'owner' } = {}) => {
  const req = request(app)[method](`${api}${path}`).set(bearer(org.tokens[role]))
  if (key !== undefined) req.set('Idempotency-Key', key)
  return req.send(body)
}
const createLead = (body, key, opts) => send('post', '/leads', body, key, opts)
const convert = (leadId, key, body = {}) => send('post', `/leads/${leadId}/convert`, body, key)
const newLead = (org = ctx) => makeRecord('leads', org.org, org.users.owner)
const leadsNamed = (name) => Lead.countDocuments({ name })
/** AI on, pointed at the stand-in (the brief POST asks the service for its prompt version before it queues). */
const aiOn = () => {
  const url = `http://127.0.0.1:${stub.server.address().port}`
  Object.assign(env, { aiEnabled: true, aiServiceUrl: url, aiInternalToken: 'test-ai-internal-token-0123' })
  resetAiBriefState()
}

beforeAll(async () => {
  ctx = await seedOrg('Idem')
  other = await seedOrg('Idem other')
  saved = { ...env }
  stub = await startAiStub()
  await IdempotencyRecord.syncIndexes()
})

afterAll(() => new Promise((resolve) => stub.server.close(resolve)))

beforeEach(() => IdempotencyRecord.deleteMany({}))

afterEach(() => {
  vi.restoreAllMocks()
  Object.assign(env, saved)
})

describe('the header', () => {
  it('absent: nothing changes, two creates make two leads', async () => {
    const name = `no key ${randomUUID()}`
    expect((await createLead({ name })).status).toBe(201)
    expect((await createLead({ name })).status).toBe(201)
    expect(await leadsNamed(name)).toBe(2)
    expect(await IdempotencyRecord.countDocuments()).toBe(0)
  })

  it.each([
    ['too short', 'abc123'],
    ['too long', 'k'.repeat(65)],
    ['a space', 'has spaces in it 0123'],
    ['a semicolon', 'semi;colon-0123456789'],
  ])('a key with %s is 400 VALIDATION_ERROR and writes nothing', async (_, key) => {
    const name = `bad key ${randomUUID()}`
    const res = await createLead({ name }, key)
    expect(res.status).toBe(400)
    expect(res.body.error).toEqual({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/^idempotency-key: /) })
    expect(await leadsNamed(name)).toBe(0)
    expect(await IdempotencyRecord.countDocuments()).toBe(0)
  })

  it('accepts a UUID and 16 to 64 safe characters', async () => {
    for (const key of [randomUUID(), 'a'.repeat(16), `k.${'_:-'.repeat(20)}9`.slice(0, 64)]) {
      expect((await createLead({ name: `ok ${key}` }, key)).status).toBe(201)
    }
  })
})

describe('replay', () => {
  it('double-click convert: one deal, and every 201 carries it', async () => {
    const lead = await newLead()
    const key = randomUUID()
    const answers = await Promise.all([convert(lead._id, key), convert(lead._id, key)])
    expect(await Deal.countDocuments({ convertedFromLeadId: lead._id })).toBe(1)
    const [deal] = await Deal.find({ convertedFromLeadId: lead._id })
    for (const res of answers) {
      if (res.status === 409) expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS')
      else {
        expect(res.status).toBe(201)
        expect(res.body.data._id).toBe(String(deal._id))
      }
    }
    // A third click, after both answered: a replay, not ALREADY_CONVERTED.
    const third = await convert(lead._id, key)
    expect(third.status).toBe(201)
    expect(third.headers[REPLAYED]).toBe('true')
    expect(third.body.data._id).toBe(String(deal._id))
  })

  it('a network retry after the server committed replays the same deal id', async () => {
    const lead = await newLead()
    const key = randomUUID()
    const first = await convert(lead._id, key, { value: 500 })
    expect(first.status).toBe(201)
    expect(first.headers[REPLAYED]).toBeUndefined()

    const retry = await convert(lead._id, key, { value: 500 })
    expect(retry.status).toBe(201)
    expect(retry.headers[REPLAYED]).toBe('true')
    expect(retry.headers['content-type']).toMatch(/^application\/json/)
    expect(retry.headers['set-cookie']).toBeUndefined()
    expect(retry.body).toEqual(first.body)
    expect(await Deal.countDocuments({ convertedFromLeadId: lead._id })).toBe(1)
  })

  it('POST /leads and POST /deals retried write once', async () => {
    const name = `retried ${randomUUID()}`
    const leadKey = randomUUID()
    const a = await createLead({ name }, leadKey)
    const b = await createLead({ name }, leadKey)
    expect([a.status, b.status, b.headers[REPLAYED]]).toEqual([201, 201, 'true'])
    expect(b.body.data._id).toBe(a.body.data._id)
    expect(await leadsNamed(name)).toBe(1)

    const title = `retried ${randomUUID()}`
    const dealKey = randomUUID()
    const c = await send('post', '/deals', { title, value: 10 }, dealKey)
    const d = await send('post', '/deals', { title, value: 10 }, dealKey)
    expect([c.status, d.status, d.headers[REPLAYED]]).toEqual([201, 201, 'true'])
    expect(await Deal.countDocuments({ title })).toBe(1)
  })

  it('PATCH /deals/:id/move-stage retried logs one move', async () => {
    const deal = await makeRecord('deals', ctx.org, ctx.users.owner)
    const key = randomUUID()
    const logs = () => ActivityLog.countDocuments({ entityId: deal._id })
    const move = () => send('patch', `/deals/${deal._id}/move-stage`, { stageKey: 'won' }, key)
    expect((await move()).status).toBe(200)
    const after = await logs()
    const retry = await move()
    expect([retry.status, retry.headers[REPLAYED]]).toEqual([200, 'true'])
    expect(await logs()).toBe(after)
  })

  it('the brief POST replays the same jobId with the original 202', async () => {
    aiOn()
    const lead = await newLead()
    const key = randomUUID()
    const first = await send('post', `/ai/leads/${lead._id}/brief`, {}, key)
    expect(first.status, JSON.stringify(first.body)).toBe(202)
    const retry = await send('post', `/ai/leads/${lead._id}/brief`, {}, key)
    expect([retry.status, retry.headers[REPLAYED]]).toEqual([202, 'true'])
    expect(retry.body.data.jobId).toBe(first.body.data.jobId)
    expect(await AiJob.countDocuments({ leadId: lead._id })).toBe(1)
  })

  it('a 4xx from the handler is stored and replayed', async () => {
    const lead = await newLead()
    expect((await convert(lead._id)).status).toBe(201)
    const key = randomUUID()
    const first = await convert(lead._id, key)
    expect([first.status, first.body.error.code]).toEqual([400, 'ALREADY_CONVERTED'])
    const retry = await convert(lead._id, key)
    expect([retry.status, retry.headers[REPLAYED]]).toEqual([400, 'true'])
    expect(retry.body).toEqual(first.body)
  })
})

describe('misuse', () => {
  it('the same key with a different body is 422 IDEMPOTENCY_KEY_REUSED and writes nothing', async () => {
    const key = randomUUID()
    const name = `first ${randomUUID()}`
    expect((await createLead({ name }, key)).status).toBe(201)
    const res = await createLead({ name: `${name} changed` }, key)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(await leadsNamed(`${name} changed`)).toBe(0)
  })

  it('the same key on a different path is 422, the other lead included', async () => {
    const [a, b] = [await newLead(), await newLead()]
    const key = randomUUID()
    expect((await convert(a._id, key)).status).toBe(201)
    const res = await convert(b._id, key)
    expect([res.status, res.body.error.code]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED'])
    expect((await Lead.findById(b._id)).status).not.toBe('converted')

    const deal = await send('post', '/deals', { title: 'x', value: 1 }, key)
    expect([deal.status, deal.body.error.code]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED'])
  })

  it('keys are per user and per org', async () => {
    const key = randomUUID()
    const name = `shared key ${randomUUID()}`
    expect((await createLead({ name }, key)).status).toBe(201)
    expect((await createLead({ name }, key)).headers[REPLAYED]).toBe('true')
    const sameOrg = await createLead({ name }, key, { role: 'manager' })
    const otherOrg = await createLead({ name }, key, { org: other })
    for (const res of [sameOrg, otherOrg]) {
      expect(res.status).toBe(201)
      expect(res.headers[REPLAYED]).toBeUndefined()
    }
    expect(await leadsNamed(name)).toBe(3)
  })
})

describe('concurrency', () => {
  it('8 identical requests in parallel: one write; the rest are 409 or a replay of it', async () => {
    const key = randomUUID()
    const name = `parallel ${randomUUID()}`
    const answers = await Promise.all(Array.from({ length: 8 }, () => createLead({ name }, key)))
    expect(await leadsNamed(name)).toBe(1)
    const created = answers.filter((r) => r.status === 201)
    const busy = answers.filter((r) => r.status === 409)
    expect(created.length + busy.length).toBe(8)
    expect(created.filter((r) => !r.headers[REPLAYED])).toHaveLength(1)
    expect(new Set(created.map((r) => r.body.data._id)).size).toBe(1)
    for (const res of busy) expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS')
  })
})

describe('failures', () => {
  it('a 5xx deletes the record, so the retry runs', async () => {
    const key = randomUUID()
    const name = `after 500 ${randomUUID()}`
    vi.spyOn(Lead, 'create').mockRejectedValueOnce(new Error('disk on fire'))
    const first = await createLead({ name }, key)
    expect([first.status, first.body.error.code]).toEqual([500, 'INTERNAL_ERROR'])
    expect(await IdempotencyRecord.countDocuments()).toBe(0)
    const retry = await createLead({ name }, key)
    expect([retry.status, retry.headers[REPLAYED]]).toEqual([201, undefined])
    expect(await leadsNamed(name)).toBe(1)
  })

  it('a 429 AI_RATE_LIMITED deletes the record, so the retry runs once the window allows', async () => {
    aiOn()
    const lead = await newLead()
    const at = new Date()
    await AiCall.insertMany(
      Array.from({ length: ORG_CALLS_PER_HOUR }, () => ({ orgId: ctx.org._id, leadId: lead._id, kind: 'call', at })),
    )
    const key = randomUUID()
    const first = await send('post', `/ai/leads/${lead._id}/brief`, {}, key)
    expect([first.status, first.body.error.code]).toEqual([429, 'AI_RATE_LIMITED'])
    expect(await IdempotencyRecord.countDocuments()).toBe(0)

    await AiCall.deleteMany({ orgId: ctx.org._id })
    const retry = await send('post', `/ai/leads/${lead._id}/brief`, {}, key)
    expect([retry.status, retry.headers[REPLAYED]]).toEqual([202, undefined])
  })

  it('a stuck in_progress record is 409 while its lease lives, and runs once the lease has expired', async () => {
    const key = randomUUID()
    const name = `stuck ${randomUUID()}`
    const res0 = await createLead({ name }, key)
    expect(res0.status).toBe(201)
    await Lead.deleteMany({ name })
    // As if the process died mid-request: in progress, nothing stored.
    await IdempotencyRecord.updateOne(
      { key },
      {
        $set: { state: 'in_progress', lockedUntil: new Date(Date.now() + 30_000) },
        $unset: { status: 1, response: 1 },
      },
    )
    const busy = await createLead({ name }, key)
    expect([busy.status, busy.body.error.code]).toEqual([409, 'IDEMPOTENCY_IN_PROGRESS'])
    expect(await leadsNamed(name)).toBe(0)

    await IdempotencyRecord.updateOne({ key }, { $set: { lockedUntil: new Date(Date.now() - 1) } })
    const taken = await createLead({ name }, key)
    expect([taken.status, taken.headers[REPLAYED]]).toEqual([201, undefined])
    expect(await leadsNamed(name)).toBe(1)
    expect((await IdempotencyRecord.findOne({ key })).state).toBe('done')
  })

  it('a record past its 24 h is treated as absent, before the TTL monitor removes it', async () => {
    const key = randomUUID()
    const name = `aged ${randomUUID()}`
    expect((await createLead({ name }, key)).status).toBe(201)
    await IdempotencyRecord.updateOne({ key }, { $set: { createdAt: new Date(Date.now() - 24 * 3600_000 - 1000) } })
    const again = await createLead({ name }, key)
    expect([again.status, again.headers[REPLAYED]]).toEqual([201, undefined])
    expect(await leadsNamed(name)).toBe(2)
  })

  it('the done-write fails in convert: the transaction rolls back, 500, and the retry converts once', async () => {
    const lead = await newLead()
    const key = randomUUID()
    vi.spyOn(IdempotencyRecord, 'updateOne').mockRejectedValueOnce(new Error('primary stepped down'))
    const first = await convert(lead._id, key)
    expect(first.status).toBe(500)
    expect(await Deal.countDocuments({ convertedFromLeadId: lead._id })).toBe(0)
    expect((await Lead.findById(lead._id)).status).not.toBe('converted')
    expect(await IdempotencyRecord.countDocuments({ key })).toBe(0)

    const retry = await convert(lead._id, key)
    expect([retry.status, retry.headers[REPLAYED]]).toEqual([201, undefined])
    expect(await Deal.countDocuments({ convertedFromLeadId: lead._id })).toBe(1)
    expect((await convert(lead._id, key)).headers[REPLAYED]).toBe('true')
  })

  it('the done-write fails in POST /leads: the lead is sent, the key is 409 until the lease ends, then writes twice', async () => {
    const key = randomUUID()
    const name = `lost done ${randomUUID()}`
    vi.spyOn(IdempotencyRecord, 'updateOne').mockRejectedValueOnce(new Error('primary stepped down'))
    const first = await createLead({ name }, key)
    expect(first.status).toBe(201)
    expect(await leadsNamed(name)).toBe(1)
    expect((await IdempotencyRecord.findOne({ key })).state).toBe('in_progress')

    const soon = await createLead({ name }, key)
    expect([soon.status, soon.body.error.code]).toEqual([409, 'IDEMPOTENCY_IN_PROGRESS'])

    // The window docs/known-issues.md describes: after the lease, the retry runs the handler again.
    await IdempotencyRecord.updateOne({ key }, { $set: { lockedUntil: new Date(Date.now() - 1) } })
    expect((await createLead({ name }, key)).status).toBe(201)
    expect(await leadsNamed(name)).toBe(2)
  })
})

describe('the middleware on its own', () => {
  const user = () => ({ id: String(ctx.users.owner._id), orgId: String(ctx.org._id), role: 'owner' })
  /** A one-route app: req.user and req.log set by hand, the real middleware and errorHandler. */
  function miniApp(handler, log = { error: () => {} }) {
    const mini = express()
    mini.use(express.json())
    mini.use((req, res, next) => {
      req.user = user()
      req.log = log
      req.id = 'req-test-1'
      next()
    })
    mini.post('/thing', idempotent(), asyncHandler(handler))
    mini.use(errorHandler)
    return mini
  }

  it('replays the original status, Content-Type and Location, never Set-Cookie', async () => {
    let runs = 0
    const mini = miniApp((req, res) => {
      runs += 1
      res.set('Location', '/thing/42')
      res.cookie('session', 'secret-value')
      res.set('X-Other', 'not kept')
      apiResponse(res, { id: 42 }, null, 202)
    })
    const key = randomUUID()
    const first = await request(mini).post('/thing').set('Idempotency-Key', key).send({ a: 1 })
    expect(first.headers['set-cookie']).toBeDefined()
    const retry = await request(mini).post('/thing').set('Idempotency-Key', key).send({ a: 1 })
    expect(runs).toBe(1)
    expect(retry.status).toBe(202)
    expect(retry.headers.location).toBe('/thing/42')
    expect(retry.headers['content-type']).toBe(first.headers['content-type'])
    expect(retry.headers['set-cookie']).toBeUndefined()
    expect(retry.headers['x-other']).toBeUndefined()
    expect(retry.text).toBe(first.text)
  })

  it('a body hashed with its keys sorted: the same fields in another order replay', async () => {
    let runs = 0
    const mini = miniApp((req, res) => apiResponse(res, { run: ++runs }, null, 201))
    const key = randomUUID()
    await request(mini)
      .post('/thing')
      .set('Idempotency-Key', key)
      .send({ a: 1, b: { c: 2, d: 3 } })
    const retry = await request(mini)
      .post('/thing')
      .set('Idempotency-Key', key)
      .send({ b: { d: 3, c: 2 }, a: 1 })
    expect([retry.status, retry.headers[REPLAYED], runs]).toEqual([201, 'true', 1])
  })

  it('a response over 64 kB is not stored: the record is deleted and the retry runs again', async () => {
    let runs = 0
    const mini = miniApp((req, res) => {
      runs += 1
      apiResponse(res, { blob: 'x'.repeat(65 * 1024) })
    })
    const key = randomUUID()
    expect((await request(mini).post('/thing').set('Idempotency-Key', key).send({})).status).toBe(200)
    expect(await IdempotencyRecord.countDocuments({ key })).toBe(0)
    const retry = await request(mini).post('/thing').set('Idempotency-Key', key).send({})
    expect([retry.status, retry.headers[REPLAYED], runs]).toEqual([200, undefined, 2])
  })

  it('a failed done-write is logged with the key, and the response is still sent', async () => {
    const log = { error: vi.fn() }
    const mini = miniApp((req, res) => apiResponse(res, { ok: true }, null, 201), log)
    const key = randomUUID()
    vi.spyOn(IdempotencyRecord, 'updateOne').mockRejectedValueOnce(new Error('primary stepped down'))
    const res = await request(mini).post('/thing').set('Idempotency-Key', key).send({})
    expect([res.status, res.body.data]).toEqual([201, { ok: true }])
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0][0]).toMatchObject({ idempotencyKey: key, err: expect.any(Error) })
  })
})

describe('the model', () => {
  it('has a unique (orgId, userId, key) index and a 24 h TTL on createdAt', async () => {
    const indexes = await IdempotencyRecord.collection.indexes()
    expect(indexes).toContainEqual(expect.objectContaining({ key: { orgId: 1, userId: 1, key: 1 }, unique: true }))
    expect(indexes).toContainEqual(expect.objectContaining({ key: { createdAt: 1 }, expireAfterSeconds: 86_400 }))
  })

  it('every record is scoped by orgId', () => {
    expect(IdempotencyRecord.schema.path('orgId').isRequired).toBe(true)
    expect(IdempotencyRecord.schema.path('userId').isRequired).toBe(true)
  })
})
