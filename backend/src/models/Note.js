// Polymorphic note: entityType, entityId, body, authorId.
import mongoose from 'mongoose'

const { Schema } = mongoose

const noteSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    entityType: { type: String, enum: ['lead', 'contact', 'company', 'deal'], required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

noteSchema.index({ orgId: 1, entityType: 1, entityId: 1, createdAt: -1 })

export default mongoose.model('Note', noteSchema)
