// @ts-check
// One row per Idempotency-Key a user sent (middleware/idempotency.js): which request it was for, whether it is still
// running, and the answer to replay. Per org and per user, kept 24 h.
import mongoose from 'mongoose'

const { Schema } = mongoose

/** How long a key stays "in progress" before a retry may take it over (the process that held it died). */
export const LEASE_MS = 60_000
export const TTL_SECONDS = 24 * 60 * 60

const idempotencyRecordSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    // sha256 of the validated body with its keys sorted (idempotencyService.hashBody).
    bodyHash: { type: String, required: true },
    state: { type: String, enum: ['in_progress', 'done'], required: true },
    lockedUntil: { type: Date, required: true },
    // Set when done: what a replay sends back. `response` is the JSON text itself, so a replay is byte for byte.
    status: { type: Number },
    headers: { type: Schema.Types.Mixed, default: undefined },
    response: { type: String },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
)

idempotencyRecordSchema.index({ orgId: 1, userId: 1, key: 1 }, { unique: true })
// Housekeeping: the TTL monitor runs about once a minute, so claim() also treats an older record as absent.
idempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: TTL_SECONDS })

/** @typedef {import('mongoose').InferSchemaType<typeof idempotencyRecordSchema>} IdempotencyRecordShape */

export default mongoose.model('IdempotencyRecord', idempotencyRecordSchema)
