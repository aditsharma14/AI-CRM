// @ts-check
// Stage-transition validation, win/loss side effects, logging/notifying.
import Deal from '../models/Deal.js'
import Organization from '../models/Organization.js'
import { createCrudService } from './crudService.js'
import { logActivity, notify } from './activityService.js'
import { badRequest, notFound } from '../utils/http.js'
import { missOrForbidden, scopeFor } from '../policies/ownership.js'
import { dealList } from '../schemas/deals.js'

export const crud = createCrudService(Deal, {
  resource: 'deal',
  list: dealList,
  populate: [
    { path: 'companyId', select: 'name' },
    { path: 'contactIds', select: 'name' },
  ],
  activityLabel: 'Deal',
})

/** @typedef {import('../types/index.js').AuthUser} AuthUser */
/** @typedef {{ key: string, label: string, order: number }} Stage */

/**
 * The org's pipeline stages: stage keys are only meaningful per org.
 * @param {unknown} orgId
 * @returns {Promise<Stage[]>}
 * @throws {import('../utils/http.js').AppError} 404 when the org document is gone
 */
async function stagesOf(orgId) {
  const org = await Organization.findById(orgId).select('pipelineStages')
  if (!org) throw notFound('Organization not found.')
  return org.pipelineStages
}

/**
 * Same `field: message` shape validate() gives Zod errors, so a bad stage
 * reads like any other bad field.
 * @param {Stage[]} stages
 * @param {string} stageKey
 * @returns {Stage}
 * @throws {import('../utils/http.js').AppError} 400 VALIDATION_ERROR
 */
function stageIn(stages, stageKey) {
  const stage = stages.find((s) => s.key === stageKey)
  if (!stage) throw badRequest(`stageKey: "${stageKey}" is not a stage in this organization's pipeline.`, 'VALIDATION_ERROR')
  return stage
}

/**
 * A new deal goes in the requested stage, which must be one of the org's,
 * or else the org's first stage (lowest `order`), never a hardcoded key.
 * @param {AuthUser} actor
 * @param {import('../schemas/deals.js').DealCreateInput} body
 * @returns {Promise<import('mongoose').HydratedDocument<import('../models/Deal.js').DealRecord>>}
 * @throws {import('../utils/http.js').AppError} 400 VALIDATION_ERROR, 400 INVALID_OWNER, 404
 */
export async function create(actor, body) {
  const stages = await stagesOf(actor.orgId)
  const first = [...stages].sort((a, b) => a.order - b.order)[0]
  const stageKey = body.stageKey ?? first?.key
  if (!stageKey) throw badRequest('stageKey: this organization has no pipeline stages.', 'VALIDATION_ERROR')
  stageIn(stages, stageKey)
  return crud.create(actor, { ...body, stageKey })
}

/**
 * Everything but the stage. A stage change has side effects (status,
 * closedAt, the audit log, the won/lost notification) that only moveStage
 * performs, so the plain update refuses stageKey outright rather than
 * silently skipping them. Checked before the write: the answer depends only
 * on the body, so it reveals nothing about the deal.
 * @param {AuthUser} actor
 * @param {string} id
 * @param {import('../schemas/deals.js').DealUpdateInput} body
 * @returns {Promise<import('mongoose').HydratedDocument<import('../models/Deal.js').DealRecord>>}
 * @throws {import('../utils/http.js').AppError} 400 VALIDATION_ERROR, 403, 404
 */
export async function update(actor, id, body) {
  if (body.stageKey !== undefined) {
    throw badRequest("stageKey: use PATCH /deals/:id/move-stage to change a deal's stage.", 'VALIDATION_ERROR')
  }
  return crud.update(actor, id, body)
}

/**
 * @param {AuthUser} actor
 * @param {string} dealId
 * @param {string} stageKey Must be one of the org's pipeline stage keys.
 * @param {string} [wonLostReason] Kept only when moving to 'won' or 'lost'.
 * @returns {Promise<import('mongoose').HydratedDocument<import('../models/Deal.js').DealRecord>>}
 * @throws {import('../utils/http.js').AppError} 400 VALIDATION_ERROR, 403, 404
 */
export async function moveStage(actor, dealId, stageKey, wonLostReason) {
  const { orgId, id: actorId } = actor
  // Access first, so a 403/404 never depends on what stage was asked for.
  const deal = await Deal.findOne({ _id: dealId, orgId, ...scopeFor(actor, 'deal', 'write') })
  if (!deal) throw await missOrForbidden(Deal, actor, dealId)

  const stage = stageIn(await stagesOf(orgId), stageKey)

  deal.stageKey = stageKey
  if (stageKey === 'won' || stageKey === 'lost') {
    deal.status = stageKey
    deal.closedAt = new Date()
    if (wonLostReason) deal.wonLostReason = wonLostReason
  } else {
    deal.status = 'open'
    deal.closedAt = undefined
  }
  await deal.save()

  await logActivity({
    orgId,
    userId: actorId,
    action: 'move-stage',
    entityType: 'deal',
    entityId: deal._id,
    message: `Moved deal "${deal.title}" to ${stage.label}`,
  })

  if (stageKey === 'won' || stageKey === 'lost') {
    await notify({
      orgId,
      userId: deal.ownerId,
      entityType: 'deal',
      entityId: deal._id,
      message: `Deal "${deal.title}" was marked ${stageKey}.`,
    })
  }

  return deal
}
