// splitFieldErrors: the backend's VALIDATION_ERROR text (`field: message; field: message`) split into per-field messages.
import { describe, expect, it } from 'vitest'

import { splitFieldErrors } from './utils.js'

/** An axios-shaped error carrying the backend's envelope. */
const apiError = (status, code, message) => ({ response: { status, data: { error: { code, message } } } })

describe('splitFieldErrors', () => {
  it('maps a field the form shows to that field, and nothing is left for the alert', () => {
    const err = apiError(400, 'VALIDATION_ERROR', 'password: must be at most 72 bytes')
    expect(splitFieldErrors(err, ['password'])).toEqual({
      fieldErrors: { password: { message: 'must be at most 72 bytes' } },
      message: null,
    })
  })

  it('keeps issues for fields the form does not show (and path-less ones) in the alert message', () => {
    const err = apiError(400, 'VALIDATION_ERROR', 'password: Too short; token: Required; Unrecognized key: "x"')
    expect(splitFieldErrors(err, ['password'])).toEqual({
      fieldErrors: { password: { message: 'Too short' } },
      message: 'token: Required; Unrecognized key: "x"',
    })
  })

  it('leaves other errors whole: a 4xx that is not a validation error, a 500, no response', () => {
    const forbidden = apiError(403, 'FORBIDDEN', 'password: not yours')
    expect(splitFieldErrors(forbidden, ['password'])).toEqual({ fieldErrors: {}, message: 'password: not yours' })
    expect(splitFieldErrors(apiError(500, 'INTERNAL_ERROR', 'boom'), ['password']).fieldErrors).toEqual({})
    expect(splitFieldErrors({}, ['password']).message).toMatch(/Can't reach the server/)
  })

  it('no error: nothing to show', () => {
    expect(splitFieldErrors(null, ['password'])).toEqual({ fieldErrors: {}, message: null })
  })
})
