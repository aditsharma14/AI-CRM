// Tenant root: profile, embedded teams[], pipelineStages[], emailTemplates[].
import mongoose from 'mongoose'

const { Schema } = mongoose

// Small, low-cardinality, always read with the org — embedded rather than
// referenced collections (see the architecture spec §07).
const teamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    memberIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
)

const pipelineStageSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    order: { type: Number, required: true },
  },
  { _id: false },
)

const emailTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
  },
  { timestamps: true },
)

const inviteTokenSchema = new Schema(
  {
    tokenHash: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ['admin', 'manager', 'member'], required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
)

const DEFAULT_PIPELINE_STAGES = [
  { key: 'new', label: 'New', order: 0 },
  { key: 'qualified', label: 'Qualified', order: 1 },
  { key: 'proposal', label: 'Proposal', order: 2 },
  { key: 'negotiation', label: 'Negotiation', order: 3 },
  { key: 'won', label: 'Closed Won', order: 4 },
  { key: 'lost', label: 'Closed Lost', order: 5 },
]

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    plan: { type: String, enum: ['trial', 'pro', 'enterprise'], default: 'trial' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },

    teams: { type: [teamSchema], default: [] },
    pipelineStages: { type: [pipelineStageSchema], default: () => DEFAULT_PIPELINE_STAGES },
    emailTemplates: { type: [emailTemplateSchema], default: [] },
    inviteTokens: { type: [inviteTokenSchema], default: [], select: false },
  },
  { timestamps: true },
)

organizationSchema.index({ 'inviteTokens.tokenHash': 1 })

export default mongoose.model('Organization', organizationSchema)
