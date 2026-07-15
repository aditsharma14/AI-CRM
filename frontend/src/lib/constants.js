// Roles, frontend permission map, pipeline stages, status enums.

export const ROLES = { OWNER: 'owner', ADMIN: 'admin', MANAGER: 'manager', MEMBER: 'member' }

// Mirrors backend/src/utils/permissions.js's matrix (see the architecture
// spec §09) — coarse enough to hide buttons; the API is the real authority.
const MATRIX = {
  [ROLES.OWNER]: { org: ['manage'], members: ['manage'], pipeline: ['configure'], crm: ['read', 'write', 'delete'], reports: ['view'], ai: ['use'] },
  [ROLES.ADMIN]: { org: [], members: ['manage'], pipeline: ['configure'], crm: ['read', 'write', 'delete'], reports: ['view'], ai: ['use'] },
  [ROLES.MANAGER]: { org: [], members: [], pipeline: [], crm: ['read', 'write', 'delete'], reports: ['view'], ai: ['use'] },
  [ROLES.MEMBER]: { org: [], members: [], pipeline: [], crm: ['read', 'write'], reports: ['view'], ai: ['use'] },
}

export function hasPermission(role, resource, action) {
  return Boolean(MATRIX[role]?.[resource]?.includes(action))
}

export const PIPELINE_STAGE_DEFAULTS = [
  { key: 'new', label: 'New', order: 0 },
  { key: 'qualified', label: 'Qualified', order: 1 },
  { key: 'proposal', label: 'Proposal', order: 2 },
  { key: 'negotiation', label: 'Negotiation', order: 3 },
  { key: 'won', label: 'Closed Won', order: 4 },
  { key: 'lost', label: 'Closed Lost', order: 5 },
]

export const ACTIVITY_TYPES = { TASK: 'task', EVENT: 'event', CALL: 'call', MEETING: 'meeting' }
export const ACTIVITY_STATUSES = { OPEN: 'open', DONE: 'done' }
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted']
