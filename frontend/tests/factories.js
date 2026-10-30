// @ts-check
// Typed fixtures shaped like the API's responses: the session user (authService.serializeUser) and org members.

/** @typedef {'owner' | 'admin' | 'manager' | 'member'} Role */

/**
 * What POST /auth/refresh, /auth/login, … return as `data.user`.
 * @typedef {object} SessionUser
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {Role} role
 * @property {{ id: string, name: string, plan: string }} org
 */

/**
 * A row of GET /org/members.
 * @typedef {object} Member
 * @property {string} _id
 * @property {string} name
 * @property {string} email
 * @property {Role} role
 */

export const ORG = { id: 'org-1', name: 'Acme', plan: 'free' }

/**
 * @param {Role} role
 * @param {Partial<SessionUser>} [overrides]
 * @returns {SessionUser}
 */
export function makeUser(role, overrides = {}) {
  return { id: `user-${role}`, name: `The ${role}`, email: `${role}@acme.test`, role, org: ORG, ...overrides }
}

/**
 * @param {Role} role
 * @param {Partial<Member>} [overrides]
 * @returns {Member}
 */
export function makeMember(role, overrides = {}) {
  return { _id: `user-${role}`, name: `The ${role}`, email: `${role}@acme.test`, role, ...overrides }
}

/**
 * The session as a member row, so a viewer appears in the roster under the same id.
 * @param {SessionUser} user
 * @returns {Member}
 */
export function asMember(user) {
  return { _id: user.id, name: user.name, email: user.email, role: user.role }
}
