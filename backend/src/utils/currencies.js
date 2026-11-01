// @ts-check
// The ISO 4217 codes an org or a deal may use. Short on purpose: each one has to format correctly in the client.
export const CURRENCIES = /** @type {const} */ (['INR', 'USD', 'EUR', 'GBP'])

/** @typedef {(typeof CURRENCIES)[number]} Currency */
