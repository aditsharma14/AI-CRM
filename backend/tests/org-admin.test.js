// Org admin end to end: profile, members/roles, invites, teams, templates, pipeline stages, "me", password change.
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import Organization from '../src/models/Organization.js'
import User from '../src/models/User.js'
import { bearer, seedOrg } from './helpers.js'
import { asRefreshCookie, createUserWithPassword, login, sessionCount } from './factories.js'

const api = '/api/v1/org'
let n = 0
const uniqueEmail = (tag) => `${tag}.${++n}.${Date.now()}@org.test`

// inviteMember logs the raw invite link (dev-only stand-in); keep it out of test output.
const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
afterAll(() => consoleLog.mockRestore())

// A fresh org per test: several tests mutate org-wide state (stages, teams, roles).
let ctx
beforeEach(async () => {
  ctx = await seedOrg('Admin')
})
const as = (role) => bearer(ctx.tokens[role])
const idOf = (doc) => doc._id.toString()

describe('org profile', () => {
  it('is readable by every role', async () => {
    for (const role of ['owner', 'admin', 'manager', 'member']) {
      const res = await request(app).get(api).set(as(role))
      expect(res.status).toBe(200)
      expect(res.body.data.name).toBe(ctx.org.name)
    }
  })

  it('can be renamed by the owner only', async () => {
    expect((await request(app).patch(api).set(as('admin')).send({ name: 'Nope Inc' })).status).toBe(403)
    const res = await request(app).patch(api).set(as('owner')).send({ name: 'Renamed Inc' })
    expect(res.status).toBe(200)
    expect((await Organization.findById(ctx.org._id)).name).toBe('Renamed Inc')
  })
})

describe('members and roles', () => {
  it('lists the members of the caller org only', async () => {
    const other = await seedOrg('Elsewhere')
    const res = await request(app).get(`${api}/members`).set(as('member'))
    expect(res.status).toBe(200)
    const ids = res.body.data.map((m) => m._id)
    expect(ids).toHaveLength(4)
    expect(ids).not.toContain(idOf(other.users.owner))
  })

  it('lets owner and admin invite; stores only a hash with a 7-day expiry', async () => {
    for (const role of ['owner', 'admin']) {
      const email = uniqueEmail(`by-${role}`)
      const before = Date.now()
      const res = await request(app).post(`${api}/members/invite`).set(as(role)).send({ email, role: 'member' })
      expect(res.status).toBe(201)

      const org = await Organization.findById(ctx.org._id).select('+inviteTokens')
      const invite = org.inviteTokens.find((t) => t.email === email)
      expect(invite.tokenHash).toMatch(/^[0-9a-f]{64}$/)
      expect(invite.role).toBe('member')
      const days = (invite.expiresAt.getTime() - before) / 86_400_000
      expect(days).toBeGreaterThan(6.99)
      expect(days).toBeLessThanOrEqual(7.01)
    }
  })

  it('forbids managers and members from inviting', async () => {
    for (const role of ['manager', 'member']) {
      const res = await request(app).post(`${api}/members/invite`).set(as(role)).send({ email: uniqueEmail('x'), role: 'member' })
      expect(res.status).toBe(403)
    }
  })

  it('rejects inviting an email that already has an account', async () => {
    const res = await request(app).post(`${api}/members/invite`).set(as('owner')).send({ email: ctx.users.member.email, role: 'member' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('changes a member role', async () => {
    const res = await request(app).patch(`${api}/members/${idOf(ctx.users.member)}/role`).set(as('owner')).send({ role: 'manager' })
    expect(res.status).toBe(200)
    expect((await User.findById(ctx.users.member._id)).role).toBe('manager')
  })

  it("never assigns 'owner' and never touches the owner's role", async () => {
    const assignOwner = await request(app).patch(`${api}/members/${idOf(ctx.users.member)}/role`).set(as('owner')).send({ role: 'owner' })
    expect(assignOwner.status).toBe(400)
    expect(assignOwner.body.error.code).toBe('VALIDATION_ERROR')

    const demoteOwner = await request(app).patch(`${api}/members/${idOf(ctx.users.owner)}/role`).set(as('admin')).send({ role: 'member' })
    expect(demoteOwner.status).toBe(404)
    expect((await User.findById(ctx.users.owner._id)).role).toBe('owner')
  })

  it('pins current behaviour: an admin can change another admin role', async () => {
    // suspect: admins can demote peer admins. Recorded in CLAUDE.md §9 for a later fix.
    const { user: peer } = await createUserWithPassword(ctx.org, { role: 'admin', email: uniqueEmail('peer') })
    const res = await request(app).patch(`${api}/members/${idOf(peer)}/role`).set(as('admin')).send({ role: 'member' })
    expect(res.status).toBe(200)
    expect((await User.findById(peer._id)).role).toBe('member')
  })

  it('pins current behaviour: an admin can change their own role', async () => {
    // suspect: self role change (e.g. an admin demoting themselves). Recorded in CLAUDE.md §9.
    const res = await request(app).patch(`${api}/members/${idOf(ctx.users.admin)}/role`).set(as('admin')).send({ role: 'manager' })
    expect(res.status).toBe(200)
    expect((await User.findById(ctx.users.admin._id)).role).toBe('manager')
  })

  it('removes a member but never the owner', async () => {
    expect((await request(app).delete(`${api}/members/${idOf(ctx.users.member)}`).set(as('manager'))).status).toBe(403)
    expect((await request(app).delete(`${api}/members/${idOf(ctx.users.member)}`).set(as('owner'))).status).toBe(200)
    expect(await User.findById(ctx.users.member._id)).toBeNull()

    expect((await request(app).delete(`${api}/members/${idOf(ctx.users.owner)}`).set(as('admin'))).status).toBe(404)
    expect(await User.findById(ctx.users.owner._id)).not.toBeNull()
  })
})

describe('teams', () => {
  it('creates, fills, lists (populated), renames and deletes a team', async () => {
    const created = await request(app).post(`${api}/teams`).set(as('admin')).send({ name: 'Alpha' })
    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({ name: 'Alpha', memberIds: [] })
    const teamId = created.body.data._id

    const memberIds = [idOf(ctx.users.member), idOf(ctx.users.manager)]
    const updated = await request(app).patch(`${api}/teams/${teamId}`).set(as('admin')).send({ name: 'Alpha 2', memberIds })
    expect(updated.status).toBe(200)
    expect(updated.body.data.name).toBe('Alpha 2')
    expect(updated.body.data.memberIds).toEqual(memberIds)

    const list = await request(app).get(`${api}/teams`).set(as('member'))
    expect(list.status).toBe(200)
    const team = list.body.data.find((t) => t._id === teamId)
    expect(team.memberIds.map((m) => m.email).sort()).toEqual([ctx.users.manager.email, ctx.users.member.email].sort())

    expect((await request(app).delete(`${api}/teams/${teamId}`).set(as('admin'))).status).toBe(200)
    expect((await Organization.findById(ctx.org._id)).teams).toHaveLength(0)
  })

  it('forbids managers from managing teams', async () => {
    expect((await request(app).post(`${api}/teams`).set(as('manager')).send({ name: 'No' })).status).toBe(403)
  })

  it("answers 404 for another org's team id", async () => {
    const other = await seedOrg('Other')
    const theirs = await request(app).post(`${api}/teams`).set(bearer(other.tokens.owner)).send({ name: 'Theirs' })
    const res = await request(app).patch(`${api}/teams/${theirs.body.data._id}`).set(as('owner')).send({ name: 'Hijacked' })
    expect(res.status).toBe(404)
    expect((await Organization.findById(other.org._id)).teams[0].name).toBe('Theirs')
  })

  it('pins current behaviour: deleting an unknown team id returns 200', async () => {
    // suspect: should be 404. Recorded in CLAUDE.md §9.
    expect((await request(app).delete(`${api}/teams/0123456789abcdef01234567`).set(as('owner'))).status).toBe(200)
  })
})

describe('email templates', () => {
  it('creates, lists, partially updates and deletes a template', async () => {
    const created = await request(app).post(`${api}/email-templates`).set(as('admin')).send({ name: 'Hello', subject: 'Hi', body: 'Body' })
    expect(created.status).toBe(201)
    const id = created.body.data._id

    expect((await request(app).get(`${api}/email-templates`).set(as('member'))).body.data.map((t) => t._id)).toContain(id)

    const updated = await request(app).patch(`${api}/email-templates/${id}`).set(as('owner')).send({ subject: 'Hi again' })
    expect(updated.status).toBe(200)
    expect(updated.body.data).toMatchObject({ name: 'Hello', subject: 'Hi again', body: 'Body' })

    expect((await request(app).delete(`${api}/email-templates/${id}`).set(as('owner'))).status).toBe(200)
    expect((await Organization.findById(ctx.org._id)).emailTemplates).toHaveLength(0)
  })

  it('forbids managers from configuring templates', async () => {
    const res = await request(app).post(`${api}/email-templates`).set(as('manager')).send({ name: 'N', subject: 'S', body: 'B' })
    expect(res.status).toBe(403)
  })

  it('pins current behaviour: deleting an unknown template id returns 200', async () => {
    // suspect: should be 404. Recorded in CLAUDE.md §9.
    expect((await request(app).delete(`${api}/email-templates/0123456789abcdef01234567`).set(as('owner'))).status).toBe(200)
  })
})

describe('pipeline stages', () => {
  it('starts with the six default stages and can be replaced by the owner', async () => {
    const initial = await request(app).get(`${api}/pipeline-stages`).set(as('member'))
    expect(initial.body.data.map((s) => s.key)).toEqual(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'])

    const stages = [
      { key: 'new', label: 'Fresh', order: 0 },
      { key: 'won', label: 'Won', order: 1 },
      { key: 'lost', label: 'Lost', order: 2 },
    ]
    const res = await request(app).patch(`${api}/pipeline-stages`).set(as('owner')).send(stages)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(stages)
  })

  it('forbids members from configuring the pipeline', async () => {
    expect((await request(app).patch(`${api}/pipeline-stages`).set(as('member')).send([])).status).toBe(403)
  })
})

describe('me', () => {
  it('updates the caller profile', async () => {
    const res = await request(app).patch(`${api}/me`).set(as('member')).send({ name: 'New Name', avatarUrl: 'https://x.test/a.png' })
    expect(res.status).toBe(200)
    expect(await User.findById(ctx.users.member._id)).toMatchObject({ name: 'New Name', avatarUrl: 'https://x.test/a.png' })
  })

  it('rejects a wrong current password and keeps every session', async () => {
    const { email, password, user } = await createUserWithPassword(ctx.org, { email: uniqueEmail('pw-wrong') })
    const { accessToken } = await login(email, password)
    const res = await request(app).patch(`${api}/me/password`).set(bearer(accessToken)).send({ currentPassword: 'not-it', newPassword: 'password456' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_PASSWORD')
    expect(await sessionCount(user._id)).toBe(1)
  })

  it('changes the password and logs out every device', async () => {
    const { email, password, user } = await createUserWithPassword(ctx.org, { email: uniqueEmail('pw') })
    const laptop = await login(email, password)
    const phone = await login(email, password)

    const res = await request(app).patch(`${api}/me/password`).set(bearer(laptop.accessToken)).send({ currentPassword: password, newPassword: 'password456' })
    expect(res.status).toBe(200)

    expect(await sessionCount(user._id)).toBe(0)
    for (const device of [laptop, phone]) {
      expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', asRefreshCookie(device.refresh))).status).toBe(401)
    }
    expect((await request(app).post('/api/v1/auth/login').send({ email, password })).status).toBe(401)
    expect((await request(app).post('/api/v1/auth/login').send({ email, password: 'password456' })).status).toBe(200)
  })
})
