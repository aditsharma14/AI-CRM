// Adds what middleware/auth.js (and middleware/idempotency.js, when a key was sent) attaches to a request.
// The only .d.ts in the project: global augmentation has no JSDoc equivalent.
import type { ClientSession } from 'mongoose'

import type { AuthUser } from './index.js'

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      idempotency?: {
        /** A callback that stores `status` and the envelope of its data as the done record, inside `session`. */
        saveInside: (status: number) => (data: unknown, session: ClientSession) => Promise<void>
      }
    }
  }
}

export {}
