// @ts-check
// ttlToMs(): REFRESH_TOKEN_TTL-style durations ('30s', '15m', '2h', '7d') in milliseconds.

const UNIT_MS = /** @type {const} */ ({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 })

/**
 * A positive whole number followed by one unit: s, m, h or d. Anything else throws, so a typo in an env
 * var fails at boot instead of silently becoming a different lifetime.
 * @param {string} ttl
 * @returns {number}
 * @throws {Error} on anything but `<positive integer><s|m|h|d>`
 */
export function ttlToMs(ttl) {
  const match = /^([1-9]\d*)([smhd])$/.exec(ttl)
  if (!match) throw new Error(`REFRESH_TOKEN_TTL must be a duration like 30s, 15m, 2h or 7d (got "${ttl}").`)
  const [, amount, unit] = match
  return Number(amount) * UNIT_MS[/** @type {keyof typeof UNIT_MS} */ (unit)]
}
