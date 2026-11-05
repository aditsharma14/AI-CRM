// @ts-check
// Typed HTTP client to the FastAPI AI service: the internal token, the time limit, its answers re-validated, and its
// failures turned into our three error codes (AI_UNAVAILABLE 503, AI_RATE_LIMITED 429, AI_BAD_OUTPUT 502).
import { env } from '../config/index.js'
import { aiInfo, leadBriefAnswer } from '../schemas/ai.js'
import { AppError } from '../utils/http.js'

/** @typedef {import('../schemas/ai.js').AiInfo} AiInfo */
/** @typedef {import('../schemas/ai.js').LeadBrief} LeadBrief */
/** @typedef {import('../schemas/ai.js').AiCallMeta} AiCallMeta */

// The AI service gets AI_TIMEOUT_MS (X-Deadline-Ms) for the whole brief; Express waits a little longer, so the
// service's typed TIMEOUT or BAD_OUTPUT normally arrives first and the abort is only the backstop.
export const ABORT_MARGIN_MS = 1000
const INFO_TTL_MS = 5 * 60_000

/** An AI failure the client sees. `meta` (token counts, never content) is for the log line only. */
export class AiError extends AppError {
  /**
   * @param {number} status
   * @param {'AI_UNAVAILABLE' | 'AI_RATE_LIMITED' | 'AI_BAD_OUTPUT'} code
   * @param {string} message
   * @param {Partial<AiCallMeta> | null} [meta]
   */
  constructor(status, code, message, meta = null) {
    super(status, code, message)
    this.meta = meta
  }
}

/**
 * @param {string} message Safe to show to the client.
 * @param {Partial<AiCallMeta> | null} [meta] Token counts for the log line.
 * @returns {AiError}
 */
export const aiUnavailable = (message, meta) => new AiError(503, 'AI_UNAVAILABLE', message, meta)
/**
 * @param {string} message Safe to show to the client.
 * @param {Partial<AiCallMeta> | null} [meta] Token counts for the log line.
 * @returns {AiError}
 */
export const aiRateLimited = (message, meta) => new AiError(429, 'AI_RATE_LIMITED', message, meta)
/**
 * @param {string} message Safe to show to the client.
 * @param {Partial<AiCallMeta> | null} [meta] Token counts for the log line.
 * @returns {AiError}
 */
export const aiBadOutput = (message, meta) => new AiError(502, 'AI_BAD_OUTPUT', message, meta)

const TOO_LONG = 'The AI took too long to answer. Try again in a moment.'
const DOWN = 'The AI service is not available right now. Try again later.'

/** @type {{ value: AiInfo, at: number, url: string } | null} */
let infoCache = null

/**
 * Forgets the cached /v1/info answer (tests; a changed AI_SERVICE_URL also misses it).
 * @returns {void}
 */
export function resetInfoCache() {
  infoCache = null
}

/**
 * @param {string} path
 * @param {{ method: string, headers?: Record<string, string>, body?: string }} init
 * @returns {Promise<Response>}
 * @throws {AiError} AI_UNAVAILABLE when unreachable or too slow
 */
async function call(path, init) {
  try {
    return await fetch(`${env.aiServiceUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: { ...init.headers, 'x-internal-token': env.aiInternalToken ?? '' },
      signal: AbortSignal.timeout(env.aiTimeoutMs + ABORT_MARGIN_MS),
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    throw aiUnavailable(name === 'TimeoutError' || name === 'AbortError' ? TOO_LONG : DOWN)
  }
}

/**
 * @param {Response} res
 * @returns {Promise<unknown>} The parsed body, or null when it isn't JSON.
 */
const jsonOf = (res) => res.json().catch(() => null)

/**
 * What decides a brief besides its input (provider, model, prompt version), cached for 5 minutes.
 * @returns {Promise<AiInfo>}
 * @throws {AiError} AI_UNAVAILABLE
 */
export async function info() {
  if (infoCache && infoCache.url === env.aiServiceUrl && Date.now() - infoCache.at < INFO_TTL_MS) {
    return infoCache.value
  }
  const res = await call('/v1/info', { method: 'GET' })
  const parsed = aiInfo.safeParse(res.ok ? await jsonOf(res) : null)
  if (!parsed.success) throw aiUnavailable(DOWN)
  infoCache = { value: parsed.data, at: Date.now(), url: env.aiServiceUrl }
  return parsed.data
}

/**
 * @param {unknown} bundle The minimal lead bundle (aiBriefService.buildBundle).
 * @returns {Promise<{ brief: LeadBrief, meta: AiCallMeta }>}
 * @throws {AiError}
 */
export async function leadBrief(bundle) {
  const res = await call('/v1/lead-brief', {
    method: 'POST',
    // The time this request has before `call` aborts it (less the margin): the service skips a retry that couldn't
    // finish in it and answers BAD_OUTPUT, instead of being cut off mid-attempt.
    headers: { 'content-type': 'application/json', 'x-deadline-ms': String(env.aiTimeoutMs) },
    body: JSON.stringify(bundle),
  })
  const json = await jsonOf(res)
  if (res.ok) {
    const parsed = leadBriefAnswer.safeParse(json)
    if (!parsed.success) throw aiBadOutput('The AI returned a brief we could not use. Try again.')
    return parsed.data
  }
  const body = /** @type {{ error?: { code?: string }, meta?: Partial<AiCallMeta> } | null} */ (json)
  const code = body?.error?.code
  const meta = body?.meta ?? null
  if (res.status === 429 || code === 'RATE_LIMITED') {
    throw aiRateLimited('The AI model is busy. Try again in a minute.', meta)
  }
  if (code === 'BAD_OUTPUT') throw aiBadOutput('The AI could not write a usable brief for this lead. Try again.', meta)
  if (code === 'TIMEOUT') throw aiUnavailable(TOO_LONG, meta)
  throw aiUnavailable(DOWN, meta)
}
