// @ts-check
// Cross-org reference policy: a stored reference must point at a document in the writer's own org.
import { Company, Contact, Lead } from '../models/CRM.js'
import Deal from '../models/Deal.js'
import { badRequest } from '../utils/http.js'

/**
 * @typedef {object} Reference
 * @property {string} field Request field, as the error names it (e.g. 'companyId', 'linkedTo.entityId').
 * @property {import('mongoose').Model<unknown>} model The collection the id must be in.
 * @property {unknown} ids One id, an array of ids, or nothing (undefined / null / '' / []: skipped).
 */

/** What a note or an activity's `linkedTo` may be attached to. */
const ENTITY_MODELS = /** @type {const} */ ({ lead: Lead, contact: Contact, company: Company, deal: Deal })

/** @typedef {keyof typeof ENTITY_MODELS} EntityType */

/**
 * The model for a polymorphic reference's `entityType`, checked against the allowlist first, so a
 * caller that skipped Zod can't point a reference at users, orgs or a prototype key.
 * @param {string} field The type field, as the error names it.
 * @param {unknown} entityType
 * @returns {import('mongoose').Model<unknown>}
 * @throws {import('../utils/http.js').AppError} 400 VALIDATION_ERROR
 */
export function entityModel(field, entityType) {
  if (typeof entityType !== 'string' || !Object.hasOwn(ENTITY_MODELS, entityType)) {
    throw badRequest(`${field}: must be one of ${Object.keys(ENTITY_MODELS).join(', ')}.`, 'VALIDATION_ERROR')
  }
  return ENTITY_MODELS[/** @type {EntityType} */ (entityType)]
}

/**
 * Throws unless every referenced id is a document in `orgId`. One count per field, over the distinct ids,
 * so `[a, a]` is one id found once. An id in another org and an id that exists nowhere get the same
 * error, so the response never reveals that another tenant's document exists. (No model has soft delete;
 * tests/references.unit.test.js fails if one gains it, so this filter gets updated with it.)
 * @param {unknown} orgId
 * @param {Reference[]} references
 * @param {{ session?: import('mongoose').ClientSession }} [options] Read inside this transaction.
 * @returns {Promise<void>}
 * @throws {import('../utils/http.js').AppError} 400 VALIDATION_ERROR naming the field
 */
export async function assertReferencesInOrg(orgId, references, { session } = {}) {
  for (const { field, model, ids } of references) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => id !== undefined && id !== null && id !== '')
    const distinct = [...new Set(list.map(String))]
    if (!distinct.length) continue
    const found = await model.countDocuments({ _id: { $in: distinct }, orgId }).session(session ?? null)
    if (found !== distinct.length) {
      throw badRequest(`${field}: no such ${model.modelName.toLowerCase()} in your organization.`, 'VALIDATION_ERROR')
    }
  }
}
