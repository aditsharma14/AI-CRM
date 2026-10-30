// Update scoping for the owned resources outside the main leads/deals matrix.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/app.js'
import { RENAME, bearer, makeRecord, seedOrg } from './helpers.js'

const RESOURCES = ['contacts', 'companies', 'activities', 'notes']

const cases = RESOURCES.flatMap((resource) => [
  { resource, role: 'member', whose: 'own', status: 200 },
  { resource, role: 'member', whose: 'others', status: 403 },
  { resource, role: 'manager', whose: 'others', status: 200 },
])

let ctx

beforeAll(async () => {
  ctx = await seedOrg('Other')
})

describe('ownership on contacts, companies, activities, notes', () => {
  it.each(cases)('$resource: $role update on $whose record -> $status', async ({ resource, role, whose, status }) => {
    const ownerUser = whose === 'own' ? ctx.users[role] : ctx.users.owner
    const record = await makeRecord(resource, ctx.org, ownerUser)
    const res = await request(app).patch(`/api/v1/${resource}/${record._id}`).set(bearer(ctx.tokens[role])).send(RENAME[resource])
    expect(res.status).toBe(status)
    if (status === 403) expect(res.body.error.code).toBe('FORBIDDEN')
  })
})
