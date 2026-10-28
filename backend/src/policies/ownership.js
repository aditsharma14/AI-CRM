// "Own records only": which records a user may change, and which owner fields they may set.
import { forbidden, notFound } from '../utils/http.js'

// Which field names a record's owner. Activities belong to whoever they're
// assigned to; notes to whoever wrote them.
const OWNER_FIELD = {
  lead: 'ownerId',
  deal: 'ownerId',
  contact: 'ownerId',
  company: 'ownerId',
  activity: 'assigneeId',
  note: 'authorId',
}

// Roles that act org-wide. Members are narrowed to records they own.
const ORG_WIDE_ROLES = new Set(['owner', 'admin', 'manager'])

// A note's author is a fact about who wrote it, not an assignment — nobody
// reassigns it.
const NEVER_REASSIGNED = new Set(['note'])

export function ownerField(resource) {
  const field = OWNER_FIELD[resource]
  // Fail loudly: an unknown resource silently scoped to {} would be an
  // authorization hole, not a harmless default.
  if (!field) throw new Error(`No ownership policy for resource "${resource}"`)
  return field
}

/**
 * Mongo filter fragment to AND into a query for `action` on `resource`.
 * Reads are org-wide for everyone; writes ('write' | 'delete') are narrowed
 * to the caller's own records unless their role acts org-wide. orgId itself
 * is the caller's job — this only adds the ownership half.
 */
export function scopeFor(user, resource, action) {
  const field = ownerField(resource)
  if (action === 'read' || ORG_WIDE_ROLES.has(user.role)) return {}
  return { [field]: user.id }
}

export function canReassign(user, resource) {
  return ORG_WIDE_ROLES.has(user.role) && !NEVER_REASSIGNED.has(resource)
}

/**
 * Strips what a caller may never set (orgId always; the owner field unless
 * they may reassign) and fills the owner on create. Returns a new object.
 */
export function sanitizeWrite(user, resource, body, { isCreate = false } = {}) {
  const field = ownerField(resource)
  const clean = { ...body }
  delete clean.orgId
  if (!canReassign(user, resource)) delete clean[field]
  if (isCreate) clean[field] ??= user.id
  return clean
}

/**
 * Turns a scoped query's miss into the right error: 403 if the record exists
 * in the caller's org (they just don't own it), 404 otherwise — so another
 * org's ids are indistinguishable from ids that never existed.
 */
export async function missOrForbidden(Model, user, id) {
  const existsInOrg = await Model.exists({ _id: id, orgId: user.orgId })
  return existsInOrg
    ? forbidden('You can only change records you own.')
    : notFound(`${Model.modelName} not found.`)
}
