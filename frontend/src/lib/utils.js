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

/**
 * The user-facing message from an API error envelope ({ error: { message } }),
 * or a generic fallback for network failures and non-envelope responses.
 */
export function apiErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  return err?.response?.data?.error?.message || fallback
}
