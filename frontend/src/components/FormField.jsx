// Input wrapper with label, error and help text.
import { cloneElement, isValidElement, useId } from 'react'

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

/**
 * Wires its one input to the label (an id is generated if neither `htmlFor` nor the input has one) and to the
 * error or hint below it, through aria-invalid and aria-describedby, so screen readers read the message.
 */
export function FormField({ label, htmlFor, error, hint, children }) {
  const generatedId = useId()
  const id = htmlFor ?? (isValidElement(children) ? children.props.id : undefined) ?? generatedId
  const messageId = `${id}-message`
  const message = error?.message ?? hint
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': message ? messageId : undefined,
      })
    : children

  return (
    <div className="mb-4">
      {label && (
        <label htmlFor={id} className="mb-1 block text-sm font-medium">
          {label}
        </label>
      )}
      {control}
      {error ? (
        <p id={messageId} className="mt-1 text-xs text-danger">
          {error.message}
        </p>
      ) : (
        hint && (
          <p id={messageId} className="mt-1 text-xs text-muted dark:text-muted-dark">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
