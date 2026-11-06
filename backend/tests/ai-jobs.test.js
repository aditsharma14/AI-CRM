// The lead-brief job queue: the atomic FIFO claim, a crashed worker's job reclaimed after its lease, the heartbeat, a
// stolen lease aborting the call, graceful shutdown, two attempts then a typed failure, the reaper, bundle hygiene on
// every path that ends a job, the hour window counted on `at`, GET /ai/jobs/:id and the owners' queue stats.
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app.js'
import { env } from '../src/config/index.js'
import AiBrief from '../src/models/AiBrief.js'
import AiCall from '../src/models/AiCall.js'
import AiJob from '../src/models/AiJob.js'
import { Lead } from '../src/models/CRM.js'
import Note from '../src/models/Note.js'
import { resetAiBriefState } from '../src/services/aiBriefService.js'
import { claimNext, drain, reapExpired, runJob, startWorker } from '../src/services/aiJobService.js'
import { META, startAiStub } from './aiStub.js'
import { bearer, seedOrg } from './helpers.js'
import { spawnWorker, waitFor } from './workerProcess.js'

const api = '/api/v1'
const TOKEN = 'test-ai-internal-token-0123'
const NOTE = 'Budget approved for forty label printers'
const quiet = { info: () => {}, warn: () => {}, error: () => {} }
let ctx, other, stub, saved

const post = (id, body = {}, token = ctx.tokens.owner) =>
  request(app).post(`${api}/ai/leads/${id}/brief`).set(bearer(token)).send(body)
const getJob = (jobId, token = ctx.tokens.owner) => request(app).get(`${api}/ai/jobs/${jobId}`).set(bearer(token))
const stubUrl = () => `http://127.0.0.1:${stub.server.address().port}`

async function makeLead(owner = ctx) {
  const lead = await Lead.create({
    orgId: owner.org._id,
    name: 'Ravi Deshpande',
    status: 'qualified',
    ownerId: owner.users.owner._id,
  })
  await Note.create({
    orgId: owner.org._id,
    entityType: 'lead',
    entityId: lead._id,
    body: NOTE,
    authorId: owner.users.owner._id,
  })
  return lead
}

/** A queued job for a new lead, through the API. */
async function queued(owner = ctx) {
  const res = await post((await makeLead(owner))._id, {}, owner.tokens.owner)
  expect(res.status, JSON.stringify(res.body)).toBe(202)
  return AiJob.findById(res.body.data.jobId).lean()
}

beforeAll(async () => {
  ctx = await seedOrg('Jobs')
  other = await seedOrg('Jobs other')
  stub = await startAiStub()
  saved = { ...env }
  await AiJob.syncIndexes()
})

beforeEach(async () => {
  Object.assign(env, { aiEnabled: true, aiServiceUrl: stubUrl(), aiInternalToken: TOKEN, aiTimeoutMs: 5000 })
  Object.assign(stub.state, { calls: 0, bodies: [], headers: [], reply: null, delayMs: 0, aborted: 0 })
  resetAiBriefState()
  await Promise.all([AiJob.deleteMany({}), AiCall.deleteMany({}), AiBrief.deleteMany({})])
})

afterEach(() => Object.assign(env, saved))
afterAll(() => new Promise((resolve) => stub.server.close(resolve)))

describe('the claim', () => {
  it('two workers racing for one job: exactly one claims it (50 runs)', async () => {
    const job = await queued()
    for (let run = 0; run < 50; run++) {
      await AiJob.updateOne(
        { _id: job._id },
        { $set: { state: 'queued', attempts: 0, lockedBy: null, lockedUntil: null } },
      )
      const claims = await Promise.all([claimNext('worker-a'), claimNext('worker-b')])
      const won = claims.filter(Boolean)
      expect(won, `run ${run}`).toHaveLength(1)
      const stored = await AiJob.findById(job._id).lean()
      expect(stored).toMatchObject({ state: 'running', attempts: 1, lockedBy: won[0].lockedBy })
    }
  })

  it('claims the oldest job first (FIFO by createdAt)', async () => {
    const jobs = [await queued(), await queued(), await queued()]
    const t = Date.now() - 60_000
    // Inserted 0, 1, 2; created 2, 0, 1.
    await AiJob.updateOne({ _id: jobs[2]._id }, { createdAt: new Date(t) })
    await AiJob.updateOne({ _id: jobs[0]._id }, { createdAt: new Date(t + 1000) })
    await AiJob.updateOne({ _id: jobs[1]._id }, { createdAt: new Date(t + 2000) })
    const order = []
    for (let i = 0; i < 3; i++) order.push(String((await claimNext('w'))._id))
    expect(order).toEqual([jobs[2], jobs[0], jobs[1]].map((j) => String(j._id)))
    expect(await claimNext('w')).toBeNull()
  })

  it('sets the lease, the worker and the first start time', async () => {
    const job = await queued()
    const before = Date.now()
    const claimed = await claimNext('worker-a', { leaseMs: 30_000 })
    expect(claimed).toMatchObject({ _id: job._id, state: 'running', lockedBy: 'worker-a', attempts: 1 })
    expect(claimed.lockedUntil.getTime()).toBeGreaterThanOrEqual(before + 30_000)
    expect(claimed.startedAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})

describe('a crashed worker', () => {
  it('killed after its claim: another worker reclaims the job after lockedUntil, and attempts becomes 2', async () => {
    const job = await queued()
    stub.state.delayMs = 60_000 // the first attempt never answers
    const worker = spawnWorker({ AI_SERVICE_URL: stubUrl(), AI_JOB_LEASE_MS: '1000' })
    const running = await waitFor(() =>
      AiJob.findOne({ _id: job._id, state: 'running', lockedBy: new RegExp(`:${worker.child.pid}:`) }).lean(),
    )
    await waitFor(async () => stub.state.calls === 1)
    worker.child.kill('SIGKILL')
    await worker.exited

    stub.state.delayMs = 0
    expect(await claimNext('worker-b'), 'the lease still holds').toBeNull()
    await waitFor(async () => Date.now() > running.lockedUntil.getTime() + 50)
    const reclaimed = await claimNext('worker-b')
    expect(reclaimed).toMatchObject({ _id: job._id, lockedBy: 'worker-b', attempts: 2 })
    expect(reclaimed.startedAt).toEqual(running.startedAt) // queue latency counts to the first start
    expect(await runJob(reclaimed, { workerId: 'worker-b', log: quiet })).toBe('done')
    expect(await AiJob.findById(job._id).lean()).toMatchObject({ state: 'done', attempts: 2 })
  })

  it('a heartbeat keeps a long job: a 2.5 s call on a 1 s lease is never reclaimed', async () => {
    const job = await queued()
    stub.state.delayMs = 2500
    const claimed = await claimNext('worker-a', { leaseMs: 1000 })
    const run = runJob(claimed, { workerId: 'worker-a', leaseMs: 1000, log: quiet })
    let stolen = null
    const thief = (async () => {
      const until = Date.now() + 2400
      while (!stolen && Date.now() < until) {
        stolen = await claimNext('worker-b', { leaseMs: 1000 })
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    })()
    expect(await run).toBe('done')
    await thief
    expect(stolen).toBeNull()
    expect(await AiJob.findById(job._id).lean()).toMatchObject({ state: 'done', attempts: 1, lockedBy: null })
  })

  it('a lost lease (another worker holds the job) aborts the AI call and writes nothing', async () => {
    const job = await queued()
    stub.state.delayMs = 5000
    const claimed = await claimNext('worker-a', { leaseMs: 1000 })
    const started = Date.now()
    const run = runJob(claimed, { workerId: 'worker-a', leaseMs: 1000, log: quiet })
    await waitFor(async () => stub.state.calls === 1)
    await AiJob.updateOne({ _id: job._id }, { lockedBy: 'worker-b', lockedUntil: new Date(Date.now() + 60_000) })

    expect(await run).toBe('lost')
    expect(Date.now() - started, 'aborted, not waited out').toBeLessThan(3000)
    await waitFor(async () => stub.state.aborted === 1)
    expect(await AiBrief.countDocuments({})).toBe(0)
    expect(await AiJob.findById(job._id).lean()).toMatchObject({ state: 'running', lockedBy: 'worker-b' })
  })
})

describe('the worker loop', () => {
  it('an idle worker picks up a job queued later, within its poll interval', async () => {
    const worker = startWorker({ workerId: 'worker-a', pollMs: 50, log: quiet })
    await new Promise((resolve) => setTimeout(resolve, 150)) // a few empty polls
    const job = await queued()
    const done = await waitFor(() => AiJob.findOne({ _id: job._id, state: 'done' }).lean(), 5000)
    await worker.stop()
    expect(done.startedAt.getTime() - done.createdAt.getTime()).toBeLessThan(1000)
  })

  it('an unexpected error is logged and retried once like AI_UNAVAILABLE, then fails with the generic typed error', async () => {
    const job = await queued()
    // Not an AI error: the brief's write itself throws.
    const write = vi.spyOn(AiBrief, 'findOneAndUpdate').mockImplementation(() => {
      throw new Error('disk on fire')
    })
    const errors = []
    const log = { ...quiet, error: (obj, msg) => errors.push(msg) }
    try {
      expect(await runJob(await claimNext('w'), { workerId: 'w', log })).toBe('requeued')
      expect(await runJob(await claimNext('w'), { workerId: 'w', log })).toBe('failed')
    } finally {
      write.mockRestore()
    }
    expect(errors).toEqual(['ai lead job: unexpected error', 'ai lead job: unexpected error'])
    const stored = await AiJob.findById(job._id).lean()
    expect(stored).toMatchObject({ state: 'failed', attempts: 2 })
    expect(stored.bundle).toBeUndefined()
    expect((await getJob(job._id)).body.data).toEqual({
      state: 'failed',
      error: { code: 'AI_UNAVAILABLE', message: 'The brief could not be generated. Try again in a moment.' },
    })
  })
})

describe('graceful shutdown', () => {
  it('stop() finishes the current job and claims no new one', async () => {
    const first = await queued()
    const second = await queued()
    await AiJob.updateOne({ _id: second._id }, { createdAt: new Date(Date.now() + 1000) })
    stub.state.delayMs = 800
    const worker = startWorker({ workerId: 'worker-a', pollMs: 20, log: quiet })
    await waitFor(() => AiJob.findOne({ _id: first._id, state: 'running' }).lean())
    await worker.stop()
    expect(await AiJob.findById(first._id).lean()).toMatchObject({ state: 'done' })
    expect(await AiJob.findById(second._id).lean()).toMatchObject({ state: 'queued', attempts: 0 })
  })

  // Windows has no catchable SIGTERM (Node's kill() there terminates outright), so the signal path runs on Linux CI.
  it.skipIf(process.platform === 'win32')(
    'SIGTERM: the worker process finishes its job, claims no other, exits 0',
    async () => {
      const first = await queued()
      const second = await queued()
      await AiJob.updateOne({ _id: second._id }, { createdAt: new Date(Date.now() + 1000) })
      stub.state.delayMs = 1500
      const worker = spawnWorker({ AI_SERVICE_URL: stubUrl(), AI_JOB_LEASE_MS: '30000' })
      await waitFor(() => AiJob.findOne({ _id: first._id, state: 'running' }).lean())
      worker.child.kill('SIGTERM')
      expect(await worker.exited, worker.output()).toBe(0)
      expect(await AiJob.findById(first._id).lean()).toMatchObject({ state: 'done' })
      expect(await AiJob.findById(second._id).lean()).toMatchObject({ state: 'queued', attempts: 0 })
    },
  )
})

describe('attempts and failures', () => {
  it('AI_UNAVAILABLE is tried twice, then the job fails with the typed error', async () => {
    const job = await queued()
    stub.state.reply = () => [503, { error: { code: 'PROVIDER_ERROR', message: 'x' }, meta: META }]
    await drain({ workerId: 'w', log: quiet })
    expect(stub.state.calls).toBe(2)
    const res = await getJob(job._id)
    expect(res.body.data).toEqual({
      state: 'failed',
      error: { code: 'AI_UNAVAILABLE', message: expect.any(String) },
    })
    expect(await AiJob.findById(job._id).lean()).toMatchObject({ attempts: 2 })
  })

  it.each([
    [502, 'BAD_OUTPUT', 'AI_BAD_OUTPUT'],
    [429, 'RATE_LIMITED', 'AI_RATE_LIMITED'],
  ])('%i %s fails at once as %s (no second attempt)', async (status, code, ours) => {
    const job = await queued()
    stub.state.reply = () => [status, { error: { code, message: 'x' }, meta: META }]
    await drain({ workerId: 'w', log: quiet })
    expect(stub.state.calls).toBe(1)
    expect((await getJob(job._id)).body.data).toMatchObject({ state: 'failed', error: { code: ours } })
  })

  it('the reaper fails a job whose second lease ran out, with a typed error', async () => {
    const job = await queued()
    await AiJob.updateOne(
      { _id: job._id },
      { state: 'running', attempts: 2, lockedBy: 'gone', lockedUntil: new Date(Date.now() - 1000) },
    )
    expect(await claimNext('w')).toBeNull() // two attempts were spent
    expect(await reapExpired()).toBe(1)
    expect((await getJob(job._id)).body.data).toEqual({
      state: 'failed',
      error: { code: 'AI_UNAVAILABLE', message: expect.any(String) },
    })
  })

  it('after a failure the next POST queues a new job (failed jobs leave the single-flight index)', async () => {
    const job = await queued()
    stub.state.reply = () => [502, { error: { code: 'BAD_OUTPUT', message: 'x' }, meta: META }]
    await drain({ workerId: 'w', log: quiet })
    const again = await post(job.leadId)
    expect(again.status).toBe(202)
    expect(again.body.data.jobId).not.toBe(String(job._id))
  })
})

describe('bundle hygiene', () => {
  it('no job document holds note text after it ends: done, failed, reaped, or its lead deleted', async () => {
    const done = await queued()
    await drain({ workerId: 'w', log: quiet })

    const failed = await queued()
    stub.state.reply = () => [502, { error: { code: 'BAD_OUTPUT', message: 'x' }, meta: META }]
    await drain({ workerId: 'w', log: quiet })
    stub.state.reply = null

    const reaped = await queued()
    await AiJob.updateOne(
      { _id: reaped._id },
      { state: 'running', attempts: 2, lockedBy: 'gone', lockedUntil: new Date(Date.now() - 1000) },
    )
    await reapExpired()

    const orphan = await queued()
    expect(JSON.stringify(orphan.bundle)).toContain(NOTE) // it was there while queued
    const del = await request(app).delete(`${api}/leads/${orphan.leadId}`).set(bearer(ctx.tokens.owner))
    expect(del.status).toBe(200)

    const ended = await AiJob.find({ _id: { $in: [done, failed, reaped, orphan].map((j) => j._id) } }).lean()
    expect(ended.map((j) => j.state).sort()).toEqual(['done', 'failed', 'failed', 'failed'])
    for (const job of ended) {
      expect(job.bundle, job.state).toBeUndefined()
      expect(JSON.stringify(job)).not.toContain(NOTE)
    }
    expect(ended.find((j) => String(j._id) === String(orphan._id)).error).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('a job whose lead is deleted while it runs writes no brief', async () => {
    const job = await queued()
    stub.state.delayMs = 500
    const claimed = await claimNext('w')
    const run = runJob(claimed, { workerId: 'w', log: quiet })
    await waitFor(async () => stub.state.calls === 1)
    await request(app).delete(`${api}/leads/${job.leadId}`).set(bearer(ctx.tokens.owner))
    expect(await run).toBe('lost')
    expect(await AiBrief.countDocuments({})).toBe(0)
  })
})

describe('the hour window is counted on `at`, not left to the TTL monitor', () => {
  const rows = (minutesAgo, n = 20) =>
    AiCall.insertMany(
      Array.from({ length: n }, () => ({
        orgId: ctx.org._id,
        leadId: new mongoose.Types.ObjectId(),
        kind: 'call',
        at: new Date(Date.now() - minutesAgo * 60_000),
      })),
    )

  it('20 rows 61 minutes old, not yet deleted by the TTL monitor, do not count', async () => {
    await rows(61)
    expect((await post((await makeLead())._id)).status).toBe(202)
  })

  it('20 rows 59 minutes old do count: 429, try again in 1 minute', async () => {
    await rows(59)
    const res = await post((await makeLead())._id)
    expect(res.status).toBe(429)
    expect(res.body.error).toEqual({ code: 'AI_RATE_LIMITED', message: expect.stringMatching(/in 1 minutes?/) })
  })
})

describe('GET /ai/jobs/:jobId', () => {
  it('queued, then done with the brief; any role in the org may read it', async () => {
    const job = await queued()
    expect((await getJob(job._id)).body.data).toEqual({ state: 'queued' })
    await drain({ workerId: 'w', log: quiet })
    for (const role of ['owner', 'member']) {
      const res = await getJob(job._id, ctx.tokens[role])
      expect(res.status).toBe(200)
      expect(res.body.data).toMatchObject({ state: 'done', brief: { summary: expect.any(String), cached: false } })
    }
  })

  it('a done job whose brief is gone (cache expired) says so instead of an empty brief', async () => {
    const job = await queued()
    await drain({ workerId: 'w', log: quiet })
    await AiBrief.deleteMany({})
    expect((await getJob(job._id)).body.data).toEqual({
      state: 'failed',
      error: { code: 'NOT_FOUND', message: 'This brief is no longer available.' },
    })
  })

  it("another org's job is 404; an unknown id is 404; a malformed one 400; no token 401", async () => {
    const theirs = await queued(other)
    expect((await getJob(theirs._id)).status).toBe(404)
    expect((await getJob(theirs._id)).body.error.code).toBe('NOT_FOUND')
    expect((await getJob(new mongoose.Types.ObjectId())).status).toBe(404)
    expect((await getJob('nope')).status).toBe(400)
    expect((await request(app).get(`${api}/ai/jobs/${theirs._id}`)).status).toBe(401)
  })

  it('the job collection has a 7-day TTL, the single-flight partial unique index and the claim indexes', async () => {
    const indexes = await AiJob.collection.indexes()
    expect(indexes.find((i) => i.expireAfterSeconds)).toMatchObject({
      key: { createdAt: 1 },
      expireAfterSeconds: 7 * 24 * 60 * 60,
    })
    expect(indexes.find((i) => i.unique)).toMatchObject({
      key: { orgId: 1, key: 1 },
      partialFilterExpression: { state: { $in: ['queued', 'running'] } },
    })
    const keys = indexes.map((i) => JSON.stringify(i.key))
    expect(keys).toContain(JSON.stringify({ state: 1, lockedUntil: 1 }))
    expect(keys).toContain(JSON.stringify({ state: 1, createdAt: 1, lockedUntil: 1 }))
  })
})

describe('GET /ai/queue/stats (owners)', () => {
  it("counts this org's queued jobs and the oldest one's age; other orgs' jobs are not counted", async () => {
    const empty = await request(app).get(`${api}/ai/queue/stats`).set(bearer(ctx.tokens.owner))
    expect(empty.body.data).toEqual({ queued: 0, running: 0, oldestQueuedMs: null })

    const a = await queued()
    await queued()
    await queued(other)
    await AiJob.updateOne({ _id: a._id }, { createdAt: new Date(Date.now() - 5000) })
    const res = await request(app).get(`${api}/ai/queue/stats`).set(bearer(ctx.tokens.owner))
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ queued: 2, running: 0 })
    expect(res.body.data.oldestQueuedMs).toBeGreaterThanOrEqual(5000)
    expect(res.body.data.oldestQueuedMs).toBeLessThan(60_000)
  })

  it('owners only: admin, manager and member get 403', async () => {
    for (const role of ['admin', 'manager', 'member']) {
      expect((await request(app).get(`${api}/ai/queue/stats`).set(bearer(ctx.tokens[role]))).status).toBe(403)
    }
  })
})
