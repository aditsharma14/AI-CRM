// Signup writes commit together: a failure partway leaves no orphan org, user or consumed invite.
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app.js'
import Organization from '../src/models/Organization.js'
import User from '../src/models/User.js'
import { issueInvite } from './factories.js'
import { seedOrg } from './helpers.js'

const api = '/api/v1/auth'
let seq = 0
const unique = (tag) => `${tag}.${Date.now()}.${++seq}@tx.test`

afterEach(() => vi.restoreAllMocks())

describe('register-org', () => {
  it('if the user write fails, no org is left behind, and a retry succeeds', async () => {
    const email = unique('founder')
    const orgName = `Orphan check ${seq}`
    vi.spyOn(User, 'create').mockRejectedValueOnce(new Error('user write failed'))

    const failed = await request(app)
      .post(`${api}/register-org`)
      .send({ orgName, name: 'F', email, password: 'password123' })
    expect(failed.status).toBe(500)
    expect(await Organization.countDocuments({ name: orgName })).toBe(0)
    expect(await User.countDocuments({ email })).toBe(0)

    const retry = await request(app)
      .post(`${api}/register-org`)
      .send({ orgName, name: 'F', email, password: 'password123' })
    expect(retry.status).toBe(200)
    expect(await Organization.countDocuments({ name: orgName })).toBe(1)
    const org = await Organization.findOne({ name: orgName })
    expect(String(org.ownerId)).toBe(String((await User.findOne({ email }))._id))
  })

  it('if storing the session fails, neither the org nor the user is kept', async () => {
    const email = unique('founder')
    const orgName = `Session check ${seq}`
    vi.spyOn(User, 'updateOne').mockRejectedValueOnce(new Error('refresh token write failed'))

    const failed = await request(app)
      .post(`${api}/register-org`)
      .send({ orgName, name: 'F', email, password: 'password123' })
    expect(failed.status).toBe(500)
    expect(await Organization.countDocuments({ name: orgName })).toBe(0)
    expect(await User.countDocuments({ email })).toBe(0)
  })
})

describe('accept-invite', () => {
  it('if the user write fails, the invite is not consumed, and a retry succeeds', async () => {
    const { org } = await seedOrg('Inviter')
    const email = unique('invitee')
    const token = await issueInvite(org._id, { email, role: 'member' })
    vi.spyOn(User, 'create').mockRejectedValueOnce(new Error('user write failed'))

    const failed = await request(app).post(`${api}/accept-invite`).send({ token, name: 'I', password: 'password123' })
    expect(failed.status).toBe(500)
    expect(await User.countDocuments({ email })).toBe(0)
    const stored = await Organization.findById(org._id).select('+inviteTokens')
    expect(stored.inviteTokens.map((t) => t.email)).toContain(email)

    const retry = await request(app).post(`${api}/accept-invite`).send({ token, name: 'I', password: 'password123' })
    expect(retry.status).toBe(200)
  })

  it('two parallel accepts of one invite: one joins, the other gets INVALID_INVITE, one user', async () => {
    const { org } = await seedOrg('Inviter')
    const email = unique('invitee')
    const token = await issueInvite(org._id, { email, role: 'member' })
    const accept = () => request(app).post(`${api}/accept-invite`).send({ token, name: 'I', password: 'password123' })

    const results = await Promise.all([accept(), accept()])
    expect(results.map((r) => r.status).sort()).toEqual([200, 400])
    expect(results.find((r) => r.status === 400).body.error.code).toBe('INVALID_INVITE')
    expect(await User.countDocuments({ email })).toBe(1)
  })
})
