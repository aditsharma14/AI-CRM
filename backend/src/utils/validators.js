// @ts-check
// Shared Zod schema fragments (pagination, ObjectId, email/phone).
import { z } from 'zod'
import mongoose from 'mongoose'

// RHF always sends '' for an untouched optional text input, never undefined —
// so a plain `.optional()` (which only accepts undefined) rejects it. These
// preprocess '' to undefined first, so "left blank" behaves as "omitted".
/**
 * @param {unknown} v
 * @returns {unknown}
 */
const emptyToUndefined = (v) => (v === '' ? undefined : v)

/**
 * @template {z.ZodType} S
 * @param {S} schema
 * @returns The same output type as `schema.optional()` (inferred: z.ZodPreprocess<z.ZodOptional<S>>).
 */
const optional = (schema) => z.preprocess(emptyToUndefined, schema.optional())

export const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id')
export const optionalObjectId = optional(objectId)

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  q: z.string().optional(),
})

export const email = z.string().trim().toLowerCase().email()
export const optionalEmail = optional(email)

export const phone = optional(z.string().trim().min(6).max(20))

// z.coerce.date() turns '' into an *invalid* Date (rather than failing type
// checking outright), so the empty-string-to-undefined preprocess still
// has to run first — same fix, same reason, one more field type.
export const optionalDate = optional(z.coerce.date())

export const password = z.string().min(8, 'Password must be at least 8 characters')
