// @ts-check
// The Idempotency-Key request header (middleware/idempotency.js): a UUID or any 16 to 64 safe characters.
import { z } from 'zod'

/** Keyed by the header's name, so a bad key reads "idempotency-key: …" like any other bad field. */
export const idempotencyHeader = z.object({
  'idempotency-key': z
    .string()
    .regex(/^[A-Za-z0-9._:-]{16,64}$/, 'must be a UUID or 16 to 64 of A-Z, a-z, 0-9, ".", "_", ":" or "-"'),
})

/** @typedef {z.infer<typeof idempotencyHeader>} IdempotencyHeader */
