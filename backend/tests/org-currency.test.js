// Organization.currency: an allowlisted ISO code (default USD, so existing orgs are unchanged), set by the owner,
// carried in the session, and the default currency of a new deal (created or converted) that names none.
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import { Lead } from '../src/models/CRM.js'
import Organization from '../src/models/Organization.js'
import { bearer, seedOrg } from './helpers.js'

let ctx
beforeEach(async () => {
  ctx = await seedOrg('Currency')
})
const as = (role) => bearer(ctx.tokens[role])
const setCurrency = (currency) => Organization.updateOne({ _id: ctx.org._id }, { currency })

describe('Organization.currency', () => {
  it('defaults to USD, also for an org stored before the field existed', async () => {
    expect((await request(app).get('/api/v1/org').set(as('member'))).body.data.currency).toBe('USD')

    await Organization.collection.updateOne({ _id: ctx.org._id }, { $unset: { currency: '' } })
    expect((await Organization.collection.findOne({ _id: ctx.org._id })).currency).toBeUndefined()
    expect((await request(app).get('/api/v1/org').set(as('member'))).body.data.currency).toBe('USD')
  })

  it.each(['INR', 'USD', 'EUR', 'GBP'])('the owner can set %s', async (currency) => {
    const res = await request(app).patch('/api/v1/org').set(as('owner')).send({ currency })
    expect(res.status).toBe(200)
    expect(res.body.data.currency).toBe(currency)
    expect((await Organization.findById(ctx.org._id)).currency).toBe(currency)
  })

  it('a currency-only update keeps the name, and a name-only update keeps the currency', async () => {
    await request(app).patch('/api/v1/org').set(as('owner')).send({ currency: 'INR' }).expect(200)
    await request(app).patch('/api/v1/org').set(as('owner')).send({ name: 'Renamed Pvt Ltd' }).expect(200)
    const org = await Organization.findById(ctx.org._id)
    expect([org.name, org.currency]).toEqual(['Renamed Pvt Ltd', 'INR'])
  })

  it.each([['JPY'], ['inr'], ['RUPEES'], [''], [42]])('refuses %j (400, unchanged)', async (currency) => {
    const res = await request(app).patch('/api/v1/org').set(as('owner')).send({ currency })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.message).toMatch(/^currency: /)
    expect((await Organization.findById(ctx.org._id)).currency).toBe('USD')
  })

  it('an empty update is refused', async () => {
    const res = await request(app).patch('/api/v1/org').set(as('owner')).send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('only the owner can change it', async () => {
    for (const role of ['admin', 'manager', 'member']) {
      expect((await request(app).patch('/api/v1/org').set(as(role)).send({ currency: 'INR' })).status).toBe(403)
    }
  })

  it('is in the session, so the client formats totals without another request', async () => {
    const email = `cur.${Date.now()}@currency.test`
    const reg = await request(app)
      .post('/api/v1/auth/register-org')
      .send({ orgName: 'Rupee Co', name: 'R', email, password: 'password123' })
    expect(reg.body.data.user.org.currency).toBe('USD')

    await Organization.updateOne({ name: 'Rupee Co' }, { currency: 'INR' })
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' })
    expect(res.body.data.user.org).toMatchObject({ name: 'Rupee Co', currency: 'INR' })
  })
})

describe('a new deal defaults to the org currency', () => {
  it('when created without one', async () => {
    await setCurrency('INR')
    const res = await request(app).post('/api/v1/deals').set(as('member')).send({ title: 'Annual AMC', value: 250000 })
    expect(res.status).toBe(201)
    expect(res.body.data.currency).toBe('INR')
  })

  it('USD for an org that never set one (unchanged behaviour)', async () => {
    const res = await request(app).post('/api/v1/deals').set(as('member')).send({ title: 'T', value: 1 })
    expect(res.body.data.currency).toBe('USD')
  })

  it('an explicit allowlisted currency wins', async () => {
    await setCurrency('INR')
    const res = await request(app)
      .post('/api/v1/deals')
      .set(as('member'))
      .send({ title: 'Export order', value: 9000, currency: 'EUR' })
    expect(res.body.data.currency).toBe('EUR')
  })

  it('a currency outside the allowlist is 400', async () => {
    const res = await request(app)
      .post('/api/v1/deals')
      .set(as('member'))
      .send({ title: 'T', value: 1, currency: 'Rs' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/^currency: /)
  })

  it('when converted from a lead', async () => {
    await setCurrency('GBP')
    const lead = await Lead.create({ orgId: ctx.org._id, name: 'Lead', ownerId: ctx.users.member._id })
    const res = await request(app).post(`/api/v1/leads/${lead._id}/convert`).set(as('member')).send({})
    expect(res.status).toBe(201)
    expect(res.body.data.currency).toBe('GBP')
  })
})
