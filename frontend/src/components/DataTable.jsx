// Generic sortable, paginated, entity-agnostic table.
import { cn } from '../lib/utils.js'
import { Loader, EmptyState, Button } from './ui.jsx'

/**
 * columns: [{ key, header, render?(row) }]
 * meta: { page, limit, total, hasMore } from the API envelope
 */
export function DataTable({
  columns,
  rows = [],
  isLoading,
  isError,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  onRowClick,
  meta,
  onPageChange,
  sort,
  onSortChange,
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader className="h-6 w-6" />
      </div>
    )
  }

  if (isError) {
    return <EmptyState title="Couldn't load this list" description="Please try again." />
  }

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border dark:border-border-dark">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border bg-black/[0.02] dark:border-border-dark dark:bg-white/[0.03]">
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-2 text-left font-medium text-muted dark:text-muted-dark">
                {onSortChange && col.sortable ? (
                  <button
                    type="button"
                    onClick={() => onSortChange(col.key)}
                    className="flex items-center gap-1 hover:text-text dark:hover:text-text-dark"
                  >
                    {col.header}
                    {sort?.field === col.key && <span>{sort.direction === 'desc' ? '↓' : '↑'}</span>}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row._id ?? row.id}
              onClick={() => onRowClick?.(row)}
              className={cn(
                'border-b border-border last:border-0 dark:border-border-dark',
                onRowClick && 'cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
              )}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-2.5">
                  {col.render ? col.render(row) : (row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {meta && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted dark:border-border-dark dark:text-muted-dark">
          <span>
            {meta.total} total · page {meta.page} of {Math.max(1, Math.ceil(meta.total / meta.limit))}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
              Prev
            </Button>
            <Button variant="secondary" disabled={!meta.hasMore} onClick={() => onPageChange(meta.page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
