// scripts/audit-references.js: finds cross-org and dangling references, and never sends a write.
import mongoose from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { auditReferences } from '../scripts/audit-references.js'
import { Company, Contact, Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import Note from '../src/models/Note.js'
import Organization from '../src/models/Organization.js'
import { seedOrg } from './helpers.js'

let client
let report
const commands = []

beforeAll(async () => {
  const A = await seedOrg('A')
  const B = await seedOrg('B')
  const owner = A.users.owner._id
  const theirCompany = await Company.create({ orgId: B.org._id, name: 'B co', ownerId: B.users.owner._id })
  const ownContact = await Contact.create({ orgId: A.org._id, name: 'A contact', ownerId: owner })
  const theirContact = await Contact.create({ orgId: B.org._id, name: 'B contact', ownerId: B.users.owner._id })
  const gone = new mongoose.Types.ObjectId()

  await Lead.create({ orgId: A.org._id, name: 'cross', ownerId: owner, companyId: theirCompany._id }) // crossOrg
  await Lead.create({ orgId: A.org._id, name: 'dangling', ownerId: owner, companyId: gone }) // dangling
  await Deal.create({
    orgId: A.org._id,
    title: 'D',
    value: 1,
    stageKey: 'new',
    ownerId: owner,
    contactIds: [ownContact._id, theirContact._id], // one fine, one crossOrg
  })
  await Note.create({ orgId: A.org._id, entityType: 'contact', entityId: theirContact._id, body: 'n', authorId: owner }) // crossOrg
  await Organization.updateOne({ _id: A.org._id }, { $push: { teams: { name: 'T', memberIds: [B.users.member._id] } } }) // crossOrg

  // A second client on the same server, with command monitoring, to see everything the audit sends.
  const { host, port, name } = mongoose.connection
  client = new mongoose.mongo.MongoClient(`mongodb://${host}:${port}/?directConnection=true`, { monitorCommands: true })
  client.on('commandStarted', (event) => commands.push(event.commandName))
  await client.connect()
  commands.length = 0
  report = await auditReferences(client.db(name))
})

afterAll(() => client?.close())

const row = (from, field) => report.find((r) => r.from === from && r.field === field)

describe('audit-references', () => {
  it('counts cross-org and dangling references per field', () => {
    expect(row('leads', 'companyId')).toMatchObject({ crossOrg: 1, dangling: 1 })
    expect(row('deals', 'contactIds')).toMatchObject({ checked: 2, crossOrg: 1, dangling: 0 })
    expect(row('notes', 'entityId')).toMatchObject({ crossOrg: 1 })
    expect(row('organizations', 'teams.memberIds')).toMatchObject({ crossOrg: 1 })
  })

  it('reports nothing for clean references', () => {
    expect(row('leads', 'ownerId')).toMatchObject({ crossOrg: 0, dangling: 0 })
    expect(row('contacts', 'companyId')).toMatchObject({ crossOrg: 0, dangling: 0 })
  })

  it('only ever sends reads', () => {
    expect(commands.length).toBeGreaterThan(0)
    expect([...new Set(commands)].sort()).toEqual(['find'])
  })
})
