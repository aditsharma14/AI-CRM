// Shared inline error display for failed API calls: role="alert" so screen readers announce it.
import { apiErrorMessage } from '../lib/utils.js'

/**
 * Pass `error` (an axios error, shown via its envelope message) or a ready `message`; renders nothing if neither.
 * `onRetry` adds a Retry button, for a failed load (a failed save is retried by saving again).
 */
export function ErrorAlert({ error, message, onRetry, className = '' }) {
  const text = message ?? (error ? apiErrorMessage(error) : null)
  if (!text) return null
  return (
    <div
      role="alert"
      className={`mb-4 flex items-center justify-between gap-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300 ${className}`}
    >
      <p>{text}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  )
}
