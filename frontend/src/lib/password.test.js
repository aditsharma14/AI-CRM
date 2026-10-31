// The client password rule mirrors the backend's case by case (backend/tests/password-rule.test.js, same table).
import { describe, expect, it } from 'vitest'

import { passwordRule } from './password.js'

// [description, password, accepted, issue message when refused]: a copy of the backend's CASES.
const CASES = [
  ['7 characters', 'a'.repeat(7), false, 'must be at least 8 characters'],
  ['8 characters', 'a'.repeat(8), true],
  ['8 spaces', ' '.repeat(8), false, 'must not be only whitespace'],
  ['tabs, newlines and a no-break space', '\t\n  \t\n  ', false, 'must not be only whitespace'],
  ['spaces around a real password (kept, not trimmed)', '  pass word  ', true],
  ['72 ASCII bytes', 'a'.repeat(72), true],
  ['73 ASCII bytes', 'a'.repeat(73), false, 'must be at most 72 bytes'],
  ['68 ASCII + one 4-byte emoji = 72 bytes', `${'a'.repeat(68)}😀`, true],
  [
    '69 ASCII + one 4-byte emoji = 73 bytes (only 70 characters)',
    `${'a'.repeat(69)}😀`,
    false,
    'must be at most 72 bytes',
  ],
  ['36 × é = 72 bytes', 'é'.repeat(36), true],
  ['37 × é = 74 bytes (only 37 characters)', 'é'.repeat(37), false, 'must be at most 72 bytes'],
  ['4 emoji: 8 UTF-16 units but 4 characters', '😀'.repeat(4), false, 'must be at least 8 characters'],
  ['8 emoji = 32 bytes', '😀'.repeat(8), true],
]

describe('passwordRule (mirror of backend validators.js `password`)', () => {
  it.each(CASES)('%s', (_, value, accepted, message) => {
    const result = passwordRule.safeParse(value)
    expect(result.success).toBe(accepted)
    if (!accepted) expect(result.error?.issues.map((i) => i.message)).toEqual([message])
  })

  it('returns the value untrimmed', () => {
    expect(passwordRule.parse('  pass word  ')).toBe('  pass word  ')
  })
})
