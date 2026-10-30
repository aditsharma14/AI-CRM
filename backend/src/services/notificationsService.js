// @ts-check
// A user's notifications (list, mark read) and the org's read-only activity log.
import { Notification, ActivityLog } from '../models/Logs.js'
import { notFound } from '../utils/http.js'
import { buildListQuery, paginate } from '../utils/queryBuilder.js'
import { notificationList } from '../schemas/notifications.js'

/** @typedef {import('../types/index.js').AuthUser} AuthUser */
/** @typedef {import('../schemas/notifications.js').NotificationListQuery} NotificationListQuery */
/** @typedef {import('../schemas/notifications.js').ActivityLogQuery} ActivityLogQuery */

/**
 * The actor's own notifications, newest first, plus their unread count
 * (the bell badge needs it whatever filter the list uses).
 * @param {AuthUser} actor
 * @param {NotificationListQuery} query
 * @returns {Promise<{ items: unknown[], meta: import('../types/index.js').PageMeta & { unreadCount: number } }>}
 */
export async function list(actor, query) {
  const plan = buildListQuery(query, {
    filterableFields: Object.keys(notificationList.filters),
    sortableFields: notificationList.sort,
  })
  const mine = { orgId: actor.orgId, userId: actor.id }
  Object.assign(plan.filter, mine)
  const [{ items, meta }, unreadCount] = await Promise.all([
    paginate(Notification, plan),
    Notification.countDocuments({ ...mine, read: false }),
  ])
  return { items, meta: { ...meta, unreadCount } }
}

/**
 * @param {AuthUser} actor
 * @param {string} id
 * @returns {Promise<unknown>}
 * @throws {import('../utils/http.js').AppError} 404 (also for someone else's notification)
 */
export async function markRead(actor, id) {
  const doc = await Notification.findOneAndUpdate(
    { _id: id, orgId: actor.orgId, userId: actor.id },
    { read: true },
    { new: true },
  )
  if (!doc) throw notFound('Notification not found.')
  return doc
}

/**
 * @param {AuthUser} actor
 * @returns {Promise<void>}
 */
export async function markAllRead(actor) {
  await Notification.updateMany({ orgId: actor.orgId, userId: actor.id, read: false }, { read: true })
}

/**
 * The org's audit trail, newest first.
 * @param {AuthUser} actor
 * @param {ActivityLogQuery} query
 * @returns {Promise<{ items: unknown[], meta: import('../types/index.js').PageMeta }>}
 */
export async function activityLog(actor, query) {
  const plan = buildListQuery(query)
  plan.filter.orgId = actor.orgId
  return paginate(ActivityLog, plan, { path: 'userId', select: 'name' })
}
