// A token whose org document is gone must get a clean 404, not a 500 crash.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import Organization from '../src/models/Organization.js'
import { bearer, makeRecord, seedOrg } from './helpers.js'

let ctx
let lead
let deal

beforeAll(async () => {
  ctx = await seedOrg('Vanishing')
  lead = await makeRecord('leads', ctx.org, ctx.users.owner)
  deal = await makeRecord('deals', ctx.org, ctx.users.owner)
  // The records and the still-valid token survive; only the org document is gone.
  await Organization.deleteOne({ _id: ctx.org._id })
})

describe('org document missing', () => {
  it('convert returns 404 NOT_FOUND instead of crashing', async () => {
    const res = await request(app).post(`/api/v1/leads/${lead._id}/convert`).set(bearer(ctx.tokens.owner))
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } })
  })

  it('move-stage returns 404 NOT_FOUND instead of crashing', async () => {
    const res = await request(app)
      .patch(`/api/v1/deals/${deal._id}/move-stage`)
      .set(bearer(ctx.tokens.owner))
      .send({ stageKey: 'qualified' })
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } })
  })
})
