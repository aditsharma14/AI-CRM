// Read-only: how many orgs the deploy smoke test has left behind (isSmoke, see src/utils/smoke.js), next to real ones.
// Usage (from backend/): node scripts/count-smoke-orgs.js   (reads MONGO_URI from .env; point it at Atlas to check prod)
//
// It only counts. Removing smoke orgs, if ever needed, is a separate, deliberate step.
import 'dotenv/config'

import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<{ smokeOrgs: number, realOrgs: number, smokeUsers: number, oldest: Date | null, newest: Date | null }>}
 */
export async function countSmokeOrgs(db) {
  const orgs = db.collection('organizations')
  const [smokeOrgs, realOrgs, smokeUsers, [range]] = await Promise.all([
    orgs.countDocuments({ isSmoke: true }),
    orgs.countDocuments({ isSmoke: { $ne: true } }),
    db.collection('users').countDocuments({ email: /@smoke\.nimbus\.invalid$/i }),
    orgs
      .aggregate([
        { $match: { isSmoke: true } },
        { $group: { _id: null, oldest: { $min: '$createdAt' }, newest: { $max: '$createdAt' } } },
      ])
      .toArray(),
  ])
  return { smokeOrgs, realOrgs, smokeUsers, oldest: range?.oldest ?? null, newest: range?.newest ?? null }
}

async function main() {
  const uri = process.env.MONGO_URI
  if (!uri) throw new Error('MONGO_URI is not set.')
  await mongoose.connect(uri, { readPreference: 'secondaryPreferred' })
  try {
    const db = mongoose.connection.db
    if (!db) throw new Error('Not connected.')
    console.log(JSON.stringify(await countSmokeOrgs(db), null, 2))
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
