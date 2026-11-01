// Orgs registered by scripts/smoke.mjs are marked isSmoke, derived server-side from the reserved email domain
// (never from the request), so anything cross-org can leave them out and they can be counted.
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import app from '../src/app.js'
import Organization from '../src/models/Organization.js'
import { isSmokeEmail, SMOKE_EMAIL_DOMAIN } from '../src/utils/smoke.js'

let n = 0
const register = (email, extra = {}) =>
  request(app)
    .post('/api/v1/auth/register-org')
    .send({ orgName: `org ${++n}`, name: 'Pat', email, password: 'password123', ...extra })

const orgOf = async (res) => Organization.findById(res.body.data.user.org.id)

describe('smoke orgs', () => {
  it('the domain is reserved (RFC 2606 .invalid), so no real person can own it', () => {
    expect(SMOKE_EMAIL_DOMAIN).toBe('smoke.nimbus.invalid')
    expect(isSmokeEmail('smoke+1@smoke.nimbus.invalid')).toBe(true)
    expect(isSmokeEmail('SMOKE+1@Smoke.Nimbus.Invalid')).toBe(true)
    expect(isSmokeEmail('pat@smoke.nimbus.invalid.example.com')).toBe(false)
    expect(isSmokeEmail('pat@acme.test')).toBe(false)
  })

  it('an org registered with the smoke domain is marked isSmoke', async () => {
    const res = await register(`smoke+${Date.now()}@smoke.nimbus.invalid`)
    expect(res.status).toBe(200)
    expect((await orgOf(res)).isSmoke).toBe(true)
  })

  it('any other org is not', async () => {
    expect((await orgOf(await register(`pat.${Date.now()}@acme.test`))).isSmoke).toBe(false)
  })

  it('the request cannot set it either way', async () => {
    const forced = await register(`real.${Date.now()}@acme.test`, { isSmoke: true })
    expect((await orgOf(forced)).isSmoke).toBe(false)
  })
})

describe('scripts/count-smoke-orgs.js', () => {
  it('counts smoke orgs and their users apart from real ones, with the date range', async () => {
    const { countSmokeOrgs } = await import('../scripts/count-smoke-orgs.js')
    const before = await countSmokeOrgs(Organization.db.db)
    await register(`smoke+a${Date.now()}@smoke.nimbus.invalid`)
    await register(`smoke+b${Date.now()}@smoke.nimbus.invalid`)
    await register(`real.${Date.now()}@acme.test`)

    const after = await countSmokeOrgs(Organization.db.db)
    expect(after.smokeOrgs - before.smokeOrgs).toBe(2)
    expect(after.smokeUsers - before.smokeUsers).toBe(2)
    expect(after.realOrgs - before.realOrgs).toBe(1)
    expect(after.newest).toBeInstanceOf(Date)
  })
})
