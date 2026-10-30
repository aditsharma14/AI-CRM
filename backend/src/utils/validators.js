// @ts-check
// Shared Zod schema fragments (pagination, ObjectId, email/phone).
import mongoose from 'mongoose'
import { z } from 'zod'

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

const page = z.coerce.number().int().min(1).default(1)
const limit = z.coerce.number().int().min(1).max(100).default(20)

/** Pagination only, for lists that take no filters. Strict, like listQuery. */
export const paginationQuery = z.object({ page, limit }).strict()

// Filter value fragments. Each accepts exactly one scalar string, so a
// repeated key (?a=1&a=2 → array) or anything operator-shaped fails here.
export const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'must be a date')
export const booleanParam = z.enum(['true', 'false']).transform((v) => v === 'true')
/** Pipeline stage keys are org-defined, so a pattern, not an enum. */
export const stageKeyParam = z.string().regex(/^[a-z0-9_-]{1,40}$/, 'must be a stage key (a-z, 0-9, _ or -)')

/**
 * What a resource's list endpoint accepts beyond page/limit. The same spec
 * feeds the route's schema (listQuery) and the service's buildListQuery
 * options, so the two can't drift apart again.
 * @template {z.ZodRawShape} [F=z.ZodRawShape]
 * @typedef {object} ListSpec
 * @property {F} filters Allowlisted equality filters, each a scalar schema.
 * @property {string[]} [sort] Sortable fields; `?sort=field` or `-field`. Omit to accept no `sort`.
 * @property {boolean} [search] Accept `?q=` (the model needs a text index).
 * @property {boolean} [dateRange] Accept `?dateFrom=&dateTo=` (inclusive).
 */

// The type-level shape of every list query. Which of sort/q/dateFrom/dateTo
// a resource really accepts is decided at runtime from its spec; to the
// types they're simply optional strings that may be absent.
const listBase = {
  page,
  limit,
  sort: z.string().optional(),
  q: z.string().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
}

/**
 * A strict list-query schema: anything not in the spec (an unknown key, a
 * bad value, `status[$ne]`, a repeated key, an unsupported sort) is a 400.
 * Stripping would silently ignore it, which is how filters went missing
 * for leads, deals, contacts, companies, notes and notifications.
 * @template {z.ZodRawShape} F
 * @param {ListSpec<F>} spec
 * @returns {z.ZodObject<typeof listBase & F>}
 */
export function listQuery({ filters, sort, search = false, dateRange = false }) {
  /** @type {Record<string, z.core.$ZodType>} */
  const shape = { page, limit, ...filters }
  if (sort?.length) {
    // Boundary cast: z.enum wants a non-empty tuple; the length check proves it.
    const values = /** @type {[string, ...string[]]} */ (sort.flatMap((f) => [f, `-${f}`]))
    shape.sort = z.enum(values).optional()
  }
  if (search) shape.q = listBase.q
  if (dateRange) Object.assign(shape, { dateFrom: listBase.dateFrom, dateTo: listBase.dateTo })
  // Boundary cast: the runtime shape is a subset of listBase & F (see listBase).
  return /** @type {z.ZodObject<typeof listBase & F>} */ (/** @type {unknown} */ (z.object(shape).strict()))
}

export const email = z.string().trim().toLowerCase().email()
export const optionalEmail = optional(email)

export const phone = optional(z.string().trim().min(6).max(20))

// z.coerce.date() turns '' into an *invalid* Date (rather than failing type
// checking outright), so the empty-string-to-undefined preprocess still
// has to run first — same fix, same reason, one more field type.
export const optionalDate = optional(z.coerce.date())

export const password = z.string().min(8, 'Password must be at least 8 characters')
