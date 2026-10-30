// Past the rate limit, /api answers with the JSON envelope (RATE_LIMITED), not express-rate-limit's HTML.
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let app
const original = process.env.RATE_LIMIT_MAX

beforeAll(async () => {
  // The limiter reads its limit when the app is built, so build a fresh app with a limit of 2.
  vi.resetModules()
  process.env.RATE_LIMIT_MAX = '2'
  ;({ default: app } = await import('../src/app.js'))
})

afterAll(() => {
  process.env.RATE_LIMIT_MAX = original
  vi.resetModules()
})

describe('rate limit', () => {
  it('the request past the limit -> 429 RATE_LIMITED in the envelope', async () => {
    // Invalid bodies: rejected by validation, so nothing here needs the database.
    const attempt = () => request(app).post('/api/v1/auth/login').send({})
    expect((await attempt()).status).toBe(400)
    expect((await attempt()).status).toBe(400)

    const res = await attempt()
    expect(res.status).toBe(429)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' },
      meta: null,
    })
  })
})
