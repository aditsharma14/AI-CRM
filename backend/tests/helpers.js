// Seeds orgs/users/records straight through the models and signs access tokens.
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import Organization from '../src/models/Organization.js'
import User from '../src/models/User.js'
import { Lead, Contact, Company } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import Activity from '../src/models/Activity.js'
import Note from '../src/models/Note.js'

export const ROLES = ['owner', 'admin', 'manager', 'member']

let seq = 0

/**
 * One org with one user per role. insertMany skips User's bcrypt pre-save
 * hook — these users never log in with a password, only with signed tokens,
 * and hashing 4 passwords per org would dominate the suite's runtime.
 */
export async function seedOrg(name = 'Org') {
  const org = await Organization.create({ name: `${name} ${++seq}` })
  const docs = await User.insertMany(
    ROLES.map((role) => ({ orgId: org._id, name: `${role} ${seq}`, email: `${role}.${seq}@test.dev`, password: 'unused', role })),
  )
  const users = Object.fromEntries(docs.map((u) => [u.role, u]))
  const tokens = Object.fromEntries(
    docs.map((u) => [
      u.role,
      // Same claims as authService.signAccessToken.
      jwt.sign({ sub: u._id.toString(), orgId: org._id.toString(), role: u.role }, process.env.JWT_ACCESS_SECRET, {
        expiresIn: '1h',
      }),
    ]),
  )
  return { org, users, tokens }
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` })

/** Owner field per resource — mirrors policies/ownership.js on purpose, so a drift there fails here. */
export const OWNER_FIELD = {
  leads: 'ownerId',
  deals: 'ownerId',
  contacts: 'ownerId',
  companies: 'ownerId',
  activities: 'assigneeId',
  notes: 'authorId',
}

/** A PATCH body that changes one visible field, per resource. */
export const RENAME = {
  leads: { name: 'Renamed' },
  deals: { title: 'Renamed' },
  contacts: { name: 'Renamed' },
  companies: { name: 'Renamed' },
  activities: { title: 'Renamed' },
  notes: { body: 'Renamed' },
}

export const MODELS = { leads: Lead, deals: Deal, contacts: Contact, companies: Company, activities: Activity, notes: Note }

/** Creates one record of `resource` in `org`, owned by `user`. */
export function makeRecord(resource, org, user) {
  const orgId = org._id
  const owner = user._id
  switch (resource) {
    case 'leads':
      return Lead.create({ orgId, name: 'Lead', ownerId: owner })
    case 'deals':
      return Deal.create({ orgId, title: 'Deal', value: 100, stageKey: 'new', ownerId: owner })
    case 'contacts':
      return Contact.create({ orgId, name: 'Contact', ownerId: owner })
    case 'companies':
      return Company.create({ orgId, name: 'Company', ownerId: owner })
    case 'activities':
      return Activity.create({ orgId, type: 'task', title: 'Task', assigneeId: owner })
    case 'notes':
      return Note.create({ orgId, entityType: 'lead', entityId: new mongoose.Types.ObjectId(), body: 'Note', authorId: owner })
    default:
      throw new Error(`Unknown resource ${resource}`)
  }
}

/** "Someone else in the same org" for a given acting role. */
export const otherRoleThan = (role) => (role === 'member' ? 'owner' : 'member')
