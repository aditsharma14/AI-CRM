// Input wrapper with label, error and help text.
import { cn } from '../lib/utils.js'

// Kept beside FormField since it's the input styling half of the same
// label/error/hint convention, not a general-purpose utility.
// eslint-disable-next-line react-refresh/only-export-components
export function inputClasses(hasError) {
  return cn(
    'w-full rounded-md border bg-surface px-3 py-2 text-sm outline-none dark:bg-surface-dark',
    'focus:border-primary focus:ring-1 focus:ring-primary',
    hasError ? 'border-danger' : 'border-border dark:border-border-dark',
  )
}

export function FormField({ label, htmlFor, error, hint, children }) {
  return (
    <div className="mb-4">
      {label && (
        <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-xs text-danger">{error.message}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-muted dark:text-muted-dark">{hint}</p>
      )}
    </div>
  )
}
