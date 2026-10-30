// Small stateless primitives: Button, Badge, Loader, EmptyState, StatCard, Tabs.
import { cn } from '../lib/utils.js'

const BUTTON_VARIANTS = {
  primary: 'bg-primary text-white hover:opacity-90 disabled:opacity-50',
  secondary: 'border border-border hover:bg-black/[0.03] dark:border-border-dark dark:hover:bg-white/[0.05]',
  ghost: 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
  danger: 'bg-danger text-white hover:opacity-90 disabled:opacity-50',
}

export function Button({ variant = 'primary', className, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

const BADGE_VARIANTS = {
  default: 'bg-black/5 text-text dark:bg-white/10 dark:text-text-dark',
  success: 'bg-success/10 text-success dark:text-success-dark',
  warning: 'bg-warning/10 text-warning dark:text-warning-dark',
  danger: 'bg-danger/10 text-danger dark:text-danger-dark',
}

export function Badge({ variant = 'default', className, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide',
        BADGE_VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Loader({ className }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  )
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-10 text-center dark:border-border-dark">
      <p className="font-serif text-base font-semibold">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted dark:text-muted-dark">{description}</p>}
      {action}
    </div>
  )
}

// Icon tint per stat card — a fixed lookup instead of building the class
// name from a variable, because Tailwind only generates classes it can see
// literally written out somewhere (see the index.css note for the same rule).
const STAT_ICON_COLORS = {
  primary: 'bg-primary-50 text-primary dark:bg-primary/10 dark:text-primary-dark',
  success: 'bg-success/10 text-success dark:text-success-dark',
  warning: 'bg-warning/10 text-warning dark:text-warning-dark',
  danger: 'bg-danger/10 text-danger dark:text-danger-dark',
  accent: 'bg-accent-50 text-accent dark:bg-accent/10 dark:text-accent-dark',
}

/** A single dashboard KPI number in a card, e.g. "Open Pipeline · $42,000". */
export function StatCard({ icon: Icon, label, value, tone = 'primary' }) {
  return (
    // A named group, so assistive tech (and tests) can find "the Win rate card".
    <div role="group" aria-label={label} className="rounded-lg border border-border bg-card p-4 dark:border-border-dark dark:bg-card-dark">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted dark:text-muted-dark">{label}</p>
        {Icon && (
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-md', STAT_ICON_COLORS[tone])}>
            <Icon size={15} strokeWidth={1.75} />
          </span>
        )}
      </div>
      <p className="font-serif text-2xl font-semibold">{value}</p>
    </div>
  )
}

/** Simple tab strip. `tabs` is [{ key, label }]; caller owns the active state. */
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 border-b border-border dark:border-border-dark">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
            active === tab.key
              ? 'border-primary text-primary dark:border-primary-dark dark:text-primary-dark'
              : 'border-transparent text-muted hover:text-text dark:text-muted-dark dark:hover:text-text-dark',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
