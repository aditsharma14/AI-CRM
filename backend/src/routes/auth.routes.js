// Register org, login, refresh, logout, password reset, email verify.
import { Router } from 'express'

import { env } from '../config/index.js'
import { validate } from '../middleware/guards.js'
import { acceptInvite, forgotPassword, login, registerOrg, resetPassword } from '../schemas/auth.js'
import * as authService from '../services/authService.js'
import { apiResponse } from '../utils/http.js'

const router = Router()

const REFRESH_COOKIE = 'refreshToken'
const cookieOptions = {
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
}

function sendSession(res, { accessToken, rawRefresh, user }) {
  res.cookie(REFRESH_COOKIE, rawRefresh, cookieOptions)
  return apiResponse(res, { accessToken, user })
}

router.post('/register-org', validate({ body: registerOrg }), async (req, res, next) => {
  try {
    sendSession(res, await authService.registerOrg(req.body))
  } catch (err) {
    next(err)
  }
})

router.post('/login', validate({ body: login }), async (req, res, next) => {
  try {
    sendSession(res, await authService.login(req.body))
  } catch (err) {
    next(err)
  }
})

router.post('/refresh', async (req, res, next) => {
  try {
    sendSession(res, await authService.refresh(req.cookies[REFRESH_COOKIE]))
  } catch (err) {
    next(err)
  }
})

router.post('/logout', async (req, res, next) => {
  try {
    await authService.logout(req.cookies[REFRESH_COOKIE])
    res.clearCookie(REFRESH_COOKIE, { path: cookieOptions.path })
    apiResponse(res, null)
  } catch (err) {
    next(err)
  }
})

router.post('/accept-invite', validate({ body: acceptInvite }), async (req, res, next) => {
  try {
    sendSession(res, await authService.acceptInvite(req.body))
  } catch (err) {
    next(err)
  }
})

router.post('/forgot-password', validate({ body: forgotPassword }), async (req, res, next) => {
  try {
    await authService.forgotPassword(req.body.email)
    apiResponse(res, null)
  } catch (err) {
    next(err)
  }
})

router.post('/reset-password', validate({ body: resetPassword }), async (req, res, next) => {
  try {
    await authService.resetPassword(req.body)
    apiResponse(res, null)
  } catch (err) {
    next(err)
  }
})

export default router
