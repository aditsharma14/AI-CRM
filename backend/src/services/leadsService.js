// @ts-check
// Lead CRUD plus convert-to-deal (one transaction, via dealsService.create). The AI rescore is promised, not built.
import AiBrief from '../models/AiBrief.js'
import AiJob, { ACTIVE_STATES } from '../models/AiJob.js'
import { Company, Lead } from '../models/CRM.js'
import { missOrForbidden, scopeFor } from '../policies/ownership.js'
import { leadList } from '../schemas/leads.js'
import { badRequest } from '../utils/http.js'
import { labelFor, logActivity, notify } from './activityLogService.js'
import { createCrudService } from './crudService.js'
import * as dealsService from './dealsService.js'

export const crud = createCrudService(Lead, {
  resource: 'lead',
  list: leadList,
  searchFields: ['name', 'email'],
  populate: { path: 'companyId', select: 'name' },
  activityLabel: 'Lead',
  references: (body) => [{ field: 'companyId', model: Company, ids: body.companyId }],
})

/** @typedef {import('../types/index.js').AuthUser} AuthUser */

/**
 * Turns a lead into a deal. The deal is made by dealsService.create, so the
 * stage rules (one of the org's stages; default its first) and
 * close-on-create apply exactly as for any new deal.
 *
 * Two documents change (a new deal, the converted lead) plus their log
 * entries and notifications, so it all runs in one transaction: a failure
 * anywhere leaves neither a converted lead without its deal nor a deal
 * whose lead still looks unconverted.
 * @param {AuthUser} actor
 * @param {string} leadId
 * @param {import('../schemas/leads.js').LeadConvertInput} [dealInput]
 * @returns {Promise<import('mongoose').HydratedDocument<import('../models/Deal.js').DealRecord>>} The new deal.
 * @throws {import('../utils/http.js').AppError} 400 ALREADY_CONVERTED, 400 VALIDATION_ERROR (stageKey), 403, 404
 */
export async function convertToDeal(actor, leadId, dealInput = {}) {
  const { orgId, id: actorId } = actor
  // Converting changes the lead, so it's a write: members may convert only
  // their own. The new deal goes to the lead's owner.
  const lead = await Lead.findOne({ _id: leadId, orgId, ...scopeFor(actor, 'lead', 'write') })
  if (!lead) throw await missOrForbidden(Lead, actor, leadId)
  if (lead.status === 'converted') throw alreadyConverted()

  // Mongoose retries the callback on transient errors (e.g. a write
  // conflict with a parallel convert of the same lead).
  return Lead.db.transaction(async (session) => {
    const deal = await dealsService.create(
      actor,
      {
        title: dealInput.title || lead.name,
        value: dealInput.value ?? 0,
        stageKey: dealInput.stageKey,
        companyId: lead.companyId ? String(lead.companyId) : undefined,
        ownerId: String(lead.ownerId),
        convertedFromLeadId: lead._id,
      },
      { session },
    )

    // Conditional, so of two parallel converts only one can mark the lead;
    // the other aborts and its deal is rolled back with it.
    const marked = await Lead.updateOne(
      { _id: lead._id, orgId, status: { $ne: 'converted' } },
      { status: 'converted', convertedToDealId: deal._id, convertedAt: new Date() },
      { session },
    )
    if (marked.modifiedCount !== 1) throw alreadyConverted()

    await logActivity(
      {
        orgId,
        userId: actorId,
        action: 'convert',
        entityType: 'lead',
        entityId: lead._id,
        message: `Converted lead "${lead.name}" into a deal`,
      },
      { session },
    )
    await notify(
      {
        orgId,
        userId: lead.ownerId,
        entityType: 'deal',
        entityId: deal._id,
        message: `Lead "${lead.name}" was converted into a deal.`,
      },
      { session },
    )
    return deal
  })
}

const alreadyConverted = () => badRequest('This lead has already been converted.', 'ALREADY_CONVERTED')

/**
 * Deletes a lead and what exists only for it (its cached AI briefs; its open AI jobs end), in one transaction: either both go or neither.
 * Same rules and audit entry as the CRUD factory's remove.
 * @param {AuthUser} actor
 * @param {string} id
 * @returns {Promise<import('mongoose').HydratedDocument<import('../models/CRM.js').LeadRecord>>} The deleted lead.
 * @throws {import('../utils/http.js').AppError} 403, 404
 */
export async function remove(actor, id) {
  return Lead.db.transaction(async (session) => {
    const doc = await Lead.findOneAndDelete(
      { _id: id, orgId: actor.orgId, ...scopeFor(actor, 'lead', 'delete') },
      { session },
    )
    if (!doc) throw await missOrForbidden(Lead, actor, id)
    await AiBrief.deleteMany({ orgId: actor.orgId, leadId: doc._id }, { session })
    // Its open jobs end here: a worker still running one finds it no longer running and writes nothing.
    await AiJob.updateMany(
      { orgId: actor.orgId, leadId: doc._id, state: { $in: [...ACTIVE_STATES] } },
      {
        $set: {
          state: 'failed',
          error: { code: 'NOT_FOUND', message: 'This lead was deleted.' },
          finishedAt: new Date(),
          lockedBy: null,
          lockedUntil: null,
        },
        $unset: { bundle: 1 },
      },
      { session },
    )
    await logActivity(
      {
        orgId: actor.orgId,
        userId: actor.id,
        action: 'delete',
        entityType: 'lead',
        entityId: doc._id,
        message: `Deleted lead "${labelFor(doc)}"`,
      },
      { session },
    )
    return doc
  })
}
