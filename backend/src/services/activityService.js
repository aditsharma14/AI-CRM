// Single choke point for writing to Logs: logActivity() and notify().
import { ActivityLog, Notification } from '../models/Logs.js'

/** Audit trail — who did what, to which record, when. Never mutated after insert. */
export async function logActivity({ orgId, userId, action, entityType, entityId, message }) {
  await ActivityLog.create({ orgId, userId, action, entityType, entityId, message })
}

/** In-app notification for one specific user. */
export async function notify({ orgId, userId, entityType, entityId, message }) {
  await Notification.create({ orgId, userId, entityType, entityId, message })
}

/** A short, human-readable label for whatever record just changed. */
export function labelFor(doc) {
  return doc?.name ?? doc?.title ?? (doc?.body ? `${doc.body.slice(0, 40)}…` : String(doc?._id ?? ''))
}
