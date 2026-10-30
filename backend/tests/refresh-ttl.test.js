// The refresh cookie's lifetime follows REFRESH_TOKEN_TTL, and a value the parser can't read fails at boot.
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app.js'
import { env } from '../src/config/index.js'
import { ttlToMs } from '../src/utils/duration.js'
import { refreshSetCookieLine } from './factories.js'

let seq = 0
const register = () =>
  request(app)
    .post('/api/v1/auth/register-org')
    .send({ orgName: 'TTL', name: 'T', email: `ttl.${Date.now()}.${++seq}@ttl.test`, password: 'password123' })

const original = env.refreshTokenTtl
afterEach(() => {
  env.refreshTokenTtl = original
})

describe('ttlToMs', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 15 * 60_000],
    ['2h', 2 * 3_600_000],
    ['7d', 7 * 86_400_000],
  ])('%s -> %i ms', (ttl, ms) => {
    expect(ttlToMs(ttl)).toBe(ms)
  })

  it.each(['7', '7w', '', 'abc', '-1d', '1.5h', '0d', ' 7d'])('rejects %j', (ttl) => {
    expect(() => ttlToMs(ttl)).toThrow(/REFRESH_TOKEN_TTL|duration/)
  })
})

describe('refresh cookie Max-Age', () => {
  it('defaults to 7 days (REFRESH_TOKEN_TTL unset)', async () => {
    expect(refreshSetCookieLine(await register())).toMatch(/Max-Age=604800(;|$)/)
  })

  it('follows REFRESH_TOKEN_TTL: 2h -> Max-Age=7200', async () => {
    env.refreshTokenTtl = '2h'
    expect(refreshSetCookieLine(await register())).toMatch(/Max-Age=7200(;|$)/)
  })
})

describe('boot check', () => {
  it('an unreadable REFRESH_TOKEN_TTL stops the server at boot', async () => {
    vi.resetModules()
    vi.stubEnv('REFRESH_TOKEN_TTL', 'a fortnight')
    try {
      await expect(import('../src/config/index.js')).rejects.toThrow(/REFRESH_TOKEN_TTL/)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
