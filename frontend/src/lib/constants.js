// @ts-check
// Roles, frontend permission map, pipeline stages, status enums.

/** @typedef {'owner' | 'admin' | 'manager' | 'member'} Role */
/** @typedef {Exclude<Role, 'owner'>} ManagedRole */
/** @typedef {{ id: string, role: Role }} SessionUserLike Enough of the session user for the checks below. */

export const ROLES = /** @type {const} */ ({ OWNER: 'owner', ADMIN: 'admin', MANAGER: 'manager', MEMBER: 'member' })

// Mirrors backend/src/utils/permissions.js's matrix (see the architecture
// spec §09) — coarse enough to hide buttons; the API is the real authority.
/** @type {Record<Role, Record<string, string[]>>} */
const MATRIX = {
  [ROLES.OWNER]: {
    org: ['manage'],
    members: ['manage'],
    pipeline: ['configure'],
    crm: ['read', 'write', 'delete'],
    reports: ['view'],
    ai: ['use'],
  },
  [ROLES.ADMIN]: {
    org: [],
    members: ['manage'],
    pipeline: ['configure'],
    crm: ['read', 'write', 'delete'],
    reports: ['view'],
    ai: ['use'],
  },
  [ROLES.MANAGER]: {
    org: [],
    members: [],
    pipeline: [],
    crm: ['read', 'write', 'delete'],
    reports: ['view'],
    ai: ['use'],
  },
  [ROLES.MEMBER]: { org: [], members: [], pipeline: [], crm: ['read', 'write'], reports: ['view'], ai: ['use'] },
}

/**
 * @param {string | null | undefined} role
 * @param {string} resource
 * @param {string} action
 * @returns {boolean}
 */
export function hasPermission(role, resource, action) {
  if (!role || !Object.hasOwn(MATRIX, role)) return false
  // Boundary cast: the hasOwn check above proves it, but tsc does not narrow a string key that way.
  return Boolean(MATRIX[/** @type {Role} */ (role)][resource]?.includes(action))
}

// Mirrors backend/src/policies/ownership.js: managers and above change any
// record in the org; members only records they own. Again UI-only — the API
// answers 403 regardless.
/** @type {Role[]} */
const ORG_WIDE_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER]

/**
 * Whether `user` may change `record`. `ownerField` is 'ownerId' for leads,
 * deals, contacts and companies, 'assigneeId' for activities. Works whether
 * the field came back as a raw id or populated ({ _id, name }).
 * @param {SessionUserLike | null | undefined} user
 * @param {Record<string, unknown> | null | undefined} record
 * @param {string} [ownerField]
 * @returns {boolean}
 */
export function canModifyRecord(user, record, ownerField = 'ownerId') {
  if (!user || !record) return false
  if (ORG_WIDE_ROLES.includes(user.role)) return true
  const owner = record[ownerField]
  const ownerId = owner && typeof owner === 'object' && '_id' in owner ? owner._id : owner
  return ownerId != null && String(ownerId) === String(user.id)
}

// Mirrors backend/src/policies/membership.js: only the owner manages (or
// grants) admins, the owner row is never managed, and nobody manages
// themselves. UI-only — orgAdminService answers 403/404 regardless.

/**
 * Roles whose holders `user` may re-role or remove, and so the roles they may assign or invite with.
 * @param {SessionUserLike | null | undefined} user
 * @returns {ManagedRole[]}
 */
export function manageableRoles(user) {
  if (user?.role === ROLES.OWNER) return [ROLES.ADMIN, ROLES.MANAGER, ROLES.MEMBER]
  if (user?.role === ROLES.ADMIN) return [ROLES.MANAGER, ROLES.MEMBER]
  return []
}

/**
 * Whether `user` gets role and remove controls on `member`'s row.
 * @param {SessionUserLike | null | undefined} user
 * @param {{ _id: string, role: Role }} member A row of GET /org/members.
 * @returns {boolean}
 */
export function canManageMember(user, member) {
  if (!user || String(member._id) === String(user.id) || member.role === ROLES.OWNER) return false
  return manageableRoles(user).includes(member.role)
}

// Pipeline stages are per org: read them with usePipelineStages() (hooks.js).
// The defaults a new org starts with live only in backend/src/models/Organization.js.

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted']
