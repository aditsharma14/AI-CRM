// Invite-token lifecycle, team/member/role mutations, org config.
import crypto from 'node:crypto'
import Organization from '../models/Organization.js'
import User from '../models/User.js'
import { badRequest, notFound } from '../utils/http.js'

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex')

// ---- Org profile ----

export async function getOrg(orgId) {
  const org = await Organization.findById(orgId)
  if (!org) throw notFound('Organization not found.')
  return org
}

export async function updateOrgProfile(orgId, { name }) {
  const org = await Organization.findByIdAndUpdate(orgId, { name }, { new: true, runValidators: true })
  if (!org) throw notFound('Organization not found.')
  return org
}

// ---- Members ----

export async function listMembers(orgId) {
  return User.find({ orgId }).select('name email role isEmailVerified createdAt').sort({ createdAt: 1 })
}

export async function inviteMember(orgId, { email, role }) {
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

export async function updateMemberRole(orgId, userId, role) {
  if (role === 'owner') throw badRequest('Ownership is transferred separately, not assigned like a role.', 'CANNOT_ASSIGN_OWNER')
  const user = await User.findOneAndUpdate({ _id: userId, orgId, role: { $ne: 'owner' } }, { role }, { new: true }).select(
    'name email role',
  )
  if (!user) throw notFound('Member not found.')
  return user
}

export async function removeMember(orgId, userId) {
  const user = await User.findOneAndDelete({ _id: userId, orgId, role: { $ne: 'owner' } })
  if (!user) throw notFound('Member not found, or you tried to remove the org owner.')
}

// ---- Teams ----

export async function listTeams(orgId) {
  const org = await Organization.findById(orgId).select('teams').populate('teams.memberIds', 'name email')
  if (!org) throw notFound('Organization not found.')
  return org.teams
}

export async function createTeam(orgId, name) {
  const org = await Organization.findByIdAndUpdate(orgId, { $push: { teams: { name, memberIds: [] } } }, { new: true })
  if (!org) throw notFound('Organization not found.')
  return org.teams.at(-1)
}

export async function updateTeam(orgId, teamId, { name, memberIds }) {
  const org = await Organization.findOne({ _id: orgId, 'teams._id': teamId })
  if (!org) throw notFound('Team not found.')
  const team = org.teams.id(teamId)
  if (name !== undefined) team.name = name
  if (memberIds !== undefined) team.memberIds = memberIds
  await org.save()
  return team
}

export async function deleteTeam(orgId, teamId) {
  const org = await Organization.findByIdAndUpdate(orgId, { $pull: { teams: { _id: teamId } } })
  if (!org) throw notFound('Organization not found.')
}

// ---- Pipeline stages ----

export async function getPipelineStages(orgId) {
  const org = await Organization.findById(orgId).select('pipelineStages')
  if (!org) throw notFound('Organization not found.')
  return org.pipelineStages
}

export async function updatePipelineStages(orgId, stages) {
  const org = await Organization.findByIdAndUpdate(orgId, { pipelineStages: stages }, { new: true, runValidators: true })
  if (!org) throw notFound('Organization not found.')
  return org.pipelineStages
}

// ---- Email templates ----

export async function listEmailTemplates(orgId) {
  const org = await Organization.findById(orgId).select('emailTemplates')
  if (!org) throw notFound('Organization not found.')
  return org.emailTemplates
}

export async function createEmailTemplate(orgId, template) {
  const org = await Organization.findByIdAndUpdate(orgId, { $push: { emailTemplates: template } }, { new: true })
  if (!org) throw notFound('Organization not found.')
  return org.emailTemplates.at(-1)
}

export async function updateEmailTemplate(orgId, templateId, updates) {
  const org = await Organization.findOne({ _id: orgId, 'emailTemplates._id': templateId })
  if (!org) throw notFound('Email template not found.')
  Object.assign(org.emailTemplates.id(templateId), updates)
  await org.save()
  return org.emailTemplates.id(templateId)
}

export async function deleteEmailTemplate(orgId, templateId) {
  const org = await Organization.findByIdAndUpdate(orgId, { $pull: { emailTemplates: { _id: templateId } } })
  if (!org) throw notFound('Organization not found.')
}

// ---- "Me" — the signed-in user's own profile ----

export async function updateProfile(userId, { name, avatarUrl }) {
  const user = await User.findByIdAndUpdate(userId, { name, avatarUrl }, { new: true, runValidators: true })
  if (!user) throw notFound('Account not found.')
  return user
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+password +refreshTokens')
  if (!user || !(await user.comparePassword(currentPassword))) {
    throw badRequest('Current password is incorrect.', 'INVALID_PASSWORD')
  }
  user.password = newPassword
  user.refreshTokens = [] // force re-login everywhere, same as a reset-password flow
  await user.save()
}
