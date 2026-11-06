// @ts-check
// The AI lead brief: load the lead and its history (org-scoped), build the minimal bundle, answer from the cache or
// queue a job (one active job per org and key), enforce the limits, and, in the worker, call the AI service and
// re-check grounding. What leaves the API for the AI service is listed in docs/ai.md; this file is where that list
// is enforced. Nothing here is kept in process memory: the limits, the queue and the cache are in MongoDB.
import { createHash } from 'node:crypto'
import { domainToASCII } from 'node:url'

import { env } from '../config/index.js'
import Activity from '../models/Activity.js'
import AiBrief from '../models/AiBrief.js'
import AiCall, { WINDOW_MS } from '../models/AiCall.js'
import AiJob, { ACTIVE_STATES } from '../models/AiJob.js'
import { Lead } from '../models/CRM.js'
import Note from '../models/Note.js'
import { scopeFor } from '../policies/ownership.js'
import { scopedPopulate } from '../policies/references.js'
import { notFound } from '../utils/http.js'
import * as aiProxy from './aiProxyService.js'

/** @typedef {import('../types/index.js').AuthUser} AuthUser */
/** @typedef {import('../schemas/ai.js').LeadBrief} LeadBrief */
/**
 * req.log, or the worker's logger.
 * @typedef {{ info: (obj: Record<string, unknown>, msg?: string) => void, warn: (obj: Record<string, unknown>, msg?: string) => void, error: (obj: Record<string, unknown>, msg?: string) => void }} Log
 */
/**
 * What the AI service receives (docs/ai.md lists each field).
 * @typedef {object} Bundle
 * @property {string} today
 * @property {{ name: string, company: string | null, companyDomain: string | null, status: string, score: number | null, source: string | null, createdAt: string }} lead
 * @property {Record<string, unknown>[]} history
 * @property {number} truncated
 */

export const HISTORY_LIMIT = 20
export const ITEM_CHARS = 1000
export const TITLE_CHARS = 200
export const BUNDLE_CHARS = 12_000
export const ORG_CALLS_PER_HOUR = 20
export const REFRESHES_PER_LEAD_PER_HOUR = 5
// A host name in its ASCII (punycode) form: dot-separated labels of letters, digits and inner hyphens, ending in a
// letter TLD or a punycode one.
const HOST_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

/**
 * Clears the cached AI service info (tests). The limits, the queue and the cache are in MongoDB.
 * @returns {void}
 */
export function resetAiBriefState() {
  aiProxy.resetInfoCache()
}

/**
 * @param {Date | undefined} oldest The oldest call still in the window.
 * @param {Date} now
 * @returns {number} Whole minutes until it leaves the window (at least 1).
 */
const minutesLeft = (oldest, now) =>
  Math.max(1, Math.ceil(((oldest ?? now).getTime() + WINDOW_MS - now.getTime()) / 60_000))

/**
 * Counts one AI call against the org's hourly limit (and, for a refresh, the lead's). Insert first, then count: two
 * processes can't both see room for one more call. At the boundary both may be refused, never both let through.
 * The count filters on `at` itself: the TTL monitor deletes old rows only about once a minute.
 * @param {string} orgId
 * @param {import('mongoose').Types.ObjectId} leadId
 * @param {boolean} refresh
 * @returns {Promise<import('mongoose').Types.ObjectId[]>} The rows written (released again if no job is queued).
 * @throws {aiProxy.AiError} 429 AI_RATE_LIMITED
 */
async function countCall(orgId, leadId, refresh) {
  const now = new Date()
  const since = new Date(now.getTime() - WINDOW_MS)
  /** @type {import('mongoose').Types.ObjectId[]} */
  const rows = []
  /**
   * @param {'call' | 'refresh'} kind
   * @param {Record<string, unknown>} scope
   * @param {number} limit
   * @param {(minutes: number) => string} message
   * @returns {Promise<void>}
   */
  const take = async (kind, scope, limit, message) => {
    rows.push((await AiCall.create({ orgId, leadId, kind, at: now }))._id)
    const window = { ...scope, kind, at: { $gt: since } }
    if ((await AiCall.countDocuments(window)) <= limit) return
    await AiCall.deleteMany({ _id: { $in: rows } })
    const oldest = await AiCall.findOne(window).sort({ at: 1 }).select('at').lean()
    throw aiProxy.aiRateLimited(message(minutesLeft(oldest?.at, now)))
  }
  await take(
    'call',
    { orgId },
    ORG_CALLS_PER_HOUR,
    (m) => `Your workspace has used its ${ORG_CALLS_PER_HOUR} AI briefs for this hour. Try again in ${m} minutes.`,
  )
  if (refresh) {
    await take(
      'refresh',
      { orgId, leadId },
      REFRESHES_PER_LEAD_PER_HOUR,
      (m) =>
        `This brief was regenerated ${REFRESHES_PER_LEAD_PER_HOUR} times in the last hour. Try again in ${m} minutes.`,
    )
  }
  return rows
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
const cut = (text, max) => (text.length > max ? text.slice(0, max) : text)

/**
 * The company's website as the AI service may allow it: the `domain` field, lower case and without a trailing dot,
 * only if it is a real host name (`пример.рф` is one, through its punycode form). Anything else, such as a URL with a
 * path, is not sent: the brief's only allowed link is this domain, so a junk value must not widen it.
 * @param {unknown} domain
 * @returns {string | null}
 */
function websiteOf(domain) {
  if (typeof domain !== 'string') return null
  const host = domain.trim().toLowerCase().replace(/\.$/, '')
  return /^[^\s/?#@:]+$/.test(host) && HOST_NAME.test(domainToASCII(host)) ? host : null
}

/**
 * The lead and up to 20 history items, newest first, within the size cap. Only these fields leave the API: the
 * lead's name, company name and website, status, score, source and creation date; per item its id, kind, type, title, text, date
 * and status. Never an email, a phone number, a user, or any other id.
 * @param {string} orgId
 * @param {any} lead A lean lead with companyId populated.
 * @returns {Promise<{ bundle: Bundle, versions: string[][] }>} versions: [id, updatedAt] per sent item (cache key).
 */
async function buildBundle(orgId, lead) {
  const lead_ = /** @type {const} */ ('lead')
  const activityFilter = { orgId, 'linkedTo.entityType': lead_, 'linkedTo.entityId': lead._id }
  const noteFilter = { orgId, entityType: lead_, entityId: lead._id }
  const [activities, notes, activityCount, noteCount] = await Promise.all([
    Activity.find(activityFilter)
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .select('type title description dueDate startAt status createdAt updatedAt')
      .lean(),
    Note.find(noteFilter).sort({ createdAt: -1 }).limit(HISTORY_LIMIT).select('body createdAt updatedAt').lean(),
    Activity.countDocuments(activityFilter),
    Note.countDocuments(noteFilter),
  ])

  /** @type {{ id: string, kind: string, type?: string, title?: string, text: string, date: Date, status?: string, updatedAt: Date }[]} */
  const items = [
    ...activities.map((a) => ({
      id: String(a._id),
      kind: 'activity',
      type: a.type,
      title: a.title ? cut(a.title, TITLE_CHARS) : undefined,
      text: cut(a.description ?? '', ITEM_CHARS),
      date: a.dueDate ?? a.startAt ?? a.createdAt,
      status: a.status,
      updatedAt: a.updatedAt,
    })),
    ...notes.map((n) => ({
      id: String(n._id),
      kind: 'note',
      text: cut(n.body, ITEM_CHARS),
      date: n.createdAt,
      updatedAt: n.updatedAt,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  // Newest first until 20 items or the character cap: the oldest are the ones left out.
  const sent = []
  let chars = 0
  for (const item of items) {
    const size = (item.title ?? '').length + item.text.length
    if (sent.length === HISTORY_LIMIT || chars + size > BUNDLE_CHARS) break
    sent.push(item)
    chars += size
  }

  const bundle = {
    today: new Date().toISOString().slice(0, 10),
    lead: {
      name: lead.name,
      company: lead.companyId?.name ?? null,
      companyDomain: websiteOf(lead.companyId?.domain),
      status: lead.status,
      score: lead.score ?? null,
      source: lead.source ?? null,
      createdAt: new Date(lead.createdAt).toISOString(),
    },
    history: sent.map(({ updatedAt: _, date, ...item }) =>
      Object.fromEntries(
        Object.entries({ ...item, date: new Date(date).toISOString() }).filter(([, v]) => v !== undefined),
      ),
    ),
    truncated: activityCount + noteCount - sent.length,
  }
  return { bundle, versions: sent.map((item) => [item.id, new Date(item.updatedAt).toISOString()]) }
}

/**
 * sha256 of everything the brief depends on: the org, the lead (its id and last change), the company's website, each sent item's last
 * change, and the service's provider, model and prompt version. Same input, no second call; any edit or a new prompt makes a new key.
 * @param {string} orgId
 * @param {any} lead
 * @param {string | null} website The bundle's companyDomain: a company edit doesn't touch the lead's updatedAt.
 * @param {string[][]} versions
 * @param {import('../schemas/ai.js').AiInfo} info
 * @returns {string} hex digest
 */
function cacheKey(orgId, lead, website, versions, info) {
  const input = [
    orgId,
    String(lead._id),
    new Date(lead.updatedAt).toISOString(),
    website,
    versions,
    info.provider,
    info.model,
    info.promptVersion,
  ]
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

/**
 * @param {any} doc An AiBrief row.
 * @param {boolean} cached
 * @returns {Record<string, unknown>} The brief as the client gets it.
 */
export const present = (doc, cached) => ({
  ...doc.brief,
  cached,
  provider: doc.provider,
  model: doc.model,
  promptVersion: doc.promptVersion,
  truncated: doc.truncated,
  generatedAt: new Date(doc.createdAt).toISOString(),
})

/**
 * Answers a brief request: the cached brief (200), or a job for the worker (202 with its id). A request for a brief
 * that already has a queued or running job gets that job, without counting against a limit.
 * @param {AuthUser} actor
 * @param {string} leadId
 * @param {{ refresh?: boolean }} options refresh skips the cache read; the worker then replaces the entry.
 * @param {Log} log req.log: one line per request, numbers only.
 * @returns {Promise<{ status: 200, data: Record<string, unknown> } | { status: 202, data: { jobId: string } }>}
 * @throws {import('../utils/http.js').AppError} 404 for a lead outside the org; 429 AI_RATE_LIMITED; 503 when AI is off
 */
export async function requestLeadBrief(actor, leadId, { refresh = false }, log) {
  const started = Date.now()
  if (!env.aiEnabled) throw aiProxy.aiUnavailable('AI features are turned off for this workspace.')

  const lead = await Lead.findOne({ _id: leadId, orgId: actor.orgId, ...scopeFor(actor, 'lead', 'read') })
    .populate(scopedPopulate({ path: 'companyId', select: 'name domain' }, actor.orgId))
    .lean()
  if (!lead) throw notFound('Lead not found.')

  const { bundle, versions } = await buildBundle(actor.orgId, lead)
  const info = await aiProxy.info()
  const key = cacheKey(actor.orgId, lead, bundle.lead.companyDomain, versions, info)
  /**
   * @param {Record<string, unknown>} fields
   * @returns {void}
   */
  const logLine = (fields) =>
    log.info(
      {
        event: 'ai_lead_brief',
        orgId: actor.orgId,
        provider: info.provider,
        model: info.model,
        promptVersion: info.promptVersion,
        refresh,
        ...fields,
        latencyMs: Date.now() - started,
      },
      'ai lead brief',
    )

  if (!refresh) {
    const hit = await AiBrief.findOne({ orgId: actor.orgId, key }).lean()
    if (hit) {
      logLine({ cacheHit: true, outcome: 'ok' })
      return { status: 200, data: present(hit, true) }
    }
  }

  const activeJob = { orgId: actor.orgId, key, state: { $in: [...ACTIVE_STATES] } }
  /**
   * @param {unknown} id
   * @param {boolean} shared
   * @returns {{ status: 202, data: { jobId: string } }}
   */
  const queued = (id, shared) => {
    logLine({ cacheHit: false, outcome: 'queued', jobId: String(id), sharedJob: shared })
    return { status: 202, data: { jobId: String(id) } }
  }
  const joined = await AiJob.findOne(activeJob).select('_id').lean()
  if (joined) return queued(joined._id, true)

  // The limits guard what costs time or money: jobs that will reach the AI service.
  const counted = await countCall(actor.orgId, lead._id, refresh)
  try {
    const job = await AiJob.create({ orgId: actor.orgId, leadId: lead._id, key, refresh, bundle })
    return queued(job._id, false)
  } catch (err) {
    await AiCall.deleteMany({ _id: { $in: counted } })
    // Another request queued the same brief between our read and our insert (the partial unique index): join it.
    const duplicate = /** @type {{ code?: number }} */ (err).code === 11000
    const raced = duplicate ? await AiJob.findOne(activeJob).select('_id').lean() : null
    if (!raced) throw err
    return queued(raced._id, true)
  }
}

/**
 * The worker's half: one AI call for a job's bundle, with grounding checked again (only ids that were in the bundle
 * survive).
 * @param {Bundle} bundle
 * @param {AbortSignal} [signal] Aborts the call (a worker that lost the job's lease).
 * @returns {Promise<{ brief: LeadBrief, meta: import('../schemas/ai.js').AiCallMeta, rejected: number }>}
 * @throws {aiProxy.AiError}
 */
export async function generateFromBundle(bundle, signal) {
  const answer = await aiProxy.leadBrief(bundle, signal)
  const sentIds = new Set(bundle.history.map((item) => String(item.id)))
  let rejected = 0
  const citations = answer.brief.citations
    .map((c) => {
      const kept = c.sourceIds.filter((id) => sentIds.has(id))
      rejected += c.sourceIds.length - kept.length
      return { ...c, sourceIds: kept }
    })
    .filter((c) => c.sourceIds.length > 0)
  return { brief: { ...answer.brief, citations }, meta: answer.meta, rejected }
}
