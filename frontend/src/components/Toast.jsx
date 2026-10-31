// A short confirmation that announces itself (role="status") and goes away on its own or when dismissed.
import { X } from 'lucide-react'
import { useEffect } from 'react'

/** Renders nothing without a `message`. Calls `onDismiss` after `duration` ms or when the user closes it. */
export function Toast({ message, onDismiss, duration = 8000 }) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [message, onDismiss, duration])

  if (!message) return null
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md bg-text px-4 py-3 text-sm text-white shadow-soft dark:bg-text-dark dark:text-background-dark"
    >
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  )
}
