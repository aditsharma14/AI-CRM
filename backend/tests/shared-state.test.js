// Two API instances on one MongoDB, as two replicas would be: each is a fresh copy of every module (vi.resetModules),
// so anything kept in module memory is not shared. The AI limits and the single-flight must hold across them.
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { Lead } from '../src/models/CRM.js'
import { startAiStub } from './aiStub.js'
import { bearer, seedOrg } from './helpers.js'

const api = '/api/v1'
const saved = { ...process.env }
const quiet = { info: () => {}, warn: () => {}, error: () => {} }
let ctx, stub, a, b

/** A fresh copy of the app and the job service, sharing only the database connection. */
async function instance() {
  mongoose.deleteModel(/.+/) // each copy registers its models again, on the same connection
  vi.resetModules()
  const { default: app } = await import('../src/app.js')
  const jobs = await import('../src/services/aiJobService.js')
  return { app, jobs }
}

const brief = (inst, id, body = {}) =>
  request(inst.app).post(`${api}/ai/leads/${id}/brief`).set(bearer(ctx.tokens.owner)).send(body)
const newLead = () => Lead.create({ orgId: ctx.org._id, name: 'Shared', ownerId: ctx.users.owner._id })

beforeAll(async () => {
  ctx = await seedOrg('Shared')
  stub = await startAiStub()
  Object.assign(process.env, {
    AI_ENABLED: 'true',
    AI_SERVICE_URL: `http://127.0.0.1:${stub.server.address().port}`,
    AI_INTERNAL_TOKEN: 'test-ai-internal-token-0123',
  })
  a = await instance()
  b = await instance()
})

afterAll(async () => {
  process.env = saved
  vi.resetModules()
  await new Promise((resolve) => stub.server.close(resolve))
})

describe('two API instances, one database', () => {
  it('share the single-flight: 8 concurrent requests for one brief, split across A and B, are one job and one AI call', async () => {
    const lead = await newLead()
    stub.state.calls = 0
    // Both instances fetch the AI service's info first: a slow answer lines all 8 up at the job lookup together, so
    // none sees another's job yet and only the unique index can stop a second one.
    stub.state.infoDelayMs = 200
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => brief(i % 2 ? b : a, lead._id)))
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(202))
    expect(new Set(responses.map((r) => r.body.data.jobId)).size).toBe(1)
    expect(await mongoose.connection.collection('aijobs').countDocuments({ leadId: lead._id })).toBe(1)
    expect(await mongoose.connection.collection('aicalls').countDocuments({ leadId: lead._id })).toBe(1)
    stub.state.infoDelayMs = 0
    await a.jobs.drain({ workerId: 'w', log: quiet })
    expect(stub.state.calls).toBe(1)
    expect((await brief(b, lead._id)).status).toBe(200) // and the cache: B answers from the brief A's job wrote
  })

  it('share the org limit: 20 calls split across A and B, the 21st is 429 on either', async () => {
    const leads = await Promise.all(Array.from({ length: 21 }, newLead))
    // One call is already spent by the test above.
    for (const [i, lead] of leads.slice(0, 19).entries()) {
      expect((await brief(i % 2 ? b : a, lead._id)).status).toBe(202)
    }
    for (const inst of [a, b]) {
      const res = await brief(inst, leads[20]._id)
      expect(res.status).toBe(429)
      expect(res.body.error.code).toBe('AI_RATE_LIMITED')
    }
  })

  it('share the per-lead refresh limit', async () => {
    await mongoose.connection.collection('aicalls').deleteMany({})
    const lead = await newLead()
    for (let i = 0; i < 5; i++) {
      expect((await brief(i % 2 ? b : a, lead._id, { refresh: true })).status).toBe(202)
      await a.jobs.drain({ workerId: 'w', log: quiet }) // each refresh finishes before the next
    }
    expect((await brief(b, lead._id, { refresh: true })).status).toBe(429)
    expect((await brief(a, lead._id, { refresh: true })).status).toBe(429)
  })
})
