// canModifyRecord must agree with backend/src/policies/ownership.js's scopeFor.
import { describe, expect, it } from 'vitest'
import { canModifyRecord, hasPermission } from './constants.js'

const user = (role, id = 'u1') => ({ id, role })

describe('canModifyRecord', () => {
  it.each(['owner', 'admin', 'manager'])('lets %s change anyone\'s record', (role) => {
    expect(canModifyRecord(user(role), { ownerId: 'someone-else' })).toBe(true)
  })

  it('lets a member change only records they own', () => {
    expect(canModifyRecord(user('member'), { ownerId: 'u1' })).toBe(true)
    expect(canModifyRecord(user('member'), { ownerId: 'u2' })).toBe(false)
  })

  it('reads a populated owner ({ _id, name }) as well as a raw id', () => {
    expect(canModifyRecord(user('member'), { assigneeId: { _id: 'u1', name: 'Me' } }, 'assigneeId')).toBe(true)
    expect(canModifyRecord(user('member'), { assigneeId: { _id: 'u2', name: 'Them' } }, 'assigneeId')).toBe(false)
  })

  it('denies a member when the record has no owner field at all', () => {
    expect(canModifyRecord(user('member'), {})).toBe(false)
  })

  it('denies guests', () => {
    expect(canModifyRecord(null, { ownerId: 'u1' })).toBe(false)
  })
})

describe('delete gating', () => {
  it('matches the backend matrix: members have no crm:delete', () => {
    expect(hasPermission('member', 'crm', 'delete')).toBe(false)
    expect(hasPermission('manager', 'crm', 'delete')).toBe(true)
  })
})
