// The demo's fake brief must equal the AI service's FakeProvider output. Both are held to the same fixture
// (contracts/lead-brief-fake.json, made from the Python side; AI/tests/test_fake_parity.py checks that side).
import { describe, expect, it } from 'vitest'

import fixture from '../../../contracts/lead-brief-fake.json'
import { fakeBrief } from './leadBrief.js'

describe('the demo fake brief matches FakeProvider', () => {
  it.each(fixture.map((entry, i) => [i, entry]))('fixture %i', (_, { bundle, brief }) => {
    expect(fakeBrief(bundle)).toEqual(brief)
  })
})
