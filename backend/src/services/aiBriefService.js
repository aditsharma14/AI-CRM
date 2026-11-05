// @ts-check
// The AI lead brief: load the lead and its history (org-scoped), build the minimal bundle, answer from the cache or
// one shared in-flight call, enforce the limits, re-check grounding, cache the result, and log one line per call.
// What leaves the API for the AI service is listed in docs/ai.md; this file is where that list is enforced.
import { createHash } from 'node:crypto'
import { domainToASCII } from 'node:url'

import { env } from '../config/index.js'
import Activity from '../models/Activity.js'
import AiBrief from '../models/AiBrief.js'
import { Lead } from '../models/CRM.js'
import Note from '../models/Note.js'
import { scopeFor } from '../policies/ownership.js'
import { scopedPopulate } from '../policies/references.js'
import { notFound } from '../utils/http.js'
import * as aiProxy from './aiProxyService.js'

/** @typedef {import('../types/index.js').AuthUser} AuthUser */
/** @typedef {import('../schemas/ai.js').LeadBrief} LeadBrief */
/** @typedef {{ info: (obj: Record<string, unknown>, msg?: string) => void }} Log */
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
const HOUR_MS = 3_600_000
// A host name in its ASCII (punycode) form: dot-separated labels of letters, digits and inner hyphens, ending in a
// letter TLD or a punycode one.
const HOST_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

// In-memory, per process: correct for the one API instance compose runs (docs/known-issues.md: not shared across
// replicas). Only calls that reach the AI service count; cache hits and joined in-flight calls are free.
/** @type {Map<string, number[]>} */
const orgCalls = new Map()
/** @type {Map<string, number[]>} */
const leadRefreshes = new Map()
/** One shared promise per (org, cache key): a double click or two tabs make one AI call. @type {Map<string, Promise<any>>} */
const inFlight = new Map()

/**
 * Clears the limits, the in-flight table and the cached service info (tests).
 * @returns {void}
 */
export function resetAiBriefState() {
  orgCalls.clear()
  leadRefreshes.clear()
  inFlight.clear()
  aiProxy.resetInfoCache()
}

/**
 * Timestamps in the last hour, pruned.
 * @param {Map<string, number[]>} map
 * @param {string} key
 * @param {number} now
 * @returns {number[]} The window, still in the map (push to it to count a call).
 */
function lastHour(map, key, now) {
  const kept = (map.get(key) ?? []).filter((t) => now - t < HOUR_MS)
  map.set(key, kept)
  return kept
}

/**
 * @param {number[]} window
 * @param {number} now
 * @returns {number} Whole minutes until the oldest call leaves the window (at least 1).
 */
const minutesLeft = (window, now) => Math.max(1, Math.ceil(((window[0] ?? now) + HOUR_MS - now) / 60_000))

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
const present = (doc, cached) => ({
  ...doc.brief,
  cached,
  provider: doc.provider,
  model: doc.model,
  promptVersion: doc.promptVersion,
  truncated: doc.truncated,
  generatedAt: new Date(doc.createdAt).toISOString(),
})

/**
 * Generates (or serves from the cache) the brief for one lead.
 * @param {AuthUser} actor
 * @param {string} leadId
 * @param {{ refresh?: boolean }} options refresh skips the cache read and replaces the entry.
 * @param {Log} log req.log: one line per call, numbers only.
 * @returns {Promise<Record<string, unknown>>}
 * @throws {import('../utils/http.js').AppError} 404 for a lead outside the org; AI_* errors from aiProxyService
 */
export async function generateLeadBrief(actor, leadId, { refresh = false }, log) {
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
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        citationsRejected: 0,
        ...fields,
        latencyMs: Date.now() - started,
      },
      'ai lead brief',
    )

  if (!refresh) {
    const hit = await AiBrief.findOne({ orgId: actor.orgId, key }).lean()
    if (hit) {
      logLine({ cacheHit: true, outcome: 'ok' })
      return present(hit, true)
    }
  }

  const flightKey = `${actor.orgId}:${key}`
  const shared = inFlight.get(flightKey)
  if (shared) {
    const doc = await shared
    logLine({ cacheHit: false, sharedCall: true, outcome: 'ok' })
    return present(doc, false)
  }

  // The limits guard what costs time or money: calls that reach the AI service.
  const now = Date.now()
  const orgWindow = lastHour(orgCalls, actor.orgId, now)
  if (orgWindow.length >= ORG_CALLS_PER_HOUR) {
    throw aiProxy.aiRateLimited(
      `Your workspace has used its ${ORG_CALLS_PER_HOUR} AI briefs for this hour. Try again in ${minutesLeft(orgWindow, now)} minutes.`,
    )
  }
  const leadWindow = lastHour(leadRefreshes, `${actor.orgId}:${leadId}`, now)
  if (refresh && leadWindow.length >= REFRESHES_PER_LEAD_PER_HOUR) {
    throw aiProxy.aiRateLimited(
      `This brief was regenerated ${REFRESHES_PER_LEAD_PER_HOUR} times in the last hour. Try again in ${minutesLeft(leadWindow, now)} minutes.`,
    )
  }
  orgWindow.push(now)
  if (refresh) leadWindow.push(now)

  const call = (async () => {
    const answer = await aiProxy.leadBrief(bundle)
    // Grounding, checked again here: only ids that were in the bundle survive.
    const sentIds = new Set(bundle.history.map((item) => String(item.id)))
    let rejected = 0
    const citations = answer.brief.citations
      .map((c) => {
        const kept = c.sourceIds.filter((id) => sentIds.has(id))
        rejected += c.sourceIds.length - kept.length
        return { ...c, sourceIds: kept }
      })
      .filter((c) => c.sourceIds.length > 0)
    const row = {
      orgId: actor.orgId,
      leadId: lead._id,
      key,
      brief: { ...answer.brief, citations },
      provider: answer.meta.provider,
      model: answer.meta.model,
      promptVersion: answer.meta.promptVersion,
      truncated: bundle.truncated,
      createdAt: new Date(),
    }
    // A lead deleted while its brief was being written must not get a row back.
    if (await Lead.exists({ _id: lead._id, orgId: actor.orgId })) {
      await AiBrief.updateOne({ orgId: actor.orgId, key }, { $set: row }, { upsert: true })
    }
    return { row, meta: answer.meta, rejected }
  })()
  inFlight.set(
    flightKey,
    call.then(({ row }) => row),
  )
  inFlight.get(flightKey)?.catch(() => {}) // joiners see the error through their own await

  try {
    const { row, meta, rejected } = await call
    logLine({
      cacheHit: false,
      outcome: 'ok',
      provider: meta.provider,
      model: meta.model,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      costUsd: meta.costUsd,
      aiLatencyMs: meta.latencyMs,
      firstTokenMs: meta.firstTokenMs,
      attempts: meta.attempts,
      citationsRejected: meta.citationsRejected + rejected,
    })
    return present(row, false)
  } catch (err) {
    const failed = err instanceof aiProxy.AiError ? err : null
    logLine({
      cacheHit: false,
      outcome: failed?.code ?? 'error',
      inputTokens: failed?.meta?.inputTokens ?? 0,
      outputTokens: failed?.meta?.outputTokens ?? 0,
      attempts: failed?.meta?.attempts,
    })
    throw err
  } finally {
    inFlight.delete(flightKey)
  }
}
