// @ts-check
// Typed factories for auth/org tests: real-password users, known invite/reset tokens, session cookies.
import crypto from 'node:crypto'

import request from 'supertest'

import app from '../src/app.js'
import Organization from '../src/models/Organization.js'
import User from '../src/models/User.js'

/** @typedef {import('../src/types/index.js').Role} Role */
/** @typedef {'admin' | 'manager' | 'member'} InvitableRole */
/** @typedef {InstanceType<typeof User>} UserDoc */
/** @typedef {import('mongoose').Types.ObjectId | string} Id */

/**
 * A deliberate copy of the services' token hashing (sha256 hex), so tests can
 * plant tokens the API will accept and assert what it stored.
 * @param {string} raw
 * @returns {string}
 */
export const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex')

/** @returns {string} A fresh raw token, same shape as the services issue. */
const newRawToken = () => crypto.randomBytes(32).toString('hex')

let seq = 0

/**
 * A user who can actually log in: User.create runs the bcrypt pre-save hook,
 * unlike helpers.seedOrg's insertMany users (which only ever use signed tokens).
 * @param {{ _id: Id }} org
 * @param {{ role?: Role, email?: string, password?: string }} [options]
 * @returns {Promise<{ user: UserDoc, email: string, password: string }>}
 */
export async function createUserWithPassword(org, { role = 'member', email, password = 'password123' } = {}) {
  seq += 1
  const address = email ?? `user${seq}.${Date.now()}@factory.test`
  const user = await User.create({ orgId: org._id, name: `${role} ${seq}`, email: address, password, role })
  return { user, email: address, password }
}

/**
 * Plants an invite exactly as orgAdminService.inviteMember stores one (hash
 * only) and returns the raw token — without depending on the dev-only
 * console.log of the invite link, which goes away once email exists.
 * @param {Id} orgId
 * @param {{ email: string, role: InvitableRole, expiresAt?: Date }} invite
 * @returns {Promise<string>} The raw invite token.
 */
export async function issueInvite(orgId, { email, role, expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }) {
  const raw = newRawToken()
  await Organization.updateOne(
    { _id: orgId },
    { $push: { inviteTokens: { tokenHash: hashToken(raw), email, role, expiresAt } } },
  )
  return raw
}

/**
 * Plants a password-reset token as authService.forgotPassword stores one.
 * @param {Id} userId
 * @param {{ expiresAt?: Date }} [options]
 * @returns {Promise<string>} The raw reset token.
 */
export async function issueResetToken(userId, { expiresAt = new Date(Date.now() + 15 * 60 * 1000) } = {}) {
  const raw = newRawToken()
  await User.updateOne({ _id: userId }, { passwordResetTokenHash: hashToken(raw), passwordResetExpires: expiresAt })
  return raw
}

/**
 * The raw refresh token from a response's Set-Cookie, if one was set.
 * @param {import('supertest').Response} res
 * @returns {string | undefined}
 */
export function refreshCookieFrom(res) {
  const header = res.headers['set-cookie']
  const cookies = Array.isArray(header) ? header : header ? [header] : []
  for (const cookie of cookies) {
    const match = /^refreshToken=([^;]*)/.exec(cookie)
    if (match) return match[1]
  }
  return undefined
}

/**
 * The full Set-Cookie line for the refresh cookie (to assert its attributes).
 * @param {import('supertest').Response} res
 * @returns {string | undefined}
 */
export function refreshSetCookieLine(res) {
  const header = res.headers['set-cookie']
  const cookies = Array.isArray(header) ? header : header ? [header] : []
  return cookies.find((cookie) => cookie.startsWith('refreshToken='))
}

/**
 * @param {string} raw
 * @returns {string} A Cookie header value carrying the refresh token.
 */
export const asRefreshCookie = (raw) => `refreshToken=${raw}`

/**
 * Logs in through the API: a real session, i.e. one stored refresh-token hash.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ accessToken: string, refresh: string }>}
 */
export async function login(email, password) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password })
  if (res.status !== 200) throw new Error(`login failed with ${res.status}`)
  const refresh = refreshCookieFrom(res)
  if (!refresh) throw new Error('login set no refresh cookie')
  /** @type {string} */
  const accessToken = res.body.data.accessToken
  return { accessToken, refresh }
}

/**
 * Number of refresh-token hashes stored for a user (one per live session).
 * @param {Id} userId
 * @returns {Promise<number>}
 */
export async function sessionCount(userId) {
  const user = await User.findById(userId).select('+refreshTokens')
  return user?.refreshTokens.length ?? 0
}
