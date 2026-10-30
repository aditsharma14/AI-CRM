// stageKey must be one of the org's stages on create and move-stage (update can't change it); won/lost close the deal either way.
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import app from '../src/app.js'
import Deal from '../src/models/Deal.js'
import Organization from '../src/models/Organization.js'
import { ActivityLog, Notification } from '../src/models/Logs.js'
import { bearer, makeRecord, seedOrg } from './helpers.js'

const api = '/api/v1/deals'
let base, custom, other

// Stored out of order on purpose: "first stage" means lowest `order`, not array position.
const CUSTOM_STAGES = [
  { key: 'demo', label: 'Demo', order: 1 },
  { key: 'discovery', label: 'Discovery', order: 0 },
  { key: 'won', label: 'Signed', order: 2 },
  { key: 'lost', label: 'Lost', order: 3 },
]

beforeAll(async () => {
  base = await seedOrg('Default stages')
  custom = await seedOrg('Custom stages')
  other = await seedOrg('Other')
  await Organization.updateOne({ _id: custom.org._id }, { pipelineStages: CUSTOM_STAGES })
  await Organization.updateOne(
    { _id: other.org._id },
    { pipelineStages: [{ key: 'only_in_other', label: 'Theirs', order: 0 }] },
  )
})

const as = (ctx, role = 'owner') => bearer(ctx.tokens[role])
const create = (ctx, body) =>
  request(app)
    .post(api)
    .set(as(ctx))
    .send({ title: 'Deal', value: 10, ...body })
const move = (ctx, id, stageKey, role) =>
  request(app).patch(`${api}/${id}/move-stage`).set(as(ctx, role)).send({ stageKey })

function expectStageRejected(res, mention = 'stageKey') {
  expect(res.status).toBe(400)
  expect(res.body).toMatchObject({ success: false, data: null, error: { code: 'VALIDATION_ERROR' }, meta: null })
  expect(res.body.error.message).toMatch(new RegExp(`^${mention}: `))
}

describe('create', () => {
  it('rejects a stage the org does not have, and stores nothing', async () => {
    const before = await Deal.countDocuments({ orgId: base.org._id })
    expectStageRejected(await create(base, { stageKey: 'nope' }))
    expect(await Deal.countDocuments({ orgId: base.org._id })).toBe(before)
  })

  it("rejects another org's stage key", async () => {
    expectStageRejected(await create(base, { stageKey: 'only_in_other' }))
  })

  it('accepts a custom stage of the requesting org', async () => {
    const res = await create(custom, { stageKey: 'demo' })
    expect(res.status).toBe(201)
    expect(res.body.data.stageKey).toBe('demo')
  })

  it.each([
    ['the default pipeline', () => base, 'new'],
    ['a custom pipeline (lowest order, not array position)', () => custom, 'discovery'],
  ])('without a stageKey, starts the deal in the first stage of %s', async (_label, ctx, expected) => {
    const res = await create(ctx(), {})
    expect(res.status).toBe(201)
    expect(res.body.data.stageKey).toBe(expected)
  })
})

describe('update', () => {
  it.each([
    ['a valid stage', 'qualified'],
    ['an unknown stage', 'nope'],
  ])('refuses to change stageKey (%s): stage changes go through move-stage', async (_label, stageKey) => {
    const deal = await makeRecord('deals', base.org, base.users.owner)
    const res = await request(app).patch(`${api}/${deal._id}`).set(as(base)).send({ stageKey, title: 'Renamed' })

    expectStageRejected(res)
    expect(res.body.error.message).toContain('move-stage')
    const after = await Deal.findById(deal._id)
    expect(after.stageKey).toBe('new')
    expect(after.title).toBe('Deal') // nothing in the body applied
  })

  it('still updates the other fields', async () => {
    const deal = await makeRecord('deals', base.org, base.users.owner)
    const res = await request(app).patch(`${api}/${deal._id}`).set(as(base)).send({ title: 'Renamed', value: 99 })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ title: 'Renamed', value: 99, stageKey: 'new' })
  })
})

describe('move-stage', () => {
  it('rejects a stage the org does not have, and leaves the deal and the audit log alone', async () => {
    const deal = await makeRecord('deals', base.org, base.users.owner)
    expectStageRejected(await move(base, deal._id, 'nope'))
    expect((await Deal.findById(deal._id)).stageKey).toBe('new')
    expect(await ActivityLog.countDocuments({ entityId: deal._id, action: 'move-stage' })).toBe(0)
  })

  it("rejects another org's stage key", async () => {
    const deal = await makeRecord('deals', base.org, base.users.owner)
    expectStageRejected(await move(base, deal._id, 'only_in_other'))
  })

  it('accepts a custom stage of the requesting org', async () => {
    const deal = await Deal.create({
      orgId: custom.org._id,
      title: 'C',
      value: 1,
      stageKey: 'discovery',
      ownerId: custom.users.owner._id,
    })
    const res = await move(custom, deal._id, 'demo')
    expect(res.status).toBe(200)
    expect(res.body.data.stageKey).toBe('demo')
  })

  it('checks access before the stage: a member moving someone else’s deal to a bad stage gets 403', async () => {
    const deal = await makeRecord('deals', base.org, base.users.manager)
    const res = await move(base, deal._id, 'nope', 'member')
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

/** Audit entries and notifications about one deal, split by kind. */
async function trailOf(dealId) {
  // By _id, not createdAt: the create and close entries can share a millisecond.
  const logs = await ActivityLog.find({ entityId: dealId }).sort({ _id: 1 })
  const notifications = await Notification.find({ entityId: dealId })
  return { actions: logs.map((l) => l.action), notifications }
}

describe('closing stages on create', () => {
  it.each(['won', 'lost'])(
    'creating in %s closes the deal: status, closedAt, one close entry, one notification',
    async (stageKey) => {
      const before = Date.now()
      const res = await create(base, { stageKey })
      expect(res.status).toBe(201)
      expect(res.body.data.status).toBe(stageKey)
      expect(new Date(res.body.data.closedAt).getTime()).toBeGreaterThanOrEqual(before - 1000)

      const stored = await Deal.findById(res.body.data._id)
      expect(stored.status).toBe(stageKey)
      expect(stored.closedAt).toBeInstanceOf(Date)
      const { actions, notifications } = await trailOf(stored._id)
      // The factory's usual 'create' entry, plus exactly one for the close.
      expect(actions).toEqual(['create', 'close'])
      expect(notifications).toHaveLength(1)
      expect(String(notifications[0].userId)).toBe(String(base.users.owner._id))
      expect(notifications[0].message).toContain(stageKey)
    },
  )

  it('creating in an open stage leaves it open: no closedAt, no close entry, no notification', async () => {
    const res = await create(base, { stageKey: 'qualified' })
    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('open')
    expect(res.body.data.closedAt).toBeUndefined()
    const { actions, notifications } = await trailOf(res.body.data._id)
    expect(actions).toEqual(['create'])
    expect(notifications).toHaveLength(0)
  })

  it('the closing keys are the hardcoded won/lost, whatever the org calls them', async () => {
    // custom org labels 'won' as "Signed": still a close (keys stay hardcoded until S2.7).
    const res = await create(custom, { stageKey: 'won' })
    expect(res.body.data.status).toBe('won')
  })
})

// Pins move-stage's close behaviour, so extracting it into a shared helper can't change it.
describe('closing stages on move-stage', () => {
  it('moving to won closes the deal, keeps the reason, logs one move and notifies the owner once', async () => {
    const deal = await makeRecord('deals', base.org, base.users.manager)
    const res = await request(app)
      .patch(`${api}/${deal._id}/move-stage`)
      .set(as(base))
      .send({ stageKey: 'won', wonLostReason: 'Price' })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ stageKey: 'won', status: 'won', wonLostReason: 'Price' })
    expect(res.body.data.closedAt).toBeDefined()
    const { actions, notifications } = await trailOf(deal._id)
    expect(actions).toEqual(['move-stage'])
    expect(notifications).toHaveLength(1)
    expect(String(notifications[0].userId)).toBe(String(base.users.manager._id))
  })

  it('moving a closed deal back to an open stage reopens it, logs the move, and does not notify', async () => {
    const deal = await makeRecord('deals', base.org, base.users.owner)
    await move(base, deal._id, 'lost')
    const res = await move(base, deal._id, 'proposal')

    expect(res.body.data).toMatchObject({ stageKey: 'proposal', status: 'open' })
    expect(res.body.data.closedAt).toBeUndefined()
    const { actions, notifications } = await trailOf(deal._id)
    expect(actions).toEqual(['move-stage', 'move-stage'])
    expect(notifications).toHaveLength(1) // only the earlier close
  })
})
