// Formatters (date, currency, initials) and classNames helper.

export function cn(...parts) {
  return parts.filter(Boolean).join(' ')
}

export function formatDate(value, options = { dateStyle: 'medium' }) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value))
}

export function formatDateTime(value) {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatCurrency(value, currency = 'USD') {
  if (value == null) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

export function initials(name = '') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export const SAVE_FAILED = "Something went wrong on our side. Your changes weren't saved. Try again."

/**
 * The user-facing message for a failed API call:
 * - 4xx: the server's envelope message ({ error: { message } }), which says what to fix;
 * - 5xx: `serverError`, because the server's own text ("Internal server error") isn't for users;
 * - no response at all: a network message, so a dropped connection isn't blamed on the server.
 */
export function apiErrorMessage(err, { serverError = 'Something went wrong on our side. Please try again.' } = {}) {
  if (err?.response == null) return "Can't reach the server. Check your connection and try again."
  if (err.response.status >= 500) return serverError
  return err.response.data?.error?.message || serverError
}
