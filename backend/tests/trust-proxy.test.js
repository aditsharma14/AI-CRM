// TRUST_PROXY decides whose IP the rate limiter counts. In production every request comes through Vercel's rewrite
// and then Render's ingress (the socket peer), so with 2 hops req.ip is the visitor; with 0 it is the proxy, for all.
import mongoose from 'mongoose'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** A fresh app (the limiter reads its limit when built) with a limit of 3 and these env vars. */
async function appWith(vars) {
  vi.resetModules()
  // Re-importing the app recompiles every model on the shared connection.
  for (const name of mongoose.modelNames()) mongoose.deleteModel(name)
  vi.stubEnv('RATE_LIMIT_MAX', '3')
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value)
  return (await import('../src/app.js')).default
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

// As production sends it: Vercel sets the visitor's IP, and Render's ingress appends Vercel's.
const via = (client) => ({ 'X-Forwarded-For': `${client}, 76.76.21.21` })
const hit = (app, client) => request(app).get('/api/v1/nope').set(via(client))

describe('TRUST_PROXY=2 (production)', () => {
  it('Express trusts exactly 2 hops', async () => {
    expect((await appWith({ TRUST_PROXY: '2' })).get('trust proxy')).toBe(2)
  })

  it('each visitor gets their own rate-limit bucket', async () => {
    const app = await appWith({ TRUST_PROXY: '2' })
    for (let i = 0; i < 3; i += 1) expect((await hit(app, '203.0.113.1')).status).toBe(404)

    const limited = await hit(app, '203.0.113.1')
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('RATE_LIMITED')
    expect((await hit(app, '203.0.113.2')).status).toBe(404)
  })

  it('/api/v1/health is not rate limited, so pings and deploy checks never use up a bucket', async () => {
    const app = await appWith({ TRUST_PROXY: '2' })
    for (let i = 0; i < 6; i += 1) {
      expect((await request(app).get('/api/v1/health').set(via('198.51.100.7'))).status).toBe(200)
    }
  })
})

describe('TRUST_PROXY unset (0) behind the same proxies', () => {
  it('every visitor shares the proxy’s bucket: one visitor gets everyone limited', async () => {
    const app = await appWith({})
    for (let i = 0; i < 3; i += 1) await hit(app, '203.0.113.50')
    expect((await hit(app, '203.0.113.50')).status).toBe(429)
    expect((await hit(app, '203.0.113.51')).status).toBe(429)
  })
})
