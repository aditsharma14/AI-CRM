// @ts-check
// Static role-permission matrix and hasPermission().

/** @typedef {import('../types/index.js').Role} Role */
/** @typedef {'org' | 'members' | 'pipeline' | 'crm' | 'reports' | 'ai'} PermissionResource */
/** @typedef {'manage' | 'configure' | 'read' | 'write' | 'delete' | 'view' | 'use'} PermissionAction */

/** @type {readonly Role[]} */
export const ROLES = ['owner', 'admin', 'manager', 'member']

// "Own only" resources
// still return true here (the resource is usable); the service layer narrows
// the query/mutation to records the caller owns.
/** @type {Record<Role, Record<PermissionResource, PermissionAction[]>>} */
const MATRIX = {
  owner: {
    org: ['manage'],
    members: ['manage'],
    pipeline: ['configure'],
    crm: ['read', 'write', 'delete'],
    reports: ['view'],
    ai: ['use'],
  },
  admin: {
    org: [],
    members: ['manage'],
    pipeline: ['configure'],
    crm: ['read', 'write', 'delete'],
    reports: ['view'],
    ai: ['use'],
  },
  manager: {
    org: [],
    members: [],
    pipeline: [],
    crm: ['read', 'write', 'delete'],
    reports: ['view'],
    ai: ['use'],
  },
  member: {
    org: [],
    members: [],
    pipeline: [],
    crm: ['read', 'write'],
    reports: ['view'],
    ai: ['use'],
  },
}

/**
 * The optional chaining stays even though the types say it can't miss: `role`
 * comes from a decoded JWT at runtime, and an unknown role must mean "no".
 * @param {Role} role
 * @param {PermissionResource} resource
 * @param {PermissionAction} action
 * @returns {boolean}
 */
export function hasPermission(role, resource, action) {
  return Boolean(MATRIX[role]?.[resource]?.includes(action))
}
