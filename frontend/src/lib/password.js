// @ts-check
// The client copy of the backend's password rule (backend/src/utils/validators.js `password`), so a form refuses
// exactly what the API would, before sending it. Change both together; password.test.js mirrors the backend's cases.
import { z } from 'zod'

/** bcrypt hashes only the first 72 bytes and ignores the rest, so a longer password is refused. */
export const PASSWORD_MAX_BYTES = 72

/** @param {string} value */
const utf8Bytes = (value) => new TextEncoder().encode(value).length

// Characters are code points ('😀'.length is 2), never trimmed: the password is exactly what was typed.
export const passwordRule = z
  .string()
  .refine((value) => [...value].length >= 8, 'must be at least 8 characters')
  .refine((value) => value.trim() !== '', 'must not be only whitespace')
  .refine((value) => utf8Bytes(value) <= PASSWORD_MAX_BYTES, 'must be at most 72 bytes')

export const PASSWORD_HINT = 'At least 8 characters, not only spaces, and at most 72 bytes (an emoji counts as 4).'
