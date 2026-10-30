// @ts-check
// Generic factory: list/getById/create/update/remove for any model.
import User from '../models/User.js'
import { canReassign, missOrForbidden, ownerField, sanitizeWrite, scopeFor } from '../policies/ownership.js'
import { badRequest, notFound } from '../utils/http.js'
import { buildListQuery, paginate } from '../utils/queryBuilder.js'
import { labelFor, logActivity } from './activityService.js'

/** @typedef {import('../types/index.js').AuthUser} AuthUser */
/** @typedef {import('../types/index.js').ListQuery} ListQuery */
/** @typedef {import('../types/index.js').PageMeta} PageMeta */
/** @typedef {import('../policies/ownership.js').OwnedResource} OwnedResource */

/**
 * @typedef {object} CrudOptions
 * @property {OwnedResource} resource Selects the ownership policy in policies/ownership.js.
 * @property {import('../utils/validators.js').ListSpec} [list] The list endpoint's spec (from src/schemas). The route
 *   validates against it, and the filterable and sortable fields come from the same object. Omit it only when the
 *   resource has its own list function (activities); `list()` then filters by nothing.
 * @property {string[]} [searchFields] Text-index fields `?q=` searches, when the spec allows search.
 * @property {string} [dateField]
 * @property {import('mongoose').PopulateOptions | import('mongoose').PopulateOptions[]} [populate]
 * @property {string} [activityLabel] e.g. "Lead" — enables audit-trail logging of create/update/delete.
 */

/**
 * Backs any org-scoped, owned resource with the same five operations.
 * Framework-free — takes `actor` ({ id, orgId, role }, i.e. req.user) and
 * plain objects, so it's callable and testable without Express.
 * @template T Raw document shape of the model (e.g. LeadRecord).
 * @param {import('mongoose').Model<T>} Model
 * @param {CrudOptions} options
 * @returns The five operations, typed to the model's documents.
 */
export function createCrudService(Model, options) {
  const { resource, list = { filters: {} }, searchFields, dateField, populate, activityLabel } = options
  const filterableFields = Object.keys(list.filters)
  const sortableFields = list.sort ?? []
  const field = ownerField(resource) // throws at boot for a resource with no policy

  /**
   * @param {AuthUser} actor
   * @param {'create' | 'update' | 'delete'} action
   * @param {import('mongoose').HydratedDocument<T>} doc
   * @param {import('./activityService.js').WriteOptions} [options]
   * @returns {Promise<void> | undefined}
   */
  const log = (actor, action, doc, { session } = {}) => {
    if (!activityLabel) return
    return logActivity(
      {
        orgId: actor.orgId,
        userId: actor.id,
        action,
        entityType: /** @type {import('./activityService.js').LoggedEntity} */ (activityLabel.toLowerCase()),
        // Boundary cast: with T generic, Mongoose can't resolve _id's type, but
        // every model in this app uses the default ObjectId _id.
        entityId: /** @type {import('mongoose').Types.ObjectId} */ (doc._id),
        message: `${action === 'create' ? 'Created' : action === 'update' ? 'Updated' : 'Deleted'} ${activityLabel.toLowerCase()} "${labelFor(doc)}"`,
      },
      { session },
    )
  }

  // Reassignment may only point at someone in the caller's own org — an id
  // from another tenant would otherwise populate that tenant's user here.
  /**
   * @param {AuthUser} actor
   * @param {Record<string, unknown>} body
   * @returns {Promise<void>}
   * @throws {import('../utils/http.js').AppError} 400 INVALID_OWNER
   */
  const assertOwnerInOrg = async (actor, body) => {
    if (!canReassign(actor, resource) || body[field] === undefined || String(body[field]) === String(actor.id)) return
    if (!(await User.exists({ _id: String(body[field]), orgId: actor.orgId }))) {
      throw badRequest(`${field} must be a member of your organization.`, 'INVALID_OWNER')
    }
  }

  return {
    /**
     * @param {AuthUser} actor
     * @param {ListQuery & Record<string, unknown>} query
     * @returns {Promise<{ items: import('mongoose').HydratedDocument<T>[], meta: PageMeta }>}
     */
    async list(actor, query) {
      const plan = buildListQuery(query, { filterableFields, searchFields, sortableFields, dateField })
      Object.assign(plan.filter, { orgId: actor.orgId }, scopeFor(actor, resource, 'read'))
      return paginate(Model, plan, populate)
    },

    /**
     * @param {AuthUser} actor
     * @param {string} id
     * @returns {Promise<import('mongoose').HydratedDocument<T>>}
     * @throws {import('../utils/http.js').AppError} 404
     */
    async getById(actor, id) {
      const query = Model.findOne({ _id: id, orgId: actor.orgId, ...scopeFor(actor, resource, 'read') })
      const doc = await (populate ? query.populate(populate) : query)
      if (!doc) throw notFound(`${Model.modelName} not found.`)
      return doc
    },

    /**
     * @param {AuthUser} actor
     * @param {Record<string, unknown>} body A validated create body (see src/schemas).
     * @param {import('./activityService.js').WriteOptions} [options] Pass a session to create inside a transaction.
     * @returns {Promise<import('mongoose').HydratedDocument<T>>}
     * @throws {import('../utils/http.js').AppError} 400 INVALID_OWNER
     */
    async create(actor, body, { session } = {}) {
      const clean = sanitizeWrite(actor, resource, body, { isCreate: true })
      await assertOwnerInOrg(actor, clean)
      // orgId last, so nothing in the body can ever override it.
      // Boundary cast: `clean` was validated by the resource's Zod schema and
      // sanitised by the policy, but tsc can't relate that to the generic T.
      const created =
        /** @type {import('mongoose').DeepPartial<import('mongoose').ApplyBasicCreateCasting<import('mongoose').Require_id<T>>>} */ (
          /** @type {unknown} */ ({ ...clean, orgId: actor.orgId })
        )
      // Array form: it's the only way Model.create takes a session.
      const [first] = await Model.create([created], { session })
      // Boundary cast: create([one doc]) resolves to exactly one document, but tsc only
      // sees the array overload's loosely typed, possibly-undefined element.
      const doc = /** @type {import('mongoose').HydratedDocument<T>} */ (first)
      await log(actor, 'create', doc, { session })
      return doc
    },

    /**
     * @param {AuthUser} actor
     * @param {string} id
     * @param {Record<string, unknown>} body A validated update body (see src/schemas).
     * @returns {Promise<import('mongoose').HydratedDocument<T>>}
     * @throws {import('../utils/http.js').AppError} 400 INVALID_OWNER, 403, 404
     */
    async update(actor, id, body) {
      const clean = sanitizeWrite(actor, resource, body)
      await assertOwnerInOrg(actor, clean)
      // One atomic, scoped write: a record the caller can't change is simply
      // not matched, so there's no check-then-write race.
      const doc = await Model.findOneAndUpdate(
        { _id: id, orgId: actor.orgId, ...scopeFor(actor, resource, 'write') },
        clean,
        {
          new: true,
          runValidators: true,
        },
      )
      if (!doc) throw await missOrForbidden(Model, actor, id)
      await log(actor, 'update', doc)
      return doc
    },

    /**
     * @param {AuthUser} actor
     * @param {string} id
     * @returns {Promise<import('mongoose').HydratedDocument<T>>}
     * @throws {import('../utils/http.js').AppError} 403, 404
     */
    async remove(actor, id) {
      const doc = await Model.findOneAndDelete({ _id: id, orgId: actor.orgId, ...scopeFor(actor, resource, 'delete') })
      if (!doc) throw await missOrForbidden(Model, actor, id)
      await log(actor, 'delete', doc)
      return doc
    },
  }
}
