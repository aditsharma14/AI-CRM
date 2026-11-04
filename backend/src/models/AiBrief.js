// @ts-check
// Cached AI lead briefs. One row per (org, cache key); rows expire after 7 days and go when their lead is deleted.
import mongoose from 'mongoose'

const { Schema } = mongoose

const CACHE_DAYS = 7

const aiBriefSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    // sha256 of everything the brief depends on (aiBriefService.cacheKey); never shown to clients.
    key: { type: String, required: true },
    brief: {
      summary: { type: String, required: true },
      nextAction: { action: { type: String, required: true }, dueDate: { type: String, required: true } },
      followUpEmail: { subject: { type: String, required: true }, body: { type: String, required: true } },
      citations: [{ _id: false, claim: { type: String, required: true }, sourceIds: [String] }],
    },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    promptVersion: { type: String, required: true },
    truncated: { type: Number, default: 0 },
    // Set on every write (a refresh replaces the row), so the TTL counts from the latest generation.
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
)

aiBriefSchema.index({ orgId: 1, key: 1 }, { unique: true })
aiBriefSchema.index({ orgId: 1, leadId: 1 })
aiBriefSchema.index({ createdAt: 1 }, { expireAfterSeconds: CACHE_DAYS * 24 * 60 * 60 })

/** @typedef {import('mongoose').InferSchemaType<typeof aiBriefSchema>} AiBriefRecord */

export default mongoose.model('AiBrief', aiBriefSchema)
