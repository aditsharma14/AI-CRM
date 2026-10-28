// Tasks and calendar events: listing by type/date, scoped writes, the done/open toggle.
import Activity from '../models/Activity.js'
import { createCrudService } from './crudService.js'
import { logActivity } from './activityService.js'
import { missOrForbidden, scopeFor } from '../policies/ownership.js'

// get/update/remove come from the factory, scoped by assigneeId. Update and
// delete aren't audit-logged (unchanged from before), so no activityLabel.
export const crud = createCrudService(Activity, {
  resource: 'activity',
  populate: { path: 'assigneeId', select: 'name' },
})

/** Filters by type/status/assignee and a date range on whichever date field the type uses. */
export async function list(actor, { page, limit, type, status, assigneeId, dateFrom, dateTo }) {
  const filter = { orgId: actor.orgId, ...scopeFor(actor, 'activity', 'read') }
  if (type) filter.type = type
  if (status) filter.status = status
  if (assigneeId) filter.assigneeId = assigneeId

  // Tasks live on dueDate; calendar events live on startAt — filter
  // whichever date field this request's type actually uses.
  const dateField = type === 'task' ? 'dueDate' : 'startAt'
  if (dateFrom || dateTo) {
    filter[dateField] = {}
    if (dateFrom) filter[dateField].$gte = new Date(dateFrom)
    if (dateTo) filter[dateField].$lte = new Date(dateTo)
  }

  const skip = (page - 1) * limit
  const [items, total] = await Promise.all([
    Activity.find(filter)
      .sort({ [dateField]: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('assigneeId', 'name'),
    Activity.countDocuments(filter),
  ])
  return { items, meta: { page, limit, total, hasMore: skip + items.length < total } }
}

/** Factory create (owner rules, same-org assignee check) plus the type-aware log message. */
export async function create(actor, body) {
  const doc = await crud.create(actor, body)
  await logActivity({
    orgId: actor.orgId,
    userId: actor.id,
    action: 'create',
    entityType: 'activity',
    entityId: doc._id,
    message: `Created ${doc.type} "${doc.title}"`,
  })
  return doc
}

export async function toggleStatus(actor, id) {
  const doc = await Activity.findOne({ _id: id, orgId: actor.orgId, ...scopeFor(actor, 'activity', 'write') })
  if (!doc) throw await missOrForbidden(Activity, actor, id)
  doc.status = doc.status === 'done' ? 'open' : 'done'
  await doc.save()
  return doc
}
