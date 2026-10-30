// @ts-check
// hashToken(): how refresh, invite and reset tokens are stored (never raw).
import crypto from 'node:crypto'

/**
 * SHA-256 hex digest of a raw token. Only the hash is stored, so a database leak can't be replayed.
 * @param {string} raw
 * @returns {string}
 */
export const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex')
