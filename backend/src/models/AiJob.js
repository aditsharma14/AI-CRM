// @ts-check
// Lead-brief jobs: POST /ai/leads/:id/brief queues one, a worker process (src/worker.js) claims and runs it, the client
// polls GET /ai/jobs/:id. The queue lives here, not in memory, so any number of API and worker processes share it.
import mongoose from 'mongoose'

const { Schema } = mongoose

export const JOB_TTL_DAYS = 7
export const ACTIVE_STATES = /** @type {const} */ (['queued', 'running'])

const aiJobSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    // The brief's cache key (aiBriefService.cacheKey): one active job per (org, key) is the single-flight.
    key: { type: String, required: true },
    refresh: { type: Boolean, default: false },
    state: { type: String, enum: ['queued', 'running', 'done', 'failed'], required: true, default: 'queued' },
    attempts: { type: Number, default: 0 },
    lockedBy: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    // The first claim's time: createdAt to startedAt is the queue latency. No default: absent until claimed, so the
    // claim's $min sets it once.
    startedAt: { type: Date },
    finishedAt: { type: Date, default: null },
    briefId: { type: Schema.Types.ObjectId, ref: 'AiBrief', default: null },
    error: { type: new Schema({ code: String, message: String }, { _id: false }), default: null },
    // Exactly what the cache key was computed from, so the worker sends that. Holds lead history text: unset on every
    // path that ends the job (done, failed, the reaper, lead deletion).
    bundle: { type: Schema.Types.Mixed, default: undefined },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
)

aiJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: JOB_TTL_DAYS * 24 * 60 * 60 })
aiJobSchema.index(
  { orgId: 1, key: 1 },
  { unique: true, partialFilterExpression: { state: { $in: [...ACTIVE_STATES] } }, name: 'one_active_job_per_key' },
)
// The claim: queued jobs, or running ones whose lease ran out, oldest first (FIFO). Both $or branches read this
// index in createdAt order, so the planner merges them instead of sorting.
aiJobSchema.index({ state: 1, createdAt: 1, lockedUntil: 1 })
// The reaper: running jobs whose lease ran out.
aiJobSchema.index({ state: 1, lockedUntil: 1 })
// Queue stats (owners): an org's queued jobs, oldest first.
aiJobSchema.index({ orgId: 1, state: 1, createdAt: 1 })
aiJobSchema.index({ orgId: 1, leadId: 1 })

/** @typedef {import('mongoose').InferSchemaType<typeof aiJobSchema>} AiJobRecord */

export default mongoose.model('AiJob', aiJobSchema)
