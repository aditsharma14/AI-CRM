// Org A must get 404 — never 403 — on every :id route for org B's records.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/app.js'
import { MODELS, RENAME, bearer, makeRecord, seedOrg } from './helpers.js'

const ID_ROUTES = [
  ['leads', 'get', ''],
  ['leads', 'patch', ''],
  ['leads', 'delete', ''],
  ['leads', 'post', '/convert'],
  ['deals', 'get', ''],
  ['deals', 'patch', ''],
  ['deals', 'delete', ''],
  ['deals', 'patch', '/move-stage'],
  ['activities', 'get', ''],
  ['activities', 'patch', ''],
  ['activities', 'patch', '/toggle-status'],
  ['activities', 'delete', ''],
  ['contacts', 'get', ''],
  ['contacts', 'patch', ''],
  ['contacts', 'delete', ''],
  ['companies', 'get', ''],
  ['companies', 'patch', ''],
  ['companies', 'delete', ''],
  ['notes', 'get', ''],
  ['notes', 'patch', ''],
  ['notes', 'delete', ''],
].map(([resource, method, suffix]) => ({ resource, method, suffix }))

const bodyFor = (resource, suffix) =>
  suffix === '/move-stage' ? { stageKey: 'qualified' } : suffix ? undefined : RENAME[resource]

let orgA
let orgB

beforeAll(async () => {
  orgA = await seedOrg('A')
  orgB = await seedOrg('B')
})

describe('cross-org isolation', () => {
  it.each(ID_ROUTES)(
    "org A owner: $method /$resource/:id$suffix on org B's record -> 404",
    async ({ resource, method, suffix }) => {
      const record = await makeRecord(resource, orgB.org, orgB.users.member)
      const before = await MODELS[resource].findById(record._id).lean()

      let req = request(app)[method](`/api/v1/${resource}/${record._id}${suffix}`).set(bearer(orgA.tokens.owner))
      const body = bodyFor(resource, suffix)
      if (body && method !== 'get' && method !== 'delete') req = req.send(body)
      const res = await req

      expect(res.status).toBe(404)
      expect(res.body).toMatchObject({ success: false, data: null, error: { code: 'NOT_FOUND' }, meta: null })
      expect(await MODELS[resource].findById(record._id).lean()).toEqual(before)
    },
  )

  it("org A's list never contains org B's records", async () => {
    const record = await makeRecord('leads', orgB.org, orgB.users.owner)
    const res = await request(app).get('/api/v1/leads').set(bearer(orgA.tokens.owner))
    expect(res.status).toBe(200)
    expect(res.body.data.map((d) => d._id)).not.toContain(record._id.toString())
  })
})
