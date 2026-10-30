// Convert creates its deal through dealsService.create (stage rules, default stage, close-on-create), all in one transaction.
import request from 'supertest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import app from '../src/app.js'
import { Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import { ActivityLog, Notification } from '../src/models/Logs.js'
import Organization from '../src/models/Organization.js'
import { bearer, makeRecord, seedOrg } from './helpers.js'

let base, custom, other

beforeAll(async () => {
  base = await seedOrg('Convert')
  custom = await seedOrg('Convert custom')
  other = await seedOrg('Convert other')
  // Stored out of order: the default must be the lowest `order`, not array position.
  await Organization.updateOne(
    { _id: custom.org._id },
    {
      pipelineStages: [
        { key: 'demo', label: 'Demo', order: 1 },
        { key: 'discovery', label: 'Discovery', order: 0 },
        { key: 'won', label: 'Signed', order: 2 },
        { key: 'lost', label: 'Lost', order: 3 },
      ],
    },
  )
  await Organization.updateOne(
    { _id: other.org._id },
    { pipelineStages: [{ key: 'only_in_other', label: 'Theirs', order: 0 }] },
  )
})

afterEach(() => vi.restoreAllMocks())

const convert = (ctx, leadId, body, role = 'owner') =>
  request(app).post(`/api/v1/leads/${leadId}/convert`).set(bearer(ctx.tokens[role])).send(body)

/** The lead as stored, and everything written about it and about any deal made from it. */
async function stateOf(leadId) {
  const lead = await Lead.findById(leadId)
  const deals = await Deal.find({ convertedFromLeadId: leadId })
  const dealIds = deals.map((d) => d._id)
  // By _id, not createdAt: entries from one request can share a millisecond.
  const dealLog = (await ActivityLog.find({ entityId: { $in: dealIds } }).sort({ _id: 1 })).map((l) => l.action)
  const leadLog = (await ActivityLog.find({ entityId: leadId }).sort({ _id: 1 })).map((l) => l.action)
  const notifications = await Notification.find({ entityId: { $in: dealIds } })
  return { lead, deals, dealLog, leadLog, notifications }
}

function expectStageRejected(res) {
  expect(res.status).toBe(400)
  expect(res.body).toMatchObject({ success: false, data: null, error: { code: 'VALIDATION_ERROR' }, meta: null })
  expect(res.body.error.message).toMatch(/^stageKey: /)
}

async function expectUntouched(leadId) {
  const { lead, deals, leadLog } = await stateOf(leadId)
  expect(lead.status).toBe('new')
  expect(lead.convertedToDealId).toBeUndefined()
  expect(deals).toHaveLength(0)
  expect(leadLog).toEqual([])
}

describe('stage rules on convert', () => {
  it('rejects an unknown stageKey, and the lead stays unconverted', async () => {
    const lead = await makeRecord('leads', base.org, base.users.owner)
    expectStageRejected(await convert(base, lead._id, { stageKey: 'nope' }))
    await expectUntouched(lead._id)
  })

  it("rejects another org's stage key", async () => {
    const lead = await makeRecord('leads', base.org, base.users.owner)
    expectStageRejected(await convert(base, lead._id, { stageKey: 'only_in_other' }))
    await expectUntouched(lead._id)
  })

  it.each([
    ['the default pipeline', () => base, 'new'],
    ['a custom pipeline (lowest order, not array position)', () => custom, 'discovery'],
  ])('without a stageKey, puts the deal in the first stage of %s', async (_label, ctx, expected) => {
    const lead = await makeRecord('leads', ctx().org, ctx().users.owner)
    const res = await convert(ctx(), lead._id, {})
    expect(res.status).toBe(201)
    expect(res.body.data.stageKey).toBe(expected)
    expect(res.body.data.status).toBe('open')
  })
})

describe('converting into a closing stage', () => {
  it.each(['won', 'lost'])(
    'into %s: the deal is closed (status, closedAt, close entry, notification) and the convert is logged',
    async (stageKey) => {
      const lead = await makeRecord('leads', base.org, base.users.manager)
      const res = await convert(base, lead._id, { stageKey })

      expect(res.status).toBe(201)
      expect(res.body.data).toMatchObject({ stageKey, status: stageKey })
      expect(res.body.data.closedAt).toBeDefined()
      const { lead: stored, deals, dealLog, leadLog, notifications } = await stateOf(lead._id)
      expect(stored.status).toBe('converted')
      expect(String(stored.convertedToDealId)).toBe(String(deals[0]._id))
      expect(dealLog).toEqual(['create', 'close'])
      expect(leadLog).toEqual(['convert'])
      // The close notification plus the existing "lead was converted" one, both to the lead's owner.
      expect(notifications.map((n) => n.message).sort()).toEqual([
        `Deal "Lead" was marked ${stageKey}.`,
        'Lead "Lead" was converted into a deal.',
      ])
      for (const n of notifications) expect(String(n.userId)).toBe(String(base.users.manager._id))
    },
  )

  it('into an open stage: no close entry and only the "converted" notification', async () => {
    const lead = await makeRecord('leads', base.org, base.users.owner)
    const res = await convert(base, lead._id, { stageKey: 'qualified' })
    expect(res.status).toBe(201)
    const { dealLog, leadLog, notifications } = await stateOf(lead._id)
    expect(dealLog).toEqual(['create'])
    expect(leadLog).toEqual(['convert'])
    expect(notifications).toHaveLength(1)
  })

  it("gives the deal to the lead's owner, not the manager converting it", async () => {
    const lead = await makeRecord('leads', base.org, base.users.member)
    const res = await convert(base, lead._id, {}, 'manager')
    expect(String(res.body.data.ownerId)).toBe(String(base.users.member._id))
  })
})

describe('atomicity', () => {
  it('if marking the lead converted fails, the deal and every log entry and notification are rolled back', async () => {
    const lead = await makeRecord('leads', base.org, base.users.owner)
    vi.spyOn(Lead, 'updateOne').mockRejectedValueOnce(new Error('simulated write failure'))

    const res = await convert(base, lead._id, { stageKey: 'won' })

    expect(res.status).toBe(500)
    await expectUntouched(lead._id)
    expect(
      await Notification.countDocuments({
        message: /^Deal "Lead" was marked won\./,
        userId: base.users.owner._id,
        createdAt: { $gte: new Date(Date.now() - 5000) },
      }),
    ).toBe(0)
    // And it can still be converted afterwards.
    const retry = await convert(base, lead._id, { stageKey: 'won' })
    expect(retry.status).toBe(201)
    expect((await stateOf(lead._id)).deals).toHaveLength(1)
  })

  it('a lead converted twice in parallel yields exactly one deal', async () => {
    const lead = await makeRecord('leads', base.org, base.users.owner)
    const results = await Promise.all([convert(base, lead._id, {}), convert(base, lead._id, {})])
    expect(results.map((r) => r.status).sort()).toEqual([201, 400])
    expect((await stateOf(lead._id)).deals).toHaveLength(1)
  })
})
