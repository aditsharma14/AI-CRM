// No email provider until S2.6. EMAIL_ENABLED (default false) tells the frontend, via GET /api/v1/config, whether it
// can offer password reset; while it is off, an invite returns its link to the admin who created it, and only to
// them. The dev-only token log lines never run in production.
import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app.js'
import { env } from '../src/config/index.js'
import { createUserWithPassword } from './factories.js'
import { bearer, seedOrg } from './helpers.js'

const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
afterAll(() => consoleLog.mockRestore())

const original = { emailEnabled: env.emailEnabled, nodeEnv: env.nodeEnv }
afterEach(() => {
  Object.assign(env, original)
  consoleLog.mockClear()
  vi.unstubAllEnvs()
  vi.resetModules()
})

let A
let n = 0
beforeEach(async () => {
  A = await seedOrg('A')
})
const as = (role) => bearer(A.tokens[role])
const invite = (role = 'owner', email = `new.${++n}.${Date.now()}@invite.test`) =>
  request(app).post('/api/v1/org/members/invite').set(as(role)).send({ email, role: 'member' })

describe('EMAIL_ENABLED', () => {
  async function bootWith(value) {
    vi.resetModules()
    vi.stubEnv('EMAIL_ENABLED', value)
    return import('../src/config/index.js')
  }

  it('defaults to false', () => expect(original.emailEnabled).toBe(false))

  it.each([
    ['true', true],
    ['false', false],
  ])('reads %j', async (value, parsed) => {
    expect((await bootWith(value)).env.emailEnabled).toBe(parsed)
  })

  it.each(['yes', '1', 'TRUE '])('refuses %j at boot', async (value) => {
    await expect(bootWith(value)).rejects.toThrow(/EMAIL_ENABLED/)
  })
})

describe('GET /api/v1/config', () => {
  it('is public and says whether email (and AI) is on', async () => {
    expect((await request(app).get('/api/v1/config')).body).toEqual({
      success: true,
      data: { emailEnabled: false, aiEnabled: false },
      error: null,
      meta: null,
    })
    env.emailEnabled = true
    expect((await request(app).get('/api/v1/config')).body.data).toEqual({ emailEnabled: true, aiEnabled: false })
  })
})

describe('invites while email is off', () => {
  it('the response carries the invite link, and the link works', async () => {
    const email = `ivy.${Date.now()}@invite.test`
    const res = await invite('admin', email)
    expect(res.status).toBe(201)
    expect(res.body.data.inviteUrl).toMatch(/^\/invite\/[0-9a-f]{64}$/)

    const token = res.body.data.inviteUrl.split('/').at(-1)
    const accepted = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token, name: 'Ivy', password: 'password123' })
    expect(accepted.status).toBe(200)
    expect(accepted.body.data.user.email).toBe(email)
  })

  it('no other read in the org ever contains the token: not for another admin, a member, or the inviter', async () => {
    const token = (await invite('owner')).body.data.inviteUrl.split('/').at(-1)
    const reads = [
      '/api/v1/org',
      '/api/v1/org/members',
      '/api/v1/org/teams',
      '/api/v1/org/pipeline-stages',
      '/api/v1/org/email-templates',
      '/api/v1/notifications',
      '/api/v1/notifications/activity-log',
      '/api/v1/dashboard/overview',
    ]
    for (const role of ['admin', 'member', 'owner']) {
      for (const path of reads) {
        const res = await request(app).get(path).set(as(role))
        expect({ role, path, leaked: JSON.stringify(res.body).includes(token) }).toEqual({ role, path, leaked: false })
      }
    }
  })

  it('a refused invite returns no link', async () => {
    const res = await invite('member')
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/invite\//)
  })
})

describe('invites while email is on', () => {
  it('the response carries no link (it would go by email)', async () => {
    env.emailEnabled = true
    const res = await invite('owner')
    expect(res.status).toBe(201)
    expect(res.body.data).toBeNull()
  })
})

describe('the dev-only token log lines', () => {
  const tokenLogged = () => consoleLog.mock.calls.some((args) => /token=|\/invite\/[0-9a-f]{64}/.test(args.join(' ')))

  async function forgot() {
    const { email } = await createUserWithPassword(A.org)
    await request(app).post('/api/v1/auth/forgot-password').send({ email }).expect(200)
  }

  it('run in development and test (how a developer gets the links today)', async () => {
    await forgot()
    await invite('owner').expect(201)
    expect(consoleLog.mock.calls.map((args) => args.join(' '))).toEqual([
      expect.stringMatching(/Password reset link for .*: \/reset-password\?token=[0-9a-f]{64}$/),
      expect.stringMatching(/Invite link for .*: \/invite\/[0-9a-f]{64}$/),
    ])
  })

  it('never run in production, so no raw token reaches the logs', async () => {
    env.nodeEnv = 'production'
    await forgot()
    await invite('owner').expect(201)
    expect(tokenLogged()).toBe(false)
    expect(consoleLog).not.toHaveBeenCalled()
  })
})
