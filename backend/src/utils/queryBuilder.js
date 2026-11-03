// @ts-check
// Filter/sort/pagination/date-range builder for any Mongoose model.
import { afterFilter, decodeCursor, encodeCursor, queryFingerprint, sortKeyNullable } from './cursor.js'

/** @typedef {import('../types/index.js').ListQuery} ListQuery */
/** @typedef {import('../types/index.js').PageMeta} PageMeta */
/** @typedef {import('../types/index.js').CursorMeta} CursorMeta */

/**
 * @typedef {object} ListQueryOptions
 * @property {string[]} [filterableFields] Flat query params copied into the filter as-is.
 * @property {string[]} [searchFields] Non-empty enables `?q=` as a $text search.
 * @property {string[]} [sortableFields] Allowed `?sort=` fields; empty allows any.
 * @property {string} [dateField] Field that `?dateFrom=&dateTo=` range over.
 */

/**
 * @typedef {object} ListPlan
 * @property {Record<string, unknown>} filter
 * @property {Record<string, 1 | -1>} sortSpec
 * @property {number} skip
 * @property {number} limit
 * @property {number} page
 */

/**
 * Builds a { filter, sortSpec, skip, limit, page } plan from a validated,
 * plain query object (req.query, already validated and coerced by the resource's listQuery)
 * plus a resource's own flat filter params — e.g. ?status=new or ?dateFrom=&dateTo=.
 * Takes plain data rather than `req` so it stays usable outside of Express.
 * @param {ListQuery & Record<string, unknown>} query
 * @param {ListQueryOptions} [options]
 * @returns {ListPlan}
 */
export function buildListQuery(
  query,
  { filterableFields = [], searchFields = [], sortableFields = [], dateField } = {},
) {
  const { page, limit, sort, q, dateFrom, dateTo } = query
  /** @type {Record<string, unknown>} */
  const filter = {}

  for (const field of filterableFields) {
    if (query[field] !== undefined) filter[field] = query[field]
  }

  if (q && searchFields.length) {
    filter.$text = { $search: q }
  }

  if (dateField && (dateFrom || dateTo)) {
    /** @type {{ $gte?: Date, $lte?: Date }} */
    const range = {}
    if (dateFrom) range.$gte = new Date(dateFrom)
    if (dateTo) range.$lte = new Date(dateTo)
    filter[dateField] = range
  }

  /** @type {Record<string, 1 | -1>} */
  let sortSpec = { createdAt: -1 }
  if (sort) {
    const field = sort.replace(/^-/, '')
    if (sortableFields.length === 0 || sortableFields.includes(field)) {
      sortSpec = { [field]: sort.startsWith('-') ? -1 : 1 }
    }
  }

  // Cursor lists have no page; they never skip.
  return { filter, sortSpec, skip: page ? (page - 1) * limit : 0, limit, page: page ?? 1 }
}

/**
 * Runs a plan against any model: one page of documents plus the total count.
 * @template T
 * @param {import('mongoose').Model<T>} model
 * @param {ListPlan} plan
 * @param {import('mongoose').PopulateOptions | import('mongoose').PopulateOptions[]} [populate]
 * @returns {Promise<{ items: import('mongoose').HydratedDocument<T>[], meta: PageMeta }>}
 */
export async function paginate(model, plan, populate) {
  const query = model.find(plan.filter).sort(plan.sortSpec).skip(plan.skip).limit(plan.limit)
  const cursor = populate ? query.populate(populate) : query
  const [items, total] = await Promise.all([cursor, model.countDocuments(plan.filter)])
  return { items, meta: { page: plan.page, limit: plan.limit, total, hasMore: plan.skip + items.length < total } }
}

/**
 * Runs a plan as one cursor page: the rows after `cursor` in the order { [sortKey]: dir, _id: dir } (an index with that
 * order reads just the page), plus one extra row to know whether there is more. No count and no skip, so the cost of a
 * page doesn't grow with the list.
 * @template T
 * @param {import('mongoose').Model<T>} model
 * @param {ListPlan} plan
 * @param {{ resource: string, query: Record<string, unknown> & { cursor?: string } }} context The fingerprint ties a
 *   cursor to this resource and query (utils/cursor.js).
 * @param {import('mongoose').PopulateOptions | import('mongoose').PopulateOptions[]} [populate]
 * @returns {Promise<{ items: import('mongoose').HydratedDocument<T>[], meta: CursorMeta }>}
 * @throws {import('./http.js').AppError} 400 INVALID_CURSOR
 */
export async function cursorPaginate(model, plan, { resource, query }, populate) {
  const [field, dir] = Object.entries(plan.sortSpec)[0] ?? ['createdAt', -1]
  const fingerprint = queryFingerprint(resource, query)
  let filter = plan.filter
  if (query.cursor) {
    const { value, id } = decodeCursor(query.cursor, fingerprint)
    const after = afterFilter(field, dir, value, id, sortKeyNullable(model.schema, field))
    // Merged flat when no key collides (the usual case: the bound then sits beside orgId for the planner), else $and.
    const collides = Object.keys(after).some((key) => key in plan.filter)
    filter = collides ? { $and: [plan.filter, after] } : { ...plan.filter, ...after }
  }
  const find = model
    .find(filter)
    .sort({ [field]: dir, _id: dir })
    .limit(plan.limit + 1)
  const rows = await (populate ? find.populate(populate) : find)
  const items = rows.slice(0, plan.limit)
  const last = items.at(-1)
  const hasMore = rows.length > plan.limit && last !== undefined
  // The stored value, as MongoDB sorted it: a missing field sorts as null, even where Mongoose filled in a default.
  const stored = last && !last.$isDefault(field) ? last.get(field) : null
  const nextCursor = hasMore ? encodeCursor(fingerprint, stored, last._id) : null
  return { items, meta: { limit: plan.limit, hasMore, nextCursor } }
}
