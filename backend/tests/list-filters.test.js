// List filters: each allowlisted filter narrows results; unknown keys, bad values, operators and bad sorts are 400, never ignored.
import request from 'supertest'
import mongoose from 'mongoose'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/app.js'
import { Company, Contact, Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import Note from '../src/models/Note.js'
import { Notification } from '../src/models/Logs.js'
import { bearer, seedOrg } from './helpers.js'

const api = '/api/v1'
let ctx, other, ids

// Each resource gets rows that differ on every filter, so a filter that is
// dropped (returns everything) or wrong (returns the wrong rows) both fail.
beforeAll(async () => {
  ctx = await seedOrg('Filters')
  other = await seedOrg('Other')
  const { org, users } = ctx
  const orgId = org._id
  const [coA, coB] = await Company.create([
    { orgId, name: 'Fixture A', ownerId: users.owner._id },
    { orgId, name: 'Fixture B', ownerId: users.owner._id },
  ])
  const leadX = new mongoose.Types.ObjectId()
  const leadY = new mongoose.Types.ObjectId()
  const dealX = new mongoose.Types.ObjectId()
  ids = {
    member: users.member._id.toString(),
    manager: users.manager._id.toString(),
    coA: coA._id.toString(),
    leadX: leadX.toString(),
    dealX: dealX.toString(),
  }

  await Lead.create([
    { orgId, name: 'L1', status: 'qualified', ownerId: users.member._id, companyId: coA._id },
    { orgId, name: 'L2', status: 'new', ownerId: users.member._id },
    { orgId, name: 'L3', status: 'qualified', ownerId: users.manager._id, companyId: coB._id },
    // Matches status=qualified, but belongs to another tenant.
    { orgId: other.org._id, name: 'L-other', status: 'qualified', ownerId: other.users.member._id },
  ])
  await Deal.create([
    {
      orgId,
      title: 'D1',
      value: 10,
      stageKey: 'proposal',
      status: 'open',
      ownerId: users.member._id,
      companyId: coA._id,
    },
    { orgId, title: 'D2', value: 20, stageKey: 'won', status: 'won', ownerId: users.manager._id },
    { orgId, title: 'D3', value: 30, stageKey: 'lost', status: 'lost', ownerId: users.member._id, companyId: coB._id },
  ])
  await Contact.create([
    { orgId, name: 'C1', companyId: coA._id, ownerId: users.member._id },
    { orgId, name: 'C2', companyId: coB._id, ownerId: users.member._id },
    { orgId, name: 'C3', companyId: coA._id, ownerId: users.manager._id },
  ])
  await Company.create([
    { orgId, name: 'Co1', ownerId: users.member._id },
    { orgId, name: 'Co2', ownerId: users.manager._id },
  ])
  await Note.create([
    { orgId, entityType: 'lead', entityId: leadX, body: 'N1', authorId: users.member._id },
    { orgId, entityType: 'deal', entityId: dealX, body: 'N2', authorId: users.member._id },
    { orgId, entityType: 'lead', entityId: leadY, body: 'N3', authorId: users.member._id },
  ])
  await Notification.create([
    { orgId, userId: users.owner._id, message: 'Nf1', read: false },
    { orgId, userId: users.owner._id, message: 'Nf2', read: true },
  ])
})

/** The visible label of a row, whatever the resource calls it. */
const labelOf = (row) => row.name ?? row.title ?? row.body ?? row.message

async function list(path, query) {
  return request(app).get(`${api}/${path}`).query(query).set(bearer(ctx.tokens.owner))
}

// [resource path, query, expected labels]. ':name' values are fixture ids, resolved at run time.
const NARROWS = [
  ['leads', { status: 'qualified' }, ['L1', 'L3']],
  ['leads', { ownerId: ':member' }, ['L1', 'L2']],
  ['leads', { companyId: ':coA' }, ['L1']],
  ['leads', { status: 'qualified', ownerId: ':manager' }, ['L3']],
  ['deals', { stageKey: 'won' }, ['D2']],
  ['deals', { status: 'lost' }, ['D3']],
  ['deals', { ownerId: ':member' }, ['D1', 'D3']],
  ['deals', { companyId: ':coA' }, ['D1']],
  ['deals', { status: 'open', ownerId: ':member' }, ['D1']],
  ['contacts', { companyId: ':coA' }, ['C1', 'C3']],
  ['contacts', { ownerId: ':manager' }, ['C3']],
  ['contacts', { companyId: ':coA', ownerId: ':member' }, ['C1']],
  ['companies', { ownerId: ':member' }, ['Co1']],
  ['companies', { ownerId: ':manager' }, ['Co2']],
  ['notes', { entityType: 'lead' }, ['N1', 'N3']],
  ['notes', { entityId: ':leadX' }, ['N1']],
  ['notes', { entityType: 'deal', entityId: ':dealX' }, ['N2']],
  ['notifications', { read: 'false' }, ['Nf1']],
  ['notifications', { read: 'true' }, ['Nf2']],
]

describe('supported filters narrow the list', () => {
  it.each(NARROWS)('%s ?%j', async (path, query, expected) => {
    const resolved = Object.fromEntries(
      Object.entries(query).map(([k, v]) => [k, v.startsWith(':') ? ids[v.slice(1)] : v]),
    )
    const res = await list(path, resolved)
    expect(res.status).toBe(200)
    expect(res.body.data.map(labelOf).sort()).toEqual(expected)
    expect(res.body.meta.total).toBe(expected.length)
  })
})

// One invalid value per resource for an allowlisted filter.
const BAD_VALUE = [
  ['leads', { status: 'nope' }, 'status'],
  ['deals', { status: 'nope' }, 'status'],
  ['deals', { stageKey: 'Has Spaces!' }, 'stageKey'],
  ['contacts', { companyId: 'not-an-id' }, 'companyId'],
  ['companies', { ownerId: 'xyz' }, 'ownerId'],
  ['notes', { entityType: 'planet' }, 'entityType'],
  ['notifications', { read: 'maybe' }, 'read'],
]

const PATHS = ['leads', 'deals', 'contacts', 'companies', 'notes', 'notifications']
// The field each resource's operator-injection attempt targets.
const OPERATOR_FIELD = {
  leads: 'status',
  deals: 'status',
  contacts: 'ownerId',
  companies: 'ownerId',
  notes: 'entityType',
  notifications: 'read',
}

function expectValidationError(res, mention) {
  expect(res.status).toBe(400)
  expect(res.body).toMatchObject({ success: false, data: null, error: { code: 'VALIDATION_ERROR' }, meta: null })
  if (mention) expect(res.body.error.message).toContain(mention)
}

describe('bad filters are rejected, never ignored', () => {
  it.each(PATHS)('%s: an unknown key is a 400 naming it', async (path) => {
    expectValidationError(await list(path, { bogus: '1' }), 'bogus')
  })

  it.each(BAD_VALUE)('%s: %j is a 400 naming the field', async (path, query, field) => {
    expectValidationError(await list(path, query), field)
  })

  it.each(PATHS)('%s: a raw $ operator is a 400', async (path) => {
    const field = OPERATOR_FIELD[path]
    const res = await request(app).get(`${api}/${path}?${field}[$ne]=x`).set(bearer(ctx.tokens.owner))
    expectValidationError(res)
  })

  it.each(PATHS)('%s: a repeated key (array value) is a 400', async (path) => {
    const field = OPERATOR_FIELD[path]
    const value = { read: 'true', status: 'new', entityType: 'lead' }[field] ?? ids.member
    const res = await request(app)
      .get(`${api}/${path}?${field}=${value}&${field}=${value}`)
      .set(bearer(ctx.tokens.owner))
    expectValidationError(res, field)
  })

  it.each(PATHS)('%s: an unsupported sort field is a 400', async (path) => {
    expectValidationError(await list(path, { sort: 'password' }), 'sort')
  })

  it.each(['deals', 'notes', 'notifications'])('%s: ?q= on a resource without search is a 400', async (path) => {
    expectValidationError(await list(path, { q: 'x' }), 'q')
  })

  it('still accepts the plain pagination params everywhere', async () => {
    for (const path of PATHS) {
      const res = await list(path, { page: '1', limit: '5', sort: '-createdAt' })
      expect(res.status).toBe(200)
    }
  })
})

describe('activity log', () => {
  it('takes no filters: an unknown key is a 400', async () => {
    const res = await request(app)
      .get(`${api}/notifications/activity-log?userId=${ids.member}`)
      .set(bearer(ctx.tokens.owner))
    expectValidationError(res, 'userId')
  })
})
