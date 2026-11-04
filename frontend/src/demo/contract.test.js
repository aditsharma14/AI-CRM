// The demo's half of the contract (../../../contracts/shape.js): every endpoint in contracts/api-shapes.json is called
// on the demo's handlers through the app's own axios client, and each response must match the real API's shape.
// backend/tests/api-contract.test.js checks the real API against the same file, so neither side can drift alone.
import { beforeAll, describe, expect, it } from 'vitest'

import contract from '../../../contracts/api-shapes.json'
import { checkShape } from '../../../contracts/shape.js'
import { API, server } from '../../tests/server.js'
import { api, setAccessToken } from '../api/client.js'
import { createDemoApi } from './handlers.js'
import { DEMO_ACCOUNTS, KIND, oid } from './seed.js'

/** endpoint -> response bodies */
const samples = new Map()
const record = (endpoint, body) => samples.set(endpoint, [...(samples.get(endpoint) ?? []), body])

/** Calls through the real client; errors are recorded too (their bodies are envelopes as well). */
async function call(endpoint, { path, body, params, expect: status = 200 } = {}) {
  const [method, template] = endpoint.split(' ')
  const res = await api
    .request({ method, url: path ?? template, data: body, params })
    .catch((err) => err.response ?? Promise.reject(err))
  expect(res.status, `${endpoint} -> ${JSON.stringify(res.data)}`).toBe(status)
  record(endpoint, res.data)
  return res.data.data
}
const errorSample = async (request, status) => {
  const res = await request().catch((err) => err.response)
  expect(res.status).toBe(status)
  record('error', res.data)
  return res.data
}

const id = (kind, n) => oid(KIND[kind], n)

beforeAll(async () => {
  const demo = createDemoApi({ now: () => new Date('2026-11-02T06:30:00.000Z') })
  // Kept across this file's tests: the global afterEach resets handlers, so re-add them before each call below.
  const use = () => server.use(...demo.handlers)
  use()

  const member = await call('POST /auth/login', { body: { email: DEMO_ACCOUNTS.member.email, password: 'x' } })
  const manager = await call('POST /auth/login', { body: { email: DEMO_ACCOUNTS.manager.email, password: 'x' } })
  setAccessToken(manager.accessToken)
  setAccessToken((await call('POST /auth/refresh')).accessToken)

  for (const endpoint of ['GET /org', 'GET /org/members', 'GET /org/teams', 'GET /org/pipeline-stages']) {
    await call(endpoint)
  }
  await call('GET /org/email-templates')
  await call('GET /config')

  // companies, contacts, leads: full and minimal records, as the backend test samples them
  const company = await call('POST /companies', {
    body: { name: 'Bhima Packaging', domain: 'bhima.example', industry: 'Packaging', size: '11-50' },
    expect: 201,
  })
  const bareCompany = await call('POST /companies', { body: { name: 'Bare Co' }, expect: 201 })
  await call('GET /companies')
  await call('GET /companies/:id', { path: `/companies/${company._id}` })
  await call('GET /companies/:id', { path: `/companies/${bareCompany._id}` })
  await call('PATCH /companies/:id', { path: `/companies/${id('company', 1)}`, body: { industry: 'Wholesale' } })
  await call('DELETE /companies/:id', { path: `/companies/${bareCompany._id}` })

  const contact = await call('POST /contacts', {
    body: {
      name: 'Leela Rao',
      email: 'leela@bhima.example',
      phone: '+91 98220 00001',
      title: 'Owner',
      companyId: company._id,
      tags: ['new'],
    },
    expect: 201,
  })
  const bareContact = await call('POST /contacts', { body: { name: 'Walk-in' }, expect: 201 })
  await call('GET /contacts')
  await call('GET /contacts/:id', { path: `/contacts/${contact._id}` })
  await call('GET /contacts/:id', { path: `/contacts/${bareContact._id}` })
  await call('PATCH /contacts/:id', { path: `/contacts/${id('contact', 1)}`, body: { title: 'Director' } })
  await call('DELETE /contacts/:id', { path: `/contacts/${bareContact._id}` })

  const lead = await call('POST /leads', {
    body: {
      name: 'Omkar Jadhav',
      email: 'omkar@example.in',
      phone: '+91 98220 00002',
      source: 'Website',
      status: 'qualified',
      companyId: company._id,
    },
    expect: 201,
  })
  const bareLead = await call('POST /leads', { body: { name: 'Bare lead' }, expect: 201 })
  await call('POST /leads/:id/convert', {
    path: `/leads/${lead._id}/convert`,
    body: { title: 'Omkar deal', value: 90000 },
    expect: 201,
  })
  await call('GET /leads')
  await call('GET /leads', { params: { limit: 1 } }) // a page with a nextCursor, as the backend samples it
  await call('GET /leads/:id', { path: `/leads/${id('lead', 6)}` })
  await call('GET /leads/:id', { path: `/leads/${bareLead._id}` })
  await call('PATCH /leads/:id', { path: `/leads/${id('lead', 6)}`, body: { status: 'qualified' } })
  await call('DELETE /leads/:id', { path: `/leads/${bareLead._id}` })

  // deals, with a close
  await call('POST /deals', {
    body: {
      title: 'Bhima cartons',
      value: 120000,
      probability: 60,
      stageKey: 'proposal',
      companyId: company._id,
      contactIds: [contact._id],
    },
    expect: 201,
  })
  const bareDeal = await call('POST /deals', { body: { title: 'Bare deal', value: 0 }, expect: 201 })
  await call('PATCH /deals/:id/move-stage', {
    path: `/deals/${id('deal', 9)}/move-stage`,
    body: { stageKey: 'won', wonLostReason: 'Next-day delivery' },
  })
  await call('PATCH /deals/:id/move-stage', { path: `/deals/${bareDeal._id}/move-stage`, body: { stageKey: 'new' } })
  await call('GET /deals')
  await call('GET /deals', { params: { limit: 1 } })
  await call('GET /deals/:id', { path: `/deals/${id('deal', 11)}` })
  await call('GET /deals/:id', { path: `/deals/${bareDeal._id}` })
  await call('PATCH /deals/:id', { path: `/deals/${id('deal', 11)}`, body: { probability: 100 } })
  await call('DELETE /deals/:id', { path: `/deals/${bareDeal._id}` })

  // activities, notes
  await call('POST /activities', {
    body: {
      type: 'task',
      title: 'Send samples',
      description: 'Two sizes',
      priority: 'high',
      dueDate: '2026-11-05T10:00:00.000Z',
      linkedTo: { entityType: 'deal', entityId: id('deal', 9) },
    },
    expect: 201,
  })
  await call('POST /activities', {
    body: {
      type: 'meeting',
      title: 'Visit',
      startAt: '2026-11-06T05:30:00.000Z',
      endAt: '2026-11-06T06:30:00.000Z',
      allDay: false,
    },
    expect: 201,
  })
  const bareTask = await call('POST /activities', { body: { type: 'call', title: 'Call back' }, expect: 201 })
  await call('GET /activities')
  await call('GET /activities/:id', { path: `/activities/${id('activity', 1)}` })
  await call('GET /activities/:id', { path: `/activities/${bareTask._id}` })
  await call('PATCH /activities/:id', { path: `/activities/${id('activity', 1)}`, body: { priority: 'medium' } })
  await call('PATCH /activities/:id/toggle-status', { path: `/activities/${id('activity', 1)}/toggle-status` })
  await call('DELETE /activities/:id', { path: `/activities/${bareTask._id}` })

  await call('POST /notes', { body: { entityType: 'deal', entityId: id('deal', 9), body: 'Confirmed.' }, expect: 201 })
  const extra = await call('POST /notes', {
    body: { entityType: 'deal', entityId: id('deal', 9), body: 'Second' },
    expect: 201,
  })
  await call('GET /notes', { params: { entityType: 'deal', entityId: id('deal', 9) } })
  await call('PATCH /notes/:id', { path: `/notes/${id('note', 1)}`, body: { body: 'Volume confirmed.' } })
  await call('DELETE /notes/:id', { path: `/notes/${extra._id}` })

  // the AI lead brief: fresh, then cached, then regenerated (a lead with history, so citations are sampled)
  const briefPath = `/ai/leads/${id('lead', 1)}/brief`
  await call('POST /ai/leads/:id/brief', { path: briefPath, body: {} })
  await call('POST /ai/leads/:id/brief', { path: briefPath, body: {} })
  await call('POST /ai/leads/:id/brief', { path: briefPath, body: { refresh: true } })
  await call('GET /dashboard/overview')
  await call('GET /dashboard/reports')
  await call('GET /search', { params: { q: 'Sahyadri' } })
  const notifications = await call('GET /notifications')
  await call('PATCH /notifications/:id/read', { path: `/notifications/${notifications[0]._id}/read` })
  await call('PATCH /notifications/read-all')

  // the error envelope: 404, 403 (the member changing the manager's deal), 400, 401, and the demo's own 400
  await errorSample(() => api.get(`/leads/${'0'.repeat(24)}`), 404)
  setAccessToken(member.accessToken)
  await errorSample(() => api.patch(`/deals/${id('deal', 6)}`, { title: 'Mine now' }), 403)
  setAccessToken(manager.accessToken)
  await errorSample(() => api.post('/leads', {}), 400)
  record('error', await (await fetch(`${API}/leads`)).json())
  const notAvailable = await errorSample(
    () => api.post('/org/members/invite', { email: 'x@y.example', role: 'member' }),
    400,
  )
  expect(notAvailable.error.code).toBe('NOT_AVAILABLE_IN_DEMO')

  await call('POST /auth/logout')
}, 30_000)

describe('the demo matches contracts/api-shapes.json', () => {
  it('answers every endpoint in the contract, and only those', () => {
    expect([...samples.keys()].sort()).toEqual(Object.keys(contract).sort())
  })

  it.each(Object.keys(contract))('%s', (endpoint) => {
    for (const body of samples.get(endpoint) ?? []) expect(checkShape(contract[endpoint], body)).toEqual([])
  })
})
