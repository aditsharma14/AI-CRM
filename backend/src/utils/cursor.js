// @ts-check
// Cursor (keyset) pagination: an opaque token holding the last row's sort value and _id, tied to the query it came from.
import { createHash } from 'node:crypto'

import mongoose from 'mongoose'

import { badRequest } from './http.js'

/** @typedef {Date | number | string | null} SortValue */

/**
 * A short hash of everything that decides a list's order and membership: resource, filters, search and sort (not the
 * limit, which may change between pages). A cursor carries it, so reusing one with another query is a 400, not a page
 * of the wrong list.
 * @param {string} resource
 * @param {Record<string, unknown>} query The validated query (`cursor` and `limit` are ignored).
 * @returns {string}
 */
export function queryFingerprint(resource, query) {
  const parts = Object.entries(query)
    .filter(([key, value]) => key !== 'cursor' && key !== 'limit' && value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
  return createHash('sha256')
    .update(JSON.stringify([resource, parts]))
    .digest('base64url')
    .slice(0, 12)
}

/**
 * @param {SortValue} value
 * @returns {[string, unknown]}
 */
const tag = (value) =>
  value === null || value === undefined
    ? ['z', null]
    : value instanceof Date
      ? ['d', value.toISOString()]
      : typeof value === 'number'
        ? ['n', value]
        : ['s', String(value)]

/**
 * @param {string} fingerprint From queryFingerprint().
 * @param {SortValue | undefined} value The last row's sort value (null or missing both sort as null).
 * @param {unknown} id The last row's _id.
 * @returns {string} base64url, opaque to the client.
 */
export function encodeCursor(fingerprint, value, id) {
  return Buffer.from(JSON.stringify([fingerprint, ...tag(value ?? null), String(id)])).toString('base64url')
}

const invalid = () =>
  badRequest('cursor: not a cursor from this list. Start again from the first page.', 'INVALID_CURSOR')
const stale = () =>
  badRequest(
    'cursor: belongs to a different filter, search or sort. Start again from the first page.',
    'INVALID_CURSOR',
  )

/**
 * @param {string} token
 * @param {string} fingerprint The current query's; a cursor from any other query is refused.
 * @returns {{ value: SortValue, id: import('mongoose').Types.ObjectId }}
 * @throws {import('./http.js').AppError} 400 INVALID_CURSOR
 */
export function decodeCursor(token, fingerprint) {
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
  } catch {
    throw invalid()
  }
  if (!Array.isArray(parsed) || parsed.length !== 4) throw invalid()
  const [fp, kind, raw, id] = parsed
  if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) throw invalid()
  /** @type {SortValue} */
  let value
  if (kind === 'z' && raw === null) value = null
  else if (kind === 'n' && typeof raw === 'number' && Number.isFinite(raw)) value = raw
  else if (kind === 's' && typeof raw === 'string') value = raw
  else if (kind === 'd' && typeof raw === 'string' && !Number.isNaN(Date.parse(raw))) value = new Date(raw)
  else throw invalid()
  if (fp !== fingerprint) throw stale()
  return { value, id: new mongoose.Types.ObjectId(id) }
}

/**
 * The filter for "rows after this one" in the order { [field]: dir, _id: dir }, merged into the list's own filter.
 * - The sort key's bound is a top-level range (`$lte`/`$gte`), so the index scan starts at the cursor: a page reads only
 *   its own rows, however deep it is. The `_id` tie-break is a residual on index keys, applied before any fetch.
 * - _id breaks ties, so equal sort values never repeat or skip a row.
 * - MongoDB sorts null (and a missing field) below every value: nulls come first ascending and last descending.
 *   Range operators never match null, hence the null branches, added only for a key that can be null: without them
 *   the filter has no `$or` of alternatives, so the planner has one plan to pick, the tight index scan.
 * @param {string} field
 * @param {1 | -1} dir
 * @param {SortValue} value
 * @param {import('mongoose').Types.ObjectId} id
 * @param {boolean} nullable Whether a row's `field` can be null or missing (see sortKeyNullable).
 * @returns {Record<string, unknown>}
 */
export function afterFilter(field, dir, value, id, nullable) {
  const beyond = dir === 1 ? '$gt' : '$lt'
  if (value === null) {
    // Ascending, the non-null rows are all still ahead; descending, only the remaining nulls are.
    const sameNull = { [field]: null, _id: { [beyond]: id } }
    return dir === 1 ? { $or: [sameNull, { [field]: { $ne: null } }] } : sameNull
  }
  const fromCursor = {
    [field]: { [dir === 1 ? '$gte' : '$lte']: value },
    $or: [{ [field]: { [beyond]: value } }, { _id: { [beyond]: id } }],
  }
  // Descending, the nulls come after every value.
  return dir === 1 || !nullable ? fromCursor : { $or: [fromCursor, { [field]: null }] }
}

/**
 * Whether a sort key can be null or missing in stored documents: anything but the timestamps and required fields. A
 * schema default doesn't count, since documents written before it existed lack the field (a lead's `score`).
 * @param {import('mongoose').Schema} schema
 * @param {string} field
 * @returns {boolean}
 */
export function sortKeyNullable(schema, field) {
  if (field === 'createdAt' || field === 'updatedAt' || field === '_id') return false
  const path = /** @type {{ isRequired?: boolean } | undefined} */ (schema.path(field))
  return !path?.isRequired
}
