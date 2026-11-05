// POST /api/v1/ai/leads/:id/brief against a stub AI service: tenancy, kill switch, cache and single-flight, rate
// limits, error mapping, grounding, the minimal bundle, truncation, the log line, and cleanup when a lead is deleted.
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import { env } from '../src/config/index.js'
import Activity from '../src/models/Activity.js'
import AiBrief from '../src/models/AiBrief.js'
import { Company, Lead } from '../src/models/CRM.js'
import Note from '../src/models/Note.js'
import { generateLeadBrief, resetAiBriefState } from '../src/services/aiBriefService.js'
import { goodAnswer, META, startAiStub } from './aiStub.js'
import { bearer, seedOrg } from './helpers.js'

const api = '/api/v1'
const TOKEN = 'test-ai-internal-token-0123'
let ctx, other, stub, saved

const brief = (id, body = {}, token = ctx.tokens.owner) =>
  request(app).post(`${api}/ai/leads/${id}/brief`).set(bearer(token)).send(body)

async function makeLead(owner = ctx, extra = {}) {
  const company = await Company.create({
    orgId: owner.org._id,
    name: 'Sahyadri Packaging',
    ownerId: owner.users.owner._id,
  })
  return Lead.create({
    orgId: owner.org._id,
    name: 'Ravi Deshpande',
    email: 'ravi@sahyadri.example',
    phone: '+91 98200 22222',
    status: 'qualified',
    source: 'IndiaMART',
    companyId: company._id,
    ownerId: owner.users.member._id,
    ...extra,
  })
}

beforeAll(async () => {
  ctx = await seedOrg('AI')
  other = await seedOrg('AI other')
  stub = await startAiStub()
  saved = { ...env }
})

beforeEach(() => {
  Object.assign(env, {
    aiEnabled: true,
    aiServiceUrl: `http://127.0.0.1:${stub.server.address().port}`,
    aiInternalToken: TOKEN,
    aiTimeoutMs: 5000,
  })
  Object.assign(stub.state, { calls: 0, bodies: [], headers: [], reply: null, delayMs: 0 })
  resetAiBriefState()
})

afterEach(() => Object.assign(env, saved))
afterAll(() => new Promise((resolve) => stub.server.close(resolve)))

describe('tenancy and the kill switch', () => {
  it('a lead from another org is 404 and the AI service is never called', async () => {
    const theirs = await makeLead(other)
    const res = await brief(theirs._id)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(stub.state.calls).toBe(0)
  })

  it('an unknown or malformed id is 404 / 400, without calling the AI service', async () => {
    expect((await brief(new mongoose.Types.ObjectId())).status).toBe(404)
    expect((await brief('not-an-id')).status).toBe(400)
    expect(stub.state.calls).toBe(0)
  })

  it('needs a signed-in user', async () => {
    const lead = await makeLead()
    expect((await request(app).post(`${api}/ai/leads/${lead._id}/brief`)).status).toBe(401)
  })

  it('every role may brief any lead in its org (reads are org-wide)', async () => {
    const lead = await makeLead(ctx, { ownerId: ctx.users.owner._id })
    for (const role of ['owner', 'admin', 'manager', 'member']) {
      expect((await brief(lead._id, {}, ctx.tokens[role])).status).toBe(200)
    }
  })

  it('AI_ENABLED=false: 503 AI_UNAVAILABLE, no call, and /config says so', async () => {
    env.aiEnabled = false
    const lead = await makeLead()
    const res = await brief(lead._id)
    expect(res.status).toBe(503)
    expect(res.body.error).toEqual({ code: 'AI_UNAVAILABLE', message: expect.stringMatching(/turned off/) })
    expect(stub.state.calls).toBe(0)
    expect((await request(app).get(`${api}/config`)).body.data.aiEnabled).toBe(false)
    env.aiEnabled = true
    expect((await request(app).get(`${api}/config`)).body.data.aiEnabled).toBe(true)
  })

  it('rejects unknown body fields', async () => {
    const lead = await makeLead()
    expect((await brief(lead._id, { refresh: true, orgId: other.org._id })).status).toBe(400)
  })
})

describe('the brief', () => {
  it('returns the brief with where it came from, and sends the internal token', async () => {
    const lead = await makeLead()
    const res = await brief(lead._id)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      summary: 'Ravi Deshpande is a qualified lead.',
      nextAction: { action: expect.any(String), dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      followUpEmail: { subject: 'Following up', body: expect.any(String) },
      citations: [],
      cached: false,
      provider: 'fake',
      model: 'fake',
      promptVersion: 'lead-brief/1',
      truncated: 0,
      generatedAt: expect.any(String),
    })
    expect(stub.state.headers.every((h) => h['x-internal-token'] === TOKEN)).toBe(true)
  })

  it('tells the AI service how long it will wait (X-Deadline-Ms), so a retry that cannot finish is skipped', async () => {
    const lead = await makeLead()
    await brief(lead._id)
    // The brief call is the last request; Express aborts AI_TIMEOUT_MS + ABORT_MARGIN_MS after sending it.
    expect(stub.state.headers.at(-1)['x-deadline-ms']).toBe(String(env.aiTimeoutMs))
  })

  it('the bundle carries no email, phone, user names or internal ids beyond history ids', async () => {
    const lead = await makeLead()
    const call = await Activity.create({
      orgId: ctx.org._id,
      type: 'call',
      title: 'Discovery call',
      description: 'Wants 40 printers',
      assigneeId: ctx.users.member._id,
      linkedTo: { entityType: 'lead', entityId: lead._id },
      status: 'done',
    })
    const note = await Note.create({
      orgId: ctx.org._id,
      entityType: 'lead',
      entityId: lead._id,
      body: 'Budget approved',
      authorId: ctx.users.owner._id,
    })
    await brief(lead._id)
    const [sent] = stub.state.bodies
    expect(Object.keys(sent).sort()).toEqual(['history', 'lead', 'today', 'truncated'])
    expect(Object.keys(sent.lead).sort()).toEqual(['company', 'createdAt', 'name', 'score', 'source', 'status'])
    expect(sent.lead.company).toBe('Sahyadri Packaging')
    expect(sent.history.map((h) => h.id).sort()).toEqual([call._id, note._id].map(String).sort())
    const text = JSON.stringify(sent)
    for (const leak of ['ravi@sahyadri.example', '98200', String(ctx.org._id), String(lead._id), 'owner 1', 'member']) {
      expect(text).not.toContain(leak)
    }
    for (const user of Object.values(ctx.users)) {
      expect(text).not.toContain(String(user._id))
      expect(text).not.toContain(user.name)
    }
  })

  it('caps the history at 20 items and about 12,000 characters, dropping the oldest first', async () => {
    const lead = await makeLead()
    const base = Date.UTC(2026, 9, 1)
    await Note.insertMany(
      Array.from({ length: 25 }, (_, i) => ({
        orgId: ctx.org._id,
        entityType: 'lead',
        entityId: lead._id,
        body: `${i} `.padEnd(900, 'x'),
        authorId: ctx.users.owner._id,
        createdAt: new Date(base + i * 3_600_000),
      })),
    )
    await brief(lead._id)
    const [sent] = stub.state.bodies
    const chars = sent.history.reduce((n, h) => n + (h.title ?? '').length + h.text.length, 0)
    expect(chars).toBeLessThanOrEqual(12_000)
    expect(sent.history.length).toBe(13) // 13 x 900 fits, a 14th would not
    expect(sent.truncated).toBe(25 - 13)
    expect(sent.history.map((h) => Number(h.text.split(' ')[0]))).toEqual(
      Array.from({ length: 13 }, (_, i) => 24 - i), // the newest 13, newest first
    )
  })

  it('cuts a single long note to 1,000 characters', async () => {
    const lead = await makeLead()
    await Note.create({
      orgId: ctx.org._id,
      entityType: 'lead',
      entityId: lead._id,
      body: 'y'.repeat(4000),
      authorId: ctx.users.owner._id,
    })
    await brief(lead._id)
    expect(stub.state.bodies[0].history[0].text).toHaveLength(1000)
  })

  it('drops citations that point outside the bundle', async () => {
    const lead = await makeLead()
    await Note.create({
      orgId: ctx.org._id,
      entityType: 'lead',
      entityId: lead._id,
      body: 'Budget approved',
      authorId: ctx.users.owner._id,
    })
    stub.state.reply = (body) => {
      const answer = goodAnswer(body)
      answer.brief.citations = [{ claim: 'x', sourceIds: [body.history[0].id, String(new mongoose.Types.ObjectId())] }]
      return [200, answer]
    }
    const res = await brief(lead._id)
    expect(res.status).toBe(200)
    expect(res.body.data.citations).toEqual([{ claim: 'x', sourceIds: [stub.state.bodies[0].history[0].id] }])
  })
})

describe('cache and single-flight', () => {
  it('the same input is answered from the cache: one AI call', async () => {
    const lead = await makeLead()
    expect((await brief(lead._id)).body.data.cached).toBe(false)
    const again = await brief(lead._id)
    expect(again.body.data.cached).toBe(true)
    expect(stub.state.calls).toBe(1)
  })

  it('two leads changed in the same millisecond, with no history, do not share a cache entry', async () => {
    const at = new Date('2026-11-01T10:00:00.000Z')
    const [a, b] = await Promise.all([makeLead(ctx, { name: 'Lead A' }), makeLead(ctx, { name: 'Lead B' })])
    await Lead.updateMany({ _id: { $in: [a._id, b._id] } }, { $set: { updatedAt: at } }, { timestamps: false })
    expect((await brief(a._id)).body.data.summary).toMatch(/^Lead A/)
    const second = await brief(b._id)
    expect(second.body.data).toMatchObject({ cached: false, summary: expect.stringMatching(/^Lead B/) })
    expect(stub.state.calls).toBe(2)
  })

  it('refresh: true bypasses the cache and replaces the entry', async () => {
    const lead = await makeLead()
    await brief(lead._id)
    const fresh = await brief(lead._id, { refresh: true })
    expect(fresh.body.data.cached).toBe(false)
    expect(stub.state.calls).toBe(2)
    expect(await AiBrief.countDocuments({ orgId: ctx.org._id, leadId: lead._id })).toBe(1)
  })

  it('an edited note or an edited lead changes the key', async () => {
    const lead = await makeLead()
    const note = await Note.create({
      orgId: ctx.org._id,
      entityType: 'lead',
      entityId: lead._id,
      body: 'v1',
      authorId: ctx.users.owner._id,
    })
    await brief(lead._id)
    await Note.updateOne({ _id: note._id }, { body: 'v2', updatedAt: new Date(Date.now() + 1000) })
    expect((await brief(lead._id)).body.data.cached).toBe(false)
    await Lead.updateOne({ _id: lead._id }, { status: 'contacted', updatedAt: new Date(Date.now() + 2000) })
    expect((await brief(lead._id)).body.data.cached).toBe(false)
    expect(stub.state.calls).toBe(3)
  })

  it('cache entries are per org: the same key in another org is not shared', async () => {
    const mine = await makeLead()
    await brief(mine._id)
    const entry = await AiBrief.findOne({ leadId: mine._id }).lean()
    expect(String(entry.orgId)).toBe(String(ctx.org._id))
  })

  it('two concurrent requests for the same brief make one AI call', async () => {
    const lead = await makeLead()
    stub.state.delayMs = 300
    const [a, b] = await Promise.all([brief(lead._id), brief(lead._id)])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(stub.state.calls).toBe(1)
    expect(a.body.data.summary).toBe(b.body.data.summary)
  })

  it('the cache collection expires entries (TTL index) and is unique per org and key', async () => {
    await AiBrief.syncIndexes()
    const indexes = await AiBrief.collection.indexes()
    expect(indexes.find((i) => i.expireAfterSeconds)).toMatchObject({
      key: { createdAt: 1 },
      expireAfterSeconds: 604800,
    })
    expect(indexes.find((i) => i.unique)).toMatchObject({ key: { orgId: 1, key: 1 } })
  })
})

describe('rate limits (only calls that reach the AI service count)', () => {
  it('20 per org per hour; cache hits are free; the 21st is 429 AI_RATE_LIMITED', async () => {
    const leads = await Promise.all(Array.from({ length: 21 }, () => makeLead()))
    for (const lead of leads.slice(0, 20)) expect((await brief(lead._id)).status).toBe(200)
    expect((await brief(leads[0]._id)).status).toBe(200) // a cache hit
    const res = await brief(leads[20]._id)
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('AI_RATE_LIMITED')
    expect(res.body.error.message).toMatch(/try again in \d+ minutes?/i)
    expect(stub.state.calls).toBe(20)
    expect((await brief((await makeLead(other))._id, {}, other.tokens.owner)).status).toBe(200) // other orgs unaffected
  })

  it('refresh is capped at 5 per lead per hour', async () => {
    const lead = await makeLead()
    for (let i = 0; i < 5; i++) expect((await brief(lead._id, { refresh: true })).status).toBe(200)
    const res = await brief(lead._id, { refresh: true })
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('AI_RATE_LIMITED')
    expect((await brief(lead._id)).status).toBe(200) // the cached brief is still served
  })
})

describe('errors from the AI service', () => {
  it.each([
    [502, 'BAD_OUTPUT', 502, 'AI_BAD_OUTPUT'],
    [504, 'TIMEOUT', 503, 'AI_UNAVAILABLE'],
    [503, 'PROVIDER_ERROR', 503, 'AI_UNAVAILABLE'],
    [429, 'RATE_LIMITED', 429, 'AI_RATE_LIMITED'],
    [401, 'UNAUTHORIZED', 503, 'AI_UNAVAILABLE'],
  ])('%i %s -> %i %s, and nothing is cached', async (status, code, expected, ours) => {
    const lead = await makeLead()
    stub.state.reply = () => [status, { error: { code, message: 'x' }, meta: META }]
    const res = await brief(lead._id)
    expect(res.status).toBe(expected)
    expect(res.body.error.code).toBe(ours)
    expect(await AiBrief.countDocuments({ leadId: lead._id })).toBe(0)
  })

  it('an answer that fails our own schema is AI_BAD_OUTPUT', async () => {
    const lead = await makeLead()
    stub.state.reply = () => [200, { brief: { summary: 'only this' }, meta: META }]
    expect((await brief(lead._id)).body.error.code).toBe('AI_BAD_OUTPUT')
  })

  it('an unreachable service is AI_UNAVAILABLE', async () => {
    env.aiServiceUrl = 'http://127.0.0.1:1'
    const lead = await makeLead()
    const res = await brief(lead._id)
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('AI_UNAVAILABLE')
  })

  it('gives up after AI_TIMEOUT_MS plus a margin: AI_UNAVAILABLE, saying it took too long', async () => {
    env.aiTimeoutMs = 200
    stub.state.delayMs = 2500
    const lead = await makeLead()
    const res = await brief(lead._id)
    expect(res.status).toBe(503)
    expect(res.body.error).toEqual({ code: 'AI_UNAVAILABLE', message: expect.stringMatching(/too long/) })
  })
})

describe('the log line', () => {
  it('one line per call with numbers, and no content', async () => {
    const lead = await makeLead()
    await Note.create({
      orgId: ctx.org._id,
      entityType: 'lead',
      entityId: lead._id,
      body: 'Secret budget note',
      authorId: ctx.users.owner._id,
    })
    const lines = []
    const log = { info: (obj, msg) => lines.push({ ...obj, msg }) }
    const actor = { id: String(ctx.users.owner._id), orgId: String(ctx.org._id), role: 'owner' }
    await generateLeadBrief(actor, String(lead._id), {}, log)
    await generateLeadBrief(actor, String(lead._id), {}, log)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      event: 'ai_lead_brief',
      orgId: String(ctx.org._id),
      provider: 'fake',
      model: 'fake',
      promptVersion: 'lead-brief/1',
      inputTokens: 900,
      outputTokens: 200,
      costUsd: 0,
      cacheHit: false,
      latencyMs: expect.any(Number),
      citationsRejected: 0,
      outcome: 'ok',
    })
    expect(lines[1]).toMatchObject({ cacheHit: true, inputTokens: 0, outputTokens: 0 })
    const text = JSON.stringify(lines)
    for (const content of ['Ravi', 'Sahyadri', 'Secret budget', 'Following up']) expect(text).not.toContain(content)
  })
})

describe('lifecycle', () => {
  it('deleting a lead deletes its cached briefs, and only its own', async () => {
    const lead = await makeLead()
    const keep = await makeLead()
    await brief(lead._id)
    await brief(keep._id)
    const res = await request(app).delete(`${api}/leads/${lead._id}`).set(bearer(ctx.tokens.owner))
    expect(res.status).toBe(200)
    expect(await AiBrief.countDocuments({ leadId: lead._id })).toBe(0)
    expect(await AiBrief.countDocuments({ leadId: keep._id })).toBe(1)
  })
})
