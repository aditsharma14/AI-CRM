// Generic factory: list/getById/create/update/remove for any model.
import { buildListQuery, paginate } from '../utils/queryBuilder.js'
import { notFound } from '../utils/http.js'
import { logActivity, labelFor } from './activityService.js'

/**
 * Backs any org-scoped resource with the same five operations. Framework-free
 * — takes plain ids/objects, so it's callable and testable without Express.
 * Pass `activityLabel` (e.g. "Lead") to get audit-trail logging for free.
 */
export function createCrudService(Model, options = {}) {
  const { filterableFields, searchFields, sortableFields, dateField, populate, extraCreateFields, activityLabel } = options

  const log = (actorId, orgId, action, doc) => {
    if (!activityLabel) return
    return logActivity({
      orgId,
      userId: actorId,
      action,
      entityType: activityLabel.toLowerCase(),
      entityId: doc._id,
      message: `${action === 'create' ? 'Created' : action === 'update' ? 'Updated' : 'Deleted'} ${activityLabel.toLowerCase()} "${labelFor(doc)}"`,
    })
  }

  return {
    async list(orgId, query) {
      const plan = buildListQuery(query, { filterableFields, searchFields, sortableFields, dateField })
      plan.filter.orgId = orgId
      return paginate(Model, plan, populate)
    },

    async getById(orgId, id) {
      const doc = await Model.findOne({ _id: id, orgId }).populate(populate)
      if (!doc) throw notFound(`${Model.modelName} not found.`)
      return doc
    },

    async create(orgId, actorId, body) {
      const extra = extraCreateFields ? extraCreateFields(orgId, actorId) : { orgId, ownerId: body.ownerId ?? actorId }
      const doc = await Model.create({ ...body, ...extra })
      await log(actorId, orgId, 'create', doc)
      return doc
    },

    async update(orgId, actorId, id, body) {
      const doc = await Model.findOneAndUpdate({ _id: id, orgId }, body, { new: true, runValidators: true })
      if (!doc) throw notFound(`${Model.modelName} not found.`)
      await log(actorId, orgId, 'update', doc)
      return doc
    },

    async remove(orgId, actorId, id) {
      const doc = await Model.findOneAndDelete({ _id: id, orgId })
      if (!doc) throw notFound(`${Model.modelName} not found.`)
      await log(actorId, orgId, 'delete', doc)
      return doc
    },
  }
}
