// The error envelope for failures outside the services: body parsing, rate limiting, unknown paths, Mongoose.
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import app from '../src/app.js'
import { errorHandler } from '../src/middleware/errorHandler.js'
import { Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
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

describe('Mongoose errors', () => {
  // Real Mongoose errors through the real errorHandler. Zod rejects these inputs first in the API,
  // so a route can only reach them through stored data or a code path that skips validation.
  const throwing = (makeError) =>
    express()
      .get('/', async () => {
        throw await makeError()
      })
      .use(errorHandler)

  it('ValidationError -> 400 "field: message" per field, no model or "Path" wording', async () => {
    const err = new Lead({ status: 'bogus' }).validateSync()
    const res = await request(throwing(() => err)).get('/')
    expectError(res, 400, 'VALIDATION_ERROR')
    expect(res.body.error.message).toBe(
      'name: is required; orgId: is required; ownerId: is required; ' +
        'status: must be one of new, contacted, qualified, unqualified, converted',
    )
    expect(res.body.error.message).not.toMatch(/Lead|validation failed|Path/)
  })

  it('any other validator keeps its own wording, without "Path" or the full stop', async () => {
    const id = '64b7f0000000000000000001'
    const err = new Deal({ orgId: id, title: 'D', value: -1, stageKey: 'new', ownerId: id }).validateSync()
    const res = await request(throwing(() => err)).get('/')
    expectError(res, 400, 'VALIDATION_ERROR')
    expect(res.body.error.message).toBe('value: (-1) is less than minimum allowed value (0)')
  })

  it('a cast failure inside a ValidationError names the field', async () => {
    const err = new Deal({ orgId: 'nope', title: 'D', value: 1, stageKey: 'new', ownerId: 'nope' }).validateSync()
    const res = await request(throwing(() => err)).get('/')
    expectError(res, 400, 'VALIDATION_ERROR')
    expect(res.body.error.message).toBe('orgId: invalid id; ownerId: invalid id')
  })

  it('CastError on _id -> 400 "id: invalid id"', async () => {
    const res = await request(
      throwing(() =>
        Lead.findById('not-an-id').then(
          () => new Error('should have thrown'),
          (e) => e,
        ),
      ),
    ).get('/')
    expectError(res, 400, 'VALIDATION_ERROR')
    expect(res.body.error.message).toBe('id: invalid id')
  })

  it('CastError on another path names that path; a non-id cast says "invalid value"', async () => {
    const id = await request(
      throwing(() =>
        Lead.find({ companyId: 'x' }).then(
          () => new Error('should have thrown'),
          (e) => e,
        ),
      ),
    ).get('/')
    expect(id.body.error.message).toBe('companyId: invalid id')
    const num = await request(
      throwing(() =>
        Deal.find({ value: 'lots' }).then(
          () => new Error('should have thrown'),
          (e) => e,
        ),
      ),
    ).get('/')
    expectError(num, 400, 'VALIDATION_ERROR')
    expect(num.body.error.message).toBe('value: invalid value')
  })
})
