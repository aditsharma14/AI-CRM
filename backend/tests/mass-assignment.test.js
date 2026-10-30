// Owner fields and orgId can only move the way the policy allows.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import Activity from '../src/models/Activity.js'
import { Lead } from '../src/models/CRM.js'
import Note from '../src/models/Note.js'
import { bearer, makeRecord, seedOrg } from './helpers.js'

let a
let b

beforeAll(async () => {
  a = await seedOrg('A')
  b = await seedOrg('B')
})

const idOf = (doc) => doc._id.toString()

describe('members cannot reassign or re-tenant records', () => {
  it('ignores ownerId on a member update of their own lead', async () => {
    const lead = await makeRecord('leads', a.org, a.users.member)
    const res = await request(app)
      .patch(`/api/v1/leads/${lead._id}`)
      .set(bearer(a.tokens.member))
      .send({ name: 'Mine', ownerId: idOf(a.users.owner) })
    expect(res.status).toBe(200)
    const after = await Lead.findById(lead._id)
    expect(after.name).toBe('Mine')
    expect(after.ownerId.toString()).toBe(idOf(a.users.member))
  })

  it('ignores orgId on any update', async () => {
    const lead = await makeRecord('leads', a.org, a.users.member)
    await request(app)
      .patch(`/api/v1/leads/${lead._id}`)
      .set(bearer(a.tokens.member))
      .send({ name: 'X', orgId: idOf(b.org) })
    expect((await Lead.findById(lead._id)).orgId.toString()).toBe(idOf(a.org))
  })

  it('forces ownerId to the member on create, whatever they send', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set(bearer(a.tokens.member))
      .send({ name: 'New', ownerId: idOf(a.users.owner) })
    expect(res.status).toBe(201)
    expect(res.body.data.ownerId).toBe(idOf(a.users.member))
  })

  it('ignores assigneeId on a member update of their own activity', async () => {
    const task = await makeRecord('activities', a.org, a.users.member)
    const res = await request(app)
      .patch(`/api/v1/activities/${task._id}`)
      .set(bearer(a.tokens.member))
      .send({ title: 'Mine', assigneeId: idOf(a.users.owner) })
    expect(res.status).toBe(200)
    expect((await Activity.findById(task._id)).assigneeId.toString()).toBe(idOf(a.users.member))
  })

  it('forces assigneeId to the member on activity create', async () => {
    const res = await request(app)
      .post('/api/v1/activities')
      .set(bearer(a.tokens.member))
      .send({ type: 'task', title: 'T', assigneeId: idOf(a.users.owner) })
    expect(res.status).toBe(201)
    expect(res.body.data.assigneeId).toBe(idOf(a.users.member))
  })

  it("never changes a note's authorId, even for the org owner", async () => {
    const note = await makeRecord('notes', a.org, a.users.member)
    const res = await request(app)
      .patch(`/api/v1/notes/${note._id}`)
      .set(bearer(a.tokens.owner))
      .send({ body: 'Edited', authorId: idOf(a.users.owner) })
    expect(res.status).toBe(200)
    expect((await Note.findById(note._id)).authorId.toString()).toBe(idOf(a.users.member))
  })
})

describe('managers and above can reassign within the org only', () => {
  it('lets a manager reassign a lead to another member of the org', async () => {
    const lead = await makeRecord('leads', a.org, a.users.member)
    const res = await request(app)
      .patch(`/api/v1/leads/${lead._id}`)
      .set(bearer(a.tokens.manager))
      .send({ ownerId: idOf(a.users.admin) })
    expect(res.status).toBe(200)
    expect((await Lead.findById(lead._id)).ownerId.toString()).toBe(idOf(a.users.admin))
  })

  it('lets a manager create a lead owned by someone else in the org', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set(bearer(a.tokens.manager))
      .send({ name: 'For member', ownerId: idOf(a.users.member) })
    expect(res.status).toBe(201)
    expect(res.body.data.ownerId).toBe(idOf(a.users.member))
  })

  it('lets a manager reassign an activity', async () => {
    const task = await makeRecord('activities', a.org, a.users.member)
    const res = await request(app)
      .patch(`/api/v1/activities/${task._id}`)
      .set(bearer(a.tokens.manager))
      .send({ assigneeId: idOf(a.users.admin) })
    expect(res.status).toBe(200)
    expect((await Activity.findById(task._id)).assigneeId.toString()).toBe(idOf(a.users.admin))
  })

  it("rejects reassigning a lead to another org's user with 400", async () => {
    const lead = await makeRecord('leads', a.org, a.users.member)
    const res = await request(app)
      .patch(`/api/v1/leads/${lead._id}`)
      .set(bearer(a.tokens.owner))
      .send({ ownerId: idOf(b.users.member) })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect((await Lead.findById(lead._id)).ownerId.toString()).toBe(idOf(a.users.member))
  })

  it("rejects creating a lead owned by another org's user with 400", async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set(bearer(a.tokens.owner))
      .send({ name: 'X', ownerId: idOf(b.users.member) })
    expect(res.status).toBe(400)
  })
})
