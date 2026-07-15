// Pipeline opportunity: value, stage, probability, forecast fields.
import mongoose from 'mongoose'

const { Schema } = mongoose

const dealSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    value: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD' },

    // Resolved against the parent org's embedded pipelineStages — validated
    // in dealsService, not here (that requires reading a second document).
    stageKey: { type: String, required: true },
    probability: { type: Number, min: 0, max: 100, default: 50 },

    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    contactIds: [{ type: Schema.Types.ObjectId, ref: 'Contact' }],
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    convertedFromLeadId: { type: Schema.Types.ObjectId, ref: 'Lead' },

    status: { type: String, enum: ['open', 'won', 'lost'], default: 'open' },
    wonLostReason: { type: String, trim: true },
    closedAt: { type: Date },
  },
  { timestamps: true },
)

dealSchema.index({ orgId: 1, stageKey: 1 })
dealSchema.index({ orgId: 1, ownerId: 1 })
dealSchema.index({ orgId: 1, closedAt: 1 })

export default mongoose.model('Deal', dealSchema)
