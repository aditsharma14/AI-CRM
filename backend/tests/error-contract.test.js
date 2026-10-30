// The error envelope for failures outside the services: body parsing, rate limiting, unknown paths, Mongoose.
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import app from '../src/app.js'
import { bearer, seedOrg } from './helpers.js'

/** The envelope's error branch with this status and code. */
const expectError = (res, status, code) => {
  expect(res.status).toBe(status)
  expect(res.headers['content-type']).toMatch(/application\/json/)
  expect(res.body).toMatchObject({ success: false, data: null, error: { code }, meta: null })
}

describe('request bodies', () => {
  it('malformed JSON -> 400 VALIDATION_ERROR naming the body', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('content-type', 'application/json').send('{bad')
    expectError(res, 400, 'VALIDATION_ERROR')
    expect(res.body.error.message).toBe('body: malformed JSON.')
  })

  it('a body over the size limit -> 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.co', password: 'x'.repeat(200 * 1024) })
    expectError(res, 413, 'PAYLOAD_TOO_LARGE')
    expect(res.body.error.message).toBe('body: the request body is too large.')
  })
})

describe('unknown paths', () => {
  it.each([
    ['get', '/api/v1/nope'],
    ['get', '/api/v1/nope/deeper'],
    ['post', '/api/v1/nope'],
    ['get', '/api/v1/dashboards'],
    ['get', '/api/v1/searching'],
  ])('a guest: %s %s -> 404, not 401', async (method, path) => {
    const res = await request(app)[method](path)
    expectError(res, 404, 'NOT_FOUND')
  })

  it('a signed-in user: GET /api/v1/nope -> 404', async () => {
    const { tokens } = await seedOrg('Paths')
    expectError(await request(app).get('/api/v1/nope').set(bearer(tokens.member)), 404, 'NOT_FOUND')
  })

  it('known resources still need a token: GET /api/v1/contacts, /search, /dashboard/overview -> 401', async () => {
    for (const path of ['/api/v1/contacts', '/api/v1/search?q=a', '/api/v1/dashboard/overview']) {
      expectError(await request(app).get(path), 401, 'UNAUTHORIZED')
    }
  })

  // Documented in CLAUDE.md §3: each resource router authenticates before matching its own routes.
  it('an unknown path under a known resource is still 401 for a guest', async () => {
    expectError(await request(app).get('/api/v1/leads/x/y'), 401, 'UNAUTHORIZED')
  })
})
