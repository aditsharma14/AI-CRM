// Register org, login, refresh, logout, accept invite, password reset.
import { Router } from 'express'

import { env } from '../config/index.js'
import { validate } from '../middleware/guards.js'
import { acceptInvite, forgotPassword, login, registerOrg, resetPassword } from '../schemas/auth.js'
import * as authService from '../services/authService.js'
import { ttlToMs } from '../utils/duration.js'
import { apiResponse, asyncHandler } from '../utils/http.js'

const router = Router()

const REFRESH_COOKIE = 'refreshToken'
const REFRESH_COOKIE_PATH = '/api/v1/auth'

/** Read per response, so the lifetime always matches REFRESH_TOKEN_TTL (validated at boot in config). */
const cookieOptions = () => ({
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
  maxAge: ttlToMs(env.refreshTokenTtl),
})

function sendSession(res, { accessToken, rawRefresh, user }) {
  res.cookie(REFRESH_COOKIE, rawRefresh, cookieOptions())
  return apiResponse(res, { accessToken, user })
}

router.post(
  '/register-org',
  validate({ body: registerOrg }),
  asyncHandler(async (req, res) => {
    sendSession(res, await authService.registerOrg(req.body))
  }),
)

router.post(
  '/login',
  validate({ body: login }),
  asyncHandler(async (req, res) => {
    sendSession(res, await authService.login(req.body))
  }),
)

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    sendSession(res, await authService.refresh(req.cookies[REFRESH_COOKIE]))
  }),
)

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await authService.logout(req.cookies[REFRESH_COOKIE])
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH })
    apiResponse(res, null)
  }),
)

router.post(
  '/accept-invite',
  validate({ body: acceptInvite }),
  asyncHandler(async (req, res) => {
    sendSession(res, await authService.acceptInvite(req.body))
  }),
)

router.post(
  '/forgot-password',
  validate({ body: forgotPassword }),
  asyncHandler(async (req, res) => {
    await authService.forgotPassword(req.body.email)
    apiResponse(res, null)
  }),
)

router.post(
  '/reset-password',
  validate({ body: resetPassword }),
  asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body)
    apiResponse(res, null)
  }),
)

export default router
