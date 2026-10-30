// @ts-check
// Single choke point for writing to Logs: logActivity() and notify().
import { ActivityLog, Notification } from '../models/Logs.js'

/** @typedef {import('mongoose').Types.ObjectId} ObjectId */
/** @typedef {'lead' | 'contact' | 'company' | 'deal' | 'activity' | 'note'} LoggedEntity */

/**
 * @typedef {object} LogEntry
 * @property {string | ObjectId} orgId
 * @property {string | ObjectId} userId Who acted (audit log) or who is told (notification).
 * @property {LoggedEntity} entityType
 * @property {string | ObjectId} entityId
 * @property {string} message
 */

/**
 * Audit trail — who did what, to which record, when. Never mutated after insert.
 * @param {LogEntry & { action: string }} entry
 * @returns {Promise<void>}
 */
export async function logActivity({ orgId, userId, action, entityType, entityId, message }) {
  await ActivityLog.create({ orgId, userId, action, entityType, entityId, message })
}

/**
 * In-app notification for one specific user.
 * @param {LogEntry} entry
 * @returns {Promise<void>}
 */
export async function notify({ orgId, userId, entityType, entityId, message }) {
  await Notification.create({ orgId, userId, entityType, entityId, message })
}

/**
 * A short, human-readable label for whatever record just changed.
 * @param {{ _id?: unknown, name?: unknown, title?: unknown, body?: unknown } | null | undefined} doc
 * @returns {string}
 */
export function labelFor(doc) {
  // Same precedence as the original `name ?? title ?? (body ? … : _id)`:
  // name/title win whenever present (even ''), body only when non-empty.
  if (typeof doc?.name === 'string') return doc.name
  if (typeof doc?.title === 'string') return doc.title
  if (typeof doc?.body === 'string' && doc.body) return `${doc.body.slice(0, 40)}…`
  return String(doc?._id ?? '')
}
