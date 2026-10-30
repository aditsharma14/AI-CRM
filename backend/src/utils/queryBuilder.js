// @ts-check
// Filter/sort/pagination/date-range builder for any Mongoose model.

/** @typedef {import('../types/index.js').ListQuery} ListQuery */
/** @typedef {import('../types/index.js').PageMeta} PageMeta */

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

  return { filter, sortSpec, skip: (page - 1) * limit, limit, page }
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
