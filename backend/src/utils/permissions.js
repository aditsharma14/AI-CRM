// Static role-permission matrix and hasPermission().

export const ROLES = ['owner', 'admin', 'manager', 'member']

// See the architecture spec §09 for the full rationale. "own only" resources
// still return true here (the resource is usable); the service layer narrows
// the query/mutation to records the caller owns.
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

export function hasPermission(role, resource, action) {
  return Boolean(MATRIX[role]?.[resource]?.includes(action))
}
