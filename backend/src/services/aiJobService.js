// @ts-check
// The lead-brief job queue in MongoDB: claim (atomic, oldest first), run with a heartbeat on the lease, finish in one
// transaction with the brief, retry once, reap jobs whose last lease ran out, and answer the client's polls. Any number
// of worker processes (src/worker.js) share it; a crashed worker's job is taken over once its lease runs out.
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

import mongoose from 'mongoose'

import { env } from '../config/index.js'
import AiBrief from '../models/AiBrief.js'
import AiJob from '../models/AiJob.js'
import { notFound } from '../utils/http.js'
import { generateFromBundle, present } from './aiBriefService.js'
import { AiError } from './aiProxyService.js'

/** @typedef {import('../types/index.js').AuthUser} AuthUser */
/** @typedef {import('./aiBriefService.js').Log} Log */
/** @typedef {import('../models/AiJob.js').AiJobRecord & { _id: import('mongoose').Types.ObjectId }} Job */
/** @typedef {'done' | 'failed' | 'requeued' | 'lost'} RunOutcome */

export const MAX_ATTEMPTS = 2
// Worth a second attempt: the AI service was down or too slow. Bad output was already retried inside the AI
// service, and a busy model shouldn't be asked again at once.
const RETRYABLE = new Set(['AI_UNAVAILABLE'])
const GAVE_UP = { code: 'AI_UNAVAILABLE', message: 'The brief could not be generated. Try again in a moment.' }
const RELEASED = { lockedBy: null, lockedUntil: null }
const CLAIM_INDEX = { state: 1, createdAt: 1, lockedUntil: 1 }

/** Thrown inside the finishing transaction when this worker no longer holds the job. */
class LostLease extends Error {}

/** @returns {string} host:pid:random, unique per worker process. */
export const newWorkerId = () => `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`

/**
 * Takes the oldest job that is queued, or running on a lease that ran out (its worker died), and holds it for
 * `leaseMs`. One findOneAndUpdate: two workers can never both get the same job.
 * @param {string} workerId
 * @param {{ leaseMs?: number }} [options]
 * @returns {Promise<Job | null>}
 */
export async function claimNext(workerId, { leaseMs = env.aiJobLeaseMs } = {}) {
  const now = new Date()
  const job = await AiJob.findOneAndUpdate(
    {
      // Queued, or running on a lease that ran out. Written as one $in on state (the index walks both states in
      // createdAt order and merges them) plus a filter; a top-level $or lets the planner pick {state, lockedUntil}
      // per branch and sort every candidate in memory.
      state: { $in: ['queued', 'running'] },
      $or: [{ state: 'queued' }, { lockedUntil: { $lt: now } }],
      attempts: { $lt: MAX_ATTEMPTS },
    },
    {
      $set: { state: 'running', lockedBy: workerId, lockedUntil: new Date(now.getTime() + leaseMs) },
      $inc: { attempts: 1 },
      // Set by the first claim (the field is absent until then) and kept by a reclaim: queue latency is createdAt to
      // the first start.
      $min: { startedAt: now },
    },
    // FIFO. The hint keeps the plan from depending on what the planner sampled (query-plans.test.js checks it).
    { sort: { createdAt: 1 }, returnDocument: 'after', hint: CLAIM_INDEX },
  ).lean()
  return /** @type {Job | null} */ (job)
}

/**
 * Fails the jobs whose last attempt's lease ran out (their worker died twice), and drops their bundles.
 * @returns {Promise<number>} How many.
 */
export async function reapExpired() {
  const now = new Date()
  const res = await AiJob.updateMany(
    { state: 'running', lockedUntil: { $lt: now }, attempts: { $gte: MAX_ATTEMPTS } },
    { $set: { state: 'failed', error: GAVE_UP, finishedAt: now, ...RELEASED }, $unset: { bundle: 1 } },
  )
  return res.modifiedCount
}

/**
 * Runs one claimed job: the AI call, with a heartbeat that renews the lease. If a heartbeat finds the job taken (its
 * lease ran out and another worker has it, or its lead was deleted), the call is aborted and nothing is written. The
 * brief and the job's `done` are written in one transaction, on the condition that this worker still holds the job.
 * @param {Job} job As claimNext returned it.
 * @param {{ workerId: string, leaseMs?: number, log: Log }} options
 * @returns {Promise<RunOutcome>}
 */
export async function runJob(job, { workerId, leaseMs = env.aiJobLeaseMs, log }) {
  const started = Date.now()
  const mine = { _id: job._id, lockedBy: workerId, state: /** @type {const} */ ('running') }
  const controller = new AbortController()
  let lost = false
  const heartbeat = setInterval(
    async () => {
      try {
        const res = await AiJob.updateOne(mine, { $set: { lockedUntil: new Date(Date.now() + leaseMs) } })
        if (res.matchedCount === 0) {
          lost = true
          controller.abort()
        }
      } catch {
        // A missed beat is covered by the rest of the lease; the next one tries again.
      }
    },
    Math.max(20, Math.floor(leaseMs / 3)),
  )
  /**
   * One line per job run, numbers only (S2.6 builds its metrics on these).
   * @param {'info' | 'warn'} level
   * @param {Record<string, unknown>} fields
   * @returns {void}
   */
  const logLine = (level, fields) =>
    log[level](
      {
        event: 'ai_lead_job',
        jobId: String(job._id),
        orgId: String(job.orgId),
        workerId,
        attempts: job.attempts,
        queueMs: job.startedAt ? new Date(job.startedAt).getTime() - new Date(job.createdAt).getTime() : null,
        runMs: Date.now() - started,
        ...fields,
      },
      'ai lead job',
    )

  try {
    const { brief, meta, rejected } = await generateFromBundle(
      /** @type {import('./aiBriefService.js').Bundle} */ (job.bundle),
      controller.signal,
    )
    if (lost) throw new LostLease()
    await AiJob.db.transaction(async (session) => {
      const row = await AiBrief.findOneAndUpdate(
        { orgId: job.orgId, key: job.key },
        {
          $set: {
            orgId: job.orgId,
            leadId: job.leadId,
            key: job.key,
            brief,
            provider: meta.provider,
            model: meta.model,
            promptVersion: meta.promptVersion,
            truncated: /** @type {{ truncated?: number }} */ (job.bundle).truncated ?? 0,
            // Every write: the cache TTL counts from the latest generation.
            createdAt: new Date(),
          },
        },
        { upsert: true, returnDocument: 'after', session },
      )
      const done = await AiJob.updateOne(
        mine,
        { $set: { state: 'done', briefId: row._id, finishedAt: new Date(), ...RELEASED }, $unset: { bundle: 1 } },
        { session },
      )
      if (done.matchedCount === 0) throw new LostLease()
    })
    logLine('info', {
      outcome: 'done',
      provider: meta.provider,
      model: meta.model,
      promptVersion: meta.promptVersion,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      costUsd: meta.costUsd,
      aiLatencyMs: meta.latencyMs,
      firstTokenMs: meta.firstTokenMs,
      aiAttempts: meta.attempts,
      citationsRejected: meta.citationsRejected + rejected,
    })
    return 'done'
  } catch (err) {
    if (lost || err instanceof LostLease) {
      logLine('warn', { outcome: 'lost' })
      return 'lost'
    }
    const known = err instanceof AiError ? err : null
    if (!known) log.error({ err, jobId: String(job._id) }, 'ai lead job: unexpected error')
    const error = known ? { code: known.code, message: known.message } : GAVE_UP
    const retry = RETRYABLE.has(error.code) && job.attempts < MAX_ATTEMPTS
    const res = await AiJob.updateOne(
      mine,
      retry
        ? { $set: { state: 'queued', ...RELEASED } }
        : { $set: { state: 'failed', error, finishedAt: new Date(), ...RELEASED }, $unset: { bundle: 1 } },
    )
    const outcome = res.matchedCount === 0 ? 'lost' : retry ? 'requeued' : 'failed'
    logLine('warn', {
      outcome: outcome === 'failed' ? error.code : outcome,
      inputTokens: known?.meta?.inputTokens ?? 0,
      outputTokens: known?.meta?.outputTokens ?? 0,
    })
    return outcome
  } finally {
    clearInterval(heartbeat)
  }
}

/**
 * Claims and runs jobs until none is left (tests and the queue bench; the worker process uses startWorker).
 * @param {{ workerId?: string, leaseMs?: number, log: Log }} options
 * @returns {Promise<number>} Jobs run.
 */
export async function drain({ workerId = newWorkerId(), leaseMs = env.aiJobLeaseMs, log }) {
  let ran = 0
  for (;;) {
    await reapExpired()
    const job = await claimNext(workerId, { leaseMs })
    if (!job) return ran
    await runJob(job, { workerId, leaseMs, log })
    ran += 1
  }
}

/**
 * The worker loop: claim and run until the queue is empty, then wait `pollMs`. stop() lets the job in hand finish,
 * claims nothing more, and resolves once the loop has ended.
 * @param {{ workerId?: string, leaseMs?: number, pollMs?: number, log: Log }} options
 * @returns {{ workerId: string, stop: () => Promise<void> }}
 */
export function startWorker({
  workerId = newWorkerId(),
  leaseMs = env.aiJobLeaseMs,
  pollMs = env.aiWorkerPollMs,
  log,
}) {
  let stopping = false
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  /** @type {(() => void) | undefined} */
  let wake
  const loop = (async () => {
    while (!stopping) {
      try {
        await reapExpired()
        const job = await claimNext(workerId, { leaseMs })
        if (job) {
          await runJob(job, { workerId, leaseMs, log })
          continue
        }
      } catch (err) {
        log.error({ err, workerId }, 'ai worker: tick failed')
      }
      if (stopping) break
      await new Promise((resolve) => {
        wake = () => resolve(undefined)
        timer = setTimeout(wake, pollMs)
      })
    }
  })()
  return {
    workerId,
    stop: async () => {
      stopping = true
      clearTimeout(timer)
      wake?.()
      await loop
    },
  }
}

/**
 * A job as its client sees it: its state, and the brief once done or the typed error once failed.
 * @param {AuthUser} actor
 * @param {string} jobId
 * @returns {Promise<{ state: string, brief?: Record<string, unknown>, error?: { code: string, message: string } }>}
 * @throws {import('../utils/http.js').AppError} 404 for an unknown job or another org's
 */
export async function getJob(actor, jobId) {
  const job = await AiJob.findOne({ _id: jobId, orgId: actor.orgId }).select('state briefId error').lean()
  if (!job) throw notFound('Job not found.')
  if (job.state === 'failed') {
    return { state: 'failed', error: { code: job.error?.code ?? GAVE_UP.code, message: job.error?.message ?? '' } }
  }
  if (job.state !== 'done') return { state: job.state }
  const brief = await AiBrief.findOne({ _id: job.briefId, orgId: actor.orgId }).lean()
  // Gone since (its lead was deleted, or the cache entry expired): say so instead of an empty brief.
  if (!brief) return { state: 'failed', error: { code: 'NOT_FOUND', message: 'This brief is no longer available.' } }
  return { state: 'done', brief: present(brief, false) }
}

/**
 * The org's queue, for its owner: queued and running counts and how long the oldest queued job has waited.
 * @param {AuthUser} actor
 * @returns {Promise<{ queued: number, running: number, oldestQueuedMs: number | null }>}
 */
export async function queueStats(actor) {
  const orgId = new mongoose.Types.ObjectId(actor.orgId)
  const [queued, running, oldest] = await Promise.all([
    AiJob.countDocuments({ orgId, state: 'queued' }),
    AiJob.countDocuments({ orgId, state: 'running' }),
    AiJob.findOne({ orgId, state: 'queued' }).sort({ createdAt: 1 }).select('createdAt').lean(),
  ])
  return { queued, running, oldestQueuedMs: oldest ? Date.now() - new Date(oldest.createdAt).getTime() : null }
}
