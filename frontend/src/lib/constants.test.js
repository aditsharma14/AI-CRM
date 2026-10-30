// The UI mirrors must agree with the backend: canModifyRecord with ownership.js, manageableRoles/canManageMember with membership.js.
import { describe, expect, it } from 'vitest'
import { canManageMember, canModifyRecord, hasPermission, manageableRoles } from './constants.js'

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

// Mirrors backend/tests/membership.unit.test.js.
describe('manageableRoles', () => {
  it('lets the owner manage admins, managers and members — never another owner', () => {
    expect(manageableRoles(user('owner'))).toEqual(['admin', 'manager', 'member'])
  })

  it('lets an admin manage managers and members only', () => {
    expect(manageableRoles(user('admin'))).toEqual(['manager', 'member'])
  })

  it('gives everyone else, and guests, nothing', () => {
    expect(manageableRoles(user('manager'))).toEqual([])
    expect(manageableRoles(user('member'))).toEqual([])
    expect(manageableRoles(null)).toEqual([])
  })
})

describe('canManageMember', () => {
  const member = (role, _id) => ({ _id, role })

  it('never offers controls on your own row', () => {
    expect(canManageMember(user('owner', 'u1'), member('owner', 'u1'))).toBe(false)
    expect(canManageMember(user('admin', 'u1'), member('admin', 'u1'))).toBe(false)
  })

  it('never offers controls on the owner row', () => {
    expect(canManageMember(user('admin'), member('owner', 'u9'))).toBe(false)
  })

  it('lets only the owner manage an admin', () => {
    expect(canManageMember(user('owner'), member('admin', 'u2'))).toBe(true)
    expect(canManageMember(user('admin'), member('admin', 'u2'))).toBe(false)
  })

  it('lets owner and admin manage managers and members; nobody else manages anyone', () => {
    for (const role of ['manager', 'member']) {
      expect(canManageMember(user('owner'), member(role, 'u2'))).toBe(true)
      expect(canManageMember(user('admin'), member(role, 'u2'))).toBe(true)
      expect(canManageMember(user('manager'), member(role, 'u2'))).toBe(false)
      expect(canManageMember(user('member'), member(role, 'u2'))).toBe(false)
    }
  })

  it('denies guests', () => {
    expect(canManageMember(null, member('member', 'u2'))).toBe(false)
  })
})
