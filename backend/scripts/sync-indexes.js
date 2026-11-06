// Makes a database's indexes match the models' definitions. Needed once on a database created before an index change
// that MongoDB can't apply on its own: S1.9 moved every text index to an orgId prefix, and a collection may hold only one
// text index, so Mongoose's automatic build of the new one fails while the old one is there (search keeps working on
// the old one, unscoped).
// Usage (from backend/): node scripts/sync-indexes.js           lists what would change (reads MONGO_URI from .env)
//                        node scripts/sync-indexes.js --apply   drops indexes no model defines, builds the missing ones
import 'dotenv/config'

import { fileURLToPath } from 'node:url'

import mongoose from 'mongoose'

import Activity from '../src/models/Activity.js'
import AiBrief from '../src/models/AiBrief.js'
import AiCall from '../src/models/AiCall.js'
import AiJob from '../src/models/AiJob.js'
import { Company, Contact, Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import { Log } from '../src/models/Logs.js'
import Note from '../src/models/Note.js'
import Organization from '../src/models/Organization.js'
import User from '../src/models/User.js'

export const MODELS = [Organization, User, Company, Contact, Lead, Deal, Activity, Note, Log, AiBrief, AiJob, AiCall]

/** Per model, the indexes the database has that no model defines (toDrop) and those it lacks (toCreate). */
export async function diff() {
  const out = []
  for (const model of MODELS) {
    const { toDrop, toCreate } = await model.diffIndexes()
    if (toDrop.length || toCreate.length) out.push({ collection: model.collection.name, toDrop, toCreate })
  }
  return out
}

/** Drops what no model defines, then builds what is missing (Model.syncIndexes, one collection at a time). */
export async function apply() {
  for (const model of MODELS) await model.syncIndexes()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false })
  const changes = await diff()
  for (const { collection, toDrop, toCreate } of changes) {
    for (const name of toDrop) console.log(`${collection}: drop ${name}`)
    for (const spec of toCreate) console.log(`${collection}: create ${JSON.stringify(spec)}`)
  }
  if (!changes.length) console.log('indexes match the models')
  else if (process.argv.includes('--apply')) {
    await apply()
    console.log('applied')
  } else console.log('dry run: nothing changed. Run with --apply to make these changes.')
  await mongoose.disconnect()
}
