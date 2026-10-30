// Verifies the access-token JWT and attaches req.user.
import jwt from 'jsonwebtoken'

import { env } from '../config/index.js'
import { unauthorized } from '../utils/http.js'

export function auth(req, res, next) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return next(unauthorized('Missing access token.'))

  try {
    // No DB lookup — the whole point of a JWT is that this stays stateless
    // and horizontally scalable.
    const payload = jwt.verify(token, env.jwtAccessSecret)
    req.user = { id: payload.sub, orgId: payload.orgId, role: payload.role }
    next()
  } catch {
    next(unauthorized('Invalid or expired access token.'))
  }
}
