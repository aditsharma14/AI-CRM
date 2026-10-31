// Notifications are per user: list, unread count, mark one read, mark all read; nobody touches anyone else's.
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import { Notification } from '../src/models/Logs.js'
import { bearer, seedOrg } from './helpers.js'

let A
let B
let mine
let colleagues
let otherOrgs

/** One notification for `user` in `org`, created `minutesAgo` minutes ago. */
const notify = (org, user, message, { read = false, minutesAgo = 0 } = {}) =>
  Notification.create({
    orgId: org._id,
    userId: user._id,
    entityType: 'deal',
    entityId: org._id,
    message,
    read,
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
  })

beforeEach(async () => {
  A = await seedOrg('A')
  B = await seedOrg('B')
  mine = [
    await notify(A.org, A.users.member, 'old unread', { minutesAgo: 10 }),
    await notify(A.org, A.users.member, 'new unread', { minutesAgo: 1 }),
    await notify(A.org, A.users.member, 'already read', { read: true, minutesAgo: 5 }),
  ]
  colleagues = await notify(A.org, A.users.manager, "a colleague's")
  otherOrgs = await notify(B.org, B.users.member, "another org's")
})

const asMember = (req) => req.set(bearer(A.tokens.member))
const readFlag = async (doc) => (await Notification.findById(doc._id)).read

describe('GET /notifications', () => {
  it("lists only the caller's own notifications, newest first, with their unread count", async () => {
    const res = await asMember(request(app).get('/api/v1/notifications'))
    expect(res.status).toBe(200)
    expect(res.body.data.map((n) => n.message)).toEqual(['new unread', 'already read', 'old unread'])
    expect(res.body.meta).toMatchObject({ total: 3, unreadCount: 2 })
  })

  it('the unread count ignores the filter (the bell badge needs the real number)', async () => {
    const res = await asMember(request(app).get('/api/v1/notifications?read=true'))
    expect(res.body.data.map((n) => n.message)).toEqual(['already read'])
    expect(res.body.meta.unreadCount).toBe(2)
  })
})

describe('PATCH /notifications/:id/read', () => {
  it('marks one of your own notifications read', async () => {
    const res = await asMember(request(app).patch(`/api/v1/notifications/${mine[0]._id}/read`))
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ _id: String(mine[0]._id), read: true })
    expect(await readFlag(mine[0])).toBe(true)
    expect(await readFlag(mine[1])).toBe(false)
  })

  it.each([
    ["a colleague's", () => colleagues],
    ["another org's", () => otherOrgs],
  ])('%s notification -> 404, left unread', async (_, target) => {
    const res = await asMember(request(app).patch(`/api/v1/notifications/${target()._id}/read`))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(await readFlag(target())).toBe(false)
  })

  it('an unknown id -> 404', async () => {
    const res = await asMember(request(app).patch(`/api/v1/notifications/${A.org._id}/read`))
    expect(res.status).toBe(404)
  })
})

describe('PATCH /notifications/read-all', () => {
  it("marks all of the caller's notifications read and nobody else's", async () => {
    const res = await asMember(request(app).patch('/api/v1/notifications/read-all'))
    expect(res.status).toBe(200)
    expect(await Promise.all(mine.map(readFlag))).toEqual([true, true, true])
    expect(await readFlag(colleagues)).toBe(false)
    expect(await readFlag(otherOrgs)).toBe(false)

    const after = await asMember(request(app).get('/api/v1/notifications'))
    expect(after.body.meta.unreadCount).toBe(0)
  })
})
