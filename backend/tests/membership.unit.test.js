// Pure-function tests for the member-management policy (no DB, no HTTP).
import { describe, expect, it } from 'vitest'
import { assertCanAssign, assertNotSelf, manageableRoles } from '../src/policies/membership.js'

const actor = (role, id = 'me') => ({ id, orgId: 'o1', role })

describe('manageableRoles', () => {
  it('lets the owner manage admins, managers and members — never another owner', () => {
    expect(manageableRoles(actor('owner'))).toEqual(['admin', 'manager', 'member'])
  })

  it('lets an admin manage managers and members only', () => {
    expect(manageableRoles(actor('admin'))).toEqual(['manager', 'member'])
  })

  it('gives everyone else nothing (the route also blocks them)', () => {
    expect(manageableRoles(actor('manager'))).toEqual([])
    expect(manageableRoles(actor('member'))).toEqual([])
  })
})

describe('assertCanAssign', () => {
  it('lets only the owner grant admin', () => {
    expect(() => assertCanAssign(actor('owner'), 'admin')).not.toThrow()
    expect(() => assertCanAssign(actor('admin'), 'admin')).toThrow(
      expect.objectContaining({ status: 403, code: 'FORBIDDEN' }),
    )
  })

  it('lets an admin assign manager or member', () => {
    expect(() => assertCanAssign(actor('admin'), 'manager')).not.toThrow()
    expect(() => assertCanAssign(actor('admin'), 'member')).not.toThrow()
  })
})

describe('assertNotSelf', () => {
  it('refuses to act on your own account, with a message for the action', () => {
    expect(() => assertNotSelf(actor('owner', 'u1'), 'u1', 'change your own role')).toThrow(
      expect.objectContaining({ status: 403, message: "You can't change your own role." }),
    )
  })

  it('allows acting on someone else', () => {
    expect(() => assertNotSelf(actor('owner', 'u1'), 'u2', 'remove yourself')).not.toThrow()
  })
})
