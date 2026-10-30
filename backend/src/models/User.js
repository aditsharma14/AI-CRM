// @ts-check
// Account schema: credentials, org ref, role, refresh-token hashes, profile.
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

const { Schema } = mongoose

const refreshTokenSchema = new Schema(
  {
    hash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
)

const userSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['owner', 'admin', 'manager', 'member'], required: true, default: 'member' },
    avatarUrl: { type: String },
    isEmailVerified: { type: Boolean, default: false },

    // Hashed, never the raw token — rotated on every refresh (see authService).
    refreshTokens: { type: [refreshTokenSchema], default: [], select: false },

    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  {
    timestamps: true,
    // Declared here rather than assigned to userSchema.methods afterwards so
    // the type checker sees comparePassword on User documents.
    methods: {
      /**
       * Only meaningful on a document loaded with .select('+password').
       * @param {string} candidate Plaintext password from the login form.
       * @returns {Promise<boolean>}
       */
      comparePassword(candidate) {
        return bcrypt.compare(candidate, this.password)
      },
    },
  },
)

userSchema.index({ orgId: 1, role: 1 })
userSchema.index({ 'refreshTokens.hash': 1 })

// Mongoose 9 no longer forwards `next` to async middleware — returning the
// promise (or, here, implicitly awaiting) is what signals completion.
userSchema.pre('save', async function hashPasswordIfChanged() {
  if (!this.isModified('password')) return
  this.password = await bcrypt.hash(this.password, 10)
})

/** Plain field shape inferred from the schema — what services read and write. */
/** @typedef {import('mongoose').InferSchemaType<typeof userSchema>} UserRecord */

export default mongoose.model('User', userSchema)
