// ActivityLog (audit trail) and Notification schemas.
import mongoose from 'mongoose'

const { Schema } = mongoose
const options = { discriminatorKey: 'kind', timestamps: true }

// One collection, two append-only shapes — mirrors Activity.js's type
// discriminator, split here by `kind` instead (see architecture spec §07).
const logSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    entityType: { type: String, enum: ['lead', 'contact', 'company', 'deal', 'activity', 'note'] },
    entityId: { type: Schema.Types.ObjectId },
    message: { type: String, required: true },
  },
  options,
)

logSchema.index({ orgId: 1, createdAt: -1 })
// Notifications age out after 90 days; activity_log entries persist for audit.
logSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90, partialFilterExpression: { kind: 'notification' } },
)

export const Log = mongoose.model('Log', logSchema)

export const ActivityLog = Log.discriminator(
  'activity_log',
  new Schema({ action: { type: String, required: true } }, options),
)

export const Notification = Log.discriminator(
  'notification',
  new Schema({ read: { type: Boolean, default: false, index: true } }, options),
)
