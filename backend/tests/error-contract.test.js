// The error envelope for failures outside the services: body parsing, rate limiting, unknown paths, Mongoose.
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import app from '../src/app.js'

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
