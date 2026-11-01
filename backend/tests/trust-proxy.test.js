// TRUST_PROXY decides whose IP the rate limiter counts. In docker compose every browser request comes through the
// client container's nginx (the socket peer), which appends the visitor's address to X-Forwarded-For, so with 1 hop
// req.ip is the visitor; with 0 it is nginx, for everyone.
import { readFileSync } from 'node:fs'

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

// As nginx sends it ($proxy_add_x_forwarded_for): whatever the browser claimed, then the address nginx saw.
const via = (client, claimed) => ({ 'X-Forwarded-For': claimed ? `${claimed}, ${client}` : client })
const hit = (app, client, claimed) => request(app).get('/api/v1/nope').set(via(client, claimed))

describe('docker compose wiring', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

  it('the api trusts exactly one hop', () => {
    expect(read('../../docker-compose.yml')).toMatch(/^\s+TRUST_PROXY: '1'$/m)
  })

  it("nginx forwards the visitor's address", () => {
    expect(read('../../frontend/nginx.conf')).toMatch(/proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/)
  })
})

describe('TRUST_PROXY=1 (compose, behind nginx)', () => {
  it('Express trusts exactly 1 hop', async () => {
    expect((await appWith({ TRUST_PROXY: '1' })).get('trust proxy')).toBe(1)
  })

  it('each visitor gets their own rate-limit bucket', async () => {
    const app = await appWith({ TRUST_PROXY: '1' })
    for (let i = 0; i < 3; i += 1) expect((await hit(app, '203.0.113.1')).status).toBe(404)

    const limited = await hit(app, '203.0.113.1')
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('RATE_LIMITED')
    expect((await hit(app, '203.0.113.2')).status).toBe(404)
  })

  it('a forged X-Forwarded-For from the browser does not buy a fresh bucket', async () => {
    const app = await appWith({ TRUST_PROXY: '1' })
    for (let i = 0; i < 3; i += 1) await hit(app, '203.0.113.9', `10.0.0.${i}`)
    expect((await hit(app, '203.0.113.9', '10.0.0.99')).status).toBe(429)
  })

  it('/api/v1/health is not rate limited, so checks never use up a bucket', async () => {
    const app = await appWith({ TRUST_PROXY: '1' })
    for (let i = 0; i < 6; i += 1) {
      expect((await request(app).get('/api/v1/health').set(via('198.51.100.7'))).status).toBe(200)
    }
  })
})

describe('TRUST_PROXY unset (0) behind the same proxy', () => {
  it('every visitor shares the proxy’s bucket: one visitor gets everyone limited', async () => {
    const app = await appWith({})
    for (let i = 0; i < 3; i += 1) await hit(app, '203.0.113.50')
    expect((await hit(app, '203.0.113.50')).status).toBe(429)
    expect((await hit(app, '203.0.113.51')).status).toBe(429)
  })
})
