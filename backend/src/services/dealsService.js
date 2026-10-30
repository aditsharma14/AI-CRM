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
  if (!stage)
    throw badRequest(`stageKey: "${stageKey}" is not a stage in this organization's pipeline.`, 'VALIDATION_ERROR')
  return stage
}

/**
 * A new deal goes in the requested stage, which must be one of the org's,
 * or else the org's first stage (lowest `order`), never a hardcoded key.
 * Also the only way any code creates a deal (lead conversion included), so
 * these rules and close-on-create can't be skipped.
 * @param {AuthUser} actor
 * @param {import('../schemas/deals.js').DealCreateInput & { convertedFromLeadId?: unknown }} body
 * @param {import('./activityService.js').WriteOptions} [options] Pass a session to create inside a transaction.
 * @returns {Promise<import('mongoose').HydratedDocument<import('../models/Deal.js').DealRecord>>}
 * @throws {import('../utils/http.js').AppError} 400 VALIDATION_ERROR, 400 INVALID_OWNER, 404
 */
export async function create(actor, body, { session } = {}) {
  const stages = await stagesOf(actor.orgId)
  const first = [...stages].sort((a, b) => a.order - b.order)[0]
  const stageKey = body.stageKey ?? first?.key
  if (!stageKey) throw badRequest('stageKey: this organization has no pipeline stages.', 'VALIDATION_ERROR')
  const toStage = stageIn(stages, stageKey)
  const deal = await crud.create(actor, { ...body, stageKey }, { session })
  await applyStageTransition(deal, null, toStage, actor, { session })
  return deal
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
  const { orgId } = actor
  // Access first, so a 403/404 never depends on what stage was asked for.
  const deal = await Deal.findOne({ _id: dealId, orgId, ...scopeFor(actor, 'deal', 'write') })
  if (!deal) throw await missOrForbidden(Deal, actor, dealId)

  const toStage = stageIn(await stagesOf(orgId), stageKey)
  await applyStageTransition(deal, deal.stageKey, toStage, actor, { wonLostReason })
  return deal
}

// Closing is keyed on these two keys, whatever an org labels them. Kept
// hardcoded until S2.7 (docs/known-issues.md).
const CLOSING_KEYS = ['won', 'lost']

/**
 * The one place a deal's stage changes take effect: status and closedAt,
 * the audit entry, and the won/lost notification. moveStage calls it for a
 * move; create calls it for a deal born in a stage, so a deal created in
 * won/lost is closed exactly as if it had been moved there.
 * @param {import('mongoose').HydratedDocument<import('../models/Deal.js').DealRecord>} deal Saved here.
 * @param {string | null} fromKey The stage it left, or null when the deal is being created.
 * @param {Stage} toStage One of the org's stages (already checked by stageIn).
 * @param {AuthUser} actor
 * @param {{ wonLostReason?: string, session?: import('mongoose').ClientSession }} [options] The reason is kept only
 *   when closing; with a session, every write here joins that transaction.
 * @returns {Promise<void>}
 */
async function applyStageTransition(deal, fromKey, toStage, actor, { wonLostReason, session } = {}) {
  const closing = CLOSING_KEYS.includes(toStage.key)
  const isCreate = fromKey === null

  deal.stageKey = toStage.key
  if (closing) {
    // Boundary cast: CLOSING_KEYS.includes() proved the key is 'won' or 'lost'; tsc can't narrow through includes().
    deal.status = /** @type {'won' | 'lost'} */ (toStage.key)
    deal.closedAt = new Date()
    if (wonLostReason) deal.wonLostReason = wonLostReason
  } else {
    deal.status = 'open'
    deal.closedAt = undefined
  }
  // A deal created in an open stage is already in that state: no second write.
  if (deal.isModified()) await deal.save({ session })

  // Every move is logged. A creation is already logged by the CRUD factory,
  // so only a creation that closes the deal gets an entry of its own.
  if (!isCreate || closing) {
    await logActivity(
      {
        orgId: actor.orgId,
        userId: actor.id,
        action: isCreate ? 'close' : 'move-stage',
        entityType: 'deal',
        entityId: deal._id,
        message: isCreate
          ? `Created deal "${deal.title}" in ${toStage.label}`
          : `Moved deal "${deal.title}" to ${toStage.label}`,
      },
      { session },
    )
  }

  if (closing) {
    await notify(
      {
        orgId: actor.orgId,
        userId: deal.ownerId,
        entityType: 'deal',
        entityId: deal._id,
        message: `Deal "${deal.title}" was marked ${toStage.key}.`,
      },
      { session },
    )
  }
}
