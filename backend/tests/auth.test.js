// Auth flows end to end: register, login, refresh rotation (incl. races), logout, invites, password reset.
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import app from '../src/app.js'
import User from '../src/models/User.js'
import Organization from '../src/models/Organization.js'
import { seedOrg } from './helpers.js'
import {
  asRefreshCookie,
  createUserWithPassword,
  issueInvite,
  issueResetToken,
  login,
  refreshCookieFrom,
  refreshSetCookieLine,
  sessionCount,
} from './factories.js'

const api = '/api/v1/auth'
let n = 0
const uniqueEmail = (tag) => `${tag}.${++n}.${Date.now()}@auth.test`

// forgot-password and invites log raw tokens (a known dev-only stand-in);
// keep them out of test output.
const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
afterAll(() => consoleLog.mockRestore())

let org
beforeAll(async () => {
  ;({ org } = await seedOrg('Auth'))
})

describe('POST /auth/register-org', () => {
  it('creates the org and its owner, returns a session and sets a locked-down refresh cookie', async () => {
    const email = uniqueEmail('founder')
    const res = await request(app).post(`${api}/register-org`).send({ orgName: 'Founders', name: 'Fay', email, password: 'password123' })

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toEqual(expect.any(String))
    expect(res.body.data.user).toMatchObject({ email, role: 'owner', org: { name: 'Founders', plan: 'trial' } })

    const cookie = refreshSetCookieLine(res)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Strict/i)
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/)

    const user = await User.findOne({ email })
    const created = await Organization.findById(user.orgId)
    expect(created.ownerId.toString()).toBe(user._id.toString())
    expect(await sessionCount(user._id)).toBe(1)
  })

  it('rejects an email that is already registered', async () => {
    const { email } = await createUserWithPassword(org, { email: uniqueEmail('taken') })
    const res = await request(app).post(`${api}/register-org`).send({ orgName: 'Again', name: 'X', email, password: 'password123' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('rejects a password shorter than 8 characters', async () => {
    const res = await request(app).post(`${api}/register-org`).send({ orgName: 'Weak', name: 'W', email: uniqueEmail('weak'), password: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('POST /auth/login', () => {
  it('returns a session for the right password', async () => {
    const { email, password, user } = await createUserWithPassword(org, { email: uniqueEmail('login') })
    const res = await request(app).post(`${api}/login`).send({ email, password })
    expect(res.status).toBe(200)
    expect(res.body.data.user.id).toBe(user._id.toString())
    expect(refreshCookieFrom(res)).toEqual(expect.any(String))
  })

  it('answers a wrong password and an unknown email identically, so emails cannot be enumerated', async () => {
    const { email } = await createUserWithPassword(org, { email: uniqueEmail('enum') })
    const wrong = await request(app).post(`${api}/login`).send({ email, password: 'not-the-password' })
    const unknown = await request(app).post(`${api}/login`).send({ email: uniqueEmail('nobody'), password: 'not-the-password' })

    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrong.body.error).toEqual(unknown.body.error)
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS')
  })
})

describe('POST /auth/refresh', () => {
  it('rotates the refresh token: new one works, old one is dead', async () => {
    const { email, password, user } = await createUserWithPassword(org, { email: uniqueEmail('rotate') })
    const { refresh: first } = await login(email, password)

    const res = await request(app).post(`${api}/refresh`).set('Cookie', asRefreshCookie(first))
    expect(res.status).toBe(200)
    const second = refreshCookieFrom(res)
    expect(second).toEqual(expect.any(String))
    expect(second).not.toBe(first)

    expect((await request(app).post(`${api}/refresh`).set('Cookie', asRefreshCookie(first))).status).toBe(401)
    expect((await request(app).post(`${api}/refresh`).set('Cookie', asRefreshCookie(second))).status).toBe(200)
    expect(await sessionCount(user._id)).toBe(1)
  })

  it('lets exactly one of two concurrent refreshes with the same token win', async () => {
    const { email, password, user } = await createUserWithPassword(org, { email: uniqueEmail('race') })
    const { refresh } = await login(email, password)

    const results = await Promise.all([
      request(app).post(`${api}/refresh`).set('Cookie', asRefreshCookie(refresh)),
      request(app).post(`${api}/refresh`).set('Cookie', asRefreshCookie(refresh)),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([200, 401])
    // The winner swapped the old hash for one new one; the loser added nothing.
    expect(await sessionCount(user._id)).toBe(1)
  })

  it('returns 401 with no cookie at all', async () => {
    expect((await request(app).post(`${api}/refresh`)).status).toBe(401)
  })
})

describe('POST /auth/logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const { email, password, user } = await createUserWithPassword(org, { email: uniqueEmail('logout') })
    const { refresh } = await login(email, password)

    const res = await request(app).post(`${api}/logout`).set('Cookie', asRefreshCookie(refresh))
    expect(res.status).toBe(200)
    expect(refreshSetCookieLine(res)).toMatch(/Expires=Thu, 01 Jan 1970/)
    expect(await sessionCount(user._id)).toBe(0)
    expect((await request(app).post(`${api}/refresh`).set('Cookie', asRefreshCookie(refresh))).status).toBe(401)
  })

  it('succeeds even without a cookie', async () => {
    expect((await request(app).post(`${api}/logout`)).status).toBe(200)
  })
})

describe('POST /auth/accept-invite', () => {
  it("joins the inviter's org with the invited role, and the token is single-use", async () => {
    const email = uniqueEmail('invitee')
    const token = await issueInvite(org._id, { email, role: 'manager' })

    const res = await request(app).post(`${api}/accept-invite`).send({ token, name: 'Ivy', password: 'password123' })
    expect(res.status).toBe(200)
    expect(res.body.data.user).toMatchObject({ email, role: 'manager', org: { id: org._id.toString() } })

    const again = await request(app).post(`${api}/accept-invite`).send({ token, name: 'Ivy 2', password: 'password123' })
    expect(again.status).toBe(400)
    expect(again.body.error.code).toBe('INVALID_INVITE')
  })

  it('rejects an expired invite', async () => {
    const token = await issueInvite(org._id, { email: uniqueEmail('late'), role: 'member', expiresAt: new Date(Date.now() - 1000) })
    const res = await request(app).post(`${api}/accept-invite`).send({ token, name: 'Late', password: 'password123' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_INVITE')
  })

  it('rejects an unknown token', async () => {
    const res = await request(app).post(`${api}/accept-invite`).send({ token: 'f'.repeat(64), name: 'Nope', password: 'password123' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_INVITE')
  })

  it('rejects an invite for an email that already has an account', async () => {
    const { email } = await createUserWithPassword(org, { email: uniqueEmail('dup') })
    const token = await issueInvite(org._id, { email, role: 'member' })
    const res = await request(app).post(`${api}/accept-invite`).send({ token, name: 'Dup', password: 'password123' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })
})

describe('POST /auth/forgot-password', () => {
  it('answers 200 for an unknown email (never reveals who is registered)', async () => {
    const res = await request(app).post(`${api}/forgot-password`).send({ email: uniqueEmail('ghost') })
    expect(res.status).toBe(200)
  })

  it('stores only a hash of the reset token, expiring in about 15 minutes', async () => {
    const { email, user } = await createUserWithPassword(org, { email: uniqueEmail('forgot') })
    const before = Date.now()
    expect((await request(app).post(`${api}/forgot-password`).send({ email })).status).toBe(200)

    const stored = await User.findById(user._id).select('+passwordResetTokenHash +passwordResetExpires')
    expect(stored.passwordResetTokenHash).toMatch(/^[0-9a-f]{64}$/)
    const minutes = (stored.passwordResetExpires.getTime() - before) / 60_000
    expect(minutes).toBeGreaterThan(14.9)
    expect(minutes).toBeLessThanOrEqual(15.1)
  })
})

describe('POST /auth/reset-password', () => {
  it('sets the new password and logs out every device', async () => {
    const { email, password, user } = await createUserWithPassword(org, { email: uniqueEmail('reset') })
    const laptop = await login(email, password)
    const phone = await login(email, password)
    expect(await sessionCount(user._id)).toBe(2)

    const token = await issueResetToken(user._id)
    const res = await request(app).post(`${api}/reset-password`).send({ token, password: 'brand-new-password' })
    expect(res.status).toBe(200)

    expect(await sessionCount(user._id)).toBe(0)
    for (const device of [laptop, phone]) {
      expect((await request(app).post(`${api}/refresh`).set('Cookie', asRefreshCookie(device.refresh))).status).toBe(401)
    }
    expect((await request(app).post(`${api}/login`).send({ email, password })).status).toBe(401)
    expect((await request(app).post(`${api}/login`).send({ email, password: 'brand-new-password' })).status).toBe(200)

    // The token is spent.
    const reuse = await request(app).post(`${api}/reset-password`).send({ token, password: 'another-password' })
    expect(reuse.status).toBe(400)
    expect(reuse.body.error.code).toBe('INVALID_RESET_TOKEN')
  })

  it('rejects an expired token and leaves the password alone', async () => {
    const { email, password, user } = await createUserWithPassword(org, { email: uniqueEmail('expired') })
    const token = await issueResetToken(user._id, { expiresAt: new Date(Date.now() - 1000) })

    const res = await request(app).post(`${api}/reset-password`).send({ token, password: 'brand-new-password' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_RESET_TOKEN')
    expect((await request(app).post(`${api}/login`).send({ email, password })).status).toBe(200)
  })
})
