// Pure-function tests for the ownership policy (no DB, no HTTP).
import { describe, expect, it } from 'vitest'
import { canReassign, ownerField, sanitizeWrite, scopeFor } from '../src/policies/ownership.js'

const user = (role) => ({ id: 'u1', orgId: 'o1', role })

describe('ownerField', () => {
  it.each([
    ['lead', 'ownerId'],
    ['deal', 'ownerId'],
    ['contact', 'ownerId'],
    ['company', 'ownerId'],
    ['activity', 'assigneeId'],
    ['note', 'authorId'],
  ])('%s -> %s', (resource, field) => expect(ownerField(resource)).toBe(field))

  it('throws on an unknown resource rather than silently scoping nothing', () => {
    expect(() => ownerField('invoice')).toThrow()
  })
})

describe('scopeFor', () => {
  it('never narrows reads', () => {
    for (const role of ['owner', 'admin', 'manager', 'member']) expect(scopeFor(user(role), 'lead', 'read')).toEqual({})
  })

  it('narrows member writes to their own records', () => {
    expect(scopeFor(user('member'), 'lead', 'write')).toEqual({ ownerId: 'u1' })
    expect(scopeFor(user('member'), 'activity', 'write')).toEqual({ assigneeId: 'u1' })
    expect(scopeFor(user('member'), 'note', 'delete')).toEqual({ authorId: 'u1' })
  })

  it('leaves manager-and-above writes org-wide', () => {
    for (const role of ['owner', 'admin', 'manager']) expect(scopeFor(user(role), 'deal', 'write')).toEqual({})
  })
})

describe('canReassign', () => {
  it('allows manager and above, never members', () => {
    expect(canReassign(user('manager'), 'lead')).toBe(true)
    expect(canReassign(user('owner'), 'activity')).toBe(true)
    expect(canReassign(user('member'), 'lead')).toBe(false)
  })

  it('never allows changing a note author', () => {
    expect(canReassign(user('owner'), 'note')).toBe(false)
  })
})

describe('sanitizeWrite', () => {
  it('always drops orgId', () => {
    expect(sanitizeWrite(user('owner'), 'lead', { name: 'x', orgId: 'o2' })).toEqual({ name: 'x' })
  })

  it("drops a member's owner field on update", () => {
    expect(sanitizeWrite(user('member'), 'lead', { name: 'x', ownerId: 'u2' })).toEqual({ name: 'x' })
  })

  it("forces a member's owner field to themselves on create", () => {
    expect(sanitizeWrite(user('member'), 'lead', { name: 'x', ownerId: 'u2' }, { isCreate: true })).toEqual({ name: 'x', ownerId: 'u1' })
  })

  it('keeps a manager-chosen owner, defaulting to themselves on create', () => {
    expect(sanitizeWrite(user('manager'), 'lead', { ownerId: 'u2' }, { isCreate: true })).toEqual({ ownerId: 'u2' })
    expect(sanitizeWrite(user('manager'), 'lead', {}, { isCreate: true })).toEqual({ ownerId: 'u1' })
    expect(sanitizeWrite(user('manager'), 'lead', { ownerId: 'u2' })).toEqual({ ownerId: 'u2' })
  })

  it('does not mutate the input body', () => {
    const body = { name: 'x', orgId: 'o2' }
    sanitizeWrite(user('member'), 'lead', body)
    expect(body).toEqual({ name: 'x', orgId: 'o2' })
  })
})
