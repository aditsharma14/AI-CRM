// Settings that matter outside a laptop: the refresh cookie's attributes, the TRUST_PROXY setting, the /api/v1/health
// route the smoke script uses, and no API response is ever cacheable. (Trust proxy and the rate limiter: trust-proxy.test.js.)
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app.js'
import { env } from '../src/config/index.js'
import { refreshSetCookieLine } from './factories.js'

let seq = 0
const register = () =>
  request(app)
    .post('/api/v1/auth/register-org')
    .send({ orgName: 'Prod', name: 'P', email: `prod.${Date.now()}.${++seq}@prod.test`, password: 'password123' })

const originalNodeEnv = env.nodeEnv
afterEach(() => {
  env.nodeEnv = originalNodeEnv
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('refresh cookie attributes', () => {
  it('production: HttpOnly, Secure, SameSite=Strict, scoped to /api/v1/auth, no Domain (host-only)', async () => {
    env.nodeEnv = 'production'
    const cookie = refreshSetCookieLine(await register())
    expect(cookie).toMatch(/; HttpOnly/i)
    expect(cookie).toMatch(/; Secure/i)
    expect(cookie).toMatch(/; SameSite=Strict/i)
    expect(cookie).toMatch(/; Path=\/api\/v1\/auth(;|$)/)
    expect(cookie).not.toMatch(/Domain=/i)
  })

  it('development and test: not Secure (plain http://localhost), everything else the same', async () => {
    const cookie = refreshSetCookieLine(await register())
    expect(cookie).not.toMatch(/; Secure/i)
    expect(cookie).toMatch(/; HttpOnly/i)
    expect(cookie).toMatch(/; SameSite=Strict/i)
  })
})

describe('TRUST_PROXY', () => {
  async function bootWith(value) {
    vi.resetModules()
    vi.stubEnv('TRUST_PROXY', value)
    return import('../src/config/index.js')
  }

  it('defaults to 0 hops (local and compose: nothing in front of the API to trust)', () => {
    expect(env.trustProxy).toBe(0)
    expect(app.get('trust proxy')).toBe(0)
  })

  it('reads a hop count', async () => {
    expect((await bootWith('2')).env.trustProxy).toBe(2)
  })

  it.each(['true', '-1', '1.5', 'two', '11'])('refuses %j at boot', async (value) => {
    await expect(bootWith(value)).rejects.toThrow(/TRUST_PROXY/)
  })
})

describe('GET /api/v1/health', () => {
  it('reports the commit the image was built from (GIT_COMMIT)', async () => {
    vi.stubEnv('GIT_COMMIT', 'abc1234')
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { status: 'ok', commit: 'abc1234' }, error: null, meta: null })
  })

  it('commit is "dev" when GIT_COMMIT is unset or empty', async () => {
    vi.stubEnv('GIT_COMMIT', '')
    expect((await request(app).get('/api/v1/health')).body.data).toEqual({ status: 'ok', commit: 'dev' })
  })
})

describe('API responses are never cacheable', () => {
  it.each([
    ['health', () => request(app).get('/api/v1/health')],
    ['a session', register],
    ['an error', () => request(app).get('/api/v1/nope')],
  ])('%s: Cache-Control no-store', async (_, send) => {
    expect((await send()).headers['cache-control']).toBe('no-store')
  })
})
