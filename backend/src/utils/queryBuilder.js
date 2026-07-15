// Filter/sort/pagination/date-range builder for any Mongoose model.

/**
 * Builds a { filter, sortSpec, skip, limit, page } plan from a validated,
 * plain query object (req.query, already coerced by validators.paginationQuery)
 * plus a resource's own flat filter params — e.g. ?status=new or ?dateFrom=&dateTo=.
 * Takes plain data rather than `req` so it stays usable outside of Express.
 */
export function buildListQuery(query, { filterableFields = [], searchFields = [], sortableFields = [], dateField } = {}) {
  const { page, limit, sort, q, dateFrom, dateTo } = query
  const filter = {}

  for (const field of filterableFields) {
    if (query[field] !== undefined) filter[field] = query[field]
  }

  if (q && searchFields.length) {
    filter.$text = { $search: q }
  }

  if (dateField && (dateFrom || dateTo)) {
    filter[dateField] = {}
    if (dateFrom) filter[dateField].$gte = new Date(dateFrom)
    if (dateTo) filter[dateField].$lte = new Date(dateTo)
  }

  let sortSpec = { createdAt: -1 }
  if (sort) {
    const field = sort.replace(/^-/, '')
    if (sortableFields.length === 0 || sortableFields.includes(field)) {
      sortSpec = { [field]: sort.startsWith('-') ? -1 : 1 }
    }
  }

  return { filter, sortSpec, skip: (page - 1) * limit, limit, page }
}

export async function paginate(model, plan, populate) {
  let cursor = model.find(plan.filter).sort(plan.sortSpec).skip(plan.skip).limit(plan.limit)
  if (populate) cursor = cursor.populate(populate)
  const [items, total] = await Promise.all([cursor, model.countDocuments(plan.filter)])
  return { items, meta: { page: plan.page, limit: plan.limit, total, hasMore: plan.skip + items.length < total } }
}
