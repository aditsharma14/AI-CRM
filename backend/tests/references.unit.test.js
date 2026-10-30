// assertReferencesInOrg and entityModel: dedupe, the entityType allowlist, and the soft-delete guard.
import mongoose from 'mongoose'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { Company, Contact, Lead } from '../src/models/CRM.js'
import Deal from '../src/models/Deal.js'
import { assertReferencesInOrg, entityModel } from '../src/policies/references.js'
import { makeRecord, seedOrg } from './helpers.js'

let A
let B

beforeAll(async () => {
  A = await seedOrg('A')
  B = await seedOrg('B')
})

describe('assertReferencesInOrg', () => {
  it('dedupes array ids before counting: [a, a] is one id, found once', async () => {
    const contact = await makeRecord('contacts', A.org, A.users.member)
    const count = vi.spyOn(Contact, 'countDocuments')
    await expect(
      assertReferencesInOrg(A.org._id, [
        { field: 'contactIds', model: Contact, ids: [contact._id, String(contact._id)] },
      ]),
    ).resolves.toBeUndefined()
    expect(count).toHaveBeenCalledTimes(1)
    expect(count.mock.calls[0][0]._id.$in).toHaveLength(1)
    count.mockRestore()
  })

  it("rejects when any id is another org's, naming the field", async () => {
    const mine = await makeRecord('contacts', A.org, A.users.member)
    const theirs = await makeRecord('contacts', B.org, B.users.member)
    await expect(
      assertReferencesInOrg(A.org._id, [{ field: 'contactIds', model: Contact, ids: [mine._id, theirs._id] }]),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: expect.stringMatching(/^contactIds: /) })
  })

  it('skips absent references (undefined, null, empty array) without querying', async () => {
    const count = vi.spyOn(Company, 'countDocuments')
    await assertReferencesInOrg(A.org._id, [
      { field: 'companyId', model: Company, ids: undefined },
      { field: 'companyId', model: Company, ids: null },
      { field: 'contactIds', model: Company, ids: [] },
    ])
    expect(count).not.toHaveBeenCalled()
    count.mockRestore()
  })
})

describe('entityModel', () => {
  it.each([
    ['lead', Lead],
    ['contact', Contact],
    ['company', Company],
    ['deal', Deal],
  ])('%s -> its model', (type, model) => {
    expect(entityModel('entityType', type)).toBe(model)
  })

  it.each(['user', 'organization', 'User', '', undefined, '__proto__', 'constructor'])(
    'rejects entityType %j before any model is chosen',
    (type) => {
      expect(() => entityModel('linkedTo.entityType', type)).toThrow(
        expect.objectContaining({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: expect.stringMatching(/^linkedTo\.entityType: /),
        }),
      )
    },
  )
})

describe('soft delete', () => {
  // The check counts every document with the id in the org. If a model ever gains soft delete, a deleted
  // document would still count as a valid reference, so this fails until references.js filters it out.
  it('no referenceable model has a soft-delete field', () => {
    const SOFT_DELETE = /^(deleted|deletedAt|isDeleted|archived|archivedAt|isArchived|removedAt)$/
    for (const model of [Lead, Contact, Company, Deal, mongoose.model('User')]) {
      expect(
        Object.keys(model.schema.paths).filter((path) => SOFT_DELETE.test(path)),
        model.modelName,
      ).toEqual([])
    }
  })
})
