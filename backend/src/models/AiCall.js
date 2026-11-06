// @ts-check
// One row per AI call counted against a limit (aiBriefService): 20 per org per hour, 5 refreshes per lead per hour.
// In Mongo, not in memory, so every API process counts against the same window.
import mongoose from 'mongoose'

const { Schema } = mongoose

export const WINDOW_MS = 3_600_000

const aiCallSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    kind: { type: String, enum: ['call', 'refresh'], required: true },
    at: { type: Date, required: true },
  },
  { versionKey: false },
)

// Housekeeping only: the TTL monitor runs about once a minute, so the count filters on `at` itself.
aiCallSchema.index({ at: 1 }, { expireAfterSeconds: WINDOW_MS / 1000 })
aiCallSchema.index({ orgId: 1, kind: 1, at: 1 })
aiCallSchema.index({ orgId: 1, leadId: 1, kind: 1, at: 1 })

export default mongoose.model('AiCall', aiCallSchema)
