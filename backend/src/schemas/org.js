// @ts-check
// Org admin and "me" request schemas — validators plus z.infer input types for orgAdminService.
import { z } from 'zod'
import { objectId, email, password } from '../utils/validators.js'

export const orgProfileUpdate = z.object({ name: z.string().trim().min(2) })

// 'owner' is deliberately absent: ownership is transferred, never assigned.
const assignableRole = z.enum(['admin', 'manager', 'member'])

export const memberInvite = z.object({ email, role: assignableRole })

export const memberRoleUpdate = z.object({ role: assignableRole })

export const teamCreate = z.object({ name: z.string().trim().min(1) })

export const teamUpdate = z.object({ name: z.string().trim().min(1).optional(), memberIds: z.array(objectId).optional() })

export const pipelineStagesUpdate = z.array(
  z.object({ key: z.string().trim().min(1), label: z.string().trim().min(1), order: z.number() }),
)

export const emailTemplateCreate = z.object({
  name: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
})

export const emailTemplateUpdate = emailTemplateCreate.partial()

export const profileUpdate = z.object({ name: z.string().trim().min(1).optional(), avatarUrl: z.string().trim().optional() })

export const passwordChange = z.object({ currentPassword: z.string().min(1), newPassword: password })

/** @typedef {z.infer<typeof assignableRole>} AssignableRole */
/** @typedef {z.infer<typeof orgProfileUpdate>} OrgProfileUpdateInput */
/** @typedef {z.infer<typeof memberInvite>} MemberInviteInput */
/** @typedef {z.infer<typeof teamUpdate>} TeamUpdateInput */
/** @typedef {z.infer<typeof pipelineStagesUpdate>} PipelineStagesInput */
/** @typedef {z.infer<typeof emailTemplateCreate>} EmailTemplateInput */
/** @typedef {z.infer<typeof emailTemplateUpdate>} EmailTemplateUpdateInput */
/** @typedef {z.infer<typeof profileUpdate>} ProfileUpdateInput */
/** @typedef {z.infer<typeof passwordChange>} PasswordChangeInput */
