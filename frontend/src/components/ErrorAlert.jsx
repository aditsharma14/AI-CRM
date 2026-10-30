// Shared inline error display for failed API calls: role="alert" so screen readers announce it.
import { apiErrorMessage } from '../lib/utils.js'

/** Pass `error` (an axios error, shown via its envelope message) or a ready `message`; renders nothing if neither. */
export function ErrorAlert({ error, message, className = '' }) {
  const text = message ?? (error ? apiErrorMessage(error) : null)
  if (!text) return null
  return (
    <p
      role="alert"
      className={`mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300 ${className}`}
    >
      {text}
    </p>
  )
}
