// Pure-function tests for labelFor, the audit-log and notification label (no DB, no HTTP).
import { describe, expect, it } from 'vitest'

import { labelFor } from '../src/services/activityLogService.js'

describe('labelFor', () => {
  it.each([
    ['name wins over everything', { _id: 'id1', name: 'Acme', title: 'T', body: 'B' }, 'Acme'],
    ['an empty name still wins', { _id: 'id1', name: '', title: 'T' }, ''],
    ['title when there is no name', { _id: 'id1', title: 'Big deal', body: 'B' }, 'Big deal'],
    ['an empty title still wins', { _id: 'id1', title: '', body: 'B' }, ''],
    ['a short body, with an ellipsis', { _id: 'id1', body: 'Call back' }, 'Call back…'],
    ['a long body, cut to 40 characters', { _id: 'id1', body: 'x'.repeat(50) }, `${'x'.repeat(40)}…`],
    ['the id when the body is empty', { _id: 'id1', body: '' }, 'id1'],
    ['the id when nothing else is set', { _id: 'id1' }, 'id1'],
    ['a non-string name is skipped', { _id: 'id1', name: 42, title: 'T' }, 'T'],
  ])('%s', (_, doc, expected) => {
    expect(labelFor(doc)).toBe(expected)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a document with no fields', {}],
  ])('returns an empty string for %s', (_, doc) => {
    expect(labelFor(doc)).toBe('')
  })
})
