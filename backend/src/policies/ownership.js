// @ts-check
// "Own records only": which records a user may change, and which owner fields they may set.
import { forbidden, notFound } from '../utils/http.js'

/** @typedef {import('../types/index.js').AuthUser} AuthUser */
/** @typedef {'lead' | 'deal' | 'contact' | 'company' | 'activity' | 'note'} OwnedResource */
/** @typedef {'ownerId' | 'assigneeId' | 'authorId'} OwnerField */
/** @typedef {'read' | 'write' | 'delete'} PolicyAction */
/** @typedef {Partial<Record<OwnerField, string>>} OwnershipScope */

// Which field names a record's owner. Activities belong to whoever they're
// assigned to; notes to whoever wrote them.
/** @type {Record<OwnedResource, OwnerField>} */
const OWNER_FIELD = {
  lead: 'ownerId',
  deal: 'ownerId',
  contact: 'ownerId',
  company: 'ownerId',
  activity: 'assigneeId',
  note: 'authorId',
}

// Roles that act org-wide. Members are narrowed to records they own.
/** @type {ReadonlySet<string>} */
const ORG_WIDE_ROLES = new Set(['owner', 'admin', 'manager'])

// A note's author is a fact about who wrote it, not an assignment — nobody
// reassigns it.
/** @type {ReadonlySet<OwnedResource>} */
const NEVER_REASSIGNED = new Set(['note'])

/**
 * @param {OwnedResource} resource
 * @returns {OwnerField}
 * @throws {Error} For a resource with no policy (only reachable from unchecked JS callers).
 */
export function ownerField(resource) {
  const field = OWNER_FIELD[resource]
  // Fail loudly: an unknown resource silently scoped to {} would be an
  // authorization hole, not a harmless default. The types rule this out for
  // checked callers; this guards the unchecked ones.
  if (!field) throw new Error(`No ownership policy for resource "${resource}"`)
  return field
}

/**
 * Mongo filter fragment to AND into a query for `action` on `resource`.
 * Reads are org-wide for everyone; writes ('write' | 'delete') are narrowed
 * to the caller's own records unless their role acts org-wide. orgId itself
 * is the caller's job — this only adds the ownership half.
 * @param {AuthUser} user
 * @param {OwnedResource} resource
 * @param {PolicyAction} action
 * @returns {OwnershipScope}
 */
export function scopeFor(user, resource, action) {
  const field = ownerField(resource)
  if (action === 'read' || ORG_WIDE_ROLES.has(user.role)) return {}
  return { [field]: user.id }
}

/**
 * @param {AuthUser} user
 * @param {OwnedResource} resource
 * @returns {boolean}
 */
export function canReassign(user, resource) {
  return ORG_WIDE_ROLES.has(user.role) && !NEVER_REASSIGNED.has(resource)
}

/**
 * Strips what a caller may never set (orgId always; the owner field unless
 * they may reassign) and fills the owner on create. Returns a new object.
 * @param {AuthUser} user
 * @param {OwnedResource} resource
 * @param {Record<string, unknown>} body
 * @param {{ isCreate?: boolean }} [options]
 * @returns {Record<string, unknown>}
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
 * The two Model members missOrForbidden needs — narrow on purpose, so any
 * model fits without dragging its generics through the policy.
 * @typedef {object} ExistsCheckable
 * @property {string} modelName
 * @property {(filter: { _id: string, orgId: string }) => PromiseLike<unknown>} exists
 */

/**
 * Turns a scoped query's miss into the right error: 403 if the record exists
 * in the caller's org (they just don't own it), 404 otherwise — so another
 * org's ids are indistinguishable from ids that never existed.
 * @param {ExistsCheckable} Model
 * @param {AuthUser} user
 * @param {string} id
 * @returns {Promise<import('../utils/http.js').AppError>} The error to throw; this never throws itself.
 */
export async function missOrForbidden(Model, user, id) {
  const existsInOrg = await Model.exists({ _id: id, orgId: user.orgId })
  return existsInOrg
    ? forbidden('You can only change records you own.')
    : notFound(`${Model.modelName} not found.`)
}
