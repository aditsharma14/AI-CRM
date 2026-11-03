// The real API's half of the demo contract (../../contracts/shape.js): every endpoint the GitHub Pages demo imitates
// is called here with full and minimal records, and each response must match contracts/api-shapes.json exactly.
// The frontend checks the demo against the same file, so a shape can't change on one side only.
// After an intended API change: UPDATE_CONTRACT=1 npx vitest run tests/api-contract.test.js, then review the diff.
import { readFileSync, writeFileSync } from 'node:fs'

import request from 'supertest'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { checkShape, mergeShapes, shapeOf } from '../../contracts/shape.js'
import app from '../src/app.js'
import Organization from '../src/models/Organization.js'
import { asRefreshCookie, createUserWithPassword, refreshCookieFrom } from './factories.js'

const CONTRACT = new URL('../../contracts/api-shapes.json', import.meta.url)
const UPDATE = process.env.UPDATE_CONTRACT === '1'
// Objects keyed by data, not by field name: the contract says "any key, values of this shape".
const MAPS = { 'GET /dashboard/overview': ['data', 'leadsByStatus'] }

/** Replaces the object at `path` in a shape with { $map: <its values' merged shape> }. */
function asMap(shape, [key, ...rest]) {
  if (rest.length) return { ...shape, [key]: asMap(shape[key], rest) }
  return { ...shape, [key]: { $map: Object.values(shape[key]).reduce(mergeShapes) } }
}

/** endpoint ("METHOD /path/:param") -> response bodies seen */
const samples = new Map()
let token = ''
let cookie = ''

/** One call as the signed-in owner (or `as`), recorded under `endpoint`, whose status must be `status`. */
async function hit(endpoint, status, { path, body, query, as = token, withCookie = false, method: verb } = {}) {
  const [first, template] = endpoint.split(' ')
  const method = verb ?? (template ? first : 'GET')
  const req = request(app)[method.toLowerCase()](`/api/v1${path ?? template}`)
  if (as) req.set('Authorization', `Bearer ${as}`)
  if (withCookie) req.set('Cookie', cookie)
  if (query) req.query(query)
  const res = await (body === undefined ? req : req.send(body))
  expect(res.status, `${endpoint} -> ${JSON.stringify(res.body)}`).toBe(status)
  samples.set(endpoint, [...(samples.get(endpoint) ?? []), res.body])
  return res
}
const dataOf = async (...args) => (await hit(...args)).body.data

// Console noise from the dev-only invite/reset link logs isn't part of any response.
vi.spyOn(console, 'log').mockImplementation(() => {})

beforeAll(async () => {
  const email = `contract.${Date.now()}@contract.test`
  const reg = await request(app)
    .post('/api/v1/auth/register-org')
    .send({ orgName: 'Contract Co', name: 'Asha Owner', email, password: 'password123' })
  const orgId = reg.body.data.user.org.id
  await Organization.updateOne({ _id: orgId }, { currency: 'INR' })
  const member = await createUserWithPassword({ _id: orgId }, { role: 'member' })

  // ---- auth (the session endpoints the demo answers)
  const login = await hit('POST /auth/login', 200, { as: '', body: { email, password: 'password123' } })
  token = login.body.data.accessToken
  cookie = asRefreshCookie(refreshCookieFrom(login))
  // Both before and after the avatar is set, so avatarUrl is string|null in both responses.
  for (let round = 0; round < 2; round += 1) {
    const refreshed = await hit('POST /auth/refresh', 200, { as: '', withCookie: true })
    token = refreshed.body.data.accessToken
    cookie = asRefreshCookie(refreshCookieFrom(refreshed))
    if (round === 0) {
      await request(app)
        .patch('/api/v1/org/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatarUrl: 'https://example.com/asha.png' })
      await hit('POST /auth/login', 200, { as: '', body: { email, password: 'password123' } })
    }
  }
  const memberLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: member.email, password: member.password })
  const memberToken = memberLogin.body.data.accessToken

  // ---- org reads
  await request(app).post('/api/v1/org/teams').set('Authorization', `Bearer ${token}`).send({ name: 'West zone' })
  await hit('GET /org', 200)
  await hit('GET /org/members', 200)
  await hit('GET /org/teams', 200)
  await hit('GET /org/pipeline-stages', 200)
  await request(app)
    .post('/api/v1/org/email-templates')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Follow-up', subject: 'Following up', body: 'Hi {{name}}' })
  await hit('GET /org/email-templates', 200)
  await hit('GET /config', 200, { as: '' })

  // ---- companies, contacts
  const company = await dataOf('POST /companies', 201, {
    body: { name: 'Sahyadri Traders', domain: 'sahyadri.example', industry: 'Retail', size: '11-50' },
  })
  const bare = await dataOf('POST /companies', 201, { body: { name: 'Bare Co' } })
  await hit('GET /companies', 200)
  await hit('GET /companies/:id', 200, { path: `/companies/${company._id}` })
  await hit('PATCH /companies/:id', 200, { path: `/companies/${company._id}`, body: { industry: 'Wholesale' } })
  await hit('GET /companies/:id', 200, { path: `/companies/${bare._id}` })
  await hit('DELETE /companies/:id', 200, { path: `/companies/${bare._id}` })

  const contact = await dataOf('POST /contacts', 201, {
    body: {
      name: 'Meera Kulkarni',
      email: 'meera@sahyadri.example',
      phone: '+91 98200 11111',
      title: 'Purchase head',
      companyId: company._id,
      tags: ['decision-maker'],
    },
  })
  const bareContact = await dataOf('POST /contacts', 201, { body: { name: 'Walk-in' } })
  await hit('GET /contacts', 200)
  await hit('GET /contacts/:id', 200, { path: `/contacts/${contact._id}` })
  await hit('PATCH /contacts/:id', 200, { path: `/contacts/${contact._id}`, body: { title: 'Director' } })
  await hit('GET /contacts/:id', 200, { path: `/contacts/${bareContact._id}` })
  await hit('DELETE /contacts/:id', 200, { path: `/contacts/${bareContact._id}` })

  // ---- leads, convert
  const lead = await dataOf('POST /leads', 201, {
    body: {
      name: 'Ravi Deshpande (Sahyadri)',
      email: 'ravi@example.in',
      phone: '+91 98220 22222',
      source: 'IndiaMART',
      status: 'qualified',
      companyId: company._id,
    },
  })
  const toConvert = await dataOf('POST /leads', 201, { body: { name: 'Convert me', companyId: company._id } })
  const bareLead = await dataOf('POST /leads', 201, { body: { name: 'Bare lead' } })
  const converted = await dataOf('POST /leads/:id/convert', 201, {
    path: `/leads/${toConvert._id}/convert`,
    body: { title: 'Convert me deal', value: 150000 },
  })
  await hit('GET /leads', 200)
  await hit('GET /leads', 200, { query: { limit: 1 } }) // a page with a nextCursor; the one above ends with null
  await hit('GET /leads/:id', 200, { path: `/leads/${lead._id}` })
  await hit('PATCH /leads/:id', 200, { path: `/leads/${lead._id}`, body: { status: 'contacted' } })
  await hit('GET /leads/:id', 200, { path: `/leads/${bareLead._id}` })
  await hit('DELETE /leads/:id', 200, { path: `/leads/${bareLead._id}` })

  // ---- deals, move-stage with a close
  const deal = await dataOf('POST /deals', 201, {
    body: {
      title: 'Sahyadri annual stationery contract',
      value: 480000,
      probability: 60,
      stageKey: 'proposal',
      companyId: company._id,
      contactIds: [contact._id],
    },
  })
  const bareDeal = await dataOf('POST /deals', 201, { body: { title: 'Bare deal', value: 0 } })
  await hit('PATCH /deals/:id/move-stage', 200, {
    path: `/deals/${deal._id}/move-stage`,
    body: { stageKey: 'won', wonLostReason: 'Best price' },
  })
  await hit('PATCH /deals/:id/move-stage', 200, {
    path: `/deals/${bareDeal._id}/move-stage`,
    body: { stageKey: 'new' },
  })
  // A deal that came from a lead keeps convertedFromLeadId through every write.
  await hit('PATCH /deals/:id/move-stage', 200, {
    path: `/deals/${converted._id}/move-stage`,
    body: { stageKey: 'qualified' },
  })
  await hit('PATCH /deals/:id', 200, { path: `/deals/${converted._id}`, body: { probability: 30 } })
  await hit('GET /deals/:id', 200, { path: `/deals/${converted._id}` })
  await hit('GET /deals', 200)
  await hit('GET /deals', 200, { query: { limit: 1 } })
  await hit('GET /deals/:id', 200, { path: `/deals/${deal._id}` })
  await hit('PATCH /deals/:id', 200, { path: `/deals/${deal._id}`, body: { probability: 100 } })
  await hit('GET /deals/:id', 200, { path: `/deals/${bareDeal._id}` })
  await hit('DELETE /deals/:id', 200, { path: `/deals/${bareDeal._id}` })

  // ---- activities (task and event), notes
  const task = await dataOf('POST /activities', 201, {
    body: {
      type: 'task',
      title: 'Send revised quote',
      description: 'With the GST breakup',
      priority: 'high',
      dueDate: '2026-11-05T10:00:00.000Z',
      linkedTo: { entityType: 'deal', entityId: deal._id },
    },
  })
  await hit('POST /activities', 201, {
    body: {
      type: 'meeting',
      title: 'Site visit',
      startAt: '2026-11-06T05:30:00.000Z',
      endAt: '2026-11-06T06:30:00.000Z',
      allDay: false,
    },
  })
  const bareTask = await dataOf('POST /activities', 201, { body: { type: 'call', title: 'Call back' } })
  await hit('GET /activities', 200)
  await hit('GET /activities/:id', 200, { path: `/activities/${task._id}` })
  await hit('PATCH /activities/:id', 200, { path: `/activities/${task._id}`, body: { priority: 'medium' } })
  await hit('PATCH /activities/:id/toggle-status', 200, { path: `/activities/${task._id}/toggle-status` })
  await hit('GET /activities/:id', 200, { path: `/activities/${bareTask._id}` })
  await hit('DELETE /activities/:id', 200, { path: `/activities/${bareTask._id}` })

  const note = await dataOf('POST /notes', 201, {
    body: { entityType: 'deal', entityId: deal._id, body: 'Wants delivery before Diwali.' },
  })
  const extra = await dataOf('POST /notes', 201, { body: { entityType: 'deal', entityId: deal._id, body: 'Second' } })
  await hit('POST /notes', 201, {
    as: memberToken,
    body: { entityType: 'deal', entityId: deal._id, body: 'Called them back.' },
  })
  await hit('GET /notes', 200, { query: { entityType: 'deal', entityId: deal._id } })
  await hit('PATCH /notes/:id', 200, { path: `/notes/${note._id}`, body: { body: 'Wants delivery before Diwali!' } })
  await hit('DELETE /notes/:id', 200, { path: `/notes/${extra._id}` })

  // ---- insights, notifications
  await hit('GET /dashboard/overview', 200)
  await hit('GET /dashboard/reports', 200)
  // Minimal records that match too, so search's optional fields are optional in the contract.
  for (const [path, body] of [
    ['/leads', { name: 'Sahyadri walk-in' }],
    ['/contacts', { name: 'Sahyadri front desk' }],
    ['/companies', { name: 'Sahyadri Annex' }],
    ['/deals', { title: 'Sahyadri spot order', value: 5000 }],
  ]) {
    await request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body)
  }
  await hit('GET /search', 200, { query: { q: 'Sahyadri' } })
  const notifications = await dataOf('GET /notifications', 200)
  await hit('PATCH /notifications/:id/read', 200, { path: `/notifications/${notifications[0]._id}/read` })
  await hit('PATCH /notifications/read-all', 200)

  // ---- the error envelope, one of each status the demo produces
  await hit('error', 404, { path: `/leads/${'0'.repeat(24)}` })
  const asMember = { as: memberToken, path: `/deals/${deal._id}`, body: { title: 'Mine now' } }
  await hit('error', 403, { ...asMember, method: 'PATCH' })
  await hit('error', 400, { path: '/leads', method: 'POST', body: {} })
  await hit('error', 401, { path: '/leads', as: '' })

  await hit('POST /auth/logout', 200, { as: '', withCookie: true })

  if (UPDATE) {
    const contract = Object.fromEntries(
      [...samples.keys()].sort().map((key) => {
        const shape = samples.get(key).map(shapeOf).reduce(mergeShapes)
        return [key, MAPS[key] ? asMap(shape, MAPS[key]) : shape]
      }),
    )
    writeFileSync(CONTRACT, `${JSON.stringify(contract, null, 2)}\n`)
  }
})

describe('the real API matches contracts/api-shapes.json', () => {
  const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'))

  it('covers exactly the endpoints the contract lists', () => {
    expect([...samples.keys()].sort()).toEqual(Object.keys(contract).sort())
  })

  it.each(Object.keys(contract))('%s', (endpoint) => {
    for (const body of samples.get(endpoint) ?? []) expect(checkShape(contract[endpoint], body)).toEqual([])
  })
})
