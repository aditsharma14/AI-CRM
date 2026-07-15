// Credential checks, token issuance/rotation, password reset tokens.
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import Organization from '../models/Organization.js'
import { env } from '../config/index.js'
import { badRequest, unauthorized } from '../utils/http.js'

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex')

function signAccessToken(user) {
  return jwt.sign({ sub: user._id.toString(), orgId: user.orgId.toString(), role: user.role }, env.jwtAccessSecret, {
    expiresIn: env.accessTokenTtl,
  })
}

function serializeUser(user) {
  const org = user.orgId && typeof user.orgId === 'object' ? user.orgId : null
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
    org: org ? { id: org._id, name: org.name, plan: org.plan } : { id: user.orgId },
  }
}

/**
 * Issues a fresh access token + rotated refresh token, persists the new hash.
 *
 * Adds the new hash via an atomic $push (User.updateOne) rather than
 * `user.save()`. save() relies on Mongoose's version-key optimistic
 * concurrency check, which throws if the document changed since it was
 * fetched — exactly what happens when two requests race to refresh (or log
 * in) at nearly the same instant, e.g. two browser tabs loading together,
 * or React's StrictMode double-invoking an effect in development. $push
 * has no such conflict: both requests' new tokens land safely either way.
 */
async function issueSession(user) {
  const rawRefresh = crypto.randomBytes(40).toString('hex')
  await User.updateOne({ _id: user._id }, { $push: { refreshTokens: { hash: hashToken(rawRefresh) } } })
  // Sign while orgId is still a raw ObjectId — populating first would make
  // `.toString()` below serialize the whole populated document instead.
  const accessToken = signAccessToken(user)
  await user.populate('orgId', 'name plan')
  return { accessToken, rawRefresh, user: serializeUser(user) }
}

export async function registerOrg({ orgName, name, email, password }) {
  const existing = await User.findOne({ email })
  if (existing) throw badRequest('An account with this email already exists.', 'EMAIL_TAKEN')

  // No multi-document transaction here (a standalone/local Mongo may lack a
  // replica set) — an acceptable MVP tradeoff; see the architecture spec §21.
  const org = await Organization.create({ name: orgName })
  const user = await User.create({ orgId: org._id, name, email, password, role: 'owner', isEmailVerified: true })
  org.ownerId = user._id
  await org.save()

  return issueSession(user)
}

export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+password +refreshTokens')
  if (!user || !(await user.comparePassword(password))) {
    throw unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS')
  }
  return issueSession(user)
}

export async function refresh(rawRefreshToken) {
  if (!rawRefreshToken) throw unauthorized('Missing refresh token.')
  const hash = hashToken(rawRefreshToken)

  // Atomic find-and-remove: only the request that actually matches and
  // pulls this exact hash "wins" it. A second, concurrent request presenting
  // the same (already-rotated-away) token now correctly gets a clean 401
  // instead of racing the first request's write (see issueSession above).
  const user = await User.findOneAndUpdate({ 'refreshTokens.hash': hash }, { $pull: { refreshTokens: { hash } } })
  if (!user) throw unauthorized('Invalid or expired refresh token.')

  return issueSession(user)
}

export async function logout(rawRefreshToken) {
  if (!rawRefreshToken) return
  const hash = hashToken(rawRefreshToken)
  await User.updateOne({ 'refreshTokens.hash': hash }, { $pull: { refreshTokens: { hash } } })
}

export async function acceptInvite({ token, name, password }) {
  const hash = hashToken(token)
  const org = await Organization.findOne({ 'inviteTokens.tokenHash': hash }).select('+inviteTokens')
  const invite = org?.inviteTokens.find((t) => t.tokenHash === hash)
  if (!org || !invite || invite.expiresAt < new Date()) {
    throw badRequest('This invite is invalid or has expired.', 'INVALID_INVITE')
  }

  const existing = await User.findOne({ email: invite.email })
  if (existing) throw badRequest('An account with this email already exists.', 'EMAIL_TAKEN')

  const user = await User.create({
    orgId: org._id,
    name,
    email: invite.email,
    password,
    role: invite.role,
    isEmailVerified: true,
  })
  org.inviteTokens = org.inviteTokens.filter((t) => t.tokenHash !== hash)
  await org.save()

  return issueSession(user)
}

export async function forgotPassword(email) {
  const user = await User.findOne({ email })
  if (!user) return // never reveal whether an email is registered

  const rawToken = crypto.randomBytes(32).toString('hex')
  user.passwordResetTokenHash = hashToken(rawToken)
  user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000)
  await user.save()

  // No transactional email provider is wired up yet — logging the link is
  // the dev-mode stand-in until one is (see Phase 11+ follow-up work).
  console.log(`[authService] Password reset link for ${email}: /reset-password?token=${rawToken}`)
}

export async function resetPassword({ token, password }) {
  const hash = hashToken(token)
  const user = await User.findOne({
    passwordResetTokenHash: hash,
    passwordResetExpires: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpires +refreshTokens')

  if (!user) throw badRequest('This reset link is invalid or has expired.', 'INVALID_RESET_TOKEN')

  user.password = password
  user.passwordResetTokenHash = undefined
  user.passwordResetExpires = undefined
  user.refreshTokens = [] // force re-login on every device, per architecture spec §08
  await user.save()
}
