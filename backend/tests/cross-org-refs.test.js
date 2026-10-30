// A reference to another org's document (or to nothing) is a 400 naming the field, on create and update.
import mongoose from 'mongoose'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import Activity from '../src/models/Activity.js'
import { Contact, Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import Note from '../src/models/Note.js'
import Organization from '../src/models/Organization.js'
import { bearer, makeRecord, seedOrg } from './helpers.js'

let A
let B
// Org B's documents, which org A must never be able to point at.
const theirs = {}

beforeAll(async () => {
  A = await seedOrg('A')
  B = await seedOrg('B')
  theirs.company = await makeRecord('companies', B.org, B.users.owner)
  theirs.contact = await makeRecord('contacts', B.org, B.users.owner)
  theirs.deal = await makeRecord('deals', B.org, B.users.owner)
  theirs.user = B.users.member
})

const missing = () => new mongoose.Types.ObjectId().toString()

/** A 400 VALIDATION_ERROR whose message names `field`. */
const expectRejected = (res, field) => {
  expect(res.status).toBe(400)
  expect(res.body.error.code).toBe('VALIDATION_ERROR')
  expect(res.body.error.message).toMatch(new RegExp(`^${field.replace('.', '\\.')}: `))
}

// [resource, create body, field, value(theirs)]: every client-written reference.
const CASES = [
  ['leads', { name: 'L' }, 'companyId', () => String(theirs.company._id)],
  ['contacts', { name: 'C' }, 'companyId', () => String(theirs.company._id)],
  ['deals', { title: 'D', value: 1 }, 'companyId', () => String(theirs.company._id)],
  ['deals', { title: 'D', value: 1 }, 'contactIds', () => [String(theirs.contact._id)]],
  [
    'activities',
    { type: 'task', title: 'T' },
    'linkedTo',
    () => ({ entityType: 'deal', entityId: String(theirs.deal._id) }),
  ],
].map(([resource, base, field, value]) => ({ resource, base, field, value }))
const MODEL = { leads: Lead, contacts: Contact, deals: Deal, activities: Activity }
const errorField = (field) => (field === 'linkedTo' ? 'linkedTo.entityId' : field)

describe('create: a member of org A pointing at org B', () => {
  it.each(CASES)('POST /$resource with $field from org B -> 400', async ({ resource, base, field, value }) => {
    const before = await MODEL[resource].countDocuments({ orgId: A.org._id })
    const res = await request(app)
      .post(`/api/v1/${resource}`)
      .set(bearer(A.tokens.member))
      .send({ ...base, [field]: value() })
    expectRejected(res, errorField(field))
    expect(await MODEL[resource].countDocuments({ orgId: A.org._id })).toBe(before)
  })

  it("POST /notes on org B's contact -> 400 entityId, no note written", async () => {
    const res = await request(app)
      .post('/api/v1/notes')
      .set(bearer(A.tokens.member))
      .send({ entityType: 'contact', entityId: String(theirs.contact._id), body: 'hi' })
    expectRejected(res, 'entityId')
    expect(await Note.countDocuments({ orgId: A.org._id })).toBe(0)
  })

  it('an id that exists nowhere is rejected the same way (no existence leak)', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set(bearer(A.tokens.member))
      .send({ name: 'L', companyId: missing() })
    expectRejected(res, 'companyId')
    const other = await request(app)
      .post('/api/v1/leads')
      .set(bearer(A.tokens.member))
      .send({ name: 'L', companyId: String(theirs.company._id) })
    expect(other.body.error.message).toBe(res.body.error.message)
  })
})

describe('update: a member of org A pointing their own record at org B', () => {
  it.each(CASES)(
    'PATCH /$resource/:id with $field from org B -> 400, record unchanged',
    async ({ resource, field, value }) => {
      const own = await makeRecord(resource, A.org, A.users.member)
      const before = await MODEL[resource].findById(own._id).lean()
      const res = await request(app)
        .patch(`/api/v1/${resource}/${own._id}`)
        .set(bearer(A.tokens.member))
        .send({ [field]: value() })
      expectRejected(res, errorField(field))
      expect(await MODEL[resource].findById(own._id).lean()).toEqual(before)
    },
  )

  it("PATCH /org/teams/:id with org B's user in memberIds -> 400, team unchanged", async () => {
    // Only owners and admins manage teams, so the owner acts here.
    const created = await request(app).post('/api/v1/org/teams').set(bearer(A.tokens.owner)).send({ name: 'Sales' })
    const teamId = created.body.data._id
    const res = await request(app)
      .patch(`/api/v1/org/teams/${teamId}`)
      .set(bearer(A.tokens.owner))
      .send({ memberIds: [String(A.users.member._id), String(theirs.user._id)] })
    expectRejected(res, 'memberIds')
    const org = await Organization.findById(A.org._id)
    expect(org.teams.id(teamId).memberIds).toHaveLength(0)
  })
})

describe('own-org references still work', () => {
  it("a lead, contact and deal can reference the org's own company and contacts", async () => {
    const company = await makeRecord('companies', A.org, A.users.member)
    const contact = await makeRecord('contacts', A.org, A.users.member)
    const lead = await request(app)
      .post('/api/v1/leads')
      .set(bearer(A.tokens.member))
      .send({ name: 'L', companyId: String(company._id) })
    expect(lead.status).toBe(201)
    const deal = await request(app)
      .post('/api/v1/deals')
      .set(bearer(A.tokens.member))
      .send({ title: 'D', value: 1, companyId: String(company._id), contactIds: [String(contact._id)] })
    expect(deal.status).toBe(201)
  })

  it('contactIds with the same id twice is accepted, not "1 of 2 found"', async () => {
    const contact = await makeRecord('contacts', A.org, A.users.member)
    const res = await request(app)
      .post('/api/v1/deals')
      .set(bearer(A.tokens.member))
      .send({ title: 'D', value: 1, contactIds: [String(contact._id), String(contact._id)] })
    expect(res.status).toBe(201)
  })

  it('a note on an own-org record and a task linked to an own-org deal are accepted', async () => {
    const contact = await makeRecord('contacts', A.org, A.users.member)
    const deal = await makeRecord('deals', A.org, A.users.member)
    const note = await request(app)
      .post('/api/v1/notes')
      .set(bearer(A.tokens.member))
      .send({ entityType: 'contact', entityId: String(contact._id), body: 'hi' })
    expect(note.status).toBe(201)
    const task = await request(app)
      .post('/api/v1/activities')
      .set(bearer(A.tokens.member))
      .send({ type: 'task', title: 'T', linkedTo: { entityType: 'deal', entityId: String(deal._id) } })
    expect(task.status).toBe(201)
  })

  it("a team can hold the org's own members", async () => {
    const created = await request(app).post('/api/v1/org/teams').set(bearer(A.tokens.owner)).send({ name: 'Ops' })
    const res = await request(app)
      .patch(`/api/v1/org/teams/${created.body.data._id}`)
      .set(bearer(A.tokens.owner))
      .send({ memberIds: [String(A.users.member._id), String(A.users.manager._id)] })
    expect(res.status).toBe(200)
  })
})

describe('lead conversion', () => {
  it("converting a lead whose stored companyId is org B's -> 400 companyId, lead unconverted, no deal", async () => {
    // Written straight to the database: the bad reference predates the check.
    const lead = await Lead.create({
      orgId: A.org._id,
      name: 'Old',
      ownerId: A.users.member._id,
      companyId: theirs.company._id,
    })
    const res = await request(app).post(`/api/v1/leads/${lead._id}/convert`).set(bearer(A.tokens.member)).send({})
    expectRejected(res, 'companyId')
    expect((await Lead.findById(lead._id)).status).not.toBe('converted')
    expect(await Deal.countDocuments({ convertedFromLeadId: lead._id })).toBe(0)
  })
})
