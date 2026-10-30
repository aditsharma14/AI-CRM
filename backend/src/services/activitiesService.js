// @ts-check
// Tasks and calendar events: listing by type/date, scoped writes, the done/open toggle.
import Activity from '../models/Activity.js'
import { missOrForbidden, scopeFor } from '../policies/ownership.js'
import { logActivity } from './activityService.js'
import { createCrudService } from './crudService.js'

/** @typedef {import('../types/index.js').AuthUser} AuthUser */
/** @typedef {import('../types/index.js').PageMeta} PageMeta */
/** @typedef {import('mongoose').HydratedDocument<import('../models/Activity.js').ActivityRecord>} ActivityDoc */

// get/update/remove come from the factory, scoped by assigneeId. Update and
// delete aren't audit-logged (unchanged from before), so no activityLabel.
export const crud = createCrudService(Activity, {
  resource: 'activity',
  populate: { path: 'assigneeId', select: 'name' },
})

/**
 * Filters by type/status/assignee and a date range on whichever date field the type uses.
 * @param {AuthUser} actor
 * @param {import('../schemas/activities.js').ActivityListQuery} query
 * @returns {Promise<{ items: ActivityDoc[], meta: PageMeta }>}
 */
export async function list(actor, { page, limit, type, status, assigneeId, dateFrom, dateTo }) {
  /** @type {Record<string, unknown>} */
  const filter = { orgId: actor.orgId, ...scopeFor(actor, 'activity', 'read') }
  if (type) filter.type = type
  if (status) filter.status = status
  if (assigneeId) filter.assigneeId = assigneeId

  // Tasks live on dueDate; calendar events live on startAt — filter
  // whichever date field this request's type actually uses.
  const dateField = type === 'task' ? 'dueDate' : 'startAt'
  if (dateFrom || dateTo) {
    /** @type {{ $gte?: Date, $lte?: Date }} */
    const range = {}
    if (dateFrom) range.$gte = new Date(dateFrom)
    if (dateTo) range.$lte = new Date(dateTo)
    filter[dateField] = range
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

/**
 * Factory create (owner rules, same-org assignee check) plus the type-aware log message.
 * @param {AuthUser} actor
 * @param {import('../schemas/activities.js').ActivityCreateInput} body
 * @returns {Promise<ActivityDoc>}
 * @throws {import('../utils/http.js').AppError} 400 INVALID_OWNER
 */
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

/**
 * @param {AuthUser} actor
 * @param {string} id
 * @returns {Promise<ActivityDoc>}
 * @throws {import('../utils/http.js').AppError} 403, 404
 */
export async function toggleStatus(actor, id) {
  const doc = await Activity.findOne({ _id: id, orgId: actor.orgId, ...scopeFor(actor, 'activity', 'write') })
  if (!doc) throw await missOrForbidden(Activity, actor, id)
  doc.status = doc.status === 'done' ? 'open' : 'done'
  await doc.save()
  return doc
}
