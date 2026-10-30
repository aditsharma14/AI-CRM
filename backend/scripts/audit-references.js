// Read-only audit: finds stored references that point at another org's document or at nothing.
// Usage (from backend/): node scripts/audit-references.js   (reads MONGO_URI from .env)
//
// It only ever runs find() with projections; tests/audit-references.test.js watches every command it sends
// and fails on anything else. Fixing what it reports is a separate, deliberate step.
import 'dotenv/config'

import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

/**
 * Every stored ObjectId reference. `to` is the target collection, or a function of the document for a
 * polymorphic reference. `org` is how to read the document's own org (default: its orgId field).
 */
const ENTITY_COLLECTIONS = {
  lead: 'leads',
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
  activity: 'activities',
  note: 'notes',
}

const REFERENCES = [
  ...['users', 'leads', 'contacts', 'companies', 'deals', 'notes', 'activities', 'logs'].map((from) => ({
    from,
    field: 'orgId',
    to: 'organizations',
  })),
  { from: 'leads', field: 'companyId', to: 'companies' },
  { from: 'leads', field: 'ownerId', to: 'users' },
  { from: 'leads', field: 'convertedToDealId', to: 'deals' },
  { from: 'contacts', field: 'companyId', to: 'companies' },
  { from: 'contacts', field: 'ownerId', to: 'users' },
  { from: 'companies', field: 'ownerId', to: 'users' },
  { from: 'deals', field: 'companyId', to: 'companies' },
  { from: 'deals', field: 'contactIds', to: 'contacts' },
  { from: 'deals', field: 'ownerId', to: 'users' },
  { from: 'deals', field: 'convertedFromLeadId', to: 'leads' },
  { from: 'notes', field: 'authorId', to: 'users' },
  { from: 'notes', field: 'entityId', to: (doc) => ENTITY_COLLECTIONS[doc.entityType] },
  { from: 'activities', field: 'assigneeId', to: 'users' },
  { from: 'activities', field: 'linkedTo.entityId', to: (doc) => ENTITY_COLLECTIONS[doc.linkedTo?.entityType] },
  { from: 'logs', field: 'userId', to: 'users' },
  { from: 'logs', field: 'entityId', to: (doc) => ENTITY_COLLECTIONS[doc.entityType] },
  { from: 'organizations', field: 'ownerId', to: 'users', org: (doc) => doc._id },
  { from: 'organizations', field: 'teams.memberIds', to: 'users', org: (doc) => doc._id },
]

/** Values at a dotted path, flattening arrays on the way (teams.memberIds -> every team's members). */
function valuesAt(doc, path) {
  let values = [doc]
  for (const key of path.split('.')) {
    values = values.flatMap((v) => (v == null ? [] : Array.isArray(v[key]) ? v[key] : [v[key]]))
  }
  return values.filter((v) => v != null)
}

/** The fields to project for a reference: its path's root, plus what `to` and `org` read. */
function projectionFor({ field }) {
  return { _id: 1, orgId: 1, entityType: 1, linkedTo: 1, [field.split('.')[0]]: 1 }
}

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<Array<{ from: string, field: string, checked: number, crossOrg: number, dangling: number,
 *   unknownType: number, examples: string[] }>>}
 */
export async function auditReferences(db) {
  /** target collection -> id -> orgId ('organizations' maps an id to itself) */
  const owners = new Map()
  const orgOf = async (collection, ids) => {
    if (!owners.has(collection)) owners.set(collection, new Map())
    const known = owners.get(collection)
    const missing = [...new Set(ids.map(String))].filter((id) => !known.has(id))
    if (missing.length) {
      const objectIds = missing.map((id) => new mongoose.Types.ObjectId(id))
      const found = await db
        .collection(collection)
        .find({ _id: { $in: objectIds } }, { projection: { _id: 1, orgId: 1 } })
        .toArray()
      for (const id of missing) known.set(id, null)
      for (const doc of found) known.set(String(doc._id), String(collection === 'organizations' ? doc._id : doc.orgId))
    }
    return known
  }

  const report = []
  for (const ref of REFERENCES) {
    const row = { from: ref.from, field: ref.field, checked: 0, crossOrg: 0, dangling: 0, unknownType: 0, examples: [] }
    const docs = await db
      .collection(ref.from)
      .find({}, { projection: projectionFor(ref) })
      .toArray()
    for (const doc of docs) {
      const ids = valuesAt(doc, ref.field)
      if (!ids.length) continue
      const target = typeof ref.to === 'function' ? ref.to(doc) : ref.to
      const ownOrg = String(ref.org ? ref.org(doc) : doc.orgId)
      if (!target) {
        row.unknownType += ids.length
        continue
      }
      const known = await orgOf(target, ids)
      for (const id of ids) {
        row.checked++
        const targetOrg = known.get(String(id))
        const problem =
          targetOrg === null ? 'dangling' : ref.field !== 'orgId' && targetOrg !== ownOrg ? 'crossOrg' : null
        if (!problem) continue
        row[problem]++
        if (row.examples.length < 3) row.examples.push(`${ref.from}/${doc._id} ${ref.field}=${id} (${problem})`)
      }
    }
    report.push(row)
  }
  return report
}

async function main() {
  const uri = process.env.MONGO_URI
  if (!uri) throw new Error('MONGO_URI is not set (backend/.env).')
  // Read-only by construction (find() only); secondaryPreferred keeps it off the primary when there's a choice.
  await mongoose.connect(uri, { readPreference: 'secondaryPreferred' })
  try {
    const db = mongoose.connection.db
    if (!db) throw new Error('Not connected.')
    const report = await auditReferences(db)
    console.log(`Database: ${db.databaseName}`)
    console.table(report.map(({ examples: _examples, ...row }) => row))
    const totals = report.reduce((t, r) => ({ crossOrg: t.crossOrg + r.crossOrg, dangling: t.dangling + r.dangling }), {
      crossOrg: 0,
      dangling: 0,
    })
    console.log(`Cross-org: ${totals.crossOrg}  Dangling: ${totals.dangling}`)
    for (const r of report) for (const example of r.examples) console.log(`  ${example}`)
  } finally {
    await mongoose.disconnect()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
