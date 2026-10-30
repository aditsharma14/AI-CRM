// @ts-check
// Who may change whose role or remove whom: admins are owner-managed, and nobody acts on themselves.
import { forbidden, notFound } from '../utils/http.js'

/** @typedef {import('../types/index.js').AuthUser} AuthUser */
/** @typedef {import('../types/index.js').Role} Role */
/** @typedef {Exclude<Role, 'owner'>} ManagedRole */

/**
 * Roles of the members `actor` may re-role or remove. The owner is never in
 * the list — ownership is transferred, not managed — and only the owner can
 * touch admins, so an admin can't demote a peer (or mint one, see below).
 * @param {AuthUser} actor
 * @returns {ManagedRole[]}
 */
export function manageableRoles(actor) {
  if (actor.role === 'owner') return ['admin', 'manager', 'member']
  if (actor.role === 'admin') return ['manager', 'member']
  return []
}

/**
 * Granting admin is owner-only, same as revoking it: otherwise an admin could
 * create admins that they themselves can't take back.
 * @param {AuthUser} actor
 * @param {ManagedRole} newRole
 * @returns {void}
 * @throws {import('../utils/http.js').AppError} 403
 */
export function assertCanAssign(actor, newRole) {
  if (!manageableRoles(actor).includes(newRole)) throw forbidden('Only the owner can grant the admin role.')
}

/**
 * @param {AuthUser} actor
 * @param {string} userId The member being acted on.
 * @param {string} action Completes "You can't …", e.g. 'change your own role'.
 * @returns {void}
 * @throws {import('../utils/http.js').AppError} 403
 */
export function assertNotSelf(actor, userId, action) {
  if (String(userId) === String(actor.id)) throw forbidden(`You can't ${action}.`)
}

/**
 * Explains why a role-scoped member query matched nothing: 404 if there's no
 * such member in the org or it's the owner (unchanged contract), else 403 —
 * they exist, the actor just isn't allowed to manage them.
 * @param {typeof import('../models/User.js').default} User Passed in (type-only import) so the policy module never loads models itself.
 * @param {AuthUser} actor
 * @param {string} userId
 * @param {string} [notFoundMessage] Kept per caller so existing 404 messages don't change.
 * @returns {Promise<import('../utils/http.js').AppError>} The error to throw; this never throws itself.
 */
export async function memberMissOrForbidden(User, actor, userId, notFoundMessage = 'Member not found.') {
  const target = await User.findOne({ _id: userId, orgId: actor.orgId }).select('role')
  if (!target || target.role === 'owner') return notFound(notFoundMessage)
  return forbidden('Only the owner can manage admins.')
}
