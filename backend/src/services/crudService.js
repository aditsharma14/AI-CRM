// Generic factory: list/getById/create/update/remove for any model.
import User from '../models/User.js'
import { buildListQuery, paginate } from '../utils/queryBuilder.js'
import { badRequest, notFound } from '../utils/http.js'
import { canReassign, missOrForbidden, ownerField, sanitizeWrite, scopeFor } from '../policies/ownership.js'
import { logActivity, labelFor } from './activityService.js'

/**
 * Backs any org-scoped, owned resource with the same five operations.
 * Framework-free — takes `actor` ({ id, orgId, role }, i.e. req.user) and
 * plain objects, so it's callable and testable without Express.
 * `resource` (e.g. 'lead') selects the ownership policy in policies/ownership.js.
 * Pass `activityLabel` (e.g. "Lead") to get audit-trail logging for free.
 */
export function createCrudService(Model, options = {}) {
  const { resource, filterableFields, searchFields, sortableFields, dateField, populate, activityLabel } = options
  const field = ownerField(resource) // throws at boot for a resource with no policy

  const log = (actor, action, doc) => {
    if (!activityLabel) return
    return logActivity({
      orgId: actor.orgId,
      userId: actor.id,
      action,
      entityType: activityLabel.toLowerCase(),
      entityId: doc._id,
      message: `${action === 'create' ? 'Created' : action === 'update' ? 'Updated' : 'Deleted'} ${activityLabel.toLowerCase()} "${labelFor(doc)}"`,
    })
  }

  // Reassignment may only point at someone in the caller's own org — an id
  // from another tenant would otherwise populate that tenant's user here.
  const assertOwnerInOrg = async (actor, body) => {
    if (!canReassign(actor, resource) || body[field] === undefined || String(body[field]) === String(actor.id)) return
    if (!(await User.exists({ _id: body[field], orgId: actor.orgId }))) {
      throw badRequest(`${field} must be a member of your organization.`, 'INVALID_OWNER')
    }
  }

  return {
    async list(actor, query) {
      const plan = buildListQuery(query, { filterableFields, searchFields, sortableFields, dateField })
      Object.assign(plan.filter, { orgId: actor.orgId }, scopeFor(actor, resource, 'read'))
      return paginate(Model, plan, populate)
    },

    async getById(actor, id) {
      const doc = await Model.findOne({ _id: id, orgId: actor.orgId, ...scopeFor(actor, resource, 'read') }).populate(populate)
      if (!doc) throw notFound(`${Model.modelName} not found.`)
      return doc
    },

    async create(actor, body) {
      const clean = sanitizeWrite(actor, resource, body, { isCreate: true })
      await assertOwnerInOrg(actor, clean)
      // orgId last, so nothing in the body can ever override it.
      const doc = await Model.create({ ...clean, orgId: actor.orgId })
      await log(actor, 'create', doc)
      return doc
    },

    async update(actor, id, body) {
      const clean = sanitizeWrite(actor, resource, body)
      await assertOwnerInOrg(actor, clean)
      // One atomic, scoped write: a record the caller can't change is simply
      // not matched, so there's no check-then-write race.
      const doc = await Model.findOneAndUpdate({ _id: id, orgId: actor.orgId, ...scopeFor(actor, resource, 'write') }, clean, {
        new: true,
        runValidators: true,
      })
      if (!doc) throw await missOrForbidden(Model, actor, id)
      await log(actor, 'update', doc)
      return doc
    },

    async remove(actor, id) {
      const doc = await Model.findOneAndDelete({ _id: id, orgId: actor.orgId, ...scopeFor(actor, resource, 'delete') })
      if (!doc) throw await missOrForbidden(Model, actor, id)
      await log(actor, 'delete', doc)
      return doc
    },
  }
}
