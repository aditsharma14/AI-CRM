// Adds what middleware/auth.js attaches to every authenticated request.
// The only .d.ts in the project: global augmentation has no JSDoc equivalent.
import type { AuthUser } from './index.js'

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export {}
