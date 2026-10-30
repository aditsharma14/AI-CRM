// A cross-org reference already in the database populates as null (or drops out of an array), never as org B's data.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import Activity from '../src/models/Activity.js'
import { Company, Contact, Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import { ActivityLog } from '../src/models/Logs.js'
import Note from '../src/models/Note.js'
import Organization from '../src/models/Organization.js'
import User from '../src/models/User.js'
import { bearer, seedOrg } from './helpers.js'

// Every org B document carries this, so a leak shows up anywhere in a response body.
const SECRET = 'ORG-B-SECRET'

let A
let B
const theirs = {}
const mine = {}

beforeAll(async () => {
  A = await seedOrg('A')
  B = await seedOrg('B')
  theirs.company = await Company.create({ orgId: B.org._id, name: `${SECRET} company`, ownerId: B.users.owner._id })
  theirs.contact = await Contact.create({ orgId: B.org._id, name: `${SECRET} contact`, ownerId: B.users.owner._id })
  theirs.user = await User.create({
    orgId: B.org._id,
    name: `${SECRET} user`,
    email: 'secret.user@b.test',
    password: 'unused-password',
    role: 'member',
  })
  mine.contact = await Contact.create({ orgId: A.org._id, name: 'Own contact', ownerId: A.users.owner._id })

  // Written straight to the database, as if the reference predates the write-time check.
  const ownerId = A.users.owner._id
  const orgId = A.org._id
  mine.lead = await Lead.create({ orgId, name: 'Lead', ownerId, companyId: theirs.company._id })
  mine.contactWithCompany = await Contact.create({ orgId, name: 'C', ownerId, companyId: theirs.company._id })
  mine.deal = await Deal.create({
    orgId,
    title: 'Deal',
    value: 1,
    stageKey: 'new',
    ownerId,
    companyId: theirs.company._id,
    contactIds: [mine.contact._id, theirs.contact._id],
  })
  mine.note = await Note.create({
    orgId,
    entityType: 'lead',
    entityId: mine.lead._id,
    body: 'n',
    authorId: theirs.user._id,
  })
  mine.task = await Activity.create({ orgId, type: 'task', title: 'T', assigneeId: theirs.user._id })
  await ActivityLog.create({
    orgId,
    userId: theirs.user._id,
    action: 'create',
    entityType: 'lead',
    entityId: mine.lead._id,
    message: 'm',
  })
  await Organization.updateOne(
    { _id: orgId },
    { $push: { teams: { name: 'Mixed', memberIds: [A.users.member._id, theirs.user._id] } } },
  )
})

const get = (path) => request(app).get(`/api/v1${path}`).set(bearer(A.tokens.owner))

/** 200, and nothing of org B's anywhere in the body. */
const expectNoLeak = (res) => {
  expect(res.status).toBe(200)
  expect(JSON.stringify(res.body)).not.toContain(SECRET)
  expect(JSON.stringify(res.body)).not.toContain('secret.user@b.test')
}

describe('single references populate as null', () => {
  it('GET /leads/:id: companyId is null', async () => {
    const res = await get(`/leads/${mine.lead._id}`)
    expectNoLeak(res)
    expect(res.body.data.companyId).toBeNull()
  })

  it('GET /leads: companyId is null in the list', async () => {
    const res = await get('/leads')
    expectNoLeak(res)
    expect(res.body.data.find((l) => l._id === String(mine.lead._id)).companyId).toBeNull()
  })

  it('GET /contacts/:id: companyId is null', async () => {
    const res = await get(`/contacts/${mine.contactWithCompany._id}`)
    expectNoLeak(res)
    expect(res.body.data.companyId).toBeNull()
  })

  it('GET /deals/:id: companyId is null', async () => {
    const res = await get(`/deals/${mine.deal._id}`)
    expectNoLeak(res)
    expect(res.body.data.companyId).toBeNull()
  })

  it('GET /notes: authorId is null', async () => {
    const res = await get(`/notes?entityType=lead&entityId=${mine.lead._id}`)
    expectNoLeak(res)
    expect(res.body.data[0].authorId).toBeNull()
  })

  it('GET /activities/:id and GET /activities: assigneeId is null', async () => {
    const one = await get(`/activities/${mine.task._id}`)
    expectNoLeak(one)
    expect(one.body.data.assigneeId).toBeNull()
    const list = await get('/activities?type=task')
    expectNoLeak(list)
    expect(list.body.data.find((t) => t._id === String(mine.task._id)).assigneeId).toBeNull()
  })

  it('GET /notifications/activity-log: userId is null', async () => {
    const res = await get('/notifications/activity-log')
    expectNoLeak(res)
    expect(res.body.data.every((entry) => entry.userId === null || !String(entry.userId.name).includes(SECRET))).toBe(
      true,
    )
  })

  it('GET /dashboard/overview: recent activity has no org B actor', async () => {
    expectNoLeak(await get('/dashboard/overview'))
  })
})

describe("array references drop the other org's ids", () => {
  it("GET /deals/:id: contactIds keeps the own contact, drops org B's", async () => {
    const res = await get(`/deals/${mine.deal._id}`)
    expectNoLeak(res)
    expect(res.body.data.contactIds.map((c) => c._id)).toEqual([String(mine.contact._id)])
  })

  it("GET /org/teams: memberIds keeps own members, drops org B's user", async () => {
    const res = await get('/org/teams')
    expectNoLeak(res)
    const team = res.body.data.find((t) => t.name === 'Mixed')
    expect(team.memberIds.map((m) => m._id)).toEqual([String(A.users.member._id)])
  })
})
