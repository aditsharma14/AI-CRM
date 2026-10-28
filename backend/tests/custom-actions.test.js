// Convert, move-stage and toggle: the write paths that bypass the CRUD factory.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/app.js'
import { Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import Activity from '../src/models/Activity.js'
import { ROLES, bearer, makeRecord, otherRoleThan, seedOrg } from './helpers.js'

const ACTIONS = {
  convert: {
    resource: 'leads',
    okStatus: 201,
    send: (id, auth) => request(app).post(`/api/v1/leads/${id}/convert`).set(auth),
    unchanged: async (id) => expect((await Lead.findById(id)).status).toBe('new'),
  },
  'move-stage': {
    resource: 'deals',
    okStatus: 200,
    send: (id, auth) => request(app).patch(`/api/v1/deals/${id}/move-stage`).set(auth).send({ stageKey: 'qualified' }),
    unchanged: async (id) => expect((await Deal.findById(id)).stageKey).toBe('new'),
  },
  toggle: {
    resource: 'activities',
    okStatus: 200,
    send: (id, auth) => request(app).patch(`/api/v1/activities/${id}/toggle-status`).set(auth),
    unchanged: async (id) => expect((await Activity.findById(id)).status).toBe('open'),
  },
}

const cases = Object.keys(ACTIONS).flatMap((action) =>
  ROLES.flatMap((role) =>
    ['own', 'others'].map((whose) => ({
      action,
      role,
      whose,
      status: role === 'member' && whose === 'others' ? 403 : ACTIONS[action].okStatus,
    })),
  ),
)

let ctx

beforeAll(async () => {
  ctx = await seedOrg('Custom')
})

describe('custom write actions', () => {
  it.each(cases)('$action: $role on $whose record -> $status', async ({ action, role, whose, status }) => {
    const spec = ACTIONS[action]
    const record = await makeRecord(spec.resource, ctx.org, ctx.users[whose === 'own' ? role : otherRoleThan(role)])
    const res = await spec.send(record._id.toString(), bearer(ctx.tokens[role]))

    expect(res.status).toBe(status)
    if (status === 403) {
      expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } })
      await spec.unchanged(record._id)
    } else {
      expect(res.body.success).toBe(true)
    }
  })
})
