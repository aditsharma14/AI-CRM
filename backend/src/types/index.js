// @ts-check
// Shared JSDoc typedefs for the checked core. Types only — this module exports nothing at runtime.

/** @typedef {'owner' | 'admin' | 'manager' | 'member'} Role */

/**
 * The caller, as verified from the access token by middleware/auth.js.
 * Services take this as `actor`.
 * @typedef {object} AuthUser
 * @property {string} id
 * @property {string} orgId
 * @property {Role} role
 */

/**
 * @typedef {object} ApiError
 * @property {string} code
 * @property {string} message
 */

/**
 * @typedef {object} PageMeta
 * @property {number} page
 * @property {number} limit
 * @property {number} total
 * @property {boolean} hasMore
 */

/**
 * List meta for cursor-paginated lists (leads, deals): no page number and no total, which would mean counting every
 * match on every page. `nextCursor` is null on the last page.
 * @typedef {object} CursorMeta
 * @property {number} limit
 * @property {boolean} hasMore
 * @property {string | null} nextCursor
 */

/**
 * The one envelope every endpoint returns (see utils/http.js).
 * @template T
 * @typedef {object} ApiResponse
 * @property {boolean} success
 * @property {T | null} data
 * @property {ApiError | null} error
 * @property {PageMeta | CursorMeta | Record<string, unknown> | null} meta
 */

/**
 * @template T
 * @typedef {object} Paginated
 * @property {T[]} items
 * @property {PageMeta} meta
 */

/**
 * A list request after validate({ query: <resource>ListQuery }) has coerced it.
 * @typedef {object} ListQuery
 * @property {number} [page] Absent on cursor lists.
 * @property {string} [cursor]
 * @property {number} limit
 * @property {string} [sort]
 * @property {string} [q]
 * @property {string} [dateFrom]
 * @property {string} [dateTo]
 */

export {}
