// @ts-check
// The convention for orgs made by scripts/smoke.mjs: owners use this reserved domain (.invalid can never be a real
// address, RFC 2606), and registerOrg marks their org isSmoke, so cross-org reads can leave them out and count them.

export const SMOKE_EMAIL_DOMAIN = 'smoke.nimbus.invalid'

/**
 * @param {string} email
 * @returns {boolean}
 */
export const isSmokeEmail = (email) => email.toLowerCase().endsWith(`@${SMOKE_EMAIL_DOMAIN}`)
