// Lead, Contact, and Company schemas/models.
import mongoose from 'mongoose'

const { Schema } = mongoose

const companySchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    domain: { type: String, trim: true, lowercase: true },
    industry: { type: String, trim: true },
    size: { type: String, enum: ['1-10', '11-50', '51-200', '201-1000', '1000+'] },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
)
companySchema.index({ orgId: 1, domain: 1 })
companySchema.index({ name: 'text' })

const contactSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    title: { type: String, trim: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tags: { type: [String], default: [] },
  },
  { timestamps: true },
)
contactSchema.index({ orgId: 1, companyId: 1 })
contactSchema.index({ name: 'text', email: 'text' })

const leadSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    source: { type: String, trim: true },
    status: {
      type: String,
      enum: ['new', 'contacted', 'qualified', 'unqualified', 'converted'],
      default: 'new',
    },
    score: { type: Number, default: 0, min: 0, max: 100 },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    convertedToDealId: { type: Schema.Types.ObjectId, ref: 'Deal' },
    convertedAt: { type: Date },
  },
  { timestamps: true },
)
leadSchema.index({ orgId: 1, status: 1 })
leadSchema.index({ orgId: 1, ownerId: 1 })
leadSchema.index({ name: 'text', email: 'text' })

export const Company = mongoose.model('Company', companySchema)
export const Contact = mongoose.model('Contact', contactSchema)
export const Lead = mongoose.model('Lead', leadSchema)
