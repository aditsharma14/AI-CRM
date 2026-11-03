// scripts/sync-indexes.js on a database from before S1.9: the old global text index blocks the org-prefixed one (one
// text index per collection); the dry run reports it and --apply replaces it.
import { beforeAll, describe, expect, it } from 'vitest'

import { apply, diff, MODELS } from '../scripts/sync-indexes.js'
import { Lead } from '../src/models/CRM.js'

beforeAll(async () => {
  for (const model of MODELS) await model.syncIndexes()
  // What a pre-S1.9 database has: the unscoped text index, so the new one can't be built.
  await Lead.collection.dropIndex('orgId_1_name_text_email_text')
  await Lead.collection.createIndex({ name: 'text', email: 'text' })
})

describe('sync-indexes', () => {
  it('the new text index cannot be built beside the old one', async () => {
    await expect(Lead.collection.createIndex({ orgId: 1, name: 'text', email: 'text' })).rejects.toThrow()
  })

  it('the dry run reports the old text index to drop and the new one to create, and changes nothing', async () => {
    const changes = await diff()
    const leads = changes.find((c) => c.collection === 'leads')
    expect(leads.toDrop).toEqual(['name_text_email_text'])
    expect(leads.toCreate).toEqual([expect.objectContaining({ orgId: 1, name: 'text', email: 'text' })])
    expect(changes.filter((c) => c.collection !== 'leads')).toEqual([])
    expect(await Lead.collection.indexExists('name_text_email_text')).toBe(true)
  })

  it('apply makes the indexes match the models', async () => {
    await apply()
    expect(await diff()).toEqual([])
    expect(await Lead.collection.indexExists('orgId_1_name_text_email_text')).toBe(true)
  })
})
