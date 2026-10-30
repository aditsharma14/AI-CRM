// @ts-check
// Invite-token lifecycle, team/member/role mutations, org config.
import crypto from 'node:crypto'

import Organization from '../models/Organization.js'
import User from '../models/User.js'
import { assertCanAssign, assertNotSelf, manageableRoles, memberMissOrForbidden } from '../policies/membership.js'
import { assertReferencesInOrg, scopedPopulate } from '../policies/references.js'
import { badRequest, notFound } from '../utils/http.js'
import { hashToken } from '../utils/tokens.js'

/** @typedef {import('../types/index.js').Role} Role */
/** @typedef {import('../types/index.js').AuthUser} AuthUser */
/** @typedef {InstanceType<typeof Organization>} OrgDoc */
/** @typedef {InstanceType<typeof User>} UserDoc */
/** @typedef {import('../utils/http.js').AppError} AppError */

// ---- Org profile ----

/**
 * @param {string} orgId
 * @returns {Promise<OrgDoc>}
 * @throws {AppError} 404
 */
export async function getOrg(orgId) {
  const org = await Organization.findById(orgId)
  if (!org) throw notFound('Organization not found.')
  return org
}

/**
 * @param {string} orgId
 * @param {import('../schemas/org.js').OrgProfileUpdateInput} input
 * @returns {Promise<OrgDoc>}
 * @throws {AppError} 404
 */
export async function updateOrgProfile(orgId, { name }) {
  const org = await Organization.findByIdAndUpdate(orgId, { name }, { new: true, runValidators: true })
  if (!org) throw notFound('Organization not found.')
  return org
}

// ---- Members ----

/**
 * @param {string} orgId
 * @returns {Promise<UserDoc[]>}
 */
export async function listMembers(orgId) {
  return User.find({ orgId }).select('name email role isEmailVerified createdAt').sort({ createdAt: 1 })
}

/**
 * Inviting with a role grants it, so the same owner-only admin rule applies.
 * @param {AuthUser} actor
 * @param {import('../schemas/org.js').MemberInviteInput} input
 * @returns {Promise<void>}
 * @throws {AppError} 400 EMAIL_TAKEN, 403, 404
 */
export async function inviteMember(actor, { email, role }) {
  assertCanAssign(actor, role)
  const orgId = actor.orgId
  const existing = await User.findOne({ email })
  if (existing) throw badRequest('An account with this email already exists.', 'EMAIL_TAKEN')

  const org = await Organization.findById(orgId).select('+inviteTokens')
  if (!org) throw notFound('Organization not found.')

  const rawToken = crypto.randomBytes(32).toString('hex')
  org.inviteTokens.push({
    tokenHash: hashToken(rawToken),
    email,
    role,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })
  await org.save()

  // Same dev-mode stand-in as authService.forgotPassword — no email
  // provider wired up yet, so the invite link is logged instead.
  console.log(`[orgAdminService] Invite link for ${email}: /invite/${rawToken}`)
}

/**
 * Policy (policies/membership.js): only the owner manages admins or grants
 * admin, nobody re-roles themselves, the owner is never a target (404).
 * `role` is typed as any Role (owner included) on purpose: the owner guard
 * below protects callers that bypass the route's Zod enum.
 * @param {AuthUser} actor
 * @param {string} userId
 * @param {Role} role
 * @returns {Promise<UserDoc>}
 * @throws {AppError} 400 CANNOT_ASSIGN_OWNER, 403, 404
 */
export async function updateMemberRole(actor, userId, role) {
  if (role === 'owner')
    throw badRequest('Ownership is transferred separately, not assigned like a role.', 'CANNOT_ASSIGN_OWNER')
  assertNotSelf(actor, userId, 'change your own role')
  assertCanAssign(actor, role)
  // One atomic, role-scoped write: a member the actor can't manage is simply
  // not matched, so there's no check-then-write race.
  const user = await User.findOneAndUpdate(
    { _id: userId, orgId: actor.orgId, role: { $in: manageableRoles(actor) } },
    { role },
    { new: true },
  ).select('name email role')
  if (!user) throw await memberMissOrForbidden(User, actor, userId)
  return user
}

/**
 * Same policy as updateMemberRole: admins are owner-managed, never yourself.
 * @param {AuthUser} actor
 * @param {string} userId
 * @returns {Promise<void>}
 * @throws {AppError} 403, 404 (also for the org owner, who can't be removed)
 */
export async function removeMember(actor, userId) {
  assertNotSelf(actor, userId, 'remove yourself')
  const user = await User.findOneAndDelete({ _id: userId, orgId: actor.orgId, role: { $in: manageableRoles(actor) } })
  if (!user)
    throw await memberMissOrForbidden(User, actor, userId, 'Member not found, or you tried to remove the org owner.')
}

// ---- Teams ----

/**
 * @param {string} orgId
 * @returns {Promise<OrgDoc['teams']>}
 * @throws {AppError} 404
 */
export async function listTeams(orgId) {
  const org = await Organization.findById(orgId)
    .select('teams')
    .populate(scopedPopulate({ path: 'teams.memberIds', select: 'name email' }, orgId))
  if (!org) throw notFound('Organization not found.')
  return org.teams
}

/**
 * @param {string} orgId
 * @param {string} name
 * @returns {Promise<OrgDoc['teams'][number] | undefined>} The new team.
 * @throws {AppError} 404
 */
export async function createTeam(orgId, name) {
  const org = await Organization.findByIdAndUpdate(orgId, { $push: { teams: { name, memberIds: [] } } }, { new: true })
  if (!org) throw notFound('Organization not found.')
  return org.teams.at(-1)
}

/**
 * @param {string} orgId
 * @param {string} teamId
 * @param {import('../schemas/org.js').TeamUpdateInput} input
 * @returns {Promise<OrgDoc['teams'][number]>}
 * @throws {AppError} 400 VALIDATION_ERROR (a member outside the org), 404
 */
export async function updateTeam(orgId, teamId, { name, memberIds }) {
  await assertReferencesInOrg(orgId, [{ field: 'memberIds', model: User, ids: memberIds }])
  const org = await Organization.findOne({ _id: orgId, 'teams._id': teamId })
  if (!org) throw notFound('Team not found.')
  const team = org.teams.id(teamId)
  // Unreachable — the query above only matches an org holding this team —
  // but it's what lets the checker know `team` isn't null.
  if (!team) throw notFound('Team not found.')
  if (name !== undefined) team.name = name
  if (memberIds !== undefined) team.set('memberIds', memberIds)
  await org.save()
  return team
}

/**
 * @param {string} orgId
 * @param {string} teamId
 * @returns {Promise<void>}
 * @throws {AppError} 404
 */
export async function deleteTeam(orgId, teamId) {
  // Matching on the team id too makes "no such team in this org" a miss
  // (404) in the same atomic write, instead of a silent no-op 200.
  const org = await Organization.findOneAndUpdate(
    { _id: orgId, 'teams._id': teamId },
    { $pull: { teams: { _id: teamId } } },
  )
  if (!org) throw notFound('Team not found.')
}

// ---- Pipeline stages ----

/**
 * @param {string} orgId
 * @returns {Promise<OrgDoc['pipelineStages']>}
 * @throws {AppError} 404
 */
export async function getPipelineStages(orgId) {
  const org = await Organization.findById(orgId).select('pipelineStages')
  if (!org) throw notFound('Organization not found.')
  return org.pipelineStages
}

/**
 * @param {string} orgId
 * @param {import('../schemas/org.js').PipelineStagesInput} stages
 * @returns {Promise<OrgDoc['pipelineStages']>}
 * @throws {AppError} 404
 */
export async function updatePipelineStages(orgId, stages) {
  const org = await Organization.findByIdAndUpdate(
    orgId,
    { pipelineStages: stages },
    { new: true, runValidators: true },
  )
  if (!org) throw notFound('Organization not found.')
  return org.pipelineStages
}

// ---- Email templates ----

/**
 * @param {string} orgId
 * @returns {Promise<OrgDoc['emailTemplates']>}
 * @throws {AppError} 404
 */
export async function listEmailTemplates(orgId) {
  const org = await Organization.findById(orgId).select('emailTemplates')
  if (!org) throw notFound('Organization not found.')
  return org.emailTemplates
}

/**
 * @param {string} orgId
 * @param {import('../schemas/org.js').EmailTemplateInput} template
 * @returns {Promise<OrgDoc['emailTemplates'][number] | undefined>} The new template.
 * @throws {AppError} 404
 */
export async function createEmailTemplate(orgId, template) {
  const org = await Organization.findByIdAndUpdate(orgId, { $push: { emailTemplates: template } }, { new: true })
  if (!org) throw notFound('Organization not found.')
  return org.emailTemplates.at(-1)
}

/**
 * @param {string} orgId
 * @param {string} templateId
 * @param {import('../schemas/org.js').EmailTemplateUpdateInput} updates
 * @returns {Promise<OrgDoc['emailTemplates'][number]>}
 * @throws {AppError} 404
 */
export async function updateEmailTemplate(orgId, templateId, updates) {
  const org = await Organization.findOne({ _id: orgId, 'emailTemplates._id': templateId })
  if (!org) throw notFound('Email template not found.')
  const template = org.emailTemplates.id(templateId)
  // Unreachable for the same reason as in updateTeam; narrows the type.
  if (!template) throw notFound('Email template not found.')
  Object.assign(template, updates)
  await org.save()
  return template
}

/**
 * @param {string} orgId
 * @param {string} templateId
 * @returns {Promise<void>}
 * @throws {AppError} 404
 */
export async function deleteEmailTemplate(orgId, templateId) {
  // Same as deleteTeam: an unknown template id is a 404, not a no-op.
  const org = await Organization.findOneAndUpdate(
    { _id: orgId, 'emailTemplates._id': templateId },
    { $pull: { emailTemplates: { _id: templateId } } },
  )
  if (!org) throw notFound('Email template not found.')
}

// ---- "Me" — the signed-in user's own profile ----

/**
 * @param {string} userId
 * @param {import('../schemas/org.js').ProfileUpdateInput} input
 * @returns {Promise<UserDoc>}
 * @throws {AppError} 404
 */
export async function updateProfile(userId, { name, avatarUrl }) {
  const user = await User.findByIdAndUpdate(userId, { name, avatarUrl }, { new: true, runValidators: true })
  if (!user) throw notFound('Account not found.')
  return user
}

/**
 * @param {string} userId
 * @param {import('../schemas/org.js').PasswordChangeInput} input
 * @returns {Promise<void>}
 * @throws {AppError} 400 INVALID_PASSWORD
 */
export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+password +refreshTokens')
  if (!user || !(await user.comparePassword(currentPassword))) {
    throw badRequest('Current password is incorrect.', 'INVALID_PASSWORD')
  }
  user.password = newPassword
  user.set('refreshTokens', []) // force re-login everywhere, same as a reset-password flow
  await user.save()
}
