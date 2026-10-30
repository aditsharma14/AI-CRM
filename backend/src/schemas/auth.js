// @ts-check
// Auth request schemas — validators plus z.infer input types for authService.
import { z } from 'zod'

import { email, password } from '../utils/validators.js'

export const registerOrg = z.object({
  orgName: z.string().trim().min(2),
  name: z.string().trim().min(1),
  email,
  password,
})

// Login doesn't re-apply the password-strength rule: an old, weaker password
// must still be able to sign in.
export const login = z.object({ email, password: z.string().min(1) })

export const acceptInvite = z.object({ token: z.string().min(1), name: z.string().trim().min(1), password })

export const forgotPassword = z.object({ email })

export const resetPassword = z.object({ token: z.string().min(1), password })

/** @typedef {z.infer<typeof registerOrg>} RegisterOrgInput */
/** @typedef {z.infer<typeof login>} LoginInput */
/** @typedef {z.infer<typeof acceptInvite>} AcceptInviteInput */
/** @typedef {z.infer<typeof resetPassword>} ResetPasswordInput */
