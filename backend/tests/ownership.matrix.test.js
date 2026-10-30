// Role x action x ownership matrix for leads and deals (CLAUDE.md §5 policy table).
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'

import app from '../src/app.js'
import { bearer, makeRecord, MODELS, otherRoleThan, RENAME, ROLES, seedOrg } from './helpers.js'

const RESOURCES = ['leads', 'deals']
const ACTIONS = ['list', 'get', 'update', 'delete']
const WHOSE = ['own', 'others']

/** The policy, written out independently of the implementation. */
function expectedStatus(role, action, whose) {
  if (action === 'list' || action === 'get') return 200
  if (action === 'delete') return role === 'member' ? 403 : 200 // members have no crm:delete at all
  return role === 'member' && whose === 'others' ? 403 : 200
}

const cases = RESOURCES.flatMap((resource) =>
  ROLES.flatMap((role) =>
    ACTIONS.flatMap((action) =>
      WHOSE.map((whose) => ({ resource, role, action, whose, status: expectedStatus(role, action, whose) })),
    ),
  ),
)

let ctx

beforeAll(async () => {
  ctx = await seedOrg('Matrix')
})

describe('ownership matrix', () => {
  it('covers every role x action x ownership combination', () => {
    expect(cases).toHaveLength(RESOURCES.length * ROLES.length * ACTIONS.length * WHOSE.length)
  })

  it.each(cases)(
    '$resource: $role $action on $whose record -> $status',
    async ({ resource, role, action, whose, status }) => {
      const ownerUser = ctx.users[whose === 'own' ? role : otherRoleThan(role)]
      const record = await makeRecord(resource, ctx.org, ownerUser)
      const id = record._id.toString()
      const auth = bearer(ctx.tokens[role])
      const Model = MODELS[resource]

      let res
      if (action === 'list') res = await request(app).get(`/api/v1/${resource}`).set(auth)
      if (action === 'get') res = await request(app).get(`/api/v1/${resource}/${id}`).set(auth)
      if (action === 'update')
        res = await request(app).patch(`/api/v1/${resource}/${id}`).set(auth).send(RENAME[resource])
      if (action === 'delete') res = await request(app).delete(`/api/v1/${resource}/${id}`).set(auth)

      expect(res.status).toBe(status)

      if (status === 403) {
        expect(res.body).toMatchObject({ success: false, data: null, error: { code: 'FORBIDDEN' }, meta: null })
        // A refused write must leave the record exactly as it was.
        const after = await Model.findById(id).lean()
        expect(after).not.toBeNull()
        const [field] = Object.keys(RENAME[resource])
        expect(after[field]).toBe(record[field])
        return
      }

      expect(res.body.success).toBe(true)
      if (action === 'list') expect(res.body.data.map((d) => d._id)).toContain(id)
      if (action === 'get') expect(res.body.data._id).toBe(id)
      if (action === 'update') {
        const [[field, value]] = Object.entries(RENAME[resource])
        expect((await Model.findById(id).lean())[field]).toBe(value)
      }
      if (action === 'delete') expect(await Model.findById(id)).toBeNull()
    },
  )
})
