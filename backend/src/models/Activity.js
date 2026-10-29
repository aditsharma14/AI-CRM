// @ts-check
// Discriminated Task/CalendarEvent schema via a type enum.
import mongoose from 'mongoose'

const { Schema } = mongoose

const activitySchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    type: { type: String, enum: ['task', 'event', 'call', 'meeting'], required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Polymorphic: points at whichever lead/contact/company/deal this is
    // attached to, without a schema per relation.
    linkedTo: {
      entityType: { type: String, enum: ['lead', 'contact', 'company', 'deal'] },
      entityId: { type: Schema.Types.ObjectId },
    },

    // Task-shaped fields
    dueDate: { type: Date },
    priority: { type: String, enum: ['low', 'medium', 'high'] },

    // Calendar-shaped fields
    startAt: { type: Date },
    endAt: { type: Date },
    allDay: { type: Boolean, default: false },

    status: { type: String, enum: ['open', 'done'], default: 'open' },
  },
  { timestamps: true },
)

activitySchema.index({ orgId: 1, assigneeId: 1, dueDate: 1 })
activitySchema.index({ orgId: 1, type: 1, startAt: 1 })

/** Plain field shape inferred from the schema — what services read and write. */
/** @typedef {import('mongoose').InferSchemaType<typeof activitySchema>} ActivityRecord */

export default mongoose.model('Activity', activitySchema)
