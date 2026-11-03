// The demo's API: MSW handlers that answer /api/v1 from an in-memory copy of seed.js, with the real API's rules
// (ownership, roles, strict list queries, stage closing, audit log, notifications) and its exact response shapes.
// Shapes are pinned by contracts/api-shapes.json (src/demo/contract.test.js). Anything the demo doesn't do answers
// 400 NOT_AVAILABLE_IN_DEMO.
import { http } from 'msw'

import { canModifyRecord, hasPermission } from '../lib/constants.js'
import { fail, ok } from './envelope.js'
import { createSeed, oid } from './seed.js'

const API = '/api/v1'

export const NOT_AVAILABLE =
  'Not available in the demo. Run the full app with docker compose to use it (see the README).'

class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    Object.assign(this, { status, code })
  }
}
const badRequest = (message, code = 'VALIDATION_ERROR') => new ApiError(400, code, message)
const forbidden = (message) => new ApiError(403, 'FORBIDDEN', message)
const notFound = (message) => new ApiError(404, 'NOT_FOUND', message)
const unauthorized = (message, code = 'UNAUTHORIZED') => new ApiError(401, code, message)

const ID = /^[0-9a-f]{24}$/
const clone = (value) => structuredClone(value)
// JSON drops undefined, as the real API never sends a field it didn't store.
const json = (value) => JSON.parse(JSON.stringify(value))

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted']
const ENTITY_TYPES = ['lead', 'contact', 'company', 'deal']
const ACTIVITY_TYPES = ['task', 'event', 'call', 'meeting']
const CLOSING_KEYS = ['won', 'lost']

// Per resource, what backend/src/schemas and the services accept: list filters, sorts, text search, writable fields.
const id = (v) => ID.test(v) || 'Invalid id'
const oneOf = (values) => (v) => values.includes(v) || `must be one of ${values.join(', ')}`
const RESOURCES = {
  leads: {
    model: 'Lead',
    policy: 'lead',
    owner: 'ownerId',
    populate: ['companyId'],
    filters: { status: oneOf(LEAD_STATUSES), ownerId: id, companyId: id },
    sort: ['name', 'score', 'createdAt'],
    search: ['name', 'email'],
    cursor: true, // cursor pagination, no page numbers (utils/cursor.js)
    fields: ['name', 'email', 'phone', 'source', 'status', 'companyId', 'ownerId'],
    required: ['name'],
    defaults: () => ({ status: 'new', score: 0 }),
    label: (r) => r.name,
    logged: 'lead',
  },
  contacts: {
    model: 'Contact',
    policy: 'contact',
    owner: 'ownerId',
    populate: ['companyId'],
    filters: { companyId: id, ownerId: id },
    sort: ['name', 'createdAt'],
    search: ['name', 'email'],
    fields: ['name', 'email', 'phone', 'title', 'companyId', 'tags', 'ownerId'],
    required: ['name'],
    defaults: () => ({ tags: [] }),
  },
  companies: {
    model: 'Company',
    policy: 'company',
    owner: 'ownerId',
    populate: [],
    filters: { ownerId: id },
    sort: ['name', 'createdAt'],
    search: ['name'],
    fields: ['name', 'domain', 'industry', 'size', 'ownerId'],
    required: ['name'],
    defaults: () => ({}),
  },
  deals: {
    model: 'Deal',
    policy: 'deal',
    owner: 'ownerId',
    populate: ['companyId', 'contactIds'],
    filters: {
      stageKey: (v) => /^[a-z0-9_-]{1,40}$/.test(v) || 'must be a stage key',
      status: oneOf(['open', 'won', 'lost']),
      ownerId: id,
      companyId: id,
    },
    sort: ['value', 'createdAt', 'closedAt'],
    cursor: true,
    fields: ['title', 'value', 'currency', 'stageKey', 'probability', 'companyId', 'contactIds', 'ownerId'],
    required: ['title', 'value'],
    defaults: () => ({ probability: 50, status: 'open', contactIds: [] }),
    label: (r) => r.title,
    logged: 'deal',
  },
  activities: {
    model: 'Activity',
    policy: 'activity',
    owner: 'assigneeId',
    populate: ['assigneeId'],
    filters: { type: oneOf(ACTIVITY_TYPES), status: oneOf(['open', 'done']), assigneeId: id },
    dateRange: true,
    fields: [
      'type',
      'title',
      'description',
      'assigneeId',
      'linkedTo',
      'dueDate',
      'priority',
      'startAt',
      'endAt',
      'allDay',
      'status',
    ],
    required: ['type', 'title'],
    defaults: () => ({ allDay: false, status: 'open' }),
  },
  notes: {
    model: 'Note',
    policy: 'note',
    owner: 'authorId',
    populate: ['authorId'],
    filters: { entityType: oneOf(ENTITY_TYPES), entityId: id },
    sort: ['createdAt'],
    fields: ['entityType', 'entityId', 'body'],
    required: ['entityType', 'entityId', 'body'],
    defaults: () => ({}),
  },
}

/**
 * The demo API over a fresh seed. Returns the MSW handlers and the store (tests inspect it).
 * @param {{ now?: () => Date }} [options]
 */
export function createDemoApi({ now = () => new Date() } = {}) {
  const db = createSeed(now())
  let sequence = 0
  let sessionUserId = null
  const tokens = new Map()

  const stamp = () => now().toISOString()
  const newId = () => oid('2a', ++sequence)
  const userById = (userId) => db.users.find((u) => u._id === String(userId))
  const stages = () => [...db.org.pipelineStages].sort((a, b) => a.order - b.order)

  // ---- auth
  const serializeUser = (user) => ({
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
    org: { id: db.org._id, name: db.org.name, plan: db.org.plan, currency: db.org.currency },
  })
  const session = (user) => {
    const token = `demo.${user._id}.${++sequence}`
    tokens.set(token, user._id)
    sessionUserId = user._id
    return { accessToken: token, user: serializeUser(user) }
  }
  /** The signed-in user, as the auth middleware would set req.user. */
  const actorOf = (request) => {
    const header = request.headers.get('authorization') ?? ''
    if (!header.startsWith('Bearer ')) throw unauthorized('Missing access token.')
    const user = userById(tokens.get(header.slice(7)))
    if (!user) throw unauthorized('Invalid or expired access token.')
    return { id: user._id, role: user.role, user }
  }
  const requirePermission = (actor, resource, action) => {
    if (!hasPermission(actor.role, resource, action)) throw forbidden(`Your role cannot ${action} ${resource}.`)
  }

  // ---- records
  const populateRef = (refId, select = ['name']) => {
    const target =
      db.users.find((u) => u._id === refId) ??
      db.companies.find((c) => c._id === refId) ??
      db.contacts.find((c) => c._id === refId)
    if (!target) return null
    return Object.fromEntries([
      ['_id', target._id],
      ...select.filter((k) => target[k] != null).map((k) => [k, target[k]]),
    ])
  }
  const populated = (spec, record) => {
    const out = clone(record)
    for (const field of spec.populate) {
      if (out[field] == null) continue
      const select = field === 'authorId' ? ['name', 'avatarUrl'] : ['name']
      out[field] = Array.isArray(out[field])
        ? out[field].map((v) => populateRef(v, select)).filter(Boolean)
        : populateRef(out[field], select)
    }
    return out
  }
  /** 403 when the record is in the org but not the actor's, 404 when it doesn't exist (ownership.js missOrForbidden). */
  const findWritable = (resource, actor, recordId) => {
    const spec = RESOURCES[resource]
    const record = db[resource].find((r) => r._id === recordId)
    if (!record) throw notFound(`${spec.model} not found.`)
    if (!canModifyRecord({ id: actor.id, role: actor.role }, record, spec.owner))
      throw forbidden('You can only change records you own.')
    return record
  }
  const findReadable = (resource, recordId) => {
    const record = db[resource].find((r) => r._id === recordId)
    if (!record) throw notFound(`${RESOURCES[resource].model} not found.`)
    return record
  }

  const log = (actor, action, entityType, record, message) => {
    const when = stamp()
    db.logs.push({
      _id: newId(),
      orgId: db.org._id,
      userId: actor.id,
      entityType,
      entityId: record._id,
      message,
      kind: 'activity_log',
      action,
      createdAt: when,
      updatedAt: when,
      __v: 0,
    })
  }
  const notify = (userId, entityType, record, message) => {
    const when = stamp()
    db.notifications.push({
      _id: newId(),
      orgId: db.org._id,
      userId,
      entityType,
      entityId: record._id,
      message,
      kind: 'notification',
      read: false,
      createdAt: when,
      updatedAt: when,
      __v: 0,
    })
  }

  /** The body a write may use: known fields, '' as omitted, orgId never, the owner field per ownership.js. */
  const cleanBody = (resource, actor, body, { isCreate }) => {
    const spec = RESOURCES[resource]
    if (body === null || typeof body !== 'object' || Array.isArray(body))
      throw badRequest('Invalid input: expected object')
    const clean = {}
    for (const field of spec.fields) {
      if (body[field] === undefined || body[field] === '') continue
      clean[field] = body[field]
    }
    if (isCreate) {
      for (const field of spec.required) if (clean[field] === undefined) throw badRequest(`${field}: is required`)
    }
    for (const field of ['companyId', 'ownerId', 'assigneeId', 'entityId']) {
      if (clean[field] !== undefined && !ID.test(clean[field])) throw badRequest(`${field}: Invalid id`)
    }
    if (clean.status !== undefined && resource === 'leads' && !LEAD_STATUSES.includes(clean.status))
      throw badRequest(`status: ${oneOf(LEAD_STATUSES)('')}`)
    if (clean.type !== undefined && !ACTIVITY_TYPES.includes(clean.type))
      throw badRequest(`type: ${oneOf(ACTIVITY_TYPES)('')}`)
    if (clean.entityType !== undefined && !ENTITY_TYPES.includes(clean.entityType))
      throw badRequest(`entityType: ${oneOf(ENTITY_TYPES)('')}`)
    if (clean.value !== undefined && (typeof clean.value !== 'number' || clean.value < 0))
      throw badRequest('value: must be a number of 0 or more')
    if (clean.currency !== undefined && !['INR', 'USD', 'EUR', 'GBP'].includes(clean.currency))
      throw badRequest('currency: must be one of INR, USD, EUR, GBP')
    for (const field of ['dueDate', 'startAt', 'endAt']) {
      if (clean[field] === undefined) continue
      const time = Date.parse(clean[field])
      if (Number.isNaN(time)) throw badRequest(`${field}: Invalid date`)
      clean[field] = new Date(time).toISOString()
    }

    // Ownership: members never choose an owner; a note's author is always its writer.
    const ownerField = spec.owner
    const orgWide = ['owner', 'admin', 'manager'].includes(actor.role) && resource !== 'notes'
    if (!orgWide) delete clean[ownerField]
    if (isCreate && clean[ownerField] === undefined) clean[ownerField] = actor.id
    if (clean[ownerField] !== undefined && !userById(clean[ownerField]))
      throw badRequest(`${ownerField} must be a member of your organization.`, 'INVALID_OWNER')
    return clean
  }

  // ---- lists
  const listQuery = (resource, url) => {
    const spec = RESOURCES[resource]
    const params = url.searchParams
    const allowed = new Set([spec.cursor ? 'cursor' : 'page', 'limit', ...Object.keys(spec.filters)])
    if (spec.sort) allowed.add('sort')
    if (spec.search) allowed.add('q')
    if (spec.dateRange) ['dateFrom', 'dateTo'].forEach((k) => allowed.add(k))
    const query = {}
    for (const key of new Set(params.keys())) {
      if (!allowed.has(key)) throw badRequest(`Unrecognized key: "${key}"`)
      if (params.getAll(key).length > 1) throw badRequest(`${key}: Invalid input: expected string, received array`)
      query[key] = params.get(key)
    }
    const pageNo = query.page === undefined ? 1 : Number(query.page)
    const limit = query.limit === undefined ? 20 : Number(query.limit)
    if (!Number.isInteger(pageNo) || pageNo < 1) throw badRequest('page: must be an integer of 1 or more')
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw badRequest('limit: must be an integer from 1 to 100')
    for (const [key, check] of Object.entries(spec.filters)) {
      if (query[key] === undefined) continue
      const verdict = check(query[key])
      if (verdict !== true) throw badRequest(`${key}: ${verdict}`)
    }
    if (query.sort !== undefined && !spec.sort.flatMap((f) => [f, `-${f}`]).includes(query.sort))
      throw badRequest(`sort: must be one of ${spec.sort.flatMap((f) => [f, `-${f}`]).join(', ')}`)
    for (const key of ['dateFrom', 'dateTo'])
      if (query[key] !== undefined && Number.isNaN(Date.parse(query[key]))) throw badRequest(`${key}: must be a date`)
    return spec.cursor ? { ...query, limit } : { ...query, page: pageNo, limit }
  }
  const matchesText = (fields, q) => {
    const terms = q.toLowerCase().split(/\W+/).filter(Boolean)
    return (record) => {
      const words = fields.flatMap((f) =>
        String(record[f] ?? '')
          .toLowerCase()
          .split(/\W+/),
      )
      return terms.some((term) => words.some((word) => word.startsWith(term)))
    }
  }
  const compare = (field, direction) => (a, b) => {
    const x = a[field]
    const y = b[field]
    if (x == null && y == null) return 0
    if (x == null) return -direction
    if (y == null) return direction
    return (x < y ? -1 : x > y ? 1 : 0) * direction
  }
  // Cursors as utils/cursor.js makes them: the last row's sort value and _id, plus a hash of the query (resource,
  // filters, search, sort; not the limit), so a cursor reused with another query is the same 400 as the real API's.
  const fingerprint = (resource, query) => {
    const parts = Object.entries(query)
      .filter(([key, value]) => key !== 'cursor' && key !== 'limit' && value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
    let hash = 0x811c9dc5 // FNV-1a: short and stable; the real API uses sha256, either is opaque to the client
    for (const char of JSON.stringify([resource, parts])) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
    return (hash >>> 0).toString(36)
  }
  const toBase64Url = (text) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const fromBase64Url = (text) => atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  // The order { [sortKey]: dir, _id: dir }: _id breaks ties, as the real list's index does.
  const cursorOrder = (query) => {
    const sort = query.sort ?? '-createdAt'
    const field = sort.replace(/^-/, '')
    const direction = sort.startsWith('-') ? -1 : 1
    const order = (a, b) => compare(field, direction)(a, b) || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0) * direction
    return { field, order }
  }
  /** One page of `rows` (already in cursorOrder) after `query.cursor`. */
  const cursorPage = (resource, rows, query) => {
    const { field, order } = cursorOrder(query)
    const fp = fingerprint(resource, query)
    let start = 0
    if (query.cursor) {
      let parsed
      try {
        parsed = JSON.parse(fromBase64Url(query.cursor))
      } catch {
        parsed = null
      }
      if (!Array.isArray(parsed) || parsed.length !== 3 || typeof parsed[2] !== 'string')
        throw badRequest('cursor: not a cursor from this list. Start again from the first page.', 'INVALID_CURSOR')
      if (parsed[0] !== fp)
        throw badRequest(
          'cursor: belongs to a different filter, search or sort. Start again from the first page.',
          'INVALID_CURSOR',
        )
      const after = { [field]: parsed[1], _id: parsed[2] }
      start = rows.findIndex((row) => order(row, after) > 0)
      if (start === -1) start = rows.length
    }
    const items = rows.slice(start, start + query.limit)
    const hasMore = start + items.length < rows.length
    const last = items.at(-1)
    const nextCursor = hasMore ? toBase64Url(JSON.stringify([fp, last[field] ?? null, last._id])) : null
    return { items, meta: { limit: query.limit, hasMore, nextCursor } }
  }
  const paginate = (rows, { page: pageNo, limit }) => {
    const skip = (pageNo - 1) * limit
    const items = rows.slice(skip, skip + limit)
    return { items, meta: { page: pageNo, limit, total: rows.length, hasMore: skip + items.length < rows.length } }
  }
  const list = (resource, query) => {
    const spec = RESOURCES[resource]
    let rows = db[resource].filter((r) =>
      Object.keys(spec.filters).every((key) => query[key] === undefined || String(r[key]) === query[key]),
    )
    if (query.q) rows = rows.filter(matchesText(spec.search, query.q))
    if (resource === 'activities') {
      // activitiesService.list: the type's own date field, ascending.
      const dateField = query.type === 'task' ? 'dueDate' : 'startAt'
      if (query.dateFrom)
        rows = rows.filter((r) => r[dateField] != null && r[dateField] >= new Date(query.dateFrom).toISOString())
      if (query.dateTo)
        rows = rows.filter((r) => r[dateField] != null && r[dateField] <= new Date(query.dateTo).toISOString())
      rows = [...rows].sort((a, b) => compare(dateField, 1)(a, b) || compare('createdAt', -1)(a, b))
    } else if (spec.cursor) {
      const { items, meta } = cursorPage(resource, [...rows].sort(cursorOrder(query).order), query)
      return { items: items.map((r) => populated(spec, r)), meta }
    } else {
      const sort = query.sort ?? '-createdAt'
      rows = [...rows].sort(compare(sort.replace(/^-/, ''), sort.startsWith('-') ? -1 : 1))
    }
    const { items, meta } = paginate(rows, query)
    return { items: items.map((r) => populated(spec, r)), meta }
  }

  // ---- deals: stage rules from dealsService
  const stageIn = (stageKey) => {
    const stage = db.org.pipelineStages.find((s) => s.key === stageKey)
    if (!stage) throw badRequest(`stageKey: "${stageKey}" is not a stage in this organization's pipeline.`)
    return stage
  }
  const applyStage = (deal, fromKey, toStage, actor, wonLostReason) => {
    const closing = CLOSING_KEYS.includes(toStage.key)
    const isCreate = fromKey === null
    deal.stageKey = toStage.key
    if (closing) {
      deal.status = toStage.key
      deal.closedAt = stamp()
      if (wonLostReason) deal.wonLostReason = wonLostReason
    } else {
      deal.status = 'open'
      delete deal.closedAt
    }
    deal.updatedAt = stamp()
    if (!isCreate || closing) {
      log(
        actor,
        isCreate ? 'close' : 'move-stage',
        'deal',
        deal,
        isCreate
          ? `Created deal "${deal.title}" in ${toStage.label}`
          : `Moved deal "${deal.title}" to ${toStage.label}`,
      )
    }
    if (closing) notify(deal.ownerId, 'deal', deal, `Deal "${deal.title}" was marked ${toStage.key}.`)
  }

  const create = (resource, actor, body, extra = {}) => {
    const spec = RESOURCES[resource]
    const clean = cleanBody(resource, actor, body, { isCreate: true })
    const when = stamp()
    const record = {
      ...spec.defaults(),
      ...clean,
      ...extra,
      orgId: db.org._id,
      _id: newId(),
      createdAt: when,
      updatedAt: when,
      __v: 0,
    }
    if (resource === 'deals') {
      record.currency = clean.currency ?? db.org.currency
      const toStage = stageIn(clean.stageKey ?? stages()[0].key)
      record.stageKey = toStage.key
      db.deals.push(record)
      log(actor, 'create', 'deal', record, `Created deal "${record.title}"`)
      applyStage(record, null, toStage, actor)
      return record
    }
    db[resource].push(record)
    if (spec.logged) log(actor, 'create', spec.logged, record, `Created ${spec.logged} "${spec.label(record)}"`)
    if (resource === 'activities') log(actor, 'create', 'activity', record, `Created ${record.type} "${record.title}"`)
    return record
  }
  const update = (resource, actor, recordId, body) => {
    const spec = RESOURCES[resource]
    if (resource === 'deals' && body?.stageKey !== undefined)
      throw badRequest("stageKey: use PATCH /deals/:id/move-stage to change a deal's stage.")
    const clean = resource === 'notes' ? { body: body?.body } : cleanBody(resource, actor, body, { isCreate: false })
    if (resource === 'notes' && (typeof clean.body !== 'string' || !clean.body.trim()))
      throw badRequest('body: is required')
    const record = findWritable(resource, actor, recordId)
    Object.assign(record, clean, { updatedAt: stamp() })
    if (spec.logged) log(actor, 'update', spec.logged, record, `Updated ${spec.logged} "${spec.label(record)}"`)
    return record
  }
  const remove = (resource, actor, recordId) => {
    requirePermission(actor, 'crm', 'delete')
    const spec = RESOURCES[resource]
    const record = findWritable(resource, actor, recordId)
    db[resource] = db[resource].filter((r) => r !== record)
    if (spec.logged) log(actor, 'delete', spec.logged, record, `Deleted ${spec.logged} "${spec.label(record)}"`)
  }

  // ---- routing
  /** Wraps a resolver: ApiErrors become the error envelope; `auth` resolvers get the actor. */
  const route = (method, path, resolver, { auth = true } = {}) =>
    http[method](`${API}${path}`, async ({ request, params }) => {
      try {
        const actor = auth ? actorOf(request) : null
        const text = method === 'get' || method === 'delete' ? '' : await request.text()
        let body
        if (text) {
          try {
            body = JSON.parse(text)
          } catch {
            throw badRequest('Malformed JSON in request body.', 'BAD_REQUEST')
          }
        }
        const [data, status = 200, meta = null] = await resolver({
          actor,
          params,
          body,
          url: new URL(request.url),
          request,
        })
        return ok(json(data), meta, status)
      } catch (err) {
        if (err instanceof ApiError) return fail(err.status, err.code, err.message)
        throw err
      }
    })

  const crudRoutes = (resource) => [
    route('get', `/${resource}`, ({ url }) => {
      const { items, meta } = list(resource, listQuery(resource, url))
      return [items, 200, meta]
    }),
    route('get', `/${resource}/:id`, ({ params }) => [
      populated(RESOURCES[resource], findReadable(resource, params.id)),
    ]),
    route('post', `/${resource}`, ({ actor, body }) => [create(resource, actor, body), 201]),
    route('patch', `/${resource}/:id`, ({ actor, params, body }) => [update(resource, actor, params.id, body)]),
    route('delete', `/${resource}/:id`, ({ actor, params }) => {
      remove(resource, actor, params.id)
      return [null]
    }),
  ]

  const handlers = [
    // auth: sign in as either seeded user, with any password
    route(
      'post',
      '/auth/login',
      ({ body }) => {
        const email = String(body?.email ?? '')
          .trim()
          .toLowerCase()
        const user = db.users.find((u) => u.email === email)
        if (!user) throw unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS')
        return [session(user)]
      },
      { auth: false },
    ),
    route(
      'post',
      '/auth/refresh',
      () => {
        const user = sessionUserId && userById(sessionUserId)
        if (!user) throw unauthorized('Missing refresh token.')
        return [session(user)]
      },
      { auth: false },
    ),
    route(
      'post',
      '/auth/logout',
      () => {
        sessionUserId = null
        tokens.clear()
        return [null]
      },
      { auth: false },
    ),
    route('get', '/config', () => [{ emailEnabled: false }], { auth: false }),

    // org reads; every write under /org is outside the demo
    route('get', '/org', () => [db.org]),
    route('get', '/org/members', () => [
      db.users.map(({ _id, name, email, role, isEmailVerified, createdAt }) => ({
        _id,
        name,
        email,
        role,
        isEmailVerified,
        createdAt,
      })),
    ]),
    route('get', '/org/teams', () => [db.org.teams]),
    route('get', '/org/pipeline-stages', () => [db.org.pipelineStages]),
    route('get', '/org/email-templates', () => [db.emailTemplates]),

    route('post', '/leads/:id/convert', ({ actor, params, body }) => {
      const lead = findWritable('leads', actor, params.id)
      if (lead.status === 'converted') throw badRequest('This lead has already been converted.', 'ALREADY_CONVERTED')
      const input = body ?? {}
      const deal = create(
        'deals',
        { ...actor, role: 'manager' },
        {
          title: input.title || lead.name,
          value: input.value ?? 0,
          stageKey: input.stageKey,
          companyId: lead.companyId,
          ownerId: lead.ownerId,
        },
        { convertedFromLeadId: lead._id },
      )
      Object.assign(lead, {
        status: 'converted',
        convertedToDealId: deal._id,
        convertedAt: stamp(),
        updatedAt: stamp(),
      })
      log(actor, 'convert', 'lead', lead, `Converted lead "${lead.name}" into a deal`)
      notify(lead.ownerId, 'deal', deal, `Lead "${lead.name}" was converted into a deal.`)
      return [deal, 201]
    }),
    route('patch', '/deals/:id/move-stage', ({ actor, params, body }) => {
      if (typeof body?.stageKey !== 'string' || !body.stageKey.trim()) throw badRequest('stageKey: is required')
      const deal = findWritable('deals', actor, params.id)
      const toStage = stageIn(body.stageKey.trim())
      applyStage(deal, deal.stageKey, toStage, actor, body.wonLostReason?.trim() || undefined)
      return [deal]
    }),
    route('patch', '/activities/:id/toggle-status', ({ actor, params }) => {
      const activity = findWritable('activities', actor, params.id)
      Object.assign(activity, { status: activity.status === 'done' ? 'open' : 'done', updatedAt: stamp() })
      return [activity]
    }),
    ...Object.keys(RESOURCES).flatMap(crudRoutes),

    route('get', '/search', ({ url }) => {
      const q = url.searchParams.get('q')?.trim()
      if (!q) throw badRequest('q: Too small: expected string to have >=1 characters')
      const text = (resource) => db[resource].filter(matchesText(RESOURCES[resource].search, q)).slice(0, 5)
      const deals = db.deals.filter((d) => d.title.toLowerCase().includes(q.toLowerCase())).slice(0, 5)
      return [{ leads: text('leads'), contacts: text('contacts'), companies: text('companies'), deals }]
    }),
    route('get', '/dashboard/overview', () => {
      const leadsByStatus = {}
      for (const lead of db.leads) leadsByStatus[lead.status] = (leadsByStatus[lead.status] ?? 0) + 1
      const byStage = new Map()
      for (const deal of db.deals) {
        const row = byStage.get(deal.stageKey) ?? { stageKey: deal.stageKey, count: 0, value: 0 }
        row.count += 1
        row.value += deal.value
        byStage.set(deal.stageKey, row)
      }
      const openPipelineValue = db.deals.filter((d) => d.status === 'open').reduce((sum, d) => sum + d.value, 0)
      const recentActivity = [...db.logs]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
        .map((entry) => ({ ...entry, userId: populateRef(entry.userId) }))
      return [{ leadsByStatus, dealsByStage: [...byStage.values()], openPipelineValue, recentActivity }]
    }),
    route('get', '/dashboard/reports', () => {
      const closed = db.deals.filter((d) => CLOSING_KEYS.includes(d.status))
      const groups = new Map()
      for (const deal of closed.filter((d) => d.closedAt)) {
        const at = new Date(deal.closedAt)
        const key = `${at.getUTCFullYear()}-${at.getUTCMonth() + 1}-${deal.status}`
        const row = groups.get(key) ?? {
          _id: { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, status: deal.status },
          count: 0,
          value: 0,
        }
        row.count += 1
        row.value += deal.value
        groups.set(key, row)
      }
      const wonLostByMonth = [...groups.values()].sort((a, b) => a._id.year - b._id.year || a._id.month - b._id.month)
      const won = closed.filter((d) => d.status === 'won').length
      const lost = closed.filter((d) => d.status === 'lost').length
      return [{ wonLostByMonth, winRate: won + lost > 0 ? won / (won + lost) : null, won, lost }]
    }),

    route('get', '/notifications', ({ actor, url }) => {
      const params = url.searchParams
      for (const key of params.keys())
        if (!['page', 'limit', 'read', 'sort'].includes(key)) throw badRequest(`Unrecognized key: "${key}"`)
      const read = params.get('read')
      if (read !== null && read !== 'true' && read !== 'false') throw badRequest('read: must be true or false')
      const sort = params.get('sort') ?? '-createdAt'
      if (!['createdAt', '-createdAt'].includes(sort)) throw badRequest('sort: must be one of createdAt, -createdAt')
      const mine = db.notifications.filter((n) => n.userId === actor.id)
      const rows = mine
        .filter((n) => read === null || n.read === (read === 'true'))
        .sort(compare('createdAt', sort.startsWith('-') ? -1 : 1))
      const { items, meta } = paginate(rows, {
        page: Number(params.get('page') ?? 1),
        limit: Number(params.get('limit') ?? 20),
      })
      return [items, 200, { ...meta, unreadCount: mine.filter((n) => !n.read).length }]
    }),
    route('patch', '/notifications/read-all', ({ actor }) => {
      for (const n of db.notifications)
        if (n.userId === actor.id && !n.read) Object.assign(n, { read: true, updatedAt: stamp() })
      return [null]
    }),
    route('patch', '/notifications/:id/read', ({ actor, params }) => {
      const notification = db.notifications.find((n) => n._id === params.id && n.userId === actor.id)
      if (!notification) throw notFound('Notification not found.')
      Object.assign(notification, { read: true, updatedAt: stamp() })
      return [notification]
    }),

    // Everything else: signup, invites, password reset and change, org and pipeline settings, profile edits, AI.
    http.all(`${API}/*`, () => fail(400, 'NOT_AVAILABLE_IN_DEMO', NOT_AVAILABLE)),
  ]

  return { handlers, db: () => db }
}
